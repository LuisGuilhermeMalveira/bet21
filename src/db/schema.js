// Schema declarativo do Bet21.
//
// Cada tabela é descrita como dados. A partir disso geramos:
//   - o CREATE TABLE IF NOT EXISTS (para banco novo);
//   - a migração ADITIVA (ALTER TABLE ADD COLUMN) para bancos antigos.
//
// Regras de ouro:
//   * Migração é SEMPRE aditiva: nunca apaga coluna nem dado do usuário.
//   * "window" é palavra reservada no SQLite — se algum dia uma coluna se chamar
//     assim, tem de vir entre aspas. (Hoje evitamos esse nome de propósito.)
//   * ALTER ADD COLUMN não aceita PRIMARY KEY / UNIQUE / NOT NULL sem DEFAULT —
//     por isso unicidade é feita via CREATE UNIQUE INDEX (também aditivo/seguro).

/**
 * @typedef {Object} TableDef
 * @property {string} name
 * @property {string} pk            Definição da PK, ex.: 'id INTEGER PRIMARY KEY'
 * @property {Record<string,string>} columns  nome -> definição (tipo + DEFAULT)
 * @property {{name:string, sql:string}[]} [indexes]
 */

/** @type {TableDef[]} */
export const SCHEMA = [
  {
    name: 'leagues',
    pk: 'id INTEGER PRIMARY KEY',
    columns: {
      name: 'TEXT',
      country: 'TEXT',
      type: 'TEXT',
      logo: 'TEXT',
      active: 'INTEGER NOT NULL DEFAULT 0',
      is_main: 'INTEGER NOT NULL DEFAULT 0',
      season: 'INTEGER',
      updated_at: 'INTEGER',
    },
  },
  {
    // Clubes de cada liga (popula a grade de cobertura mesmo sem fixtures baixados).
    name: 'league_teams',
    pk: 'id INTEGER PRIMARY KEY AUTOINCREMENT',
    columns: {
      league_id: 'INTEGER NOT NULL',
      team_id: 'INTEGER NOT NULL',
      team_name: 'TEXT',
      season: 'INTEGER',
      last_try_at: 'INTEGER',      // quando tentamos puxar pela última vez
      last_try_stored: 'INTEGER',  // quantos jogos novos vieram nessa tentativa
      updated_at: 'INTEGER',
    },
    indexes: [
      { name: 'idx_league_teams_uniq', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_league_teams_uniq ON league_teams(league_id, team_id)' },
    ],
  },
  {
    name: 'fixtures',
    pk: 'id INTEGER PRIMARY KEY',
    columns: {
      league_id: 'INTEGER',
      season: 'INTEGER',
      kickoff: 'INTEGER',
      status: 'TEXT',
      status_short: 'TEXT',
      elapsed: 'INTEGER',
      home_team_id: 'INTEGER',
      home_team: 'TEXT',
      away_team_id: 'INTEGER',
      away_team: 'TEXT',
      goals_home: 'INTEGER',
      goals_away: 'INTEGER',
      ht_goals_home: 'INTEGER',
      ht_goals_away: 'INTEGER',
      // cantos finais e do 1º tempo (congelados no intervalo)
      corners_home: 'INTEGER',
      corners_away: 'INTEGER',
      ht_corners_home: 'INTEGER',
      ht_corners_away: 'INTEGER',
      // odds 1x2
      odds_home: 'REAL',
      odds_draw: 'REAL',
      odds_away: 'REAL',
      // mercado de cantos do JOGO TODO (id 45)
      corner_line: 'REAL',
      corner_over_odd: 'REAL',
      corner_under_odd: 'REAL',
      corner_open_odd: 'REAL',     // preservada pro CLV
      corner_close_odd: 'REAL',
      corner_under_close_odd: 'REAL', // fechamento do under (CLV de sinais under)
      corner_bookmaker: 'TEXT',
      corner_odds_captured_at: 'INTEGER',
      // Pinnacle como âncora de calibração (preço de referência do mercado)
      corner_pinn_line: 'REAL',
      corner_pinn_over_odd: 'REAL',
      corner_pinn_under_odd: 'REAL',
      // mercado de cantos do 1º TEMPO (id 77)
      ht_corner_line: 'REAL',
      ht_corner_over_odd: 'REAL',
      ht_corner_under_odd: 'REAL',
      ht_corner_open_odd: 'REAL',
      ht_corner_close_odd: 'REAL',
      ht_corner_bookmaker: 'TEXT',
      ht_corner_odds_captured_at: 'INTEGER',
      // controle
      monitored: 'INTEGER NOT NULL DEFAULT 0',
      created_at: 'INTEGER',
      updated_at: 'INTEGER',
    },
    indexes: [
      { name: 'idx_fixtures_kickoff', sql: 'CREATE INDEX IF NOT EXISTS idx_fixtures_kickoff ON fixtures(kickoff)' },
      { name: 'idx_fixtures_league', sql: 'CREATE INDEX IF NOT EXISTS idx_fixtures_league ON fixtures(league_id, season)' },
      { name: 'idx_fixtures_status', sql: 'CREATE INDEX IF NOT EXISTS idx_fixtures_status ON fixtures(status_short)' },
    ],
  },
  {
    name: 'match_stats',
    pk: 'id INTEGER PRIMARY KEY AUTOINCREMENT',
    columns: {
      fixture_id: 'INTEGER',
      team_id: 'INTEGER',
      team: 'TEXT',
      opponent_id: 'INTEGER',
      opponent: 'TEXT',
      league_id: 'INTEGER',
      season: 'INTEGER',
      competition: 'TEXT',
      played_at: 'INTEGER',
      is_home: 'INTEGER',
      corners_for: 'INTEGER',
      corners_against: 'INTEGER',
      ht_corners_for: 'INTEGER',
      ht_corners_against: 'INTEGER',
      shots: 'INTEGER',
      shots_on: 'INTEGER',
      dangerous_attacks: 'INTEGER',
      possession: 'REAL',
      yellow: 'INTEGER',
      red: 'INTEGER',
      fouls: 'INTEGER',
      goals_for: 'INTEGER',
      goals_against: 'INTEGER',
      ht_goals_for: 'INTEGER',
      ht_goals_against: 'INTEGER',
      created_at: 'INTEGER',
    },
    indexes: [
      { name: 'uq_match_stats', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS uq_match_stats ON match_stats(fixture_id, team_id)' },
      { name: 'idx_match_stats_team', sql: 'CREATE INDEX IF NOT EXISTS idx_match_stats_team ON match_stats(team_id, played_at)' },
    ],
  },
  {
    name: 'live_samples',
    pk: 'id INTEGER PRIMARY KEY AUTOINCREMENT',
    columns: {
      fixture_id: 'INTEGER',
      minute: 'INTEGER',
      captured_at: 'INTEGER',
      corners_home: 'INTEGER',
      corners_away: 'INTEGER',
      shots_home: 'INTEGER',
      shots_away: 'INTEGER',
      shots_on_home: 'INTEGER',
      shots_on_away: 'INTEGER',
      dangerous_home: 'INTEGER',
      dangerous_away: 'INTEGER',
      possession_home: 'REAL',
      possession_away: 'REAL',
      goals_home: 'INTEGER',
      goals_away: 'INTEGER',
    },
    indexes: [
      { name: 'idx_live_fixture', sql: 'CREATE INDEX IF NOT EXISTS idx_live_fixture ON live_samples(fixture_id, minute)' },
    ],
  },
  {
    name: 'odds_snapshots',
    pk: 'id INTEGER PRIMARY KEY AUTOINCREMENT',
    columns: {
      fixture_id: 'INTEGER',
      market: 'TEXT',          // 'W2' (jogo todo) | '1T' (1º tempo)
      captured_at: 'INTEGER',
      line: 'REAL',
      over_odd: 'REAL',
      under_odd: 'REAL',
      bookmaker: 'TEXT',
    },
    indexes: [
      { name: 'idx_snap_fixture', sql: 'CREATE INDEX IF NOT EXISTS idx_snap_fixture ON odds_snapshots(fixture_id, market, captured_at)' },
    ],
  },
  {
    name: 'signals',
    pk: 'id INTEGER PRIMARY KEY AUTOINCREMENT',
    columns: {
      fixture_id: 'INTEGER',
      market: 'TEXT',          // 'W2' | '1T' | 'W1' | '2T'
      minute: 'INTEGER',
      line: 'REAL',
      open_odd: 'REAL',
      close_odd: 'REAL',
      bookmaker: 'TEXT',
      stake: 'REAL',
      model_prob: 'REAL',
      ev: 'REAL',
      status: "TEXT NOT NULL DEFAULT 'pending'", // pending | green | red | void
      profit_units: 'REAL',
      result_corners: 'REAL',  // cantos do período que saíram (gravado no settle)
      context: 'TEXT',         // JSON: placar, pressão, minuto, mando, motivos
      created_at: 'INTEGER',
      settled_at: 'INTEGER',
    },
    indexes: [
      // Anti-repetição: um mercado por jogo, no máximo.
      { name: 'uq_signal_market', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_market ON signals(fixture_id, market)' },
      { name: 'idx_signal_status', sql: 'CREATE INDEX IF NOT EXISTS idx_signal_status ON signals(status)' },
      { name: 'idx_signal_created', sql: 'CREATE INDEX IF NOT EXISTS idx_signal_created ON signals(created_at)' },
    ],
  },
  {
    name: 'model_params',
    pk: 'key TEXT PRIMARY KEY',
    columns: {
      value: 'TEXT',
      updated_at: 'INTEGER',
    },
  },
  {
    name: 'app_settings',
    pk: 'key TEXT PRIMARY KEY',
    columns: {
      value: 'TEXT',
      updated_at: 'INTEGER',
    },
  },
  {
    name: 'app_events',
    pk: 'id INTEGER PRIMARY KEY AUTOINCREMENT',
    columns: {
      ts: 'INTEGER',
      level: 'TEXT',           // info | warn | error | signal | settle
      type: 'TEXT',
      message: 'TEXT',
      data: 'TEXT',            // JSON opcional
    },
    indexes: [
      { name: 'idx_events_ts', sql: 'CREATE INDEX IF NOT EXISTS idx_events_ts ON app_events(ts)' },
    ],
  },
];

/** Gera o SQL de CREATE TABLE IF NOT EXISTS para uma tabela. */
export function createTableSql(table) {
  const cols = [table.pk, ...Object.entries(table.columns).map(([n, def]) => `${n} ${def}`)];
  return `CREATE TABLE IF NOT EXISTS ${table.name} (\n  ${cols.join(',\n  ')}\n)`;
}
