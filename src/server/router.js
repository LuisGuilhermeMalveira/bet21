// Roteador: resolve método+caminho para uma função do controlador.
// Devolve { status, body } (objeto JS); o servidor serializa em JSON.
// Separado do http pra ser testável sem abrir socket.

import * as C from './controller.js';

// Tabela de rotas. Cada handler recebe (ctx, payload) onde payload é a query
// (GET) ou o corpo JSON (POST).
const ROUTES = {
  'GET /api/health': (ctx) => C.health(ctx),
  'GET /api/leagues': (ctx) => C.leagues(ctx),
  'POST /api/leagues/activate': (ctx, b) => C.leaguesActivate(ctx, b),
  'POST /api/sync/leagues': (ctx) => C.syncLeaguesRoute(ctx),
  'POST /api/sync/fixtures': (ctx, b) => C.syncFixtures(ctx, b),
  'GET /api/fixtures/today': (ctx) => C.todayFixtures(ctx),
  'POST /api/odds/capture': (ctx, b) => C.captureOdds(ctx, b),
  'GET /api/odds/diagnose': (ctx, q) => C.diagnose(ctx, q),
  'GET /api/odds/live-diagnose': (ctx, q) => C.liveOddsDiagnose(ctx, q),
  'GET /api/prelive': (ctx) => C.preliveRoute(ctx),
  'GET /api/signals': (ctx, q) => C.signals(ctx, q),
  'GET /api/accounting': (ctx, q) => C.accounting(ctx, q),
  'GET /api/backtest': (ctx) => C.backtestRoute(ctx),
  'GET /api/strategy/backtest': (ctx) => C.strategyBacktestRoute(ctx),
  'GET /api/config': (ctx) => C.getConfig(ctx),
  'POST /api/config': (ctx, b) => C.setConfig(ctx, b),
  'POST /api/engine': (ctx, b) => C.toggleEngine(ctx, b),
  'POST /api/settle': (ctx) => C.settleRoute(ctx),
  'POST /api/backfill': (ctx, b) => C.backfillRoute(ctx, b),
  'GET /api/backfill/status': (ctx) => C.backfillStatus(ctx),
  'GET /api/backfill/coverage': (ctx) => C.backfillCoverage(ctx),
  'POST /api/backfill/team': (ctx, b) => C.backfillTeamRoute(ctx, b),
  'POST /api/backfill/league': (ctx, b) => C.backfillLeagueRoute(ctx, b),
  'POST /api/sync/teams': (ctx) => C.syncTeamsRoute(ctx),
  'POST /api/backfill/cancel': (ctx) => C.cancelBackfillRoute(ctx),
  'POST /api/signals/delete': (ctx, b) => C.deleteSignalRoute(ctx, b),
  'POST /api/simulate': (ctx) => C.simulateRoute(ctx),
  'POST /api/backup': (ctx) => C.backupRoute(ctx),
  'GET /api/live/state': (ctx) => C.liveStateRoute(ctx),
  'GET /api/events': (ctx, q) => C.events(ctx, q),
};

/**
 * Resolve uma rota de API.
 * @returns {Promise<{status:number, body:any}>}
 */
export async function handleApi(ctx, method, path, payload) {
  const key = `${method} ${path}`;
  const handler = ROUTES[key];
  if (!handler) return { status: 404, body: { error: 'rota não encontrada', path } };
  try {
    const body = await handler(ctx, payload || {});
    if (body && body.error) return { status: 400, body };
    return { status: 200, body };
  } catch (err) {
    return { status: 500, body: { error: err.userMessage || err.message || 'erro interno' } };
  }
}

export const ROUTE_KEYS = Object.keys(ROUTES);
