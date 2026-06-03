// Settle — liquidação automática dos sinais.
//
// Para cada sinal pendente de um jogo TERMINADO:
//   • pega os cantos do PERÍODO certo (total pra W2/W1; 1º tempo pro 1T; 2º tempo pro 2T);
//   • marca green/red (void se empatar a linha inteira — raro, linhas são .5);
//   • calcula o lucro em unidades;
//   • grava a odd de fechamento (proxy: fechamento pré-jogo do mercado) e quantos cantos saíram;
//   • encerra o status do jogo e grava o pacote completo em match_stats.
//
// Só gasta requisição se houver sinais pendentes (1 por jogo terminado).

import { normalize, logEvent } from '../db/index.js';
import { parseTeamStatistics, buildMatchStatsRows, isFinished, FINISHED_STATUS } from '../api/statsParser.js';
import { upsertMatchStats } from './fixturesSync.js';

/** Cantos do período do mercado. Retorna null se o dado necessário falta. */
export function periodCorners(market, { total, htTotal }) {
  switch (market) {
    case 'W2':
    case 'W1':
    case 'PL_OVER':
    case 'PL_UNDER':
      return Number.isFinite(total) ? total : null;          // jogo todo
    case '1T':
      return Number.isFinite(htTotal) ? htTotal : null;       // 1º tempo
    case '2T':
      return Number.isFinite(total) && Number.isFinite(htTotal) ? total - htTotal : null; // 2º tempo
    default:
      return null;
  }
}

/**
 * Resultado de um sinal, dada a contagem real de cantos do período.
 * @param {'over'|'under'} side
 * @returns {{status:'green'|'red'|'void', profit:number}}
 */
export function gradeBet(side, line, actualCorners, stake, odd) {
  if (!Number.isFinite(actualCorners) || !Number.isFinite(line)) return null;
  if (actualCorners === line) return { status: 'void', profit: 0 };   // push (linha inteira)
  const won = side === 'under' ? (actualCorners < line) : (actualCorners > line);
  if (won) {
    const o = Number.isFinite(odd) ? odd : null;
    return { status: 'green', profit: o != null ? stake * (o - 1) : 0 };
  }
  return { status: 'red', profit: -stake };
}

/** Compat: grade de um over. */
export function gradeOver(line, actualCorners, stake, odd) {
  return gradeBet('over', line, actualCorners, stake, odd);
}

/** Lado da aposta a partir do market do sinal. */
export function sideOfMarket(market) {
  if (market === 'PL_UNDER') return 'under';
  return 'over'; // W2, 1T, W1, 2T, PL_OVER → over
}

/** Constrói um parsedFixture mínimo a partir da linha de fixtures (pra match_stats). */
function fixtureRowToParsed(row, statsByTeam) {
  return {
    id: row.id, league_id: row.league_id, season: row.season, kickoff: row.kickoff,
    status: row.status, status_short: row.status_short,
    home_team_id: row.home_team_id, home_team: row.home_team,
    away_team_id: row.away_team_id, away_team: row.away_team,
    goals_home: row.goals_home, goals_away: row.goals_away,
    ht_goals_home: row.ht_goals_home, ht_goals_away: row.ht_goals_away,
    competition: row.competition,
  };
}

/**
 * Liquida todos os sinais pendentes de UM jogo terminado.
 * @param {{db, client}} ctx
 * @param {number} fixtureId
 * @returns {Promise<{settled:number, spent:number, skipped?:string}>}
 */
