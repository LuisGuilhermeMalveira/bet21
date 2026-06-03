// Modelo AO VIVO — pega o λ pré-jogo, projeta pro tempo restante e ajusta pelo
// que está acontecendo (pressão + placar). Depois escolhe a linha de melhor EV.
//
// Projeção do "restante" (a aposta é no TOTAL; já saíram C cantos):
//   • projeção pela média observada:  (C / minuto) · minutos_restantes
//   • projeção pré-jogo:              λ_pré · (minutos_restantes / fim)
//   • baseline = mistura das duas (peso na observada cresce com o minuto)
//   • λ_restante = baseline · pressão · fator_placar
// A pressão entra como ACELERAÇÃO (ritmo recente vs médio), por cima do nível.

import { makeDist, evOver } from './distributions.js';

/**
 * Projeta os cantos que ainda devem sair (do período do mercado).
 * @returns {number|null} λ do restante, ou null se faltar base.
 */
export function projectRemainingLambda({
  lambdaPregame, minute, cornersNow, marketEnd = 90, pressure = 1, scoreline = 1,
} = {}) {
  if (!Number.isFinite(lambdaPregame) || lambdaPregame <= 0) return null;
  if (!Number.isFinite(minute) || minute < 0) return null;
  const remMin = Math.max(0, marketEnd - minute);
  if (remMin <= 0) return 0;

  const w = Math.min(1, Math.max(0, minute / marketEnd));
  const pregProj = lambdaPregame * (remMin / marketEnd);
  let baseline = pregProj;
  if (Number.isFinite(cornersNow) && minute > 0) {
    const obsProj = (cornersNow / minute) * remMin;
    baseline = w * obsProj + (1 - w) * pregProj;
  }
  const lam = baseline * (pressure || 1) * (scoreline || 1);
  return Math.max(0, lam);
}

/**
 * P(total de cantos > linha), dado o que já saiu e o λ do restante.
 * over linha ⇔ restante > (linha − cantos_atuais). Faltando dado → null.
 */
export function liveProbForLine({ lambdaRemaining, line, cornersNow, params = {} }) {
  if (lambdaRemaining == null || !Number.isFinite(line) || !Number.isFinite(cornersNow)) return null;
  const needed = line - cornersNow;
  if (needed <= 0) return null; // já batido → sem aposta de valor
  const dist = makeDist(lambdaRemaining, params);
  return dist.sf(Math.floor(needed));
}

/**
 * Entre TODAS as linhas das casas, escolhe a de melhor EV acima dos cortes.
 * Não fixa "+1"/"+2": quem decide o número é o EV.
 * @param {Array<{line:number, overOdd:number, bookmaker:string}>} lines
 * @param {{lambdaRemaining:number, cornersNow:number, params:object, evMin:number, probMin:number}} cfg
 * @returns {{line:number, overOdd:number, bookmaker:string, prob:number, ev:number}|null}
 */
export function chooseBestLine(lines, { lambdaRemaining, cornersNow, params, evMin, probMin }) {
  let best = null;
  for (const ln of lines || []) {
    const p = liveProbForLine({ lambdaRemaining, line: ln.line, cornersNow, params });
    if (p == null || p < probMin) continue;
    const ev = evOver(p, ln.overOdd);
    if (ev == null || ev < evMin) continue;
    if (!best || ev > best.ev) {
      best = { line: ln.line, overOdd: ln.overOdd, bookmaker: ln.bookmaker, prob: p, ev };
    }
  }
  return best;
}
