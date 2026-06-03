// Backfill de histórico → match_stats.
//
// SETUP (uma vez): últimos N jogos de cada time das ligas ativas.
// DIÁRIO (madrugada): só os jogos que terminaram desde a última vez.
//
// Economia central: estatística é cara (1 requisição por jogo). Antes de gastar,
// checamos se o jogo já tem match_stats (já processado) e PULAMOS — sem requisição.
// Tudo passa pelo porteiro (prioridade baixa) e respeita um TETO de requisições.

import { logEvent } from '../db/index.js';
import { parseFixture, isFinished, parseTeamStatistics, buildMatchStatsRows } from '../api/statsParser.js';
import { upsertFixture, upsertMatchStats, hasMatchStats } from './fixturesSync.js';
import { displayLeagueName } from './leagueNames.js';

/**
 * Contador de orçamento de requisições (o teto protege a cota diária).
 */
export class RequestBudget {
  constructor(cap) { this.cap = cap ?? Infinity; this.used = 0; }
  get left() { return this.cap - this.used; }
  get exhausted() { return this.used >= this.cap; }
  spend(n = 1) { this.used += n; return this.used; }
}

/**
 * Extrai e grava as estatísticas de UM jogo terminado (1 requisição).
 * Idempotente: se já tem match_stats, não faz nada (e não gasta requisição).
 * @returns {{spent:number, stored:boolean, reason?:string}}
 */
export async function extractAndStoreStats(ctx, fixtureId, parsedFixture) {
  const { db, client } = ctx;
  if (hasMatchStats(db, fixtureId)) return { spent: 0, stored: false, reason: 'já tem' };

  const res = await client.getFixtureStatistics(fixtureId);
  // 200 vazio = estatística indisponível pra esse jogo (acontece). Não é erro.
  if (res?.empty || !Array.isArray(res?.response) || res.response.length === 0) {
    return { spent: 1, stored: false, reason: 'sem estatística' };
  }
  const statsByTeam = parseTeamStatistics(res.response);
  const rows = buildMatchStatsRows(parsedFixture, statsByTeam);
  if (rows.length === 0) return { spent: 1, stored: false, reason: 'sem times' };
  for (const row of rows) upsertMatchStats(db, row);
  return { spent: 1, stored: true };
}

/**
 * Backfill de UM time: puxa os últimos N jogos, faz upsert dos fixtures, e
 * extrai stats dos terminados que ainda não têm. Respeita o orçamento.
 * @returns {{fetched:number, stored:number, skipped:number, spent:number}}
 */
export async function backfillTeam(ctx, teamId, { last = 30, budget } = {}) {
  const { db, client } = ctx;
  const b = budget || new RequestBudget(Infinity);
  const stat = { fetched: 0, stored: 0, skipped: 0, spent: 0, truncated: false };

  if (b.exhausted) { stat.truncated = true; return stat; }
  const res = await client.getTeamLastFixtures(teamId, last);
  b.spend(1); stat.spent += 1;
  if (res?.empty || !Array.isArray(res?.response)) { markTry(db, teamId, 0); return stat; }

  for (const item of res.response) {
    const pf = parseFixture(item);
    if (pf.id == null) continue;
    upsertFixture(db, pf);              // grava o jogo (gols, status, data…)
    stat.fetched += 1;
    if (!isFinished(pf)) continue;       // só extrai stats de jogo terminado
    if (hasMatchStats(db, pf.id)) { stat.skipped += 1; continue; } // já temos → pula sem gastar
    if (b.exhausted) { stat.truncated = true; break; }  // acabou o orçamento → para SEM marcar como completo
    const r = await extractAndStoreStats(ctx, pf.id, pf);
    if (r.spent) { b.spend(r.spent); stat.spent += r.spent; }
    if (r.stored) stat.stored += 1;
  }
  // Só marca como "tentado" se processamos o time inteiro (não foi cortado pela cota).
  if (!stat.truncated) markTry(db, teamId, stat.stored);
  return stat;
}

/** Registra na league_teams que tentamos puxar este time (e quantos jogos vieram).
 *  Faz UPSERT: se o time não estava na tabela (veio só de fixtures), insere — senão
 *  ele nunca ganharia last_try_at e ficaria preso em cinza/amarelo (sem virar vermelho). */
