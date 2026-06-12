// Controlador do dashboard: cada função corresponde a uma rota e devolve dados
// puros (ou {error}). Sem tocar em sockets — assim dá pra testar tudo isolado.

import { logEvent } from '../db/index.js';
import * as cfg from '../config/settings.js';
import { listLeagues, setLeaguesActive, syncLeagues, countActive, syncLeagueTeams } from '../services/leagues.js';
import { displayLeagueName, countryPt } from '../services/leagueNames.js';
import { parseFixture } from '../api/statsParser.js';
import { upsertFixture, refreshMonitoredFlags } from '../services/fixturesSync.js';
import { captureFixtureOdds, diagnoseCornerOdds } from '../services/oddsCapture.js';
import { parseLiveCornerLines } from '../api/oddsParser.js';
import { prelive } from '../services/prelive.js';
import { evaluateDescalibration, valueConfig } from '../services/descalibration.js';
import { report } from '../services/accounting.js';
import { backtest } from '../services/backtest.js';
import { runSettle } from '../services/settle.js';
import { runBackfill, activeTeamIds, splitByHistory, coverageByLeague, backfillTeam, RequestBudget, statsCountByTeam } from '../services/backfill.js';
import { simulate } from '../services/simulation.js';
import { backupTick } from '../services/loops.js';

const ymd = (d) => d.toISOString().slice(0, 10);

/** Último ts de cada tipo de evento (pro painel de saúde). */
function lastEventTs(db, type) {
  const r = db.prepare('SELECT MAX(ts) AS t FROM app_events WHERE type = ?').get(type);
  return r?.t ?? null;
}

/** Painel de saúde: luzes verde/vermelho + o que fazer. */
export function health(ctx) {
  const { db, gatekeeper, secrets } = ctx;
  const gk = gatekeeper ? gatekeeper.stats() : {};
  const settings = cfg.settings(db);

  const upcoming = db.prepare(`
    SELECT
      SUM(CASE WHEN corner_line IS NOT NULL THEN 1 ELSE 0 END) AS withOdds,
      SUM(CASE WHEN corner_line IS NULL THEN 1 ELSE 0 END) AS withoutOdds
    FROM fixtures
    WHERE kickoff > strftime('%s','now') - 10800 AND (status_short IS NULL OR status_short IN ('NS','TBD'))
  `).get();

  const engineRunning = cfg.get(db, 'settings', 'odds_capture_enabled') !== undefined
    ? !!(ctx.engine && ctx.engine.running)
    : false;

  const apiKeyOk = !!(secrets && secrets.apiKey);
  const lights = {
    apiKey: { ok: apiKeyOk, label: apiKeyOk ? 'Chave da API configurada' : 'Falta a chave da API no .env', fix: apiKeyOk ? null : 'Edite o arquivo .env e preencha APIFOOTBALL_KEY.' },
    requestsDay: { remaining: gk.remainingDay ?? null, limit: gk.limitDay ?? null },
    requestsMinute: { remaining: gk.remainingMinute ?? null, limit: gk.limitMinute ?? null },
    captureEnabled: { ok: !!settings.odds_capture_enabled, label: settings.odds_capture_enabled ? 'Captura de odds ligada' : 'Captura de odds desligada' },
    engine: { ok: !!(ctx.engine && ctx.engine.running), label: (ctx.engine && ctx.engine.running) ? 'Engine ao vivo LIGADO' : 'Engine ao vivo desligado' },
    odds: { withOdds: upcoming?.withOdds ?? 0, withoutOdds: upcoming?.withoutOdds ?? 0 },
    lastSettle: lastEventTs(db, 'settle'),
    lastCapture: lastEventTs(db, 'odds_capture'),
    lastBackfill: lastEventTs(db, 'backfill'),
    activeLeagues: countActive(db),
  };
  return lights;
}

export function leagues(ctx) {
  const list = listLeagues(ctx.db).map((l) => ({
    ...l,
    displayName: displayLeagueName(l),
    countryPt: countryPt(l.country) || l.country || null,
  }));
  return { leagues: list };
}

export function leaguesActivate(ctx, body) {
  const active = setLeaguesActive(ctx.db, body || {});
  refreshMonitoredFlags(ctx.db);
  return { active };
}

