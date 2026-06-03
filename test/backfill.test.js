import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/db/migrate.js';
import { upsertFixture, upsertMatchStats, hasMatchStats, refreshMonitoredFlags } from '../src/services/fixturesSync.js';
import { parseFixture, parseTeamStatistics, buildMatchStatsRows } from '../src/api/statsParser.js';
import { RequestBudget, backfillTeam, runBackfill, activeTeamIds, extractAndStoreStats } from '../src/services/backfill.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  return db;
}

// ---- Cliente FALSO da API ----
// Simula getTeamLastFixtures e getFixtureStatistics, contando as chamadas.
function fakeClient({ fixturesByTeam = {}, statsByFixture = {} } = {}) {
  const calls = { team: 0, stats: 0 };
  return {
    calls,
    async getTeamLastFixtures(teamId) {
      calls.team += 1;
      return { ok: true, empty: false, response: fixturesByTeam[teamId] || [] };
    },
    async getFixtureStatistics(fixtureId) {
      calls.stats += 1;
      const r = statsByFixture[fixtureId];
      if (!r) return { ok: true, empty: true, response: [] };
      return { ok: true, empty: false, response: r };
    },
  };
}

function fx(id, homeId, awayId, status = 'FT') {
  return {
    fixture: { id, timestamp: 1900000000 + id, status: { short: status, long: status, elapsed: 90 } },
    league: { id: 39, season: 2025, name: 'PL' },
    teams: { home: { id: homeId, name: `T${homeId}` }, away: { id: awayId, name: `T${awayId}` } },
    goals: { home: 1, away: 0 }, score: { halftime: { home: 0, away: 0 } },
  };
}
function st(homeId, awayId, ch = 6, ca = 3) {
  return [
    { team: { id: homeId }, statistics: [{ type: 'Corner Kicks', value: ch }, { type: 'Total Shots', value: 12 }] },
    { team: { id: awayId }, statistics: [{ type: 'Corner Kicks', value: ca }, { type: 'Total Shots', value: 8 }] },
  ];
}

test('upsertFixture é idempotente e atualiza status/gols sem duplicar', () => {
  const db = freshDb();
  upsertFixture(db, parseFixture(fx(1, 33, 40, 'NS')));
  upsertFixture(db, parseFixture(fx(1, 33, 40, 'FT'))); // mesmo id, agora terminado
  const rows = db.prepare('SELECT * FROM fixtures WHERE id=1').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status_short, 'FT');
});

test('upsertMatchStats respeita unicidade (fixture+team) e atualiza', () => {
  const db = freshDb();
  const pf = parseFixture(fx(2, 33, 40));
  const rows = buildMatchStatsRows(pf, parseTeamStatistics(st(33, 40, 6, 3)));
  for (const r of rows) upsertMatchStats(db, r);
  assert.equal(hasMatchStats(db, 2), true);
  // re-gravar não duplica
  for (const r of rows) upsertMatchStats(db, r);
  const n = db.prepare('SELECT COUNT(*) AS n FROM match_stats WHERE fixture_id=2').get().n;
  assert.equal(n, 2);
});

test('backfillTeam grava jogos e stats dos terminados', async () => {
  const db = freshDb();
  const client = fakeClient({
    fixturesByTeam: { 33: [fx(10, 33, 40), fx(11, 33, 50, 'NS')] }, // um FT, um não começou
    statsByFixture: { 10: st(33, 40, 7, 2) },
  });
  const s = await backfillTeam({ db, client }, 33, { last: 30 });
  assert.equal(s.fetched, 2);
  assert.equal(s.stored, 1);              // só o FT virou match_stats
  assert.equal(hasMatchStats(db, 10), true);
  assert.equal(hasMatchStats(db, 11), false);
});

test('INCREMENTAL: jogo já processado é pulado SEM gastar requisição de stats', async () => {
  const db = freshDb();
  const client = fakeClient({
    fixturesByTeam: { 33: [fx(20, 33, 40)] },
    statsByFixture: { 20: st(33, 40) },
  });
  await backfillTeam({ db, client }, 33, {});
  const statsCallsAfterFirst = client.calls.stats;
  assert.equal(statsCallsAfterFirst, 1);

  // roda de novo: o jogo 20 já tem match_stats → não chama getFixtureStatistics de novo
  await backfillTeam({ db, client }, 33, {});
  assert.equal(client.calls.stats, statsCallsAfterFirst, 'não deve regastar requisição de stats');
});

test('TETO de requisições: para quando o orçamento acaba', async () => {
  const db = freshDb();
  // 3 jogos terminados, cada um custaria 1 req de stats; orçamento só pra 1 time + 1 stat
  const client = fakeClient({
    fixturesByTeam: { 33: [fx(30, 33, 40), fx(31, 33, 41), fx(32, 33, 42)] },
    statsByFixture: { 30: st(33, 40), 31: st(33, 41), 32: st(33, 42) },
  });
  const budget = new RequestBudget(2); // 1 pro getTeamLastFixtures + 1 pra uma stat
  const s = await backfillTeam({ db, client }, 33, { budget });
  assert.ok(budget.exhausted);
  assert.equal(s.stored, 1, 'só deu pra processar 1 jogo dentro do teto');
});

