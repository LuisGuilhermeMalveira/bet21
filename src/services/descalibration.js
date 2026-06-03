// Detector de descalibração PRÉ-LIVE (over e under).
//
// Ideia: a casa embute uma probabilidade na odd. Se a NOSSA probabilidade (do λ
// do modelo) discordar o suficiente da dela — depois de tirar a margem — isso é
// uma odd descalibrada = valor. Over quando achamos que sai MAIS que a linha;
// under quando achamos que sai MENOS.
//
// HONESTIDADE: isto depende inteiramente do λ estar bem calibrado. Se o modelo
// erra a média, o "valor" é fantasia. Por isso a PINNACLE é âncora obrigatória
// (ela raramente erra o preço): só tratamos como valor quando concordamos com a
// DIREÇÃO da Pinnacle. Apostar contra a Pinnacle = provavelmente nós erramos.
// E o juiz final é o CLV, não o resultado de um jogo.

import { pOverLine, evOver } from '../model/distributions.js';
import { devigPair } from '../model/devig.js';
import { predictFixture } from './backtest.js';
import { hasSignal, recordSignal } from './liveEngine.js';
import { logEvent } from '../db/index.js';
import * as cfg from '../config/settings.js';

/**
 * Avalia a descalibração de UM jogo.
 * @param {object} fx  linha de fixtures (com corner_line/over/under e corner_pinn_*)
 * @param {number|null} lambda  expectativa de cantos do modelo
 * @param {object} cfg  { evMin, edgeMin, requirePinnacle, distParams, bounds }
 * @returns {{
 *   hasValue:boolean, side?:'over'|'under', line?:number, odd?:number,
 *   modelProb?:number, marketProb?:number, pinnProb?:number, edge?:number, ev?:number,
 *   reason?:string, candidates?:Array
 * }}
 */
export function evaluateDescalibration(fx, lambda, cfg = {}) {
  const evMin = cfg.evMin ?? 0.08;          // só os gritantes
  const edgeMin = cfg.edgeMin ?? 0.05;      // ≥5 pontos de discordância
  const requirePinnacle = cfg.requirePinnacle !== false; // padrão: exige Pinnacle
  const params = cfg.distParams || {};

  if (!Number.isFinite(lambda)) return { hasValue: false, reason: 'sem λ (histórico insuficiente)' };

  const line = fx.corner_line;
  const overOdd = fx.corner_over_odd;
  const underOdd = fx.corner_under_odd;
  if (!Number.isFinite(line) || !Number.isFinite(overOdd) || !Number.isFinite(underOdd)) {
    return { hasValue: false, reason: 'sem par over/under capturado' };
  }

  // Probabilidade da casa, SEM a margem (de-vig).
  const market = devigPair(overOdd, underOdd);
  if (!market) return { hasValue: false, reason: 'odds inválidas pro de-vig' };

  // Nossa probabilidade do modelo.
  const pModelOver = pOverLine(lambda, line, params);
  if (pModelOver == null) return { hasValue: false, reason: 'modelo não calculou prob' };
  const pModelUnder = 1 - pModelOver;

  // Âncora Pinnacle (de-vig da Pinnacle, na linha dela).
  let pinn = null;
  if (Number.isFinite(fx.corner_pinn_over_odd) && Number.isFinite(fx.corner_pinn_under_odd)) {
    pinn = devigPair(fx.corner_pinn_over_odd, fx.corner_pinn_under_odd);
  }
  if (requirePinnacle && !pinn) {
    return { hasValue: false, reason: 'sem Pinnacle pra ancorar' };
  }

  // Monta os dois lados.
  const sides = [
    { side: 'over',  odd: overOdd,  modelProb: pModelOver,  marketProb: market.over,  pinnProb: pinn ? pinn.over : null },
    { side: 'under', odd: underOdd, modelProb: pModelUnder, marketProb: market.under, pinnProb: pinn ? pinn.under : null },
  ];

  const candidates = [];
  for (const s of sides) {
    const edge = s.modelProb - s.marketProb;       // discordância a nosso favor (pontos)
    const ev = evOver(s.modelProb, s.odd);         // EV do lado (evOver serve p/ qualquer lado)
    let blockedBy = null;

    // Âncora: não apostar CONTRA a Pinnacle. A Pinnacle favorece um lado quando
    // a prob de-vigada dela nesse lado passa de 0.5. Se vamos no lado que a Pinnacle
    // considera MENOS provável (pinnProb < 0.5), estamos contra a casa mais afiada
    // — provavelmente o erro é nosso. Bloqueia.
    if (requirePinnacle && s.pinnProb != null && s.pinnProb < (cfg.pinnFloor ?? 0.5)) {
      blockedBy = 'Pinnacle favorece o outro lado';
    }
    candidates.push({ ...s, edge, ev, blockedBy });
  }

  // Filtra os que passam em EV, edge e âncora; escolhe o de maior EV.
  const passing = candidates
    .filter((c) => c.ev != null && c.ev >= evMin && c.edge >= edgeMin && !c.blockedBy)
    .sort((a, b) => b.ev - a.ev);

  if (passing.length === 0) {
    // devolve o melhor candidato (pro front mostrar "quase") + motivo
    const best = candidates.slice().sort((a, b) => (b.ev ?? -1) - (a.ev ?? -1))[0];
    let reason = 'sem edge suficiente';
    if (best?.blockedBy) reason = best.blockedBy;
    else if (best && best.ev != null && best.ev < evMin) reason = `EV ${(best.ev * 100).toFixed(1)}% < corte ${(evMin * 100).toFixed(0)}%`;
    else if (best && best.edge < edgeMin) reason = `edge ${(best.edge * 100).toFixed(1)}pts < ${(edgeMin * 100).toFixed(0)}pts`;
    return { hasValue: false, reason, candidates };
  }

  const w = passing[0];
  return {
    hasValue: true,
    side: w.side,
    line,
    odd: w.odd,
    bookmaker: w.side === 'over' ? (fx.corner_bookmaker || '?') : (fx.corner_bookmaker || '?'),
    modelProb: w.modelProb,
    marketProb: w.marketProb,
    pinnProb: w.pinnProb,
    edge: w.edge,
    ev: w.ev,
    candidates,
  };
}