export async function syncLeaguesRoute(ctx) {
  requireClient(ctx);
  return await syncLeagues(ctx);
}

/** Sincroniza os jogos de uma data (padrão: hoje), upsert e marca monitorados. */
export async function syncFixtures(ctx, body) {
  requireClient(ctx);
  const db = ctx.db;

  // Modo legado: se vier uma data explícita, busca só aquele dia (compat).
  if (body && body.date) {
    const date = body.date;
    const res = await ctx.client.getFixtures({ date }, { priority: 'normal' });
    let n = 0;
    if (!res?.empty && Array.isArray(res?.response)) {
      for (const item of res.response) { const pf = parseFixture(item); if (pf.id != null) { upsertFixture(db, pf); n += 1; } }
    }
    refreshMonitoredFlags(db);
    logEvent(db, { level: 'info', type: 'fixtures_sync', message: `${n} jogos sincronizados (${date}).`, data: { date, n } });
    return { date, synced: n };
  }

  // Modo padrão: próximos N jogos de CADA liga ativa (1 requisição por liga).
  const perLeague = cfg.get(db, 'settings', 'fixtures_next_per_league') ?? 10;
  const leaguesActive = db.prepare('SELECT id, season FROM leagues WHERE active = 1').all();
  if (leaguesActive.length === 0) return { synced: 0, leagues: 0, message: 'Nenhuma liga ativa. Ative ligas na aba "Ligas".' };

  let synced = 0, spent = 0, errors = 0;
  for (const lg of leaguesActive) {
    try {
      // SEM season: "próximos N" já são da temporada vigente. Passar season quebra
      // quando ela está desatualizada no banco (ex.: Copa do Mundo gravada como 2022).
      const res = await ctx.client.getFixtures({ league: lg.id, next: perLeague }, { priority: 'normal' });
      spent += 1;
      if (!res?.empty && Array.isArray(res?.response)) {
        for (const item of res.response) { const pf = parseFixture(item); if (pf.id != null) { upsertFixture(db, pf); synced += 1; } }
      }
    } catch { errors += 1; }
  }
  refreshMonitoredFlags(db);
  logEvent(db, { level: 'info', type: 'fixtures_sync', message: `Próximos jogos: ${synced} em ${leaguesActive.length} liga(s) ativa(s) (${spent} req).`, data: { synced, leagues: leaguesActive.length, spent, errors } });
  return { synced, leagues: leaguesActive.length, spent };
}

/** Jogos de hoje (e próximas horas) das LIGAS ATIVAS, com odds e flag de monitorado. */
export function todayFixtures(ctx) {
  const db = ctx.db;
  const rows = db.prepare(`
    SELECT f.id, f.home_team, f.away_team, f.kickoff, f.status_short, f.elapsed,
           f.corner_line, f.corner_over_odd, f.corner_bookmaker, f.monitored,
           f.goals_home, f.goals_away, l.name AS league
      FROM fixtures f JOIN leagues l ON l.id = f.league_id
     WHERE l.active = 1
       AND f.kickoff BETWEEN strftime('%s','now') - 10800 AND strftime('%s','now') + 86400
     ORDER BY f.kickoff ASC
  `).all();
  return { fixtures: rows };
}

/** Captura de odds: lote, por jogo, ou fechamento. */
export async function captureOdds(ctx, body) {
  requireClient(ctx);
  const scope = body?.scope || 'fixture';
  if (scope === 'fixture') {
    if (!body.fixtureId) return { error: 'fixtureId obrigatório' };
    const r = await captureFixtureOdds(ctx, Number(body.fixtureId), { isClosing: !!body.closing });
    return { scope, ...r.outcome, empty: r.empty };
  }
  // lote: pega N jogos próximos sem odds e tenta resolver
  const per = cfg.get(ctx.db, 'settings', 'odds_capture_per_round');
  const hours = cfg.get(ctx.db, 'settings', 'odds_capture_window_hours');
  const targets = ctx.db.prepare(`
    SELECT id FROM fixtures
     WHERE corner_line IS NULL AND kickoff BETWEEN strftime('%s','now') AND strftime('%s','now') + ?*3600
     ORDER BY kickoff ASC LIMIT ?
  `).all(hours, per);
  let set = 0, cleared = 0;
  for (const t of targets) {
    const r = await captureFixtureOdds(ctx, t.id, {});
    if (r.outcome.full === 'set') set += 1; else cleared += 1;
  }
  return { scope: 'lot', tried: targets.length, set, cleared };
}