function markTry(db, teamId, stored) {
  try {
    const now = Date.now();
    const upd = db.prepare('UPDATE league_teams SET last_try_at = ?, last_try_stored = ? WHERE team_id = ?')
      .run(now, stored, teamId);
    if (upd.changes === 0) {
      // Não existia: descobre liga e nome a partir dos fixtures e insere.
      const info = db.prepare(`
        SELECT league_id, name FROM (
          SELECT league_id, home_team AS name FROM fixtures WHERE home_team_id = ?
          UNION SELECT league_id, away_team AS name FROM fixtures WHERE away_team_id = ?
        ) LIMIT 1
      `).get(teamId, teamId);
      if (info && info.league_id != null) {
        db.prepare(`INSERT INTO league_teams (league_id, team_id, team_name, last_try_at, last_try_stored, updated_at)
                    VALUES (?,?,?,?,?,?)
                    ON CONFLICT(league_id, team_id) DO UPDATE SET last_try_at = excluded.last_try_at,
                      last_try_stored = excluded.last_try_stored, updated_at = excluded.updated_at`)
          .run(info.league_id, teamId, info.name || `#${teamId}`, now, stored, now);
      }
    }
  } catch { /* best-effort */ }
}

/**
 * Lista os times das ligas ativas (derivados dos fixtures já no banco).
 * No setup inicial, os fixtures vêm da sincronização de jogos.
 */
export function activeTeamIds(db) {
  const rows = db.prepare(`
    SELECT DISTINCT t AS team_id FROM (
      SELECT home_team_id AS t FROM fixtures
      WHERE league_id IN (SELECT id FROM leagues WHERE active = 1)
      UNION
      SELECT away_team_id AS t FROM fixtures
      WHERE league_id IN (SELECT id FROM leagues WHERE active = 1)
      UNION
      SELECT team_id AS t FROM league_teams
      WHERE league_id IN (SELECT id FROM leagues WHERE active = 1)
    ) WHERE t IS NOT NULL
  `).all();
  return rows.map((r) => r.team_id);
}

/** Quantos jogos (com match_stats) cada time já tem. Map<teamId, contagem>. */
export function statsCountByTeam(db) {
  const rows = db.prepare('SELECT team_id, COUNT(*) AS n FROM match_stats GROUP BY team_id').all();
  const m = new Map();
  for (const r of rows) m.set(r.team_id, r.n);
  return m;
}

/** Dado uma lista de times, separa os que já têm histórico suficiente dos que faltam. */
export function splitByHistory(db, ids, minGames) {
  const counts = statsCountByTeam(db);
  const need = [], ready = [];
  for (const id of ids) {
    if ((counts.get(id) || 0) >= minGames) ready.push(id);
    else need.push(id);
  }
  return { need, ready };
}

/**
 * Cobertura do histórico por liga ativa: cada time com sua contagem de jogos e nível.
 * Os times (e seus nomes/ligas) vêm dos fixtures de ligas ativas; a contagem vem
 * de match_stats por team_id. Tudo local — nenhuma chamada de API.
 * @returns {{minGames:number, summary:{activeTeams,ready,started,empty,games},
 *   leagues:Array<{id,name,teams:Array<{teamId,name,games,level}>}>}}
 */
