import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSide, classifyCornerBet, collectCornerMarkets, isPlausibleLine,
  pickPrincipalLine, plausibleLines, parseMatchWinner, summarizeOdds,
} from '../src/api/oddsParser.js';

const BOUNDS = { full: { min: 7.5, max: 16.5 }, ht: { min: 2.5, max: 8.5 } };

test('parseSide entende Over/Under e mais/menos', () => {
  assert.deepEqual(parseSide('Over 9.5'), { side: 'over', line: 9.5 });
  assert.deepEqual(parseSide('Under 10'), { side: 'under', line: 10 });
  assert.deepEqual(parseSide('Mais de 8.5'), { side: 'over', line: 8.5 });
  assert.equal(parseSide('Yes'), null);
  assert.equal(parseSide(null), null);
});

test('classifyCornerBet usa o ID: 45=full, 77=ht, ignora 57/58/85/338', () => {
  assert.equal(classifyCornerBet({ id: 45, name: 'Corners Over Under' }), 'full');
  assert.equal(classifyCornerBet({ id: 77, name: 'Total Corners 1st Half' }), 'ht');
  assert.equal(classifyCornerBet({ id: 57, name: 'Home Corners' }), null);
  assert.equal(classifyCornerBet({ id: 58, name: 'Away Corners' }), null);
  assert.equal(classifyCornerBet({ id: 85, name: 'Total Corners (3-way)' }), null);
  assert.equal(classifyCornerBet({ id: 338, name: 'Corners Odd/Even' }), null);
});

test('classifyCornerBet usa o nome só como reserva (sem id reconhecível)', () => {
  // id desconhecido, mas nome claro de total → full
  assert.equal(classifyCornerBet({ id: 9999, name: 'Total Corners' }), 'full');
  // id desconhecido, nome de 1º tempo → ht
  assert.equal(classifyCornerBet({ id: 9999, name: 'Corners Over/Under 1st Half' }), 'ht');
  // id desconhecido, nome "por time" → rejeita mesmo sendo canto
  assert.equal(classifyCornerBet({ id: 9999, name: 'Home Team Corners' }), null);
  // nome de par/ímpar → rejeita
  assert.equal(classifyCornerBet({ id: 9999, name: 'Corners Odd/Even' }), null);
});

test('isPlausibleLine respeita a faixa', () => {
  assert.equal(isPlausibleLine(9.5, BOUNDS.full), true);
  assert.equal(isPlausibleLine(4.5, BOUNDS.full), false); // canto de um time pego por engano
  assert.equal(isPlausibleLine(20, BOUNDS.full), false);
  assert.equal(isPlausibleLine(4.5, BOUNDS.ht), true);
});

// Monta um fixture de odds com 3 casas oferecendo a linha 9.5 com odds diferentes.
function fixtureOdds() {
  return {
    bookmakers: [
      { id: 1, name: 'CasaA', bets: [
        { id: 45, name: 'Corners Over Under', values: [
          { value: 'Over 9.5', odd: '1.85' }, { value: 'Under 9.5', odd: '1.95' },
          { value: 'Over 10.5', odd: '2.20' }, { value: 'Under 10.5', odd: '1.65' },
        ] },
        { id: 57, name: 'Home Corners', values: [ { value: 'Over 4.5', odd: '1.90' } ] }, // IGNORAR
        { id: 1, name: 'Match Winner', values: [
          { value: 'Home', odd: '1.50' }, { value: 'Draw', odd: '4.0' }, { value: 'Away', odd: '6.5' },
        ] },
      ] },
      { id: 2, name: 'CasaB', bets: [
        { id: 45, name: 'Corners Over Under', values: [
          { value: 'Over 9.5', odd: '1.92' }, { value: 'Under 9.5', odd: '1.88' },
        ] },
        { id: 77, name: 'Total Corners 1st Half', values: [
          { value: 'Over 4.5', odd: '2.10' }, { value: 'Under 4.5', odd: '1.70' },
        ] },
      ] },
      { id: 3, name: 'CasaC', bets: [
        { id: 45, name: 'Corners Over Under', values: [
          { value: 'Over 9.5', odd: '1.90' },
        ] },
      ] },
    ],
  };
}

test('line shopping: pega a MELHOR over entre as casas, guardando qual casa', () => {
  const { full } = collectCornerMarkets(fixtureOdds());
  const l95 = full.get(9.5);
  assert.equal(l95.bestOver.odd, 1.92);          // CasaB é a melhor over de 9.5
  assert.equal(l95.bestOver.bookmaker, 'CasaB');
  assert.equal(l95.bestUnder.odd, 1.95);          // melhor under de 9.5 é CasaA
  assert.equal(l95.bestUnder.bookmaker, 'CasaA');
});

test('linhas implausíveis (canto de um time) são descartadas pelo picker', () => {
  const { full } = collectCornerMarkets(fixtureOdds());
  // a linha 4.5 do mercado id 57 nem entrou (foi ignorada por id), garante:
  assert.equal(full.has(4.5), false);
  const principal = pickPrincipalLine(full, BOUNDS.full);
  assert.ok(principal.line >= 7.5 && principal.line <= 16.5);
});

test('pickPrincipalLine escolhe a linha mais equilibrada (over perto de 2.0)', () => {
  const { full } = collectCornerMarkets(fixtureOdds());
  const principal = pickPrincipalLine(full, BOUNDS.full);
  // 9.5 (over ~1.92, dist 0.08) é mais central que 10.5 (over 2.20, dist 0.20)
  assert.equal(principal.line, 9.5);
  assert.equal(principal.overOdd, 1.92);
  assert.equal(principal.bookmaker, 'CasaB');
});

test('plausibleLines devolve todas as linhas ordenadas (pro disparo por EV)', () => {
  const { full } = collectCornerMarkets(fixtureOdds());
  const lines = plausibleLines(full, BOUNDS.full);
  assert.deepEqual(lines.map((l) => l.line), [9.5, 10.5]);
});

test('parseMatchWinner acha o favorito pela menor odd', () => {
  const mw = parseMatchWinner(fixtureOdds());
  assert.equal(mw.favorite, 'home');
  assert.equal(mw.home, 1.5);
});

test('summarizeOdds junta tudo: full, ht, favorito e raw', () => {
  const s = summarizeOdds(fixtureOdds(), BOUNDS);
  assert.equal(s.full.line, 9.5);
  assert.equal(s.ht.line, 4.5);
  assert.equal(s.ht.overOdd, 2.10);
  assert.equal(s.matchWinner.favorite, 'home');
  // raw inclui os mercados de cantos (full+ht), não o 1x2 nem o id 57? (57 é canto, entra no raw)
  assert.ok(s.raw.length >= 3);
});

test('jogo sem mercado de cantos → full e ht nulos (sem inventar valor)', () => {
  const s = summarizeOdds({ bookmakers: [{ id: 1, name: 'X', bets: [
    { id: 1, name: 'Match Winner', values: [{ value: 'Home', odd: '2.0' }, { value: 'Away', odd: '3.0' }] },
  ] }] }, BOUNDS);
  assert.equal(s.full, null);
  assert.equal(s.ht, null);
});
