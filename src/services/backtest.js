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
            ms.played_at, ms.league_id, (ms.corners_for + ms.corners_against) AS total_corners
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

// --- Backtest da ESTRATÉGIA: "se o app existisse no passado, teria funcionado?" --

import { pOverLine, evOver } from '../model/distributions.js';
import { displayLeagueName } from './leagueNames.js';

/**
 * Roda a estratégia do app sobre TODO o histórico guardado, sem vazamento de
 * futuro: pra cada jogo, o λ usa só partidas ANTERIORES àquela data, e a linha
 * "de mercado" sintética é a média da liga ATÉ aquela data (arredondada pra .5).
 *
 * O que devolve:
 *  - calibração: erro do modelo vs "chutar a média" + viés (real − λ) global e POR LIGA
 *  - simulação: aplica a MESMA regra do app (EV ≥ evMin e prob ≥ probMin) com odds
 *    sintéticas de 1.90 dos dois lados → ROI/hit/lucro simulados
 *
 * HONESTIDADE: as odds reais do passado não existem no banco; 1.90 é uma odd
 * típica. Isso mede se o MODELO acha desvios — não prova lucro real. O juiz
 * final continua sendo o CLV do paper-trade.
 */
export function strategyBacktest(db, { minPriorGames = 10, params, oddSynthetic = 1.90 } = {}) {
  const mp = params || modelParams(db);
  const evMin = Number(mp.ev_min ?? 0.05);
  const probMin = Number(mp.prob_min ?? 0.55);
  const matches = evaluableMatches(db);

  const totals = matches.map((m) => m.total_corners).filter((x) => Number.isFinite(x));
  const meanActual = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;

  // Acumuladores globais e por liga
  let sumAbsModel = 0, sumAbsBase = 0, sumBias = 0, evaluated = 0, skipped = 0;
  const byLeague = new Map(); // id -> { n, sumAbs, sumBias }
  // Linha sintética por liga: média ACUMULADA da liga até a data (anti-vazamento)
  const leagueRun = new Map(); // id -> { sum, n }
  // Simulação de apostas
  const sim = { nBets: 0, nOver: 0, nUnder: 0, green: 0, red: 0, profit: 0 };
  const equity = []; // curva de lucro acumulado (pra um gráfico futuro)

  for (const m of matches) {
    // linha da liga ANTES deste jogo (depois acumula o jogo)
    const run = leagueRun.get(m.league_id) || { sum: 0, n: 0 };
    const leagueMeanBefore = run.n >= 20 ? run.sum / run.n : null; // só com 20+ jogos de base
    run.sum += m.total_corners; run.n += 1; leagueRun.set(m.league_id, run);

    const homeGames = teamGamesBefore(db, m.home_team_id, m.played_at);
    const awayGames = teamGamesBefore(db, m.away_team_id, m.played_at);
    const hr = teamRates(homeGames, { halflife: mp.recency_halflife_games });
    const ar = teamRates(awayGames, { halflife: mp.recency_halflife_games });
    if (!hr || !ar || hr.nTotal < minPriorGames || ar.nTotal < minPriorGames) { skipped += 1; continue; }
    const lm = lambdaForMatch(hr, ar, mp, {});
    if (!lm || !Number.isFinite(lm.lambda)) { skipped += 1; continue; }

    // calibração
    sumAbsModel += Math.abs(lm.lambda - m.total_corners);
    sumAbsBase += Math.abs(meanActual - m.total_corners);
    sumBias += (m.total_corners - lm.lambda);
    evaluated += 1;
    const L = byLeague.get(m.league_id) || { n: 0, sumAbs: 0, sumBias: 0 };
    L.n += 1; L.sumAbs += Math.abs(lm.lambda - m.total_corners); L.sumBias += (m.total_corners - lm.lambda);
    byLeague.set(m.league_id, L);

    // simulação (só com linha sintética disponível)
    if (leagueMeanBefore != null) {
      const line = Math.round(leagueMeanBefore - 0.5) + 0.5; // .5 mais próxima (sem push)
      const pOver = pOverLine(lm.lambda, line, mp);
      if (pOver != null) {
        const pUnder = 1 - pOver;
        let side = null, prob = null;
        if (evOver(pOver, oddSynthetic) >= evMin && pOver >= probMin) { side = 'over'; prob = pOver; }
        else if (evOver(pUnder, oddSynthetic) >= evMin && pUnder >= probMin) { side = 'under'; prob = pUnder; }
        if (side) {
          sim.nBets += 1; if (side === 'over') sim.nOver += 1; else sim.nUnder += 1;
          const won = side === 'over' ? m.total_corners > line : m.total_corners < line;
          if (won) { sim.green += 1; sim.profit += (oddSynthetic - 1); }
          else { sim.red += 1; sim.profit -= 1; }
          equity.push(Number(sim.profit.toFixed(2)));
        }
      }
    }
  }

  const maeModel = evaluated ? sumAbsModel / evaluated : null;
  const maeBaseline = evaluated ? sumAbsBase / evaluated : null;
  const improvementPct = maeModel != null && maeBaseline ? ((maeBaseline - maeModel) / maeBaseline) * 100 : null;
  const bias = evaluated ? sumBias / evaluated : null;

  const leagues = [...byLeague.entries()].map(([id, L]) => {
    const row = db.prepare('SELECT id, name, country FROM leagues WHERE id = ?').get(id);
    return {
      leagueId: id,
      name: row ? displayLeagueName(row) : `Liga #${id}`,
      n: L.n,
      mae: Number((L.sumAbs / L.n).toFixed(2)),
      bias: Number((L.sumBias / L.n).toFixed(2)), // >0: modelo SUBestima (sai mais canto que o previsto)
    };
  }).filter((l) => l.n >= 20).sort((a, b) => Math.abs(b.bias) - Math.abs(a.bias));

  const roi = sim.nBets ? sim.profit / sim.nBets : null;
  const hitRate = (sim.green + sim.red) ? sim.green / (sim.green + sim.red) : null;

  let verdict;
  if (evaluated === 0) verdict = 'Sem jogos avaliáveis — faça o backfill do histórico primeiro.';
  else if (evaluated < 100) verdict = `Amostra pequena (${evaluated} jogos) — não tire conclusões ainda.`;
  else if (improvementPct > 2) verdict = `O modelo erra ${improvementPct.toFixed(1)}% menos que chutar a média — há sinal de calibração. Edge pré-jogo costuma ser pequeno; confirme com o CLV do paper-trade.`;
  else if (improvementPct > 0) verdict = `O modelo é só marginalmente melhor que a média (${improvementPct.toFixed(1)}%). Sem evidência forte de edge pré-jogo.`;
  else verdict = 'O modelo NÃO bate "chutar a média" no passado. Não confie nos sinais pré-live até recalibrar.';

  const result = {
    evaluated, skipped, maeModel, maeBaseline, improvementPct, bias, meanActual,
    leagues,
    simulation: { ...sim, roi, hitRate, oddSynthetic, evMin, probMin, equity: equity.filter((_, i) => i % Math.max(1, Math.floor(equity.length / 80)) === 0) },
    verdict,
  };
  logEvent(db, { level: 'info', type: 'strategy_backtest', message: verdict, data: { evaluated, improvementPct, bias, simBets: sim.nBets, simRoi: roi } });
  return result;
}