export function coverageByLeague(db, { minGames = 20 } = {}) {
  const counts = statsCountByTeam(db);
  // Quem já foi tentado (tem last_try_at).
  const tried = new Set(
    db.prepare('SELECT team_id FROM league_teams WHERE last_try_at IS NOT NULL').all().map((r) => r.team_id)
  );
  // classifica um time pelo nº de jogos e se já foi tentado
  const levelOf = (games, teamId) => {
    if (games >= minGames) return 'ready';                 // verde: atingiu o limiar
    // Já foi tentado mas não chegou ao limiar → é tudo que a API tem desse time.
    if (tried.has(teamId)) return games > 0 ? 'exhausted' : 'tried_empty';
    // Nunca tentado: cinza (0 jogos) ou amarelo (tem restos de confronto, dá pra puxar mais).
    return games > 0 ? 'partial' : 'empty';
  };
  // Times distintos por liga ativa, com um nome (o mais recente visto nos fixtures).
  const rows = db.prepare(`
    SELECT l.id AS league_id, l.name AS league_name, l.country AS league_country, t.team_id AS team_id, t.team_name AS team_name
      FROM (
        SELECT league_id, home_team_id AS team_id, home_team AS team_name FROM fixtures
        UNION
        SELECT league_id, away_team_id AS team_id, away_team AS team_name FROM fixtures
        UNION
        SELECT league_id, team_id, team_name FROM league_teams
      ) t
      JOIN leagues l ON l.id = t.league_id
     WHERE l.active = 1 AND t.team_id IS NOT NULL
  `).all();

  const leaguesMap = new Map();
  const seenTeam = new Set();
  let ready = 0, started = 0, empty = 0, triedEmpty = 0;
  for (const r of rows) {
    if (!leaguesMap.has(r.league_id)) leaguesMap.set(r.league_id, { id: r.league_id, name: displayLeagueName({ id: r.league_id, name: r.league_name, country: r.league_country }), teams: [] });
    // um time pode aparecer em mais de uma linha (mando) — conta uma vez por liga
    const key = r.league_id + ':' + r.team_id;
    if (seenTeam.has(key)) continue;
    seenTeam.add(key);
    const games = counts.get(r.team_id) || 0;
    const level = levelOf(games, r.team_id);
    leaguesMap.get(r.league_id).teams.push({ teamId: r.team_id, name: r.team_name || `#${r.team_id}`, games, level });
  }

  // Conta cada time UMA vez no resumo global (um time em 2 ligas não conta dobrado).
  const globalSeen = new Set();
  let exhausted = 0;
  for (const r of rows) {
    if (globalSeen.has(r.team_id)) continue;
    globalSeen.add(r.team_id);
    const games = counts.get(r.team_id) || 0;
    const lvl = levelOf(games, r.team_id);
    if (lvl === 'ready') ready++;
    else if (lvl === 'exhausted') { ready++; exhausted++; }   // completo (poucos jogos) conta como pronto
    else if (lvl === 'partial') started++;
    else if (lvl === 'tried_empty') triedEmpty++;
    else empty++;
  }

  const leagues = [...leaguesMap.values()].map((L) => {
    L.teams.sort((a, b) => b.games - a.games); // mais cheios primeiro
    const done = (t) => t.level === 'ready' || t.level === 'exhausted'; // completo (ou tudo que a API tem)
    L.ready = L.teams.filter((t) => t.level === 'ready').length;
    L.exhausted = L.teams.filter((t) => t.level === 'exhausted').length;
    L.triedEmpty = L.teams.filter((t) => t.level === 'tried_empty').length;
    // "faltam" = incompletos que ainda NÃO foram tentados (cinza + amarelo nunca-tentado)
    L.pending = L.teams.filter((t) => !done(t) && !tried.has(t.teamId)).length;
    // incompletos que JÁ foram tentados mas NÃO esgotados (vale re-varrer com "incluir tentados").
    // exhausted e tried_empty NÃO entram aqui — já sabemos que a API não tem mais.
    L.triedIncomplete = L.teams.filter((t) => !done(t) && t.level !== 'tried_empty' && tried.has(t.teamId)).length;
    L.total = L.teams.length;
    return L;
  }).sort((a, b) => (b.ready / Math.max(1, b.total)) - (a.ready / Math.max(1, a.total)));

  const games = db.prepare('SELECT COUNT(DISTINCT fixture_id) AS n FROM match_stats').get().n;
  return {
    minGames,
    summary: { activeTeams: globalSeen.size, ready, started, empty, triedEmpty, games },
    leagues,
  };
}

/**
 * Roda o backfill sobre uma lista de times (ou todos os ativos), com teto total.
 * Por padrão PULA times que já têm >= minGames jogos (não gasta nem a listagem).
 * Com force=true, varre todos (útil pra atualizar geral / virada de temporada).
 * @param {object} ctx {db, client}
 * @param {{teamIds?:number[], last?:number, cap?:number, minGames?:number, force?:boolean}} opts
 */
export async function runBackfill(ctx, { teamIds, last = 30, cap = 1500, minGames = 20, force = false } = {}) {
  const { db } = ctx;
  const all = teamIds && teamIds.length ? teamIds : activeTeamIds(db);
  const { need, ready } = splitByHistory(db, all, minGames);
  const ids = force ? all : need;          // sem force, só os que faltam
  const skippedTeams = force ? 0 : ready.length;

  const budget = new RequestBudget(cap);
  const totals = { teams: 0, skippedTeams, fetched: 0, stored: 0, skipped: 0, spent: 0, stoppedEarly: false, canceled: false };

  for (const teamId of ids) {
    if (ctx._backfillCancel) { totals.canceled = true; break; }   // pedido de parada
    if (budget.exhausted) { totals.stoppedEarly = true; break; }
    const s = await backfillTeam(ctx, teamId, { last, budget });
    totals.teams += 1;
    totals.fetched += s.fetched;
    totals.stored += s.stored;
    totals.skipped += s.skipped;
    totals.spent += s.spent;
  }

  logEvent(db, {
    level: 'info', type: 'backfill',
    message: `Backfill: ${totals.stored} jogos novos em ${totals.teams} times`
      + (skippedTeams ? `, ${skippedTeams} já prontos (pulados)` : '')
      + ` — ${totals.spent} req${totals.canceled ? ', PARADO por você' : (totals.stoppedEarly ? ', parou no teto' : '')}.`,
    data: totals,
  });
  return totals;
}