/** Lê os cortes da descalibração das settings. */
export function valueConfig(db, params) {
  return {
    evMin: cfg.get(db, 'settings', 'prelive_value_ev_min') ?? 0.08,
    edgeMin: cfg.get(db, 'settings', 'prelive_value_edge_min') ?? 0.05,
    requirePinnacle: cfg.get(db, 'settings', 'prelive_value_require_pinnacle') !== false,
    distParams: params || {},
  };
}

const PCT = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);

/**
 * Avalia os próximos jogos das ligas ativas e devolve os que têm valor.
 * Não grava nada — só calcula (o tick decide disparar).
 * @returns {Array<{fixtureId, match, kickoff, eval}>}
 */
export function evaluateFixturesForValue(db, { now = Date.now(), windowHours = 24, params } = {}) {
  const nowSec = Math.floor(now / 1000);
  const until = nowSec + windowHours * 3600;
  const fixtures = db.prepare(`
    SELECT f.*, l.name AS league_name FROM fixtures f JOIN leagues l ON l.id = f.league_id
     WHERE l.active = 1 AND f.kickoff BETWEEN ? AND ?
       AND (f.status_short IS NULL OR f.status_short IN ('NS','TBD'))
     ORDER BY f.kickoff ASC
  `).all(nowSec, until);

  const conf = valueConfig(db, params);
  const out = [];
  for (const fx of fixtures) {
    const pred = predictFixture(db, fx.id, conf.distParams);
    const ev = evaluateDescalibration(fx, pred?.lambda ?? null, conf);
    out.push({ fixtureId: fx.id, match: `${fx.home_team} x ${fx.away_team}`, kickoff: fx.kickoff, lambda: pred?.lambda ?? null, eval: ev });
  }
  return out;
}

/**
 * Grava um sinal pré-live de valor (pendente), se ainda não existir.
 * Usa markets PL_OVER / PL_UNDER (1 por lado por jogo, garantido pelo UNIQUE).
 * @returns {{fired:boolean, market?:string, reason?:string}}
 */
export function fireValueSignal(db, fx, result, { stake = 1, now = Date.now() } = {}) {
  if (!result?.hasValue) return { fired: false, reason: result?.reason || 'sem valor' };
  const market = result.side === 'under' ? 'PL_UNDER' : 'PL_OVER';
  if (hasSignal(db, fx.id, market)) return { fired: false, reason: 'já existe sinal' };

  const decision = {
    market,
    line: result.line,
    overOdd: result.odd,          // recordSignal grava isto como open_odd (a odd do lado)
    bookmaker: result.bookmaker,
    prob: result.modelProb,
    ev: result.ev,
    context: {
      kind: 'prelive_value',
      side: result.side,
      modelProb: result.modelProb,
      marketProb: result.marketProb,
      pinnProb: result.pinnProb,
      edge: result.edge,
      lambda: fx._lambda ?? null,
    },
  };
  const ok = recordSignal(db, fx.id, decision, { stake, now });
  if (ok) {
    logEvent(db, {
      level: 'signal', type: 'prelive_value',
      message: `🎯 VALOR pré-live: ${fx.home_team} x ${fx.away_team} — ${result.side.toUpperCase()} ${result.line} @ ${result.odd} (${result.bookmaker}) · modelo ${PCT(result.modelProb)} vs casa ${PCT(result.marketProb)} · edge +${(result.edge * 100).toFixed(1)}pts · EV ${PCT(result.ev)}`,
      data: { fixtureId: fx.id, market, side: result.side, ev: result.ev, edge: result.edge },
    });
  }
  return { fired: ok, market };
}
