import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/db/migrate.js';
import { writeOddsToFixture, captureFixtureOdds, diagnoseCornerOdds } from '../src/services/oddsCapture.js';

const BOUNDS = { full: { min: 7.5, max: 16.5 }, ht: { min: 2.5, max: 8.5 } };

function dbWithFixture() {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare('INSERT INTO fixtures (id, kickoff, status_short, home_team, away_team) VALUES (?,?,?,?,?)')
    .run(500, 1900000000, 'NS', 'Time A', 'Time B');
  return db;
}

function fullSummary(line, overOdd, bookmaker = 'CasaX', underOdd = null) {
  return { full: { line, overOdd, underOdd, bookmaker }, ht: null, fullLines: [], htLines: [], matchWinner: null, raw: [] };
}

test('1ª captura grava linha/odd e define a odd de ABERTURA', () => {
  const db = dbWithFixture();
  writeOddsToFixture(db, 500, fullSummary(9.5, 1.90, 'CasaX'));
  const r = db.prepare('SELECT * FROM fixtures WHERE id=500').get();
  assert.equal(r.corner_line, 9.5);
  assert.equal(r.corner_over_odd, 1.90);
  assert.equal(r.corner_bookmaker, 'CasaX');
  assert.equal(r.corner_open_odd, 1.90, 'abertura definida na 1ª vez');
});

test('ARMADILHA COALESCE: recaptura SOBRESCREVE a linha (não fica grudada)', () => {
  const db = dbWithFixture();
  // Versão anterior gravou 4.5 errado; aqui simulamos uma linha antiga 9.5...
  writeOddsToFixture(db, 500, fullSummary(9.5, 1.90, 'CasaX'));
  // ...e a recaptura traz a linha CERTA 10.5. Tem que sobrescrever.
  writeOddsToFixture(db, 500, fullSummary(10.5, 2.05, 'CasaY'));
  const r = db.prepare('SELECT * FROM fixtures WHERE id=500').get();
  assert.equal(r.corner_line, 10.5, 'a linha nova substitui a antiga (sem COALESCE)');
  assert.equal(r.corner_over_odd, 2.05);
  assert.equal(r.corner_bookmaker, 'CasaY');
  // mas a ABERTURA é preservada (pro CLV):
  assert.equal(r.corner_open_odd, 1.90, 'abertura NÃO é sobrescrita');
});

test('mercado sumiu na recaptura → LIMPA a linha (vira "sem odds"), preserva abertura', () => {
  const db = dbWithFixture();
  writeOddsToFixture(db, 500, fullSummary(9.5, 1.90, 'CasaX'));
  // recaptura sem mercado de total
  writeOddsToFixture(db, 500, { full: null, ht: null, fullLines: [], htLines: [], matchWinner: null, raw: [] });
  const r = db.prepare('SELECT * FROM fixtures WHERE id=500').get();
  assert.equal(r.corner_line, null, 'linha limpa, não deixou valor velho grudado');
  assert.equal(r.corner_over_odd, null);
  assert.equal(r.corner_bookmaker, null);
  assert.equal(r.corner_open_odd, 1.90, 'abertura preservada mesmo após limpar');
});

test('isClosing grava a odd de fechamento (pro CLV)', () => {
  const db = dbWithFixture();
  writeOddsToFixture(db, 500, fullSummary(9.5, 1.90, 'CasaX'));        // abertura 1.90
  writeOddsToFixture(db, 500, fullSummary(9.5, 1.70, 'CasaX'), { isClosing: true }); // fechamento 1.70
  const r = db.prepare('SELECT * FROM fixtures WHERE id=500').get();
  assert.equal(r.corner_open_odd, 1.90);
  assert.equal(r.corner_close_odd, 1.70);
});

test('snapshots históricos são gravados quando há linha', () => {
  const db = dbWithFixture();
  writeOddsToFixture(db, 500, fullSummary(9.5, 1.90, 'CasaX'));
  writeOddsToFixture(db, 500, fullSummary(10.5, 2.00, 'CasaY'));
  const snaps = db.prepare("SELECT * FROM odds_snapshots WHERE fixture_id=500 AND market='W2' ORDER BY id").all();
  assert.equal(snaps.length, 2);
  assert.equal(snaps[0].line, 9.5);
  assert.equal(snaps[1].line, 10.5);
});

test('undefined nunca chega ao SQLite (normalize → null)', () => {
  const db = dbWithFixture();
  // underOdd undefined de propósito
  const s = { full: { line: 9.5, overOdd: 1.9, underOdd: undefined, bookmaker: 'X' }, ht: null, fullLines: [], htLines: [], matchWinner: null, raw: [] };
  assert.doesNotThrow(() => writeOddsToFixture(db, 500, s));
  const r = db.prepare('SELECT corner_under_odd FROM fixtures WHERE id=500').get();
  assert.equal(r.corner_under_odd, null);
});

test('captureFixtureOdds: 200 vazio (mercado não aberto) resolve limpando, sem lançar', async () => {
  const db = dbWithFixture();
  const client = { getOdds: async () => ({ ok: true, empty: true, response: [], remainingDay: 7000 }) };
  const r = await captureFixtureOdds({ db, client }, 500);
  assert.equal(r.empty, true);
  assert.equal(r.outcome.full, 'cleared');
  const row = db.prepare('SELECT corner_line FROM fixtures WHERE id=500').get();
  assert.equal(row.corner_line, null);
});

test('captureFixtureOdds: resposta real é parseada e gravada', async () => {
  const db = dbWithFixture();
  const client = {
    getOdds: async () => ({
      ok: true, empty: false, remainingDay: 6999,
      response: [{ bookmakers: [
        { id: 1, name: 'CasaA', bets: [
          { id: 45, name: 'Corners Over Under', values: [
            { value: 'Over 9.5', odd: '1.95' }, { value: 'Under 9.5', odd: '1.85' },
          ] },
        ] },
      ] }],
    }),
  };
  const r = await captureFixtureOdds({ db, client }, 500);
  assert.equal(r.outcome.full, 'set');
  const row = db.prepare('SELECT corner_line, corner_over_odd, corner_open_odd FROM fixtures WHERE id=500').get();
  assert.equal(row.corner_line, 9.5);
  assert.equal(row.corner_over_odd, 1.95);
  assert.equal(row.corner_open_odd, 1.95);
});

test('diagnoseCornerOdds retorna os mercados de cantos CRUS (nome+id+valores)', async () => {
  const client = {
    getOdds: async () => ({
      ok: true, empty: false,
      response: [{ bookmakers: [
        { id: 1, name: 'CasaA', bets: [
          { id: 45, name: 'Corners Over Under', values: [{ value: 'Over 9.5', odd: '1.9' }] },
          { id: 57, name: 'Home Corners', values: [{ value: 'Over 4.5', odd: '1.8' }] },
          { id: 1, name: 'Match Winner', values: [{ value: 'Home', odd: '2.0' }] },
        ] },
      ] }],
    }),
  };
  const d = await diagnoseCornerOdds({ client }, 500);
  const ids = d.markets.map((m) => m.marketId).sort();
  assert.deepEqual(ids, [45, 57]); // só cantos (id 1 = match winner, fora)
  assert.ok(d.markets.find((m) => m.marketId === 45));
});

test('writeOddsToFixture lança se o jogo não existe (sincronize antes)', () => {
  const db = dbWithFixture();
  assert.throws(() => writeOddsToFixture(db, 99999, fullSummary(9.5, 1.9)), /não existe/);
});
