// Sincronização de jogos (fixtures) e gravação de match_stats no banco.
//
// Tudo idempotente: rodar de novo não duplica. Atualizar um jogo (placar mudou,
// terminou) faz UPDATE; não apaga nada.

import { normalize, normalizeAll } from '../db/index.js';

const FIXTURE_FIELDS = [
  'id', 'league_id', 'season', 'kickoff', 'status', 'status_short', 'elapsed',
  'home_team_id', 'home_team', 'away_team_id', 'away_team',
  'goals_home', 'goals_away', 'ht_goals_home', 'ht_goals_away',
];

/**
 * Insere ou atualiza um jogo. Sobrescreve os campos vindos da API (status, gols…)
 * mas NÃO mexe em odds nem em corners_* (esses têm donos próprios).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} pf  resultado de parseFixture
 */
export function upsertFixture(db, pf, now = Date.now()) {
  if (pf?.id == null) throw new Error('upsertFixture: fixture sem id.');
  const cols = [...FIXTURE_FIELDS, 'updated_at'];
  const placeholders = cols.map(() => '?').join(', ');
  const updates = [...FIXTURE_FIELDS.filter((c) => c !== 'id'), 'updated_at']
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  const values = normalizeAll([...FIXTURE_FIELDS.map((f) => pf[f]), now]);

  db.prepare(
    `INSERT INTO fixtures (${cols.join(', ')}, created_at) VALUES (${placeholders}, ?)
     ON CONFLICT(id) DO UPDATE SET ${updates}`
  ).run(...values, now);
}

const STATS_COLS = [
  'fixture_id', 'team_id', 'team', 'opponent_id', 'opponent', 'league_id', 'season',
  'competition', 'played_at', 'is_home', 'corners_for', 'corners_against',
  'ht_corners_for', 'ht_corners_against', 'shots', 'shots_on', 'dangerous_attacks',
  'possession', 'yellow', 'red', 'fouls', 'goals_for', 'goals_against',
  'ht_goals_for', 'ht_goals_against', 'created_at',
];

/**
 * Grava (ou atualiza) uma linha de match_stats. Unicidade por (fixture_id, team_id).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} row  resultado de buildMatchStatsRows
 */
export function upsertMatchStats(db, row) {
  const placeholders = STATS_COLS.map(() => '?').join(', ');
  const updates = STATS_COLS
    .filter((c) => c !== 'fixture_id' && c !== 'team_id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  const values = normalizeAll(STATS_COLS.map((c) => row[c]));
  db.prepare(
    `INSERT INTO match_stats (${STATS_COLS.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(fixture_id, team_id) DO UPDATE SET ${updates}`
  ).run(...values);
}

/** True se já existem as 2 linhas de match_stats desse jogo (não precisa re-puxar). */
export function hasMatchStats(db, fixtureId) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM match_stats WHERE fixture_id = ?').get(fixtureId);
  return row.n >= 2;
}

/** Marca quais jogos das ligas ativas devem ser monitorados ao vivo. */
export function refreshMonitoredFlags(db) {
  db.exec(`
    UPDATE fixtures SET monitored = CASE
      WHEN league_id IN (SELECT id FROM leagues WHERE active = 1) THEN 1 ELSE 0 END
  `);
}
