// Modelo PRÉ-JOGO de cantos — funções PURAS (recebem o histórico já carregado).
//
// Para cada time, taxas separadas POR MANDO, com decaimento (mais peso nos jogos
// recentes — não média simples):
//   • cantos que FAZ/SOFRE em casa;  • cantos que FAZ/SOFRE fora.
//
// Expectativa do jogo:
//   esperado_mandante = (ataque do mandante em casa + defesa do visitante fora) / 2
//   esperado_visitante = (ataque do visitante fora  + defesa do mandante em casa) / 2
//   λ_total = soma, ajustado pela força do favorito e pelo knob de calibração.
//
// HONESTIDADE: o backtest da versão anterior mostrou que o pré-jogo tem POUCO
// poder preditivo (mal bate "chutar a média"). Este modelo é melhor que a média
// simples, mas só confie nele se o backtest confirmar. O valor real, se houver,
// está no ao vivo.

import { pOverLine, evOver } from './distributions.js';

/** Média ponderada por decaimento: peso = 0.5^(posição / meia-vida). índice 0 = mais recente. */
export function weightedMean(values, halflife) {
  let wsum = 0, vsum = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null || !Number.isFinite(values[i])) continue;
    const w = Math.pow(0.5, i / halflife);
    wsum += w;
    vsum += w * values[i];
  }
  return wsum > 0 ? vsum / wsum : null;
}

/**
 * Taxas de cantos de um time, separadas por mando, com decaimento.
 * @param {Array<{is_home:number, corners_for:number, corners_against:number, played_at:number}>} games
 *        (em qualquer ordem; serão ordenados do mais recente pro mais antigo)
 * @param {{halflife?:number}} [opts]
 * @returns {{homeAttack:number, homeDefense:number, awayAttack:number, awayDefense:number,
 *            overallAttack:number, overallDefense:number, nHome:number, nAway:number, nTotal:number}|null}
 */
export function teamRates(games, { halflife = 8 } = {}) {
  const valid = (games || []).filter(
    (g) => g && Number.isFinite(g.corners_for) && Number.isFinite(g.corners_against)
  );
  if (valid.length === 0) return null;

  const sorted = [...valid].sort((a, b) => (b.played_at ?? 0) - (a.played_at ?? 0));
  const home = sorted.filter((g) => g.is_home);
  const away = sorted.filter((g) => !g.is_home);

  const overallAttack = weightedMean(sorted.map((g) => g.corners_for), halflife);
  const overallDefense = weightedMean(sorted.map((g) => g.corners_against), halflife);

  // Por mando; se faltar o subconjunto, cai no overall (fallback robusto).
  const homeAttack = home.length ? weightedMean(home.map((g) => g.corners_for), halflife) : overallAttack;
  const homeDefense = home.length ? weightedMean(home.map((g) => g.corners_against), halflife) : overallDefense;
  const awayAttack = away.length ? weightedMean(away.map((g) => g.corners_for), halflife) : overallAttack;
  const awayDefense = away.length ? weightedMean(away.map((g) => g.corners_against), halflife) : overallDefense;

  return {
    homeAttack, homeDefense, awayAttack, awayDefense,
    overallAttack, overallDefense,
    nHome: home.length, nAway: away.length, nTotal: sorted.length,
  };
}

/** Cantos esperados de cada lado a partir das taxas dos dois times. */
export function expectedCorners(homeRates, awayRates) {
  if (!homeRates || !awayRates) return null;
  const expHome = (homeRates.homeAttack + awayRates.awayDefense) / 2;
  const expAway = (awayRates.awayAttack + homeRates.homeDefense) / 2;
  if (!Number.isFinite(expHome) || !Number.isFinite(expAway)) return null;
  return { expHome, expAway, total: expHome + expAway };
}

/** Probabilidades implícitas (normalizadas, tirando a margem) do 1x2. */
export function impliedProbs({ home, draw, away } = {}) {
  const inv = [home, draw, away].map((o) => (Number.isFinite(o) && o > 1 ? 1 / o : null));
  const known = inv.filter((x) => x != null);
  if (known.length < 2) return null;
  const s = known.reduce((a, b) => a + b, 0);
  return {
    pHome: inv[0] != null ? inv[0] / s : null,
    pDraw: inv[1] != null ? inv[1] / s : null,
    pAway: inv[2] != null ? inv[2] / s : null,
  };
}

/** Força do favorito = |pHome − pAway| (0 = equilibrado, →1 = favorito enorme). */
export function favoriteStrength(odds1x2) {
  const p = impliedProbs(odds1x2);
  if (!p || p.pHome == null || p.pAway == null) return 0;
  return Math.abs(p.pHome - p.pAway);
}

/**
 * λ do jogo a partir das taxas, ajustado por força do favorito e knob.
 * @returns {{lambda:number, expHome:number, expAway:number, favStrength:number}|null}
 */
export function lambdaForMatch(homeRates, awayRates, params = {}, { odds1x2 } = {}) {
  const exp = expectedCorners(homeRates, awayRates);
  if (!exp) return null;
  const favStrength = favoriteStrength(odds1x2);
  const favCoef = params.favorite_corner_coef ?? 0;
  const knob = params.calibration_knob ?? 1;
  const lambda = exp.total * (1 + favCoef * favStrength) * knob;
  return { lambda, expHome: exp.expHome, expAway: exp.expAway, favStrength };
}

/**
 * Previsão completa de um jogo pré-jogo. Se faltar histórico → null (não inventa).
 * @param {object} args
 * @param {Array} args.homeGames  histórico do mandante
 * @param {Array} args.awayGames  histórico do visitante
 * @param {object} args.params    parâmetros do modelo (de config)
 * @param {object} [args.odds1x2] {home,draw,away}
 * @param {number} [args.line]    linha de cantos (pra P e EV)
 * @param {number} [args.overOdd] odd de over (pra EV)
 */
export function predictMatch({ homeGames, awayGames, params = {}, odds1x2, line, overOdd } = {}) {
  const halflife = params.recency_halflife_games ?? 8;
  const homeRates = teamRates(homeGames, { halflife });
  const awayRates = teamRates(awayGames, { halflife });
  if (!homeRates || !awayRates) return null;

  const lm = lambdaForMatch(homeRates, awayRates, params, { odds1x2 });
  if (!lm) return null;

  let p = null, ev = null;
  if (Number.isFinite(line)) p = pOverLine(lm.lambda, line, params);
  if (p != null && Number.isFinite(overOdd)) ev = evOver(p, overOdd);

  return {
    lambda: lm.lambda,
    expHome: lm.expHome,
    expAway: lm.expAway,
    favStrength: lm.favStrength,
    p, ev, line: Number.isFinite(line) ? line : null,
    nHome: homeRates.nTotal, nAway: awayRates.nTotal,
    homeRates, awayRates,
  };
}
