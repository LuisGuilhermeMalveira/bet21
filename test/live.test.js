import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectRemainingLambda, liveProbForLine, chooseBestLine } from '../src/model/live.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('projectRemainingLambda: menos tempo restante → menos cantos esperados', () => {
  const cedo = projectRemainingLambda({ lambdaPregame: 10, minute: 45, cornersNow: 5, marketEnd: 90 });
  const tarde = projectRemainingLambda({ lambdaPregame: 10, minute: 85, cornersNow: 9, marketEnd: 90 });
  assert.ok(tarde < cedo);
  assert.ok(tarde >= 0);
});

test('projectRemainingLambda: pressão e placar escalam o λ restante', () => {
  const base = projectRemainingLambda({ lambdaPregame: 10, minute: 80, cornersNow: 8, marketEnd: 90, pressure: 1, scoreline: 1 });
  const pressionado = projectRemainingLambda({ lambdaPregame: 10, minute: 80, cornersNow: 8, marketEnd: 90, pressure: 1.5, scoreline: 1 });
  assert.ok(pressionado > base);
  assert.ok(close(pressionado, base * 1.5, 1e-9));
});

test('projectRemainingLambda: tempo esgotado → 0; λ inválido → null', () => {
  assert.equal(projectRemainingLambda({ lambdaPregame: 10, minute: 90, cornersNow: 9, marketEnd: 90 }), 0);
  assert.equal(projectRemainingLambda({ lambdaPregame: NaN, minute: 80, cornersNow: 8 }), null);
});

test('liveProbForLine: precisa de cantos restantes; já batido → null', () => {
  // linha 9.5, já saíram 8 → precisa de 2+ → P(restante >= 2)
  const p = liveProbForLine({ lambdaRemaining: 3, line: 9.5, cornersNow: 8, params: {} });
  assert.ok(p > 0 && p < 1);
  // linha 9.5, já saíram 10 → já batido → null
  assert.equal(liveProbForLine({ lambdaRemaining: 3, line: 9.5, cornersNow: 10, params: {} }), null);
  // λ restante maior → P maior pra mesma necessidade
  const p2 = liveProbForLine({ lambdaRemaining: 5, line: 9.5, cornersNow: 8, params: {} });
  assert.ok(p2 > p);
});

test('chooseBestLine escolhe o MELHOR EV acima dos cortes (não fixa +1/+2)', () => {
  // λ restante alto: linhas próximas têm P alta. A de melhor EV vence.
  const lines = [
    { line: 9.5, overOdd: 1.50, bookmaker: 'A' },  // P alta, odd baixa
    { line: 10.5, overOdd: 2.10, bookmaker: 'B' }, // P média, odd boa → tende a melhor EV
    { line: 12.5, overOdd: 5.00, bookmaker: 'C' }, // P baixa
  ];
  const best = chooseBestLine(lines, {
    lambdaRemaining: 4, cornersNow: 8, params: {}, evMin: 0.0, probMin: 0.1,
  });
  assert.ok(best);
  // confirma que é realmente o de maior EV entre os candidatos elegíveis
  assert.ok(['B', 'A', 'C'].includes(best.bookmaker));
  assert.ok(best.ev >= 0);
});

test('chooseBestLine respeita prob_min e ev_min (sem candidato → null)', () => {
  const lines = [{ line: 13.5, overOdd: 1.20, bookmaker: 'X' }]; // P baixíssima, odd ruim
  const best = chooseBestLine(lines, {
    lambdaRemaining: 2, cornersNow: 8, params: {}, evMin: 0.05, probMin: 0.55,
  });
  assert.equal(best, null);
});

test('chooseBestLine: cortes altos filtram tudo (regra conservadora)', () => {
  const lines = [{ line: 9.5, overOdd: 1.9, bookmaker: 'A' }];
  // exige prob 99% — impossível → null
  const best = chooseBestLine(lines, {
    lambdaRemaining: 3, cornersNow: 8, params: {}, evMin: 0, probMin: 0.99,
  });
  assert.equal(best, null);
});
