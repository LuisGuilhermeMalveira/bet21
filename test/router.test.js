import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/db/migrate.js';
import { handleApi } from '../src/server/router.js';

function ctx0({ withClient = false } = {}) {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.prepare("INSERT INTO leagues (id,name,active,is_main) VALUES (39,'Premier League',0,1)").run();
  db.prepare("INSERT INTO leagues (id,name,active,is_main) VALUES (61,'Ligue 1',0,0)").run();
  const ctx = {
    db,
    gatekeeper: { stats: () => ({ remainingDay: 7000, limitDay: 7500, remainingMinute: 250, limitMinute: 300 }) },
    secrets: { apiKey: withClient ? 'KEY' : '' },
    engine: { running: false },
  };
  if (withClient) {
    ctx.client = {
      async getFixtures() { return { ok: true, response: [{ fixture: { id: 1, timestamp: 999, status: { short: 'NS', long: 'NS' } }, league: { id: 39, season: 2025, name: 'PL' }, teams: { home: { id: 10, name: 'A' }, away: { id: 11, name: 'B' } }, goals: {}, score: {} }] }; },
      async getOdds() { return { ok: true, response: [], empty: true }; },
      async getLeagues() { return { ok: true, response: [{ league: { id: 39, name: 'PL', type: 'League' }, country: { name: 'England' }, seasons: [{ year: 2025, current: true }] }] }; },
    };
  }
  return ctx;
}

test('rota desconhecida → 404', async () => {
  const r = await handleApi(ctx0(), 'GET', '/api/naoexiste', {});
  assert.equal(r.status, 404);
});

test('GET /api/health devolve as luzes', async () => {
  const r = await handleApi(ctx0(), 'GET', '/api/health', {});
  assert.equal(r.status, 200);
  assert.equal(r.body.apiKey.ok, false);
  assert.equal(r.body.requestsDay.remaining, 7000);
  assert.equal(r.body.activeLeagues, 0);
});

test('GET /api/leagues lista as ligas (principais primeiro)', async () => {
  const r = await handleApi(ctx0(), 'GET', '/api/leagues', {});
  assert.equal(r.status, 200);
  assert.equal(r.body.leagues[0].id, 39);  // PL é principal
});

test('POST /api/leagues/activate (modo principais) ativa só as is_main', async () => {
  const ctx = ctx0();
  const r = await handleApi(ctx, 'POST', '/api/leagues/activate', { mode: 'main' });
  assert.equal(r.status, 200);
  assert.equal(r.body.active, 1);
  const pl = ctx.db.prepare('SELECT active FROM leagues WHERE id=39').get();
  assert.equal(pl.active, 1);
});

test('GET /api/config devolve settings e model agrupados', async () => {
  const r = await handleApi(ctx0(), 'GET', '/api/config', {});
  assert.equal(r.status, 200);
  assert.ok(r.body.settings.stake_per_signal);
  assert.ok(r.body.model.ev_min);
});

test('POST /api/config grava e POST reset volta ao padrão', async () => {
  const ctx = ctx0();
  let r = await handleApi(ctx, 'POST', '/api/config', { which: 'model', key: 'ev_min', value: '0,2' });
  assert.equal(r.body.value, 0.2);
  r = await handleApi(ctx, 'POST', '/api/config', { which: 'model', key: 'ev_min', reset: true });
  assert.equal(r.body.value, 0.03);
});

test('POST /api/engine liga e desliga', async () => {
  const ctx = ctx0();
  let r = await handleApi(ctx, 'POST', '/api/engine', { on: true });
  assert.equal(r.body.running, true);
  assert.equal(ctx.engine.running, true);
  r = await handleApi(ctx, 'POST', '/api/engine', { on: false });
  assert.equal(r.body.running, false);
});

test('rotas que precisam de cliente falham com mensagem clara quando não há chave', async () => {
  const r = await handleApi(ctx0({ withClient: false }), 'POST', '/api/sync/fixtures', {});
  assert.equal(r.status, 500);
  assert.match(r.body.error, /chave|APIFOOTBALL/i);
});

test('POST /api/sync/fixtures funciona com cliente e faz upsert', async () => {
  const ctx = ctx0({ withClient: true });
  const r = await handleApi(ctx, 'POST', '/api/sync/fixtures', { date: '2026-05-31' });
  assert.equal(r.status, 200);
  assert.equal(r.body.synced, 1);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM fixtures').get().n, 1);
});

test('GET /api/accounting aceita filtros via query', async () => {
  const r = await handleApi(ctx0(), 'GET', '/api/accounting', { market: 'W2', evMin: '0.05' });
  assert.equal(r.status, 200);
  assert.ok(r.body.summary);
  assert.equal(r.body.summary.nTotal, 0);
});

test('GET /api/prelive e /api/signals e /api/backtest respondem', async () => {
  const ctx = ctx0();
  assert.equal((await handleApi(ctx, 'GET', '/api/prelive', {})).status, 200);
  assert.equal((await handleApi(ctx, 'GET', '/api/signals', {})).status, 200);
  assert.equal((await handleApi(ctx, 'GET', '/api/backtest', {})).status, 200);
});