test('extractAndStoreStats: sem estatística (200 vazio) não grava e marca o motivo', async () => {
  const db = freshDb();
  upsertFixture(db, parseFixture(fx(40, 33, 40)));
  const client = fakeClient({ statsByFixture: {} }); // nenhuma stat → empty
  const r = await extractAndStoreStats({ db, client }, 40, parseFixture(fx(40, 33, 40)));
  assert.equal(r.stored, false);
  assert.equal(r.reason, 'sem estatística');
  assert.equal(hasMatchStats(db, 40), false);
});

test('runBackfill deriva times das ligas ATIVAS e marca stoppedEarly no teto', async () => {
  const db = freshDb();
  // liga 39 ativa, com jogos no banco → times 33,40
  db.prepare('INSERT INTO leagues (id, name, active) VALUES (39, ?, 1)').run('PL');
  db.prepare('INSERT INTO leagues (id, name, active) VALUES (61, ?, 0)').run('Ligue 1');
  upsertFixture(db, parseFixture(fx(50, 33, 40)));
  // liga inativa não deve entrar
  db.prepare('INSERT INTO fixtures (id, league_id, home_team_id, away_team_id) VALUES (51, 61, 99, 98)').run();

  const ids = activeTeamIds(db).sort((a, b) => a - b);
  assert.deepEqual(ids, [33, 40]);

  const client = fakeClient({
    fixturesByTeam: { 33: [fx(60, 33, 40)], 40: [fx(60, 33, 40)] },
    statsByFixture: { 60: st(33, 40) },
  });
  const totals = await runBackfill({ db, client }, { cap: 100 });
  assert.equal(totals.teams, 2);
  assert.ok(totals.stored >= 1);
});

test('refreshMonitoredFlags marca só jogos de ligas ativas', () => {
  const db = freshDb();
  db.prepare('INSERT INTO leagues (id, name, active) VALUES (39, ?, 1)').run('PL');
  upsertFixture(db, parseFixture(fx(70, 33, 40)));
  db.prepare('INSERT INTO fixtures (id, league_id, home_team_id, away_team_id) VALUES (71, 61, 1, 2)').run();
  refreshMonitoredFlags(db);
  assert.equal(db.prepare('SELECT monitored FROM fixtures WHERE id=70').get().monitored, 1);
  assert.equal(db.prepare('SELECT monitored FROM fixtures WHERE id=71').get().monitored, 0);
});

// ---- "Preencher o que falta": pula times já prontos (>= minGames) ----

import { splitByHistory, statsCountByTeam } from '../src/services/backfill.js';

function seedTeamGames(db, teamId, n) {
  // cria n jogos terminados com match_stats pra esse time (ligando-o a um adversário fixo)
  for (let i = 0; i < n; i++) {
    const fid = teamId * 1000 + i;
    upsertFixture(db, parseFixture(fx(fid, teamId, 999, 'FT')));
    const rows = buildMatchStatsRows(parseFixture(fx(fid, teamId, 999, 'FT')), parseTeamStatistics(st(teamId, 999)));
    for (const r of rows) upsertMatchStats(db, r);
  }
}

test('splitByHistory separa prontos (>=min) de faltando', () => {
  const db = freshDb();
  db.prepare('INSERT INTO leagues (id,name,active) VALUES (39,?,1)').run('PL');
  seedTeamGames(db, 10, 25); // pronto
  seedTeamGames(db, 11, 3);  // falta
  const { need, ready } = splitByHistory(db, [10, 11, 12], 20);
  assert.deepEqual(ready, [10]);
  assert.ok(need.includes(11) && need.includes(12)); // 12 não tem nada → falta
});

test('runBackfill (sem force) NÃO lista times já prontos (economiza requisição)', async () => {
  const db = freshDb();
  db.prepare('INSERT INTO leagues (id,name,active) VALUES (39,?,1)').run('PL');
  seedTeamGames(db, 10, 25); // já pronto → deve ser pulado
  // time 11 precisa: 1 jogo novo a puxar
  const client = fakeClient({
    fixturesByTeam: { 10: [fx(123, 10, 999)], 11: [fx(456, 11, 998)] },
    statsByFixture: { 456: st(11, 998) },
  });
  const totals = await runBackfill({ db, client }, { teamIds: [10, 11], minGames: 20, cap: 100 });
  assert.equal(totals.skippedTeams, 1, 'o time 10 (pronto) deve ser pulado');
  assert.equal(totals.teams, 1, 'só o time 11 é processado');
  assert.equal(client.calls.team, 1, 'só 1 listagem de time (o 10 nem é listado)');
});

test('runBackfill (force) varre todos, mesmo os prontos', async () => {
  const db = freshDb();
  db.prepare('INSERT INTO leagues (id,name,active) VALUES (39,?,1)').run('PL');
  seedTeamGames(db, 10, 25);
  const client = fakeClient({ fixturesByTeam: { 10: [fx(123, 10, 999)], 11: [fx(456, 11, 998)] } });
  const totals = await runBackfill({ db, client }, { teamIds: [10, 11], minGames: 20, force: true, cap: 100 });
  assert.equal(totals.skippedTeams, 0);
  assert.equal(totals.teams, 2, 'force processa os dois');
  assert.equal(client.calls.team, 2, 'lista os dois times');
});
