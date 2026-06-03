import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weightedMean, teamRates, expectedCorners, impliedProbs, favoriteStrength,
  lambdaForMatch, predictMatch,
} from '../src/model/pregame.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('weightedMean dá mais peso ao recente (índice 0)', () => {
  // [10 (recente), 0 (antigo)] com meia-vida 1 → peso 1 e 0.5 → (10·1+0·0.5)/1.5 = 6.67
  const m = weightedMean([10, 0], 1);
  assert.ok(close(m, 10 / 1.5), `veio ${m}`);
  // média simples seria 5; o decaimento puxa pro recente (>5)
  assert.ok(m > 5);
});

test('teamRates separa mando e cai no overall se faltar subconjunto', () => {
  const games = [
    { is_home: 1, corners_for: 8, corners_against: 3, played_at: 300 },
    { is_home: 1, corners_for: 6, corners_against: 4, played_at: 200 },
    { is_home: 0, corners_for: 4, corners_against: 6, played_at: 100 },
  ];
  const r = teamRates(games, { halflife: 8 });
  assert.equal(r.nHome, 2);
  assert.equal(r.nAway, 1);
  assert.ok(r.homeAttack > r.awayAttack); // faz mais canto em casa
  // time só com jogos em casa → awayAttack cai no overall (não quebra)
  const r2 = teamRates(games.filter((g) => g.is_home), { halflife: 8 });
  assert.equal(r2.nAway, 0);
  assert.ok(Number.isFinite(r2.awayAttack));
});

test('teamRates: sem jogos válidos → null', () => {
  assert.equal(teamRates([], {}), null);
  assert.equal(teamRates([{ is_home: 1, corners_for: null, corners_against: null }], {}), null);
});

test('expectedCorners aplica a fórmula da spec', () => {
  const home = { homeAttack: 6, homeDefense: 4, awayAttack: 5, awayDefense: 5 };
  const away = { homeAttack: 5, homeDefense: 5, awayAttack: 4, awayDefense: 6 };
  const e = expectedCorners(home, away);
  // expHome = (6 + 6)/2 = 6 ; expAway = (4 + 4)/2 = 4 ; total 10
  assert.ok(close(e.expHome, 6));
  assert.ok(close(e.expAway, 4));
  assert.ok(close(e.total, 10));
});

test('impliedProbs normaliza e tira a margem', () => {
  const p = impliedProbs({ home: 2.0, draw: 4.0, away: 4.0 });
  // inversos 0.5,0.25,0.25 = 1.0 (sem margem) → mantém
  assert.ok(close(p.pHome, 0.5));
  assert.ok(close(p.pDraw, 0.25));
});

test('favoriteStrength: 0 no equilíbrio, alto com favorito forte', () => {
  assert.ok(favoriteStrength({ home: 2.6, draw: 3.3, away: 2.6 }) < 0.05);
  assert.ok(favoriteStrength({ home: 1.2, draw: 6, away: 12 }) > 0.5);
});

test('lambdaForMatch: favorito forte aumenta λ; knob escala', () => {
  const home = { homeAttack: 6, homeDefense: 4, awayAttack: 5, awayDefense: 5 };
  const away = { homeAttack: 5, homeDefense: 5, awayAttack: 4, awayDefense: 6 };
  const neutro = lambdaForMatch(home, away, { favorite_corner_coef: 0.1, calibration_knob: 1 }, {
    odds1x2: { home: 2.6, draw: 3.3, away: 2.6 },
  });
  const favorito = lambdaForMatch(home, away, { favorite_corner_coef: 0.1, calibration_knob: 1 }, {
    odds1x2: { home: 1.2, draw: 6, away: 12 },
  });
  assert.ok(favorito.lambda > neutro.lambda);
  // knob 1.1 escala 10%
  const knob = lambdaForMatch(home, away, { favorite_corner_coef: 0, calibration_knob: 1.1 }, {});
  assert.ok(close(knob.lambda, 10 * 1.1));
});

test('predictMatch: histórico insuficiente → null (não inventa)', () => {
  const r = predictMatch({ homeGames: [], awayGames: [], params: {} });
  assert.equal(r, null);
});

test('predictMatch: devolve λ, P(over) e EV quando há linha e odd', () => {
  const games = (cf, ca) => Array.from({ length: 10 }, (_, i) => ({
    is_home: i % 2, corners_for: cf, corners_against: ca, played_at: 100 + i,
  }));
  const r = predictMatch({
    homeGames: games(7, 4), awayGames: games(5, 5),
    params: { recency_halflife_games: 8, distribution: 'poisson', calibration_knob: 1, favorite_corner_coef: 0 },
    line: 9.5, overOdd: 1.9,
  });
  assert.ok(r.lambda > 0);
  assert.ok(r.p > 0 && r.p < 1);
  assert.equal(typeof r.ev, 'number');
});