export async function diagnose(ctx, query) {
  requireClient(ctx);
  const fixtureId = Number(query.fixture);
  if (!fixtureId) return { error: 'fixture obrigatório' };
  return await diagnoseCornerOdds(ctx, fixtureId);
}

/**
 * Diagnóstico de odds AO VIVO: chama /odds/live AGORA pro jogo e devolve
 * o que a API retornou (mercados crus de cantos) + o que o parser extraiu.
 * Ferramenta de auditoria: compara com a casa de aposta aberta do lado.
 */
export async function liveOddsDiagnose(ctx, query) {
  requireClient(ctx);
  const fixtureId = Number(query.fixture);
  if (!fixtureId) return { error: 'fixture obrigatório' };
  let res;
  try { res = await ctx.client.getLiveOdds(fixtureId); }
  catch (e) { return { fixtureId, error: 'falha ao buscar /odds/live: ' + (e?.message || e) }; }
  const item = Array.isArray(res?.response) ? res.response[0] : null;
  if (!item) return { fixtureId, empty: true, note: 'A API não tem odds ao vivo pra esse jogo agora (cobertura varia por jogo/liga).' };
  // mercados crus que mencionam corner (pra você ver o formato real)
  const rawCorners = (item.odds || [])
    .filter((m) => String(m?.name || '').toLowerCase().includes('corner'))
    .map((m) => ({ id: m.id, name: m.name, values: (m.values || []).slice(0, 12) }));
  const parsed = parseLiveCornerLines(item);
  return { fixtureId, rawCornerMarkets: rawCorners, parsedLines: parsed,
    note: parsed.length ? 'parsedLines = o que o motor usa pro EV.' : 'Nenhuma linha de canto apostável extraída — me mande este JSON se a casa mostra linhas.' };
}

export function preliveRoute(ctx) {
  const db = ctx.db;
  const ranking = prelive(db);
  // anexa o valor (descalibração over/under) a cada jogo do ranking
  const params = cfg.modelParams(db);
  const conf = valueConfig(db, params);
  for (const r of ranking) {
    const fx = db.prepare('SELECT * FROM fixtures WHERE id = ?').get(r.fixtureId);
    if (!fx) continue;
    const ev = evaluateDescalibration(fx, r.lambda, conf);
    if (ev.hasValue) {
      r.value = { side: ev.side, line: ev.line, odd: ev.odd, ev: ev.ev, edge: ev.edge, modelProb: ev.modelProb, marketProb: ev.marketProb };
    } else {
      r.valueReason = ev.reason;
    }
  }
  return { ranking };
}

export function signals(ctx, query = {}) {
  const filters = {};
  if (query.status === 'pending') filters.status = 'pending';
  const r = report(ctx.db, filters);
  let table = r.table;
  // 'settled' = tudo que não é pendente (green/red/void)
  if (query.status === 'settled') table = table.filter((t) => t.resultado !== 'pending');
  else if (query.status === 'pending') table = table.filter((t) => t.resultado === 'pending');
  return { summary: r.summary, table };
}

export function accounting(ctx, query) {
  const f = {};
  const map = ['market', 'status', 'bookmaker', 'mando', 'scoreState', 'clvSign'];
  for (const k of map) if (query[k]) f[k] = query[k];
  for (const k of ['leagueId', 'evMin', 'evMax', 'oddMin', 'oddMax', 'minuteMin', 'minuteMax', 'pressureMin', 'pressureMax', 'from', 'to']) {
    if (query[k] != null && query[k] !== '') f[k] = Number(query[k]);
  }
  return report(ctx.db, f);
}

export function backtestRoute(ctx) {
  return backtest(ctx.db, {});
}

export function getConfig(ctx) {
  return { settings: cfg.all(ctx.db, 'settings'), model: cfg.all(ctx.db, 'model') };
}

