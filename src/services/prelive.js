// Pré-live — ranking 0–100 dos próximos jogos por propensão a over de cantos.
//
// É TRIAGEM (onde olhar), NÃO sinal de aposta. A decisão acontece ao vivo.
// Nota alta não significa "boa aposta". Combina: expectativa de cantos (modelo,
// peso maior), linha de cantos da casa, força do favorito e mando.

import { predictFixture } from './backtest.js';
import { favoriteStrength } from '../model/pregame.js';
import { displayLeagueName } from './leagueNames.js';

/** Mapeia λ de cantos (~7..14) para uma base 0..100. */
function lambdaToScore(lambda) {
  if (!Number.isFinite(lambda)) return 0;
  const lo = 8, hi = 13;
  const t = (lambda - lo) / (hi - lo);
  return Math.max(0, Math.min(100, t * 100));
}

/**
 * Calcula o ranking pré-live dos próximos jogos das ligas ativas.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{now?:number, windowHours?:number, params?:object}} [opts]
 */
export function prelive(db, { now = Date.now(), windowHours = 24 * 30, params } = {}) {
  const nowSec = Math.floor(now / 1000);
  const until = nowSec + windowHours * 3600;
  const fixtures = db.prepare(`
    SELECT f.*, l.name AS league_name, l.country AS league_country, l.active AS league_active
      FROM fixtures f
      JOIN leagues l ON l.id = f.league_id
     WHERE l.active = 1
       AND f.kickoff IS NOT NULL AND f.kickoff BETWEEN ? AND ?
       AND (f.status_short IS NULL OR f.status_short IN ('NS','TBD'))
     ORDER BY f.kickoff ASC
  `).all(nowSec - 3 * 3600, until);

  const out = [];
  for (const fx of fixtures) {
    const pred = predictFixture(db, fx.id, params);
    const lambda = pred?.lambda ?? null;
    const favStr = favoriteStrength({ home: fx.odds_home, draw: fx.odds_draw, away: fx.odds_away });

    let score = lambdaToScore(lambda);
    const reasons = [];
    if (lambda != null) reasons.push(`expectativa ${lambda.toFixed(1)} cantos`);
    else reasons.push('sem histórico suficiente');

    // Favorito forte pressiona → leve bônus.
    if (favStr > 0.2) { score += favStr * 15; reasons.push(`favorito forte (${(favStr * 100).toFixed(0)}%)`); }

    // Linha da casa baixa em relação à expectativa → mais propenso a over.
    if (Number.isFinite(fx.corner_line) && lambda != null) {
      if (lambda > fx.corner_line) { score += 6; reasons.push(`λ acima da linha ${fx.corner_line}`); }
      reasons.push(`linha ${fx.corner_line} @ ${fx.corner_bookmaker || '?'}`);
    } else {
      reasons.push('sem odds de cantos ainda');
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    out.push({
      fixtureId: fx.id,
      home: fx.home_team, away: fx.away_team,
      league: displayLeagueName({ id: fx.league_id, name: fx.league_name, country: fx.league_country }),
      kickoff: fx.kickoff,
      score,
      lambda: lambda != null ? Number(lambda.toFixed(2)) : null,
      cornerLine: fx.corner_line ?? null,
      cornerOdd: fx.corner_over_odd ?? null,
      cornerUnderOdd: fx.corner_under_odd ?? null,
      bookmaker: fx.corner_bookmaker ?? null,
      statusShort: fx.status_short ?? null,
      monitored: fx.league_active ? true : false, // 🟢 monitorado / ⚪ não
      reasons,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
