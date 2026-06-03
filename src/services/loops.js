// Loops de fundo — o que faz o Bet21 "rodar sozinho".
//
// Cada tick é uma função pura-ish que recebe ctx e faz UM trabalho, devolvendo
// um resumo. startLoops() agenda todos com setInterval. Tudo é best-effort:
// um erro num tick é logado, nunca derruba o app. Os ticks são testáveis com
// um ctx falso (client/db fakes), sem timers.

import * as cfg from '../config/settings.js';
import { logEvent } from '../db/index.js';
import { broadcastEvent } from '../server/server.js';
import { captureFixtureOdds } from './oddsCapture.js';
import { runSettle } from './settle.js';
import { evaluateLiveFixture, processDecisions } from './liveEngine.js';
import { computePressure } from '../model/pressure.js';
import { predictFixture } from './backtest.js';
import { parseTeamStatistics } from '../api/statsParser.js';
import { notifySignal } from './telegram.js';
import { backupDb } from './backup.js';
import { evaluateFixturesForValue, fireValueSignal } from './descalibration.js';

/** Loga no banco E empurra pro SSE (o log ao vivo do Painel). */
export function emit(ctx, ev) {
  try { logEvent(ctx.db, ev); } catch { /* ignora */ }
  try { broadcastEvent(ctx, { ...ev, ts: Date.now() }); } catch { /* ignora */ }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (v == null ? null : Number(v)));

/** Favorito (lado que vence) a partir das odds 1x2 guardadas. */
function favoriteFromOdds(fx) {
  const h = num(fx.odds_home), a = num(fx.odds_away);
  if (Number.isFinite(h) && Number.isFinite(a)) return h <= a ? 'home' : 'away';
  return null;
}

/** Linhas de cantos guardadas no jogo (principal capturada), como array p/ o engine. */
function linesFromFixture(fx) {
  const full = [];
  if (Number.isFinite(fx.corner_line) && Number.isFinite(fx.corner_over_odd)) {
    full.push({ line: fx.corner_line, overOdd: fx.corner_over_odd, bookmaker: fx.corner_bookmaker || '?' });
  }
  const ht = [];
  if (Number.isFinite(fx.ht_corner_line) && Number.isFinite(fx.ht_corner_over_odd)) {
    ht.push({ line: fx.ht_corner_line, overOdd: fx.ht_corner_over_odd, bookmaker: fx.ht_corner_bookmaker || '?' });
  }
  return { full, ht };
}

// --- Captura de odds (jogos que vão começar) ----------------------------------

export async function captureOddsTick(ctx) {
  const db = ctx.db;
  if (!ctx.client) return { skipped: 'sem cliente' };
  if (cfg.get(db, 'settings', 'odds_capture_enabled') === false) return { skipped: 'captura desligada' };

  const perRound = cfg.get(db, 'settings', 'odds_capture_per_round') ?? 8;
  const windowH = cfg.get(db, 'settings', 'odds_capture_window_hours') ?? 12;
  const nowSec = Math.floor(Date.now() / 1000);

  const rows = db.prepare(`
    SELECT f.id FROM fixtures f JOIN leagues l ON l.id = f.league_id
     WHERE l.active = 1 AND f.kickoff BETWEEN ? AND ?
       AND (f.status_short IS NULL OR f.status_short IN ('NS','TBD'))
     ORDER BY (f.corner_odds_captured_at IS NULL) DESC, f.kickoff ASC
     LIMIT ?
  `).all(nowSec - 1800, nowSec + windowH * 3600, perRound);

  let done = 0;
  for (const r of rows) {
    try { await captureFixtureOdds(ctx, r.id); done++; } catch { /* segue */ }
  }
  if (done) emit(ctx, { level: 'info', type: 'odds_capture', message: `Captura: ${done} jogo(s) atualizados.`, data: { done } });
  return { captured: done };
}

// --- Captura de fechamento (perto do apito, pro CLV) --------------------------