export function setConfig(ctx, body) {
  const { which, key, value, reset } = body || {};
  if (!which || !key) return { error: 'which e key obrigatórios' };
  if (reset) return { value: cfg.reset(ctx.db, which, key) };
  return { value: cfg.set(ctx.db, which, key, value) };
}

export function toggleEngine(ctx, body) {
  if (!ctx.engine) ctx.engine = { running: false };
  ctx.engine.running = !!(body && body.on);
  // Persiste para sobreviver a reinícios do container (Railway reinicia e zeraria a memória).
  try { cfg.set(ctx.db, 'settings', 'engine_running', ctx.engine.running); } catch { /* ignora */ }
  logEvent(ctx.db, { level: 'info', type: 'engine', message: ctx.engine.running ? 'Engine LIGADO' : 'Engine desligado', data: {} });
  return { running: ctx.engine.running };
}

export function events(ctx, query) {
  const n = Math.min(200, Number(query.n) || 50);
  const rows = ctx.db.prepare('SELECT ts, level, type, message FROM app_events ORDER BY ts DESC LIMIT ?').all(n);
  return { events: rows };
}

export async function settleRoute(ctx) {
  requireClient(ctx);
  return await runSettle(ctx);
}

/**
 * Dispara o backfill do histórico de cantos dos times das ligas ativas.
 * Roda em SEGUNDO PLANO (pode demorar) e loga o progresso no log ao vivo.
 */
export function backfillRoute(ctx, body = {}) {
  requireClient(ctx);
  const db = ctx.db;
  if (ctx._backfillRunning) {
    return { started: false, message: 'Backfill já está em andamento — acompanhe no log.' };
  }
  const allTeams = activeTeamIds(db);
  if (allTeams.length === 0) {
    return { error: 'Sem times pra puxar. Ative ligas na aba "Ligas" e clique em "Sincronizar jogos" primeiro.' };
  }
  const last = cfg.get(db, 'settings', 'history_games_per_team');
  const cap = cfg.get(db, 'settings', 'history_backfill_request_cap');
  const minGames = cfg.get(db, 'settings', 'history_complete_threshold') ?? 20;
  const force = !!body.force;

  // Quantos realmente vão ser puxados (pra mensagem e pra evitar rodar à toa)
  const { need, ready } = splitByHistory(db, allTeams, minGames);
  const toPull = force ? allTeams.length : need.length;
  if (toPull === 0) {
    return { started: false, message: `Todos os ${allTeams.length} times já têm histórico (≥${minGames} jogos). Nada a puxar — use "forçar tudo" se quiser atualizar mesmo assim.` };
  }

  ctx._backfillRunning = true;
  ctx._backfillCancel = false;
  ctx._backfillStartedAt = Date.now();
  logEvent(db, {
    level: 'info', type: 'backfill',
    message: force
      ? `Histórico (forçar tudo): ${allTeams.length} times. Roda em segundo plano.`
      : `Histórico: puxando ${need.length} time(s) que faltam, ${ready.length} já prontos pulados. Roda em segundo plano.`,
    data: { teams: toPull, skipped: force ? 0 : ready.length, last, cap, force },
  });

  runBackfill(ctx, { teamIds: allTeams, last, cap, minGames, force })
    .catch((e) => logEvent(db, { level: 'error', type: 'backfill', message: 'Erro no backfill: ' + (e?.message || e), data: {} }))
    .finally(() => { ctx._backfillRunning = false; ctx._backfillCancel = false; });

  return { started: true, teams: toPull, skipped: force ? 0 : ready.length, force };
}

/** Status do histórico: quantos times já têm dados, total de jogos, e se está rodando. */
export function backfillStatus(ctx) {
  const db = ctx.db;
  const teams = activeTeamIds(db);
  const withStats = db.prepare(`
    SELECT COUNT(DISTINCT team_id) AS n FROM match_stats
     WHERE team_id IN (${teams.length ? teams.map(() => '?').join(',') : 'NULL'})
  `).get(...teams).n;
  const games = db.prepare('SELECT COUNT(DISTINCT fixture_id) AS n FROM match_stats').get().n;
  const minGames = cfg.get(db, 'settings', 'history_complete_threshold') ?? 20;
  const { need, ready } = splitByHistory(db, teams, minGames);
  return {
    running: !!ctx._backfillRunning,
    activeTeams: teams.length,
    teamsWithHistory: withStats,
    teamsReady: ready.length,
    teamsNeeding: need.length,
    minGames,
    games,
  };
}

