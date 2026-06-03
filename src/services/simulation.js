// Modo simulação: cria um estado ao vivo sintético que DISPARA um sinal,
// pra você testar o ciclo (engine → sinal → log/Telegram) sem gastar API.

import { evaluateLiveFixture, processDecisions } from './liveEngine.js';
import * as cfg from '../config/settings.js';
import { logEvent } from '../db/index.js';

const SIM_FIXTURE_ID = 999000001;

/** Garante um jogo sintético no banco (pra o sinal ter onde se ancorar). */
export function ensureSimFixture(db, { now = Date.now() } = {}) {
  const exists = db.prepare('SELECT id FROM fixtures WHERE id = ?').get(SIM_FIXTURE_ID);
  if (!exists) {
    db.prepare(`
      INSERT INTO fixtures (id, league_id, home_team_id, away_team_id, home_team, away_team,
                            kickoff, status_short, status, elapsed, goals_home, goals_away,
                            odds_home, odds_draw, odds_away, monitored, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      SIM_FIXTURE_ID, 0, 99001, 99002, 'Sim FC', 'Teste United',
      Math.floor(now / 1000) - 85 * 60, '2H', 'Second Half', 85, 0, 1,
      1.7, 3.6, 5.2, 1, now, now,
    );
  }
  return SIM_FIXTURE_ID;
}

/**
 * Monta um estado ao vivo que passa por todas as travas da janela W2:
 * minuto 85, favorito (casa) PERDENDO, pressão SUBINDO, λ alto, linha batível com EV.
 */
export function buildFiringState({ minute = 85 } = {}) {
  // Amostras cumulativas; o ritmo recente (75→85) supera o anterior (65→75) = pressão subindo.
  const samples = [
    { minute: 55, corners_home: 3, corners_away: 2, shots_on_home: 2, shots_on_away: 2, dangerous_home: 22, dangerous_away: 20, shots_home: 6, shots_away: 5, goals_home: 0, goals_away: 1 },
    { minute: 65, corners_home: 4, corners_away: 3, shots_on_home: 3, shots_on_away: 2, dangerous_home: 30, dangerous_away: 24, shots_home: 8, shots_away: 6, goals_home: 0, goals_away: 1 },
    { minute: 75, corners_home: 5, corners_away: 3, shots_on_home: 4, shots_on_away: 2, dangerous_home: 40, dangerous_away: 28, shots_home: 10, shots_away: 7, goals_home: 0, goals_away: 1 },
    { minute: 85, corners_home: 7, corners_away: 4, shots_on_home: 7, shots_on_away: 2, dangerous_home: 58, dangerous_away: 31, shots_home: 14, shots_away: 8, goals_home: 0, goals_away: 1 },
  ];
  return {
    minute,
    cornersTotal: 11,        // já saíram 11; a linha de over fica logo acima
    htCornersTotal: 5,
    goalsHome: 0,
    goalsAway: 1,            // favorito (casa) perdendo → janela W2 permite
    favorite: 'home',
    lambdaPregame: 12.0,     // jogo de muitos cantos
    samples,
    fullLines: [
      { line: 11.5, overOdd: 1.85, bookmaker: 'SimBook' },
      { line: 12.5, overOdd: 2.40, bookmaker: 'SimBook' },
    ],
    htLines: [],
  };
}

/**
 * Roda a simulação: monta o estado, avalia e (se passar) grava o sinal.
 * @param {object} ctx { db }
 * @returns {{fixtureId, evalResult, processed, fired:boolean}}
 */
export function simulate(ctx, { now = Date.now(), record = true } = {}) {
  const db = ctx.db;
  const fixtureId = ensureSimFixture(db, { now });
  const config = { settings: cfg.settings(db), model: cfg.modelParams(db) };
  const state = buildFiringState({});
  const evalResult = evaluateLiveFixture(state, config);

  let processed = [];
  if (record) {
    processed = processDecisions(db, fixtureId, evalResult, config, { now });
  }
  const fired = processed.some((d) => d.fired);

  logEvent(db, {
    level: fired ? 'signal' : 'info', type: 'simulation',
    message: fired ? '🧪 Simulação disparou um sinal de teste.' : '🧪 Simulação rodou (nenhum disparo).',
    data: { fixtureId, decisions: evalResult.decisions.map((d) => ({ market: d.market, fire: d.fire, reason: d.reason })) },
  });

  return { fixtureId, evalResult, processed, fired };
}
