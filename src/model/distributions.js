// Distribuições de contagem pra cantos — funções PURAS e numericamente estáveis.
//
// Poisson é o padrão; Binomial Negativa é a opção (cantos têm variância maior
// que a Poisson pura — overdispersion). Tudo calculado em espaço-log pra não
// estourar com λ grande.

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln(Γ(z)) — aproximação de Lanczos. lgamma(n+1) = ln(n!). */
export function lgamma(z) {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  }
  z -= 1;
  let x = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i++) x += LANCZOS[i] / (z + i);
  const t = z + LANCZOS.length - 1.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function isCount(k) {
  return Number.isFinite(k) && k >= 0 && Number.isInteger(k);
}

// ---------- Poisson ----------
export function poissonPmf(k, lambda) {
  if (!isCount(k)) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - lgamma(k + 1));
}

export function poissonCdf(k, lambda) {
  if (k < 0) return 0;
  const kk = Math.floor(k);
  let sum = 0;
  for (let i = 0; i <= kk; i++) sum += poissonPmf(i, lambda);
  return Math.min(1, sum);
}

// ---------- Binomial Negativa (parametrizada por média μ e dispersão r) ----------
// Variância = μ + μ²/r. r grande → aproxima a Poisson.
export function negbinPmf(k, mean, r) {
  if (!isCount(k)) return 0;
  if (mean <= 0) return k === 0 ? 1 : 0;
  if (!(r > 0)) return poissonPmf(k, mean);
  const p = r / (r + mean);
  const logp =
    lgamma(k + r) - lgamma(r) - lgamma(k + 1) +
    r * Math.log(p) + k * Math.log(1 - p);
  return Math.exp(logp);
}

export function negbinCdf(k, mean, r) {
  if (k < 0) return 0;
  const kk = Math.floor(k);
  let sum = 0;
  for (let i = 0; i <= kk; i++) sum += negbinPmf(i, mean, r);
  return Math.min(1, sum);
}

/**
 * Fábrica de distribuição a partir da config do modelo.
 * @param {number} lambda  média esperada (λ)
 * @param {{distribution?:'poisson'|'negbin', negbin_dispersion?:number}} params
 * @returns {{pmf:(k:number)=>number, cdf:(k:number)=>number, sf:(k:number)=>number}}
 */
export function makeDist(lambda, params = {}) {
  const useNeg = params.distribution === 'negbin';
  const r = params.negbin_dispersion ?? 8;
  const pmf = (k) => (useNeg ? negbinPmf(k, lambda, r) : poissonPmf(k, lambda));
  const cdf = (k) => (useNeg ? negbinCdf(k, lambda, r) : poissonCdf(k, lambda));
  const sf = (k) => Math.max(0, 1 - cdf(k));
  return { pmf, cdf, sf };
}

/**
 * P(total de cantos > linha). Para linha .5 (ex.: 9.5), over = X ≥ 10 = sf(9).
 * Para linha inteira, trata over como X > linha (push fica fora; o settle cuida do void).
 * @param {number} lambda
 * @param {number} line
 * @param {object} params  config do modelo
 */
export function pOverLine(lambda, line, params = {}) {
  if (!Number.isFinite(lambda) || lambda < 0 || !Number.isFinite(line)) return null;
  const dist = makeDist(lambda, params);
  return dist.sf(Math.floor(line));
}

/** EV de uma aposta em over: EV = P·(odd−1) − (1−P). */
export function evOver(p, odd) {
  if (p == null || !Number.isFinite(odd)) return null;
  return p * (odd - 1) - (1 - p);
}