/** Cobertura do histórico por liga (pra grade visual). */
export function backfillCoverage(ctx) {
  const minGames = cfg.get(ctx.db, 'settings', 'history_complete_threshold') ?? 20;
  return { ...coverageByLeague(ctx.db, { minGames }), running: !!ctx._backfillRunning };
}

/** Descobre os times das ligas ativas (popula a grade mesmo sem jogos baixados). */
export async function syncTeamsRoute(ctx) {
  requireClient(ctx);
  const r = await syncLeagueTeams(ctx);
  return r;
}

/** Pede pro backfill em andamento parar (ele termina o time atual e encerra). */
export function cancelBackfillRoute(ctx) {
  if (!ctx._backfillRunning) return { canceled: false, message: 'Nenhum backfill rodando.' };
  ctx._backfillCancel = true;
  logEvent(ctx.db, { level: 'info', type: 'backfill', message: 'Parada solicitada — encerrando após o time atual.', data: {} });
  return { canceled: true };
}

/** Exclui um sinal (pelo id). Útil pra remover um disparo que você não quer registrar. */
export function deleteSignalRoute(ctx, body = {}) {
  const id = Number(body.id);
  if (!Number.isFinite(id)) return { error: 'id inválido' };
  const sig = ctx.db.prepare('SELECT id, fixture_id, market FROM signals WHERE id = ?').get(id);
  if (!sig) return { deleted: false, message: 'Sinal não encontrado.' };
  ctx.db.prepare('DELETE FROM signals WHERE id = ?').run(id);
  logEvent(ctx.db, { level: 'info', type: 'signal_delete', message: `Sinal #${id} (${sig.market}) excluído.`, data: { id, fixtureId: sig.fixture_id } });
  return { deleted: true, id };
}

/** Puxa o histórico dos times QUE FALTAM de uma liga (botão por liga na grade). */
export function backfillLeagueRoute(ctx, body = {}) {
  requireClient(ctx);
  const db = ctx.db;
  const leagueId = Number(body.leagueId);
  if (!Number.isFinite(leagueId)) return { error: 'leagueId inválido' };
  if (ctx._backfillRunning) return { started: false, message: 'Um backfill já está rodando — espere terminar.' };

  // Times daquela liga: dos fixtures e de league_teams (cobre liga recém-descoberta).
  const teamRows = db.prepare(`
    SELECT DISTINCT t AS team_id FROM (
      SELECT home_team_id AS t FROM fixtures WHERE league_id = ?
      UNION SELECT away_team_id AS t FROM fixtures WHERE league_id = ?
      UNION SELECT team_id AS t FROM league_teams WHERE league_id = ?
    ) WHERE t IS NOT NULL
  `).all(leagueId, leagueId, leagueId);
  const allTeams = teamRows.map((r) => r.team_id);
  if (allTeams.length === 0) return { started: false, message: 'Essa liga ainda não tem times. Use "Descobrir times" primeiro.' };

  const last = cfg.get(db, 'settings', 'history_games_per_team');
  const cap = cfg.get(db, 'settings', 'history_backfill_request_cap');
  const minGames = cfg.get(db, 'settings', 'history_complete_threshold') ?? 20;
  const includeTried = !!body.includeTried;
  const { need, ready } = splitByHistory(db, allTeams, minGames);  // need = quem tem < minGames jogos
  // Quem já foi tentado (tem last_try_at). Por padrão, pulamos esses — re-puxar gasta à toa.
  const tried = new Set(
    db.prepare('SELECT team_id FROM league_teams WHERE league_id = ? AND last_try_at IS NOT NULL').all(leagueId).map((r) => r.team_id)
  );
  // Padrão: cinza + amarelo NUNCA tentado. Com includeTried: tudo que falta (re-varre tentados).
  const toPull = includeTried ? need : need.filter((id) => !tried.has(id));
  if (toPull.length === 0) {
    const triedLeft = need.filter((id) => tried.has(id)).length;
    return { started: false, message: triedLeft
      ? `Os ${triedLeft} restantes já foram tentados. Use "incluir tentados" se quiser re-varrer.`
      : `Todos os ${allTeams.length} times dessa liga já estão prontos (≥${minGames} jogos).` };
  }

  const name = db.prepare('SELECT name FROM leagues WHERE id = ?').get(leagueId)?.name || `liga #${leagueId}`;
  ctx._backfillRunning = true;
  ctx._backfillCancel = false;
  ctx._backfillStartedAt = Date.now();
  logEvent(db, { level: 'info', type: 'backfill', message: `Histórico da ${name}: puxando ${toPull.length} time(s)${includeTried ? ' (incluindo já tentados)' : ''} — ${ready.length} prontos pulados.`, data: { leagueId, teams: toPull.length, includeTried } });

  // toPull já é a lista exata → force:true pra runBackfill não re-filtrar.
  runBackfill(ctx, { teamIds: toPull, last, cap, minGames, force: true })
    .catch((e) => logEvent(db, { level: 'error', type: 'backfill', message: 'Erro no backfill da liga: ' + (e?.message || e), data: { leagueId } }))
    .finally(() => { ctx._backfillRunning = false; ctx._backfillCancel = false; });

  return { started: true, leagueId, name, teams: toPull.length, skipped: ready.length, includeTried };
}

