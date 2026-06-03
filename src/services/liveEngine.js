// Engine ao vivo: avalia as janelas de entrada e dispara sinais.
//
// Janelas (foco em DUAS):
//   • W2 — jogo todo, reta final (~80–90'): favorito NÃO-ganhando + pressão subindo.
//   • 1T — 1º tempo (~22–40'): projeta até os 45'.
//   • W1 e 2T — implementadas, DESLIGADAS por padrão (ligáveis na configuração).
//
// Regras inegociáveis:
//   • Dados incompletos = NÃO dispara (sem stats ao vivo, sem odds, sem λ → nada).
//   • Anti-repetição: um mercado por jogo (índice único + checagem).
//   • Stop de banca: se o prejuízo passar do limite, para de disparar.
//   • Escolhe a linha de MELHOR EV entre as casas (não fixa +1/+2).

import { normalize, logEvent } from '../db/index.js';
import { computePressure } from '../model/pressure.js';
import { scorelineFactor } from '../model/scoreline.js';
import { projectRemainingLambda, chooseBestLine } from '../model/live.js';

/** Define as janelas a partir das configurações. */
export function buildWindowSpecs(settings) {
  return [
    { market: 'W2', lines: 'full', marketEnd: 90, minMinute: settings.window_w2_min, maxMinute: settings.window_w2_max, requireFavNotWinning: true, requireRising: true, enabled: true },
    { market: '1T', lines: 'ht', marketEnd: 45, minMinute: settings.window_1t_min, maxMinute: settings.window_1t_max, requireFavNotWinning: false, requireRising: false, enabled: true },
    { market: 'W1', lines: 'full', marketEnd: 90, minMinute: 43, maxMinute: 48, requireFavNotWinning: false, requireRising: false, enabled: !!settings.window_w1_enabled },
    { market: '2T', lines: 'full', marketEnd: 90, minMinute: 50, maxMinute: 75, requireFavNotWinning: false, requireRising: false, enabled: !!settings.window_2t_enabled },
  ];
}

/** Favorito está ganhando agora? */
export function favoriteWinning(favorite, goalsHome, goalsAway) {
  if (favorite === 'home') return (goalsHome ?? 0) > (goalsAway ?? 0);
  if (favorite === 'away') return (goalsAway ?? 0) > (goalsHome ?? 0);
  return false;
}

/**
 * Avalia um jogo ao vivo (PURO). Devolve uma decisão por janela.
 * @param {object} state {minute, cornersTotal, htCornersTotal, goalsHome, goalsAway,
 *   favorite, lambdaPregame, samples, fullLines, htLines}
 * @param {{settings:object, model:object}} cfg
 */
export function evaluateLiveFixture(state, cfg) {
  const { settings, model } = cfg;
  const {
    minute, cornersTotal, htCornersTotal, goalsHome, goalsAway,
    favorite, lambdaPregame, samples, fullLines, htLines,
  } = state;

  const press = computePressure(samples, {
    clampMin: model.pressure_clamp_min, clampMax: model.pressure_clamp_max,
    weights: {
      shots_on: model.pressure_w_shots_on, dangerous: model.pressure_w_dangerous,
      corners: model.pressure_w_corners, shots: model.pressure_w_shots,
    },
  });

  const decisions = [];
  for (const spec of buildWindowSpecs(settings)) {
    const d = {
      market: spec.market, fire: false, reason: null,
      line: null, overOdd: null, bookmaker: null, prob: null, ev: null,
      lambdaRemaining: null, context: null,
    };

    if (!spec.enabled) { d.reason = 'janela desligada'; decisions.push(d); continue; }
    if (!(minute >= spec.minMinute && minute <= spec.maxMinute)) { d.reason = 'fora da janela'; decisions.push(d); continue; }

    // Dados incompletos = NÃO dispara.
    if (!press.ok) { d.reason = 'dados ao vivo insuficientes'; decisions.push(d); continue; }
    const lines = spec.lines === 'full' ? fullLines : htLines;
    const cornersNow = spec.lines === 'full' ? cornersTotal : htCornersTotal;
    if (!Array.isArray(lines) || lines.length === 0) { d.reason = 'sem odds'; decisions.push(d); continue; }
    if (!Number.isFinite(cornersNow)) { d.reason = 'sem contagem de cantos'; decisions.push(d); continue; }
    if (!Number.isFinite(lambdaPregame) || lambdaPregame <= 0) { d.reason = 'sem λ pré-jogo'; decisions.push(d); continue; }

    if (spec.requireFavNotWinning && favorite && favoriteWinning(favorite, goalsHome, goalsAway)) {
      d.reason = 'favorito ganhando'; decisions.push(d); continue;
    }
    if (spec.requireRising && !press.rising) { d.reason = 'pressão não está subindo'; decisions.push(d); continue; }

    const goalDiff = (goalsHome ?? 0) - (goalsAway ?? 0);
    const sf = scorelineFactor({ goalDiff, minute, marketEnd: spec.marketEnd });
    const lamPre = spec.lines === 'ht' ? lambdaPregame * (model.ht_share ?? 0.46) : lambdaPregame;
    const lamRem = projectRemainingLambda({
      lambdaPregame: lamPre, minute, cornersNow, marketEnd: spec.marketEnd,
      pressure: press.pressure, scoreline: sf,
    });
    d.lambdaRemaining = lamRem;
    if (lamRem == null) { d.reason = 'sem base de cálculo'; decisions.push(d); continue; }

    const best = chooseBestLine(lines, {
      lambdaRemaining: lamRem, cornersNow, params: model,
      evMin: model.ev_min, probMin: model.prob_min,
    });
    if (!best) { d.reason = 'sem linha com EV/prob suficientes'; decisions.push(d); continue; }

    d.fire = true;
    d.reason = 'valor encontrado';
    d.line = best.line; d.overOdd = best.overOdd; d.bookmaker = best.bookmaker;
    d.prob = best.prob; d.ev = best.ev;
    d.context = {
      minute, score: `${goalsHome ?? 0}-${goalsAway ?? 0}`,
      favorite: favorite ?? null,
      pressure: Number(press.pressure.toFixed(3)), rising: press.rising,
      scoreline: Number(sf.toFixed(3)),
      lambdaPregame: Number(lamPre.toFixed(3)), lambdaRemaining: Number(lamRem.toFixed(3)),
      needed: Number((best.line - cornersNow).toFixed(1)),
      reasons: [
        `pressão ${press.pressure.toFixed(2)}${press.rising ? ' (subindo)' : ''}`,
        `placar ${goalsHome ?? 0}-${goalsAway ?? 0}`,
        `λ restante ${lamRem.toFixed(1)}`,
        `linha ${best.line} @ ${best.bookmaker}`,
        `EV ${(best.ev * 100).toFixed(1)}%`,
      ],
    };
    decisions.push(d);
  }
  return { pressure: press, decisions };
}