export async function settleFixture(ctx, fixtureId) {
  const { db, client } = ctx;
  const fx = db.prepare('SELECT * FROM fixtures WHERE id = ?').get(fixtureId);
  if (!fx) return { settled: 0, spent: 0, skipped: 'jogo inexistente' };

  const pending = db.prepare("SELECT * FROM signals WHERE fixture_id = ? AND status = 'pending'").all(fixtureId);
  if (pending.length === 0) return { settled: 0, spent: 0, skipped: 'sem pendentes' };

  // Busca as estatísticas finais (1 requisição) pra obter o total de cantos.
  let total = null, spent = 0;
  const res = await client.getFixtureStatistics(fixtureId);
  spent = 1;
  if (!res?.empty && Array.isArray(res?.response) && res.response.length) {
    const statsByTeam = parseTeamStatistics(res.response);
    const home = statsByTeam.get(fx.home_team_id);
    const away = statsByTeam.get(fx.away_team_id);
    const ch = home?.corners_for ?? null;
    const ca = away?.corners_for ?? null;
    if (Number.isFinite(ch) && Number.isFinite(ca)) {
      total = ch + ca;
      db.prepare('UPDATE fixtures SET corners_home = ?, corners_away = ? WHERE id = ?')
        .run(normalize(ch), normalize(ca), fixtureId);
    }
    // grava o pacote completo em match_stats
    const rows = buildMatchStatsRows(fixtureRowToParsed(fx), statsByTeam);
    for (const r of rows) upsertMatchStats(db, r);
  }

  // 1º tempo: usa os cantos congelados no intervalo (só existem se monitoramos ao vivo).
  const htTotal = Number.isFinite(fx.ht_corners_home) && Number.isFinite(fx.ht_corners_away)
    ? fx.ht_corners_home + fx.ht_corners_away
    : null;

  const now = Date.now();
  let settled = 0;
  for (const sig of pending) {
    const actual = periodCorners(sig.market, { total, htTotal });
    if (actual == null) {
      // Não dá pra liquidar com confiança (falta o dado do período) → deixa pendente.
      logEvent(db, { level: 'warn', type: 'settle', message: `Sinal ${sig.id} (${sig.market}) sem cantos do período — segue pendente.`, data: { fixtureId } });
      continue;
    }
    const side = sideOfMarket(sig.market);
    const graded = gradeBet(side, sig.line, actual, sig.stake ?? 0, sig.open_odd);
    if (!graded) continue;

    // Fechamento (proxy): odd de fechamento pré-jogo do mercado/lado correspondente.
    let closeProxy;
    if (sig.market === '1T') closeProxy = fx.ht_corner_close_odd;
    else if (side === 'under') closeProxy = fx.corner_under_close_odd;
    else closeProxy = fx.corner_close_odd;
    const closeOdd = sig.close_odd != null ? sig.close_odd : (closeProxy ?? null);

    db.prepare(
      `UPDATE signals SET status = ?, profit_units = ?, result_corners = ?, close_odd = ?, settled_at = ? WHERE id = ?`
    ).run(graded.status, normalize(graded.profit), normalize(actual), normalize(closeOdd), now, sig.id);
    settled += 1;
    logEvent(db, {
      level: 'settle', type: 'settle',
      message: `Sinal ${sig.id} (${sig.market}) ${graded.status}: ${actual} cantos vs linha ${sig.line}.`,
      data: { fixtureId, market: sig.market, status: graded.status, profit: graded.profit, actual },
    });
  }

  // Encerra o status do jogo.
  if (!isFinished(fx)) {
    db.prepare("UPDATE fixtures SET status_short = COALESCE(status_short, 'FT'), monitored = 0 WHERE id = ?").run(fixtureId);
  } else {
    db.prepare('UPDATE fixtures SET monitored = 0 WHERE id = ?').run(fixtureId);
  }

  return { settled, spent };
}

/**
 * Roda o settle em todos os jogos com sinais pendentes que já terminaram (ou
 * cujo kickoff foi há tempo suficiente). Só gasta requisição quando há pendentes.
 * @param {{db, client}} ctx
 * @param {{now?:number, minMinutesAfterKickoff?:number}} [opts]
 */
export async function runSettle(ctx, { now = Date.now(), minMinutesAfterKickoff = 120 } = {}) {
  const { db } = ctx;
  const rows = db.prepare(`
    SELECT DISTINCT f.id, f.status_short, f.kickoff
      FROM fixtures f
      JOIN signals s ON s.fixture_id = f.id
     WHERE s.status = 'pending'
  `).all();

  const cutoff = now / 1000 - minMinutesAfterKickoff * 60;
  const totals = { fixtures: 0, settled: 0, spent: 0 };
  for (const r of rows) {
    const finished = FINISHED_STATUS.has(r.status_short);
    const oldEnough = Number.isFinite(r.kickoff) && r.kickoff <= cutoff;
    if (!finished && !oldEnough) continue; // ainda rolando / cedo demais
    const res = await settleFixture(ctx, r.id);
    totals.fixtures += 1;
    totals.settled += res.settled;
    totals.spent += res.spent;
  }
  if (totals.settled || totals.fixtures) {
    logEvent(db, { level: 'info', type: 'settle', message: `Settle: ${totals.settled} sinais liquidados em ${totals.fixtures} jogos (${totals.spent} req).`, data: totals });
  }
  return totals;
}

/** Grava a odd de fechamento observada na linha do sinal (chamado pelo loop ao vivo). */
export function recordClosingForSignal(db, signalId, closeOdd) {
  db.prepare('UPDATE signals SET close_odd = ? WHERE id = ?').run(normalize(closeOdd), signalId);
}
