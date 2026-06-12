// Ligas: sincronizar da API, listar, ativar/desativar (inclusive em massa).
//
// Ativar não é tocado pela sincronização — a escolha do usuário é preservada.
// As "principais" (is_main) ficam no topo e têm atalho "só principais".

import { normalize, logEvent } from '../db/index.js';

// Principais ligas (inclui Brasil, já que o usuário está no Brasil).
export const MAIN_LEAGUE_IDS = new Set([
  71, 72, 73,          // Brasileirão A, Série B, Copa do Brasil
  13, 11,              // Libertadores, Sul-Americana
  39, 140, 135, 78, 61, // PL, La Liga, Serie A, Bundesliga, Ligue 1
  2, 3,                // Champions, Europa League
  94, 88, 203,         // Primeira Liga, Eredivisie, Süper Lig
]);

/** Lê o ano de temporada "atual" de um item de /leagues. */
function currentSeason(seasons) {
  if (!Array.isArray(seasons)) return null;
  const cur = seasons.find((s) => s.current) || seasons[seasons.length - 1];
  return cur ? cur.year : null;
}

/** Sincroniza a lista de ligas da API (preserva o flag 'active' do usuário). */
export async function syncLeagues(ctx) {
  const { db, client } = ctx;
  const res = await client.getLeagues();
  if (res?.empty || !Array.isArray(res?.response)) {
    return { synced: 0, empty: !!res?.empty };
  }
  const now = Date.now();
  let synced = 0;
  for (const item of res.response) {
    const lg = item.league || {};
    if (lg.id == null) continue;
    const isMain = MAIN_LEAGUE_IDS.has(Number(lg.id)) ? 1 : 0;
    db.prepare(
      `INSERT INTO leagues (id, name, country, type, logo, is_main, season, updated_at, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, country = excluded.country, type = excluded.type,
         logo = excluded.logo, is_main = excluded.is_main, season = excluded.season,
         updated_at = excluded.updated_at`  // NÃO mexe em active
    ).run(
      Number(lg.id), normalize(lg.name), normalize(item.country?.name),
      normalize(lg.type), normalize(lg.logo), isMain,
      normalize(currentSeason(item.seasons)), now
    );
    synced += 1;
  }
  logEvent(db, { level: 'info', type: 'leagues_sync', message: `${synced} ligas sincronizadas.`, data: { synced } });
  return { synced };
}

/** Lista as ligas: principais primeiro, depois ativas, depois nome. */
export function listLeagues(db) {
  return db.prepare(
    `SELECT id, name, country, type, logo, active, is_main, season
       FROM leagues
      ORDER BY is_main DESC, active DESC, name ASC`
  ).all();
}

/**
 * Ativa/desativa ligas.
 * @param {object} db
 * @param {{ids?:number[], active?:boolean, mode?:'all'|'main'|'none'}} opts
 */
export function setLeaguesActive(db, { ids, active, mode } = {}) {
  if (mode === 'all') { db.exec('UPDATE leagues SET active = 1'); return countActive(db); }
  if (mode === 'none') { db.exec('UPDATE leagues SET active = 0'); return countActive(db); }
  if (mode === 'main') {
    db.exec('UPDATE leagues SET active = 0');
    db.exec('UPDATE leagues SET active = 1 WHERE is_main = 1');
    return countActive(db);
  }
  if (Array.isArray(ids) && ids.length) {
    const val = active ? 1 : 0;
    const stmt = db.prepare('UPDATE leagues SET active = ? WHERE id = ?');
    for (const id of ids) stmt.run(val, Number(id));
  }
  return countActive(db);
}

export function countActive(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM leagues WHERE active = 1').get().n;
}

/**
 * Sincroniza os TIMES de cada liga ativa (endpoint /teams), populando league_teams.
 * Custo: ~1 requisição por liga ativa. Isso faz a grade de cobertura mostrar TODOS
 * os clubes da liga, mesmo os que não têm jogo hoje (e portanto sem fixtures ainda).
 * @returns {{leagues:number, teams:number, spent:number, errors:number}}
 */
export async function syncLeagueTeams(ctx, { onlyLeagueId } = {}) {
  const { db, client } = ctx;
  const now = Date.now();
  const rows = onlyLeagueId
    ? db.prepare('SELECT id, season FROM leagues WHERE id = ?').all(Number(onlyLeagueId))
    : db.prepare('SELECT id, season FROM leagues WHERE active = 1').all();

  const ins = db.prepare(
    `INSERT INTO league_teams (league_id, team_id, team_name, season, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(league_id, team_id) DO UPDATE SET team_name = excluded.team_name,
       season = excluded.season, updated_at = excluded.updated_at`
  );

  let leagues = 0, teams = 0, spent = 0, errors = 0;
  for (const lg of rows) {
    try {
      // Temporadas candidatas, em ordem: a do banco, a dos jogos já sincronizados
      // dessa liga (fonte mais confiável da vigente) e o ano atual. A do banco pode
      // estar velha (ex.: Copa do Mundo gravada como 2022 → /teams volta vazio).
      const fxSeason = db.prepare('SELECT MAX(season) AS s FROM fixtures WHERE league_id = ?').get(lg.id)?.s;
      const candidates = [...new Set([lg.season, fxSeason, new Date().getFullYear()].filter((s) => s != null))];
      let stored = 0, usedSeason = null;
      for (const season of candidates) {
        const res = await client.getTeams(lg.id, season);
        spent += 1;
        const list = (!res?.empty && Array.isArray(res?.response)) ? res.response : [];
        if (list.length === 0) continue; // temporada sem times → tenta a próxima
        for (const item of list) {
          const t = item?.team;
          if (t?.id != null) { ins.run(lg.id, t.id, t.name || `#${t.id}`, season, now); stored += 1; }
        }
        usedSeason = season;
        break;
      }
      // Auto-corrige a temporada da liga se achamos times numa mais nova.
      if (usedSeason != null && usedSeason !== lg.season) {
        db.prepare('UPDATE leagues SET season = ? WHERE id = ?').run(usedSeason, lg.id);
      }
      teams += stored;
      leagues += 1;
    } catch {
      errors += 1;
    }
  }
  logEvent(db, { level: 'info', type: 'teams_sync', message: `Times sincronizados: ${teams} em ${leagues} liga(s) (${spent} req).`, data: { leagues, teams, spent, errors } });
  return { leagues, teams, spent, errors };
}