export async function closingCaptureTick(ctx) {
  const db = ctx.db;
  if (!ctx.client) return { skipped: 'sem cliente' };
  const minsBefore = cfg.get(db, 'settings', 'closing_capture_minutes_before') ?? 10;
  const nowSec = Math.floor(Date.now() / 1000);
  const lo = nowSec;
  const hi = nowSec + minsBefore * 60;

  const rows = db.prepare(`
    SELECT f.id FROM fixtures f JOIN leagues l ON l.id = f.league_id
     WHERE l.active = 1 AND f.kickoff BETWEEN ? AND ?
       AND (f.status_short IS NULL OR f.status_short IN ('NS','TBD'))
     ORDER BY f.kickoff ASC LIMIT 10
  `).all(lo, hi);

  let done = 0;
  for (const r of rows) {
    try { await captureFixtureOdds(ctx, r.id, { closing: true }); done++; } catch { /* segue */ }
  }
  if (done) emit(ctx, { level: 'info', type: 'closing_capture', message: `Fechamento capturado: ${done} jogo(s).`, data: { done } });
  return { closing: done };
}

// --- Settle (liquidar jogos terminados) ---------------------------------------

export async function settleTick(ctx) {
  if (!ctx.client) return { skipped: 'sem cliente' };
  try {
    const r = await runSettle(ctx);
    const n = r?.settled ?? r?.count ?? 0;
    if (n) emit(ctx, { level: 'info', type: 'settle', message: `Settle: ${n} sinal(is) liquidados.`, data: { settled: n } });
    return r || {};
  } catch (e) {
    emit(ctx, { level: 'error', type: 'settle', message: 'Erro no settle: ' + (e?.message || e), data: {} });
    return { error: true };
  }
}

// --- Engine ao vivo (o coração) -----------------------------------------------

