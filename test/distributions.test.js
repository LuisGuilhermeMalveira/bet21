import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lgamma, poissonPmf, poissonCdf, negbinPmf, makeDist, pOverLine, evOver,
} from '../src/model/distributions.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('lgamma: ln(n!) confere com fatoriais', () => {
  assert.ok(close(lgamma(1), 0));            // 0! = 1 → ln 1 = 0
  assert.ok(close(lgamma(2), 0));            // 1! = 1
  assert.ok(close(lgamma(6), Math.log(120))); // 5! = 120
});

test('Poisson pmf: valores conhecidos (λ=2)', () => {
  assert.ok(close(poissonPmf(0, 2), Math.exp(-2)));        // e^-2
  assert.ok(close(poissonPmf(2, 2), 2 * Math.exp(-2)));    // 2·e^-2
  assert.equal(poissonPmf(-1, 2), 0);
  assert.equal(poissonPmf(1.5, 2), 0);                      // não-inteiro
});

test('Poisson pmf soma ~1 ao longo do suporte', () => {
  let s = 0;
  for (let k = 0; k <= 60; k++) s += poissonPmf(k, 9.5);
  assert.ok(close(s, 1, 1e-6));
});

test('Poisson cdf é monotônica e sf = 1 − cdf', () => {
  const lambda = 9.5;
  const d = makeDist(lambda, { distribution: 'poisson' });
  assert.ok(d.cdf(8) <= d.cdf(9));
  assert.ok(close(d.sf(9), 1 - d.cdf(9)));
});

test('NegBin com r grande aproxima a Poisson', () => {
  const k = 10, mean = 9.5;
  const ratio = negbinPmf(k, mean, 100000) / poissonPmf(k, mean);
  assert.ok(close(ratio, 1, 1e-2), `esperava ~1, veio ${ratio}`);
});

test('NegBin tem mais massa nas caudas que a Poisson (overdispersion)', () => {
  const mean = 9.5;
  // cauda alta: P(X >= 16) deve ser maior na negbin (r pequeno) que na poisson
  const dP = makeDist(mean, { distribution: 'poisson' });
  const dN = makeDist(mean, { distribution: 'negbin', negbin_dispersion: 6 });
  assert.ok(dN.sf(15) > dP.sf(15));
});

test('pOverLine: over 9.5 = P(X ≥ 10) = sf(9)', () => {
  const lambda = 10;
  const p = pOverLine(lambda, 9.5, { distribution: 'poisson' });
  assert.ok(close(p, makeDist(lambda).sf(9)));
  // λ maior → mais provável passar de 9.5
  assert.ok(pOverLine(12, 9.5) > pOverLine(8, 9.5));
});

test('pOverLine inválido → null (regra de dados faltantes)', () => {
  assert.equal(pOverLine(NaN, 9.5), null);
  assert.equal(pOverLine(10, NaN), null);
});

test('evOver: fórmula P·(odd−1) − (1−P)', () => {
  // P=0.6, odd=2.0 → 0.6·1 − 0.4 = 0.2
  assert.ok(close(evOver(0.6, 2.0), 0.2));
  // breakeven: P = 1/odd → EV 0
  assert.ok(close(evOver(0.5, 2.0), 0));
  assert.equal(evOver(null, 2.0), null);
});
