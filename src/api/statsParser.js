// Parsing de jogos e estatísticas da API-Football — funções PURAS.
//
// Dois passos:
//   1. parseFixture(item)         → normaliza um item de /fixtures (placar, times, data, liga…)
//   2. parseTeamStatistics(resp)  → mapa teamId → estatísticas (cantos, chutes, posse…)
//      buildMatchStatsRows(...)   → cruza os dois times e produz as 2 linhas de match_stats
//
// A API NÃO entrega cantos por tempo no histórico (só "Corner Kicks" do jogo todo),
// nem ataques perigosos. O que não vier fica null — guardamos o que a API der.

/** Status que contam como "jogo terminado" (tem estatística final estável). */
export const FINISHED_STATUS = new Set(['FT', 'AET', 'PEN']);

/** Converte "55%" → 55 (número). Aceita já-número. */
export function parsePercent(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const m = String(v).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normaliza um item de /fixtures.
 * @returns {object} campos prontos pra tabela fixtures (sem cantos — vêm das stats)
 */
export function parseFixture(item) {
  const fx = item?.fixture || {};
  const lg = item?.league || {};
  const teams = item?.teams || {};
  const goals = item?.goals || {};
  const score = item?.score || {};
  const ht = score.halftime || {};

  return {
    id: num(fx.id),
    league_id: num(lg.id),
    season: num(lg.season),
    kickoff: num(fx.timestamp),
    status: lg && fx.status ? fx.status.long : null,
    status_short: fx.status ? fx.status.short : null,
    elapsed: fx.status ? num(fx.status.elapsed) : null,
    home_team_id: num(teams.home?.id),
    home_team: teams.home?.name ?? null,
    away_team_id: num(teams.away?.id),
    away_team: teams.away?.name ?? null,
    goals_home: num(goals.home),
    goals_away: num(goals.away),
    ht_goals_home: num(ht.home),
    ht_goals_away: num(ht.away),
    competition: lg.name ?? null,
  };
}

/** True se o jogo terminou. */
export function isFinished(parsedFixture) {
  return FINISHED_STATUS.has(parsedFixture?.status_short);
}

// Mapa dos "type" da API → nossos campos de stats por time.
const STAT_MAP = {
  'Corner Kicks': 'corners_for',
  'Total Shots': 'shots',
  'Shots on Goal': 'shots_on',
  'Ball Possession': 'possession',
  'Dangerous Attacks': 'dangerous_attacks',
  'Yellow Cards': 'yellow',
  'Red Cards': 'red',
  'Fouls': 'fouls',
};

/**
 * Lê a resposta de /fixtures/statistics e devolve um mapa por time.
 * @param {Array} statsResponse  response[] de /fixtures/statistics
 * @returns {Map<number, object>}
 */
export function parseTeamStatistics(statsResponse) {
  const out = new Map();
  for (const teamBlock of statsResponse || []) {
    const teamId = num(teamBlock?.team?.id);
    if (teamId == null) continue;
    const acc = {
      team_id: teamId,
      team: teamBlock.team?.name ?? null,
      corners_for: null, shots: null, shots_on: null, possession: null,
      yellow: null, red: null, fouls: null,
      dangerous_attacks: null, // não disponível no histórico
    };
    for (const s of teamBlock.statistics || []) {
      const field = STAT_MAP[s?.type];
      if (!field) continue;
      acc[field] = field === 'possession' ? parsePercent(s.value) : num(s.value);
    }
    out.set(teamId, acc);
  }
  return out;
}

/**
 * Cruza o jogo + as stats dos dois times e produz as 2 linhas de match_stats
 * (uma por time, com corners_against = corners_for do adversário).
 * @param {object} parsedFixture  resultado de parseFixture
 * @param {Map<number,object>} statsByTeam  resultado de parseTeamStatistics
 * @returns {Array<object>}  0, 1 ou 2 linhas (vazio se faltar dado essencial)
 */
export function buildMatchStatsRows(parsedFixture, statsByTeam, now = Date.now()) {
  const f = parsedFixture;
  if (f?.home_team_id == null || f?.away_team_id == null) return [];

  const homeStats = statsByTeam.get(f.home_team_id) || {};
  const awayStats = statsByTeam.get(f.away_team_id) || {};

  const mk = (teamId, team, oppId, opp, isHome, mine, theirs, gf, ga, htgf, htga) => ({
    fixture_id: f.id,
    team_id: teamId,
    team: team ?? (isHome ? f.home_team : f.away_team),
    opponent_id: oppId,
    opponent: opp ?? (isHome ? f.away_team : f.home_team),
    league_id: f.league_id,
    season: f.season,
    competition: f.competition,
    played_at: f.kickoff,
    is_home: isHome ? 1 : 0,
    corners_for: mine.corners_for ?? null,
    corners_against: theirs.corners_for ?? null,
    ht_corners_for: null,       // só ao vivo
    ht_corners_against: null,   // só ao vivo
    shots: mine.shots ?? null,
    shots_on: mine.shots_on ?? null,
    dangerous_attacks: mine.dangerous_attacks ?? null,
    possession: mine.possession ?? null,
    yellow: mine.yellow ?? null,
    red: mine.red ?? null,
    fouls: mine.fouls ?? null,
    goals_for: gf,
    goals_against: ga,
    ht_goals_for: htgf,
    ht_goals_against: htga,
    created_at: now,
  });

  return [
    mk(f.home_team_id, f.home_team, f.away_team_id, f.away_team, true,
       homeStats, awayStats, f.goals_home, f.goals_away, f.ht_goals_home, f.ht_goals_away),
    mk(f.away_team_id, f.away_team, f.home_team_id, f.home_team, false,
       awayStats, homeStats, f.goals_away, f.goals_home, f.ht_goals_away, f.ht_goals_home),
  ];
}