/** Grava uma amostra ao vivo (cumulativa) a partir das stats. */
export function recordLiveSample(db, fx, minute, byTeam, goalsHome, goalsAway, now = Date.now()) {
  const h = byTeam.get(fx.home_team_id) || {};
  const a = byTeam.get(fx.away_team_id) || {};
  db.prepare(`
    INSERT INTO live_samples (fixture_id, minute, captured_at, corners_home, corners_away,
      shots_home, shots_away, shots_on_home, shots_on_away, dangerous_home, dangerous_away,
      possession_home, possession_away, goals_home, goals_away)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    fx.id, minute, now,
    h.corners_for ?? null, a.corners_for ?? null,
    h.shots ?? null, a.shots ?? null,
    h.shots_on ?? null, a.shots_on ?? null,
    h.dangerous_attacks ?? null, a.dangerous_attacks ?? null,
    h.possession ?? null, a.possession ?? null,
    goalsHome ?? null, goalsAway ?? null,
  );
}

// Sparkline da pressão: recalcula a pressão em cada amostra (janela móvel),
// devolvendo uma série pequena (até ~12 pontos) pro mini-gráfico do card.
export function pressureSeries(samples) {
  const sorted = [...(samples || [])].sort((a, b) => a.minute - b.minute);
  const pts = [];
  for (let i = 2; i < sorted.length; i++) {
    const p = computePressure(sorted.slice(0, i + 1));
    if (p.ok) pts.push({ minute: sorted[i].minute, pressure: Number(p.pressure.toFixed(3)) });
  }
  return pts.slice(-12);
}

// Escolhe a decisão "principal" pra mostrar no card: a que disparou; senão a
// W2; senão a primeira que não seja "janela desligada".
function pickDecision(decisions) {
  return decisions.find((d) => d.fire)
    || decisions.find((d) => d.market === 'W2' && d.reason !== 'janela desligada')
    || decisions.find((d) => d.reason !== 'janela desligada')
    || decisions[0] || null;
}

// Traduz o motivo técnico num rótulo curto pro card + um "status" (cor).
function statusFromDecision(d) {
  if (!d) return { status: 'idle', label: 'sem janela ativa' };
  if (d.fire) return { status: 'fired', label: 'sinal disparado' };
  const r = d.reason || '';
  if (r === 'fora da janela') return { status: 'wait', label: 'fora da janela' };
  if (r === 'janela desligada') return { status: 'idle', label: 'janela desligada' };
  if (r === 'favorito ganhando') return { status: 'block', label: 'favorito ganhando — não dispara' };
  if (r === 'pressão não está subindo') return { status: 'watch', label: 'pressão não está subindo' };
  if (r === 'dados ao vivo insuficientes') return { status: 'collecting', label: 'coletando dados' };
  if (r === 'sem odds') return { status: 'watch', label: 'sem odds de cantos' };
  if (r === 'sem linha com EV/prob suficientes') return { status: 'watch', label: 'observando — sem EV suficiente' };
  if (r === 'sem λ pré-jogo') return { status: 'watch', label: 'sem histórico pro λ' };
  return { status: 'watch', label: r || 'observando' };
}

/** Monta o snapshot de um jogo (o "card" da aba Ao vivo) a partir do estado avaliado. */
export function buildLiveSnapshot(fx, state, evalResult, now = Date.now()) {
  const d = pickDecision(evalResult.decisions);
  const st = statusFromDecision(d);
  const press = evalResult.pressure || {};
  return {
    fixtureId: fx.id,
    match: `${fx.home_team} x ${fx.away_team}`,
    league: fx.league_name || null,
    minute: state.minute,
    score: `${state.goalsHome ?? 0}-${state.goalsAway ?? 0}`,
    corners: Number.isFinite(state.cornersTotal) ? state.cornersTotal : null,
    favorite: state.favorite || null,
    pressure: press.ok ? Number(press.pressure.toFixed(2)) : null,
    rising: !!press.rising,
    window: d ? d.market : null,
    status: st.status,
    statusLabel: st.label,
    line: d?.line ?? null,
    overOdd: d?.overOdd ?? null,
    prob: d?.prob ?? null,
    ev: d?.ev ?? null,
    series: pressureSeries(state.samples).map((p) => p.pressure),
    updatedAt: now,
  };
}

export async function liveEngineTick(ctx, { now = Date.now() } = {}) {
  const db = ctx.db;
  if (!ctx.engine || !ctx.engine.running) return { skipped: 'engine desligado' };
  if (!ctx.client) return { skipped: 'sem cliente' };

  // 1 chamada: todos os jogos ao vivo agora
  let live;
  try { live = await ctx.client.getLiveFixtures('all'); } catch (e) {
    emit(ctx, { level: 'error', type: 'live', message: 'Erro buscando jogos ao vivo: ' + (e?.message || e), data: {} });
    return { error: true };
  }
  const liveArr = (live && live.response) || [];
  const liveById = new Map();
  for (const item of liveArr) {
    const id = item?.fixture?.id;
    if (id != null) liveById.set(id, item);
  }

  // Nossos jogos monitorados de ligas ativas
  const ours = db.prepare(`
    SELECT f.*, l.name AS league_name FROM fixtures f JOIN leagues l ON l.id = f.league_id
     WHERE l.active = 1 AND f.monitored = 1
  `).all();

  if (!ctx.liveState) ctx.liveState = new Map();
  const config = { settings: cfg.settings(db), model: cfg.modelParams(db) };
  let checked = 0, fired = 0;
  const seen = new Set();

  for (const fx of ours) {
    const item = liveById.get(fx.id);
    if (!item) continue; // não está ao vivo agora
    checked++;
    const minute = num(item?.fixture?.status?.elapsed);
    const goalsHome = num(item?.goals?.home) ?? 0;
    const goalsAway = num(item?.goals?.away) ?? 0;
    if (!Number.isFinite(minute)) continue;

    // 1 chamada por jogo ao vivo: stats atuais
    let stats;
    try { stats = await ctx.client.getFixtureStatistics(fx.id); } catch { continue; }
    const byTeam = parseTeamStatistics((stats && stats.response) || []);
    recordLiveSample(db, fx, minute, byTeam, goalsHome, goalsAway, now);

    // Monta o estado
    const samples = db.prepare('SELECT * FROM live_samples WHERE fixture_id = ? ORDER BY minute ASC').all(fx.id);
    const { full, ht } = linesFromFixture(fx);
    const pred = predictFixture(db, fx.id, config.model);
    const lambdaPregame = pred?.lambda ?? null;
    const tNow = byTeam.get(fx.home_team_id) || {};
    const oNow = byTeam.get(fx.away_team_id) || {};
    const cornersTotal = (tNow.corners_for ?? 0) + (oNow.corners_for ?? 0);

    const state = {
      minute, cornersTotal, htCornersTotal: num(fx.ht_corners_home) != null ? (num(fx.ht_corners_home) + num(fx.ht_corners_away)) : NaN,
      goalsHome, goalsAway, favorite: favoriteFromOdds(fx),
      lambdaPregame, samples, fullLines: full, htLines: ht,
    };

    const evalResult = evaluateLiveFixture(state, config);
    const processed = processDecisions(db, fx.id, evalResult, config, { now });

    // Guarda o snapshot pro dashboard (a aba "Ao vivo" lê isto)
    ctx.liveState.set(fx.id, buildLiveSnapshot(fx, state, evalResult, now));
    seen.add(fx.id);

    for (const d of processed) {
      if (d.fired) {
        fired++;
        const match = `${fx.home_team} x ${fx.away_team}`;
        emit(ctx, {
          level: 'signal', type: 'live_signal',
          message: `🔔 SINAL: ${match} — over ${d.line} cantos (${d.market}) @ ${d.overOdd} ${d.bookmaker} · EV ${(d.ev * 100).toFixed(1)}%`,
          data: { fixtureId: fx.id, market: d.market, line: d.line, ev: d.ev },
        });
        // Telegram (best-effort)
        notifySignal(ctx, {
          match, market: d.market, line: d.line, overOdd: d.overOdd,
          bookmaker: d.bookmaker, minute, score: `${goalsHome}-${goalsAway}`, ev: d.ev,
        }).catch(() => {});
      }
    }
  }

  // Poda jogos que não estão mais ao vivo (saíram desde o último tick)
  for (const id of [...ctx.liveState.keys()]) {
    if (!seen.has(id)) ctx.liveState.delete(id);
  }

  return { checked, fired };
}

// --- Backup -------------------------------------------------------------------

export function backupTick(ctx, { now = Date.now(), force = false } = {}) {
  const db = ctx.db;
  const everyH = cfg.get(db, 'settings', 'backup_interval_hours') ?? 12;
  const keep = cfg.get(db, 'settings', 'backup_keep') ?? 20;
  const last = ctx._lastBackupAt || 0;
  if (!force && now - last < everyH * 3600 * 1000) return { skipped: 'ainda não na hora' };

  const r = backupDb({ keep, now: new Date(now) });
  ctx._lastBackupAt = now;
  if (r.ok) emit(ctx, { level: 'info', type: 'backup', message: `Backup do banco feito${r.removed ? ` (${r.removed} antigos removidos)` : ''}.`, data: { file: r.file } });
  return r;
}

// --- Resumo diário no Telegram ------------------------------------------------

export async function dailySummaryTick(ctx, { now = Date.now() } = {}) {
  const db = ctx.db;
  const hour = cfg.get(db, 'settings', 'daily_summary_hour_brt') ?? 9;
  // BRT = UTC-3
  const brtNow = new Date(now - 3 * 3600 * 1000);
  const todayKey = `${brtNow.getUTCFullYear()}-${brtNow.getUTCMonth()}-${brtNow.getUTCDate()}`;
  if (brtNow.getUTCHours() !== hour) return { skipped: 'fora da hora' };
  if (ctx._lastDailyKey === todayKey) return { skipped: 'já enviado hoje' };
  ctx._lastDailyKey = todayKey;

  try {
    const { report } = await import('./accounting.js');
    const rep = report(db, {});
    const { notifyDailySummary } = await import('./telegram.js');
    const res = await notifyDailySummary(ctx, rep);
    emit(ctx, { level: 'info', type: 'daily_summary', message: 'Resumo diário ' + (res.ok ? 'enviado' : `não enviado (${res.skipped || res.error || '?'})`), data: {} });
    return { sent: !!res.ok };
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}

// --- Descalibração pré-live (sinais de valor over/under) ----------------------

export async function descalibrationTick(ctx, { now = Date.now() } = {}) {
  const db = ctx.db;
  if (cfg.get(db, 'settings', 'prelive_value_enabled') === false) return { skipped: 'desligado' };
  const windowHours = cfg.get(db, 'settings', 'prelive_value_window_hours') ?? 24;
  const stake = cfg.get(db, 'settings', 'stake_per_signal') ?? 1;
  const params = cfg.modelParams(db);

  let evaluated = 0, fired = 0;
  let list;
  try {
    list = evaluateFixturesForValue(db, { now, windowHours, params });
  } catch (e) {
    emit(ctx, { level: 'error', type: 'prelive_value', message: 'Erro na descalibração: ' + (e?.message || e), data: {} });
    return { error: true };
  }

  for (const item of list) {
    evaluated++;
    if (!item.eval?.hasValue) continue;
    const fx = db.prepare('SELECT * FROM fixtures WHERE id = ?').get(item.fixtureId);
    if (!fx) continue;
    fx._lambda = item.lambda;
    const r = fireValueSignal(db, fx, item.eval, { stake, now });
    if (r.fired) {
      fired++;
      broadcastEvent(ctx, { level: 'signal', type: 'prelive_value', message: `🎯 VALOR: ${item.match} ${item.eval.side} ${item.eval.line}`, ts: Date.now() });
      notifySignal(ctx, {
        match: item.match, market: r.market, line: item.eval.line, overOdd: item.eval.odd,
        bookmaker: item.eval.bookmaker, ev: item.eval.ev,
      }).catch(() => {});
    }
  }
  if (fired) emit(ctx, { level: 'info', type: 'prelive_value', message: `Descalibração: ${fired} sinal(is) de valor disparados (${evaluated} jogos avaliados).`, data: { fired, evaluated } });
  return { evaluated, fired };
}

// --- Agendador ----------------------------------------------------------------

/**
 * Agenda todos os loops. Devolve uma função stop() que limpa os timers.
 * @param {object} ctx
 * @param {{setIntervalFn?:Function, clearIntervalFn?:Function}} [inj]  injetável p/ teste
 */
export function startLoops(ctx, inj = {}) {
  const si = inj.setIntervalFn || setInterval;
  const ci = inj.clearIntervalFn || clearInterval;
  const db = ctx.db;

  const liveSec = cfg.get(db, 'settings', 'live_tick_interval_sec') ?? 60;
  const capSec = cfg.get(db, 'settings', 'odds_capture_interval_sec') ?? 90;
  const settleMin = cfg.get(db, 'settings', 'settle_interval_minutes') ?? 20;

  const wrap = (name, fn) => () => { Promise.resolve().then(() => fn(ctx)).catch((e) => emit(ctx, { level: 'error', type: name, message: `Erro no loop ${name}: ${e?.message || e}`, data: {} })); };

  const timers = [
    si(wrap('live', liveEngineTick), liveSec * 1000),
    si(wrap('odds_capture', captureOddsTick), capSec * 1000),
    si(wrap('closing_capture', closingCaptureTick), 60 * 1000),
    si(wrap('settle', settleTick), settleMin * 60 * 1000),
    si(wrap('prelive_value', descalibrationTick), 5 * 60 * 1000),
    si(wrap('backup', backupTick), 30 * 60 * 1000),
    si(wrap('daily_summary', dailySummaryTick), 5 * 60 * 1000),
  ];

  emit(ctx, { level: 'info', type: 'loops', message: 'Loops de fundo iniciados.', data: { liveSec, capSec, settleMin } });

  return function stop() {
    for (const t of timers) ci(t);
  };
}