/** Puxa o histórico de UM time específico (clicar no clube na grade). */
export function backfillTeamRoute(ctx, body = {}) {
  requireClient(ctx);
  const db = ctx.db;
  const teamId = Number(body.teamId);
  if (!Number.isFinite(teamId)) return { error: 'teamId inválido' };
  if (ctx._backfillRunning) return { started: false, message: 'Um backfill já está rodando — espere terminar.' };

  const last = cfg.get(db, 'settings', 'history_games_per_team');
  const name = db.prepare(
    'SELECT home_team AS n FROM fixtures WHERE home_team_id=? UNION SELECT away_team FROM fixtures WHERE away_team_id=? LIMIT 1'
  ).get(teamId, teamId)?.n || `#${teamId}`;

  ctx._backfillRunning = true;
  ctx._backfillStartedAt = Date.now();
  logEvent(db, { level: 'info', type: 'backfill', message: `Histórico do time ${name}: puxando os últimos ${last} jogos.`, data: { teamId, last } });

  const budget = new RequestBudget(last + 5);
  backfillTeam(ctx, teamId, { last, budget })
    .then((s) => logEvent(db, { level: 'info', type: 'backfill', message: `Time ${name}: ${s.stored} jogos novos (${s.spent} req).`, data: { teamId, ...s } }))
    .catch((e) => logEvent(db, { level: 'error', type: 'backfill', message: 'Erro no backfill do time: ' + (e?.message || e), data: { teamId } }))
    .finally(() => { ctx._backfillRunning = false; });

  return { started: true, teamId, name };
}

/** Modo simulação: dispara um sinal sintético pra testar o ciclo sem API. */
export function simulateRoute(ctx) {
  const r = simulate(ctx);
  return { fired: r.fired, fixtureId: r.fixtureId, decisions: r.evalResult.decisions.map((d) => ({ market: d.market, fire: d.fire, reason: d.reason, line: d.line, ev: d.ev })) };
}

/** Backup manual do banco (força agora). */
export function backupRoute(ctx) {
  const r = backupTick(ctx, { force: true });
  return r;
}

/** Estado ao vivo: os snapshots que o engine calcula a cada tick (pra aba "Ao vivo"). */
export function liveStateRoute(ctx) {
  const running = !!(ctx.engine && ctx.engine.running);
  const games = ctx.liveState ? [...ctx.liveState.values()] : [];
  // mais "interessantes" primeiro: disparados, depois em janela, depois por minuto
  const rank = (g) => (g.status === 'fired' ? 0 : g.status === 'watch' ? 1 : g.window === 'W2' ? 2 : 3);
  games.sort((a, b) => rank(a) - rank(b) || (b.minute || 0) - (a.minute || 0));
  return { running, count: games.length, games };
}

function requireClient(ctx) {
  if (!ctx.client) {
    const e = new Error('Sem cliente da API (configure a chave APIFOOTBALL_KEY no .env).');
    e.userMessage = e.message;
    throw e;
  }
}
