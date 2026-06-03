// Backtest do modelo pré-jogo, SEM look-ahead.
//
// Para cada jogo histórico, reconstrói as taxas de cada time usando SÓ os jogos
// ANTERIORES (played_at < o do jogo). Compara o λ previsto com o total real de
// cantos e mede o erro (MAE). Compara com o baseline "chutar a média".
//
// O que mede: PODER PREDITIVO (erra menos que a média?), NÃO lucro — não há odds
// históricas de cantos. Isto valida o PRÉ-JOGO. O ao vivo só se valida com CLV real.

import { modelParams } from '../config/settings.js';
import { teamRates, lambdaForMatch } from '../model/pregame.js';
import { logEvent } from '../db/index.js';

/**
 * Histórico de um time ANTES de um instante (sem look-ahead).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} teamId
 * @param {number} beforeTs
 * @param {number} [limit]
 */
export function teamGamesBefore(db, teamId, beforeTs, limit = 60) {
  return db.prepare(
    `SELECT is_home, corners_for, corners_against, played_at
       FROM match_stats
      WHERE team_id = ? AND played_at < ?
        AND corners_for IS NOT NULL AND corners_against IS NOT NULL
      ORDER BY played_at DESC
      LIMIT ?`
  ).all(teamId, beforeTs, limit);
}

/**
 * Lista os jogos avaliáveis no backtest: têm os dois times, total de cantos real
 * conhecido, e data. (Pegamos a linha do MANDANTE em match_stats: ela tem
 * corners_for = cantos do mandante e corners_against = cantos do visitante.)
 */
export function evaluableMatches(db) {
  return db.prepare(
    `SELECT ms.fixture_id, ms.team_id AS home_team_id, ms.opponent_id AS away_team_id,
            ms.played_at, (ms.corners_for + ms.corners_against) AS total_corners
       FROM match_stats ms
      WHERE ms.is_home = 1
        AND ms.corners_for IS NOT NULL AND ms.corners_against IS NOT NULL
        AND ms.played_at IS NOT NULL
      ORDER BY ms.played_at ASC`
  ).all();
}

/**
 * Roda o backtest.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{minPriorGames?:number, params?:object}} [opts]
 * @returns {{evaluated:number, skipped:number, maeModel:number|null, maeBaseline:number|null,
 *            improvementPct:number|null, meanActual:number|null, smallSample:boolean, verdict:string}}
 */
export function backtest(db, { minPriorGames = 10, params } = {}) {
  const mp = params || modelParams(db);
  const matches = evaluableMatches(db);

  // Baseline "chutar a média": média global dos totais avaliáveis.
  // (Usar a média global deixa o baseline um pouco otimista — ou seja, a barra
  //  fica MAIS difícil pro modelo. Escolha conservadora/honesta de propósito.)
  const totals = matches.map((m) => m.total_corners).filter((x) => Number.isFinite(x));
  const meanActual = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;

  let sumAbsModel = 0, sumAbsBase = 0, evaluated = 0, skipped = 0;

  for (const m of matches) {
    const homeGames = teamGamesBefore(db, m.home_team_id, m.played_at);
    const awayGames = teamGamesBefore(db, m.away_team_id, m.played_at);
    const hr = teamRates(homeGames, { halflife: mp.recency_halflife_games });
    const ar = teamRates(awayGames, { halflife: mp.recency_halflife_games });

    if (!hr || !ar || hr.nTotal < minPriorGames || ar.nTotal < minPriorGames) {
      skipped += 1;
      continue;
    }
    const lm = lambdaForMatch(hr, ar, mp, {});
    if (!lm || !Number.isFinite(lm.lambda)) { skipped += 1; continue; }

    sumAbsModel += Math.abs(lm.lambda - m.total_corners);
    sumAbsBase += Math.abs(meanActual - m.total_corners);
    evaluated += 1;
  }

  const maeModel = evaluated ? sumAbsModel / evaluated : null;
  const maeBaseline = evaluated ? sumAbsBase / evaluated : null;
  const improvementPct =
    maeModel != null && maeBaseline ? ((maeBaseline - maeModel) / maeBaseline) * 100 : null;
  const smallSample = evaluated < 30;

  let verdict;
  if (evaluated === 0) {
    verdict = 'Sem jogos avaliáveis (faça o backfill do histórico primeiro).';
  } else if (smallSample) {
    verdict = `Amostra pequena (${evaluated} jogos) — não tire conclusões.`;
  } else if (maeModel < maeBaseline) {
    verdict = `O modelo erra ${improvementPct.toFixed(1)}% menos que chutar a média. Edge pré-jogo costuma ser pequeno — confirme com mais dados.`;
  } else {
    verdict = 'O modelo NÃO bate "chutar a média". Sem edge pré-jogo detectável — o valor, se houver, está no ao vivo.';
  }

  const result = {
    evaluated, skipped,
    maeModel, maeBaseline, improvementPct,
    meanActual, smallSample, verdict,
  };
  logEvent(db, { level: 'info', type: 'backtest', message: verdict, data: result });
  return result;
}

/**
 * Previsão pré-jogo de UM jogo do banco (usa todo o histórico até o kickoff).
 * Reaproveitada pelo pré-live. Sem look-ahead: só jogos antes do kickoff.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} fixtureId
 * @param {object} [params]
 */
export function predictFixture(db, fixtureId, params) {
  const mp = params || modelParams(db);
  const fx = db.prepare('SELECT * FROM fixtures WHERE id = ?').get(fixtureId);
  if (!fx) return null;
  const before = fx.kickoff ?? Date.now() / 1000;
  const homeGames = teamGamesBefore(db, fx.home_team_id, before);
  const awayGames = teamGamesBefore(db, fx.away_team_id, before);
  const hr = teamRates(homeGames, { halflife: mp.recency_halflife_games });
  const ar = teamRates(awayGames, { halflife: mp.recency_halflife_games });
  if (!hr || !ar) return { fixtureId, lambda: null, reason: 'histórico insuficiente' };

  const lm = lambdaForMatch(hr, ar, mp, {
    odds1x2: { home: fx.odds_home, draw: fx.odds_draw, away: fx.odds_away },
  });
  return {
    fixtureId,
    lambda: lm ? lm.lambda : null,
    expHome: lm?.expHome ?? null,
    expAway: lm?.expAway ?? null,
    favStrength: lm?.favStrength ?? 0,
    nHome: hr.nTotal, nAway: ar.nTotal,
  };
}