test('POST /api/odds/capture por jogo resolve (200 vazio limpa) com cliente', async () => {
  const ctx = ctx0({ withClient: true });
  await handleApi(ctx, 'POST', '/api/sync/fixtures', { date: '2026-05-31' });
  const r = await handleApi(ctx, 'POST', '/api/odds/capture', { scope: 'fixture', fixtureId: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.full, 'cleared');  // odds vazias → limpa
});

test('Jogos de hoje mostra SÓ jogos de ligas ativas', async () => {
  const ctx = ctx0();
  const soon = Math.floor(Date.now() / 1000) + 3600;
  // jogo na liga 39 (ativaremos) e na liga 61 (deixaremos inativa)
  ctx.db.prepare('INSERT INTO fixtures (id, league_id, home_team, away_team, kickoff, status_short) VALUES (?,?,?,?,?,?)').run(1, 39, 'A', 'B', soon, 'NS');
  ctx.db.prepare('INSERT INTO fixtures (id, league_id, home_team, away_team, kickoff, status_short) VALUES (?,?,?,?,?,?)').run(2, 61, 'C', 'D', soon, 'NS');

  // nenhuma liga ativa → lista vazia
  let r = await handleApi(ctx, 'GET', '/api/fixtures/today', {});
  assert.equal(r.body.fixtures.length, 0);

  // ativa só a liga 39 → só o jogo dela aparece
  await handleApi(ctx, 'POST', '/api/leagues/activate', { ids: [39], active: true });
  r = await handleApi(ctx, 'GET', '/api/fixtures/today', {});
  assert.equal(r.body.fixtures.length, 1);
  assert.equal(r.body.fixtures[0].id, 1);

  // ativa também a 61 → os dois aparecem
  await handleApi(ctx, 'POST', '/api/leagues/activate', { ids: [61], active: true });
  r = await handleApi(ctx, 'GET', '/api/fixtures/today', {});
  assert.equal(r.body.fixtures.length, 2);
});

test('Pré-live ranqueia SÓ jogos de ligas ativas', async () => {
  const ctx = ctx0();
  const soon = Math.floor(Date.now() / 1000) + 3600;
  ctx.db.prepare('INSERT INTO fixtures (id, league_id, home_team, away_team, kickoff, status_short) VALUES (?,?,?,?,?,?)').run(1, 39, 'A', 'B', soon, 'NS');
  ctx.db.prepare('INSERT INTO fixtures (id, league_id, home_team, away_team, kickoff, status_short) VALUES (?,?,?,?,?,?)').run(2, 61, 'C', 'D', soon, 'NS');
  await handleApi(ctx, 'POST', '/api/leagues/activate', { ids: [39], active: true });
  const r = await handleApi(ctx, 'GET', '/api/prelive', {});
  assert.equal(r.body.ranking.length, 1);
  assert.equal(r.body.ranking[0].fixtureId, 1);
});

test('POST /api/backfill sem times → erro orientando o usuário', async () => {
  const ctx = ctx0({ withClient: true });
  const r = await handleApi(ctx, 'POST', '/api/backfill', {});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Sincronizar jogos|Ative ligas/i);
});

test('POST /api/backfill sem chave da API → mensagem clara', async () => {
  const ctx = ctx0({ withClient: false });
  const r = await handleApi(ctx, 'POST', '/api/backfill', {});
  assert.equal(r.status, 500);
  assert.match(r.body.error, /chave|APIFOOTBALL/i);
});

test('POST /api/backfill inicia em segundo plano e popula match_stats; status reflete', async () => {
  const ctx = ctx0({ withClient: true });
  // jogo de liga ativa → fornece os times 10 e 11
  const soon = Math.floor(Date.now() / 1000) + 3600;
  ctx.db.prepare('INSERT INTO fixtures (id, league_id, home_team_id, away_team_id, home_team, away_team, kickoff, status_short) VALUES (?,?,?,?,?,?,?,?)')
    .run(1, 39, 10, 11, 'A', 'B', soon, 'NS');
  await handleApi(ctx, 'POST', '/api/leagues/activate', { ids: [39], active: true });

  // cliente falso: cada time tem 1 jogo terminado com cantos
  let teamCalls = 0;
  ctx.client.getTeamLastFixtures = async (teamId) => {
    teamCalls++;
    const fid = 5000 + teamId;
    return { ok: true, response: [{
      fixture: { id: fid, timestamp: 100, status: { short: 'FT', long: 'FT' } },
      league: { id: 39, season: 2025, name: 'PL' },
      teams: { home: { id: teamId, name: 'T' + teamId }, away: { id: 99, name: 'Z' } },
      goals: { home: 1, away: 0 }, score: { halftime: { home: 0, away: 0 } },
    }] };
  };
  ctx.client.getFixtureStatistics = async () => ({ ok: true, response: [
    { team: { id: 10 }, statistics: [{ type: 'Corner Kicks', value: 6 }] },
    { team: { id: 11 }, statistics: [{ type: 'Corner Kicks', value: 4 }] },
    { team: { id: 99 }, statistics: [{ type: 'Corner Kicks', value: 3 }] },
  ] });

  const r = await handleApi(ctx, 'POST', '/api/backfill', {});
  assert.equal(r.status, 200);
  assert.equal(r.body.started, true);
  assert.ok(r.body.teams >= 2);

  // espera o backfill de fundo terminar
  for (let i = 0; i < 50 && ctx._backfillRunning; i++) await new Promise((res) => setTimeout(res, 10));
  assert.ok(teamCalls >= 2);
  const rows = ctx.db.prepare('SELECT COUNT(*) n FROM match_stats').get().n;
  assert.ok(rows > 0, 'match_stats deveria ter sido populado');

  const st = await handleApi(ctx, 'GET', '/api/backfill/status', {});
  assert.equal(st.status, 200);
  assert.ok(st.body.activeTeams >= 2);
  assert.ok(st.body.teamsWithHistory >= 1);
});