/** Já existe sinal nesse mercado pra esse jogo? (anti-repetição) */
export function hasSignal(db, fixtureId, market) {
  return !!db.prepare('SELECT 1 FROM signals WHERE fixture_id = ? AND market = ?').get(fixtureId, market);
}

/** Prejuízo acumulado passou do stop de banca? */
export function bankrollStopHit(db, settings) {
  const row = db.prepare(
    "SELECT COALESCE(SUM(profit_units), 0) AS p FROM signals WHERE status IN ('green','red','void')"
  ).get();
  return row.p <= -Math.abs(settings.bankroll_stop_units);
}

/** Grava um sinal (pending). Retorna false se já existia (anti-repetição). */
export function recordSignal(db, fixtureId, decision, { stake, now = Date.now() }) {
  try {
    db.prepare(
      `INSERT INTO signals
         (fixture_id, market, minute, line, open_odd, bookmaker, stake, model_prob, ev, status, context, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(
      fixtureId, decision.market, normalize(decision.context?.minute),
      normalize(decision.line), normalize(decision.overOdd), normalize(decision.bookmaker),
      normalize(stake), normalize(decision.prob), normalize(decision.ev),
      JSON.stringify(decision.context || {}), now
    );
    return true;
  } catch (e) {
    if (String(e).includes('UNIQUE')) return false;
    throw e;
  }
}

/**
 * Processa as decisões de uma avaliação: dispara as que devem, respeitando
 * stop de banca e anti-repetição. Loga só as tentativas de disparo (evita spam).
 * @returns {Array} decisões enriquecidas com {fired, note}
 */
export function processDecisions(db, fixtureId, evalResult, cfg, { now = Date.now() } = {}) {
  const stopped = bankrollStopHit(db, cfg.settings);
  const out = [];
  for (const d of evalResult.decisions) {
    let fired = false;
    let note = d.reason;
    if (d.fire) {
      if (stopped) {
        note = 'stop de banca atingido — não dispara';
      } else if (hasSignal(db, fixtureId, d.market)) {
        note = 'já existe sinal neste mercado (anti-repetição)';
      } else {
        fired = recordSignal(db, fixtureId, d, { stake: cfg.settings.stake_per_signal, now });
        note = fired ? 'disparado' : 'já existe sinal neste mercado (anti-repetição)';
      }
      logEvent(db, {
        level: fired ? 'signal' : 'warn', type: 'live_signal',
        message: `${d.market} ${fired ? 'DISPAROU' : 'bloqueado'}: ${note}`,
        data: { fixtureId, market: d.market, line: d.line, ev: d.ev, note },
      });
    }
    out.push({ ...d, fired, note });
  }
  return out;
}
