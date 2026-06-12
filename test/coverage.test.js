// Cobertura do histórico: agregação por liga + render da grade.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openDb } from '../src/db/index.js';
import { coverageByLeague } from '../src/services/backfill.js';
import { upsertFixture, upsertMatchStats } from '../src/services/fixturesSync.js';
import { parseFixture, parseTeamStatistics, buildMatchStatsRows } from '../src/api/statsParser.js';
import { dashboardHtml } from '../src/server/html.js';

function db0() { return openDb(':memory:'); }
function fxObj(id, h, a, league = 39) {
  return { fixture: { id, timestamp: 1700000000 + id, status: { short: 'FT', long: 'FT', elapsed: 90 } },
    league: { id: league, season: 2025, name: 'L' + league },
    teams: { home: { id: h, name: 'T' + h }, away: { id: a, name: 'T' + a } },
    goals: { home: 1, away: 0 }, score: { halftime: { home: 0, away: 0 } } };
}
function st(h, a) { return [{ team: { id: h }, statistics: [{ type: 'Corner Kicks', value: 6 }] }, { team: { id: a }, statistics: [{ type: 'Corner Kicks', value: 3 }] }]; }
function seedGames(db, teamId, n, league = 39) {
  for (let i = 0; i < n; i++) {
    const fid = teamId * 1000 + i + league * 100000;
    const f = parseFixture(fxObj(fid, teamId, 999, league));
    for (const r of buildMatchStatsRows(f, parseTeamStatistics(st(teamId, 999)))) upsertMatchStats(db, r);
  }
}

test('coverageByLeague: classifica times em ready/started/empty', () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active) VALUES (39,'Premier',1)").run();
  // jogo futuro define os times ativos da liga 39
  upsertFixture(db, parseFixture(fxObj(50, 10, 11, 39)));
  upsertFixture(db, parseFixture(fxObj(51, 12, 13, 39)));
  seedGames(db, 10, 25); // ready
  seedGames(db, 11, 5);  // started
  // 12 e 13 ficam com 0 → empty
  const cov = coverageByLeague(db, { minGames: 20 });
  assert.equal(cov.summary.activeTeams, 4);
  assert.equal(cov.summary.ready, 1);
  assert.equal(cov.summary.started, 1);
  assert.equal(cov.summary.empty, 2);
  assert.equal(cov.leagues.length, 1);
  const t10 = cov.leagues[0].teams.find((t) => t.teamId === 10);
  assert.equal(t10.level, 'ready');
  assert.ok(t10.games >= 20);
});

test('coverageByLeague: só conta ligas ativas (e usa nome+país)', () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,country,active) VALUES (9001,'Serie A','Brazil',1)").run();
  db.prepare("INSERT INTO leagues (id,name,country,active) VALUES (9002,'Serie A','Italy',0)").run();
  upsertFixture(db, parseFixture(fxObj(60, 10, 11, 9001)));
  upsertFixture(db, parseFixture(fxObj(61, 20, 21, 9002)));
  const cov = coverageByLeague(db, { minGames: 20 });
  assert.equal(cov.leagues.length, 1, 'só a ativa');
  // id fora do mapa de apelidos → nome + país pra desambiguar
  assert.equal(cov.leagues[0].name, 'Serie A (Brasil)');
});

test('coverageByLeague: time em 0 jogos aparece como empty com nome', () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active) VALUES (39,'L',1)").run();
  upsertFixture(db, parseFixture(fxObj(70, 10, 11, 39)));
  const cov = coverageByLeague(db, { minGames: 20 });
  const team = cov.leagues[0].teams.find((t) => t.teamId === 10);
  assert.equal(team.games, 0);
  assert.equal(team.level, 'empty');
  assert.equal(team.name, 'T10');
});

// ---------- render jsdom ----------

let win;
before(() => {
  const dom = new JSDOM(dashboardHtml(), { runScripts: 'dangerously', pretendToBeVisual: true });
  win = dom.window;
});

test('renderCoverage desenha a barra e a grade por liga', () => {
  const B = win.Bet21;
  assert.equal(typeof B.renderCoverage, 'function');
  const root = win.document.createElement('div');
  B.renderCoverage(root, {
    minGames: 20, running: true,
    summary: { activeTeams: 10, ready: 4, started: 4, empty: 2, games: 120 },
    leagues: [{ id: 39, name: 'Premier', ready: 4, total: 10, teams: [
      { teamId: 1, name: 'A', games: 25, level: 'ready' },
      { teamId: 2, name: 'B', games: 5, level: 'partial' },
      { teamId: 3, name: 'C', games: 0, level: 'empty' },
    ] }],
  });
  assert.match(root.innerHTML, /Banco de dados/);
  assert.match(root.innerHTML, /40%/); // 4/10 concluídos (ready+exhausted)
  assert.match(root.innerHTML, /Premier/);
  assert.match(root.innerHTML, /preenchendo agora/); // running
  assert.ok(root.querySelectorAll('.cvcell').length >= 3);
  assert.ok(root.querySelector('.cvleague'), 'cada liga vira um cartão');
});

test('renderCoverage: sem dados mostra carregando, não quebra', () => {
  const B = win.Bet21;
  const root = win.document.createElement('div');
  B.renderCoverage(root, null);
  assert.match(root.innerHTML, /[Cc]arregando|Dados/);
});

// ---------- backfill de um time (clicar no clube) ----------

import { backfillTeamRoute } from '../src/server/controller.js';

test('backfillTeamRoute: teamId inválido → erro', () => {
  const ctx = { db: db0(), client: {}, _backfillRunning: false };
  const r = backfillTeamRoute(ctx, { teamId: 'abc' });
  assert.match(r.error, /inválido/);
});

test('backfillTeamRoute: recusa se já há backfill rodando', () => {
  const ctx = { db: db0(), client: {}, _backfillRunning: true };
  const r = backfillTeamRoute(ctx, { teamId: 10 });
  assert.equal(r.started, false);
});

test('backfillTeamRoute: dispara e busca os jogos do time (cliente falso)', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active) VALUES (39,'L',1)").run();
  upsertFixture(db, parseFixture(fxObj(80, 33, 34, 39))); // define o time 33 com nome
  let teamCalls = 0;
  const client = {
    async getTeamLastFixtures(teamId) { teamCalls++; return { response: [fxObj(900 + teamId, teamId, 999, 39)] }; },
    async getFixtureStatistics() { return { response: st(33, 999) }; },
  };
  const ctx = { db, client, _backfillRunning: false };
  const r = backfillTeamRoute(ctx, { teamId: 33 });
  assert.equal(r.started, true);
  assert.equal(r.teamId, 33);
  // espera o background terminar
  await new Promise((res) => setTimeout(res, 150));
  assert.equal(teamCalls, 1, 'buscou os jogos do time 33');
  assert.equal(ctx._backfillRunning, false, 'liberou a trava ao terminar');
  // agora o time 33 tem stats guardadas
  const n = db.prepare('SELECT COUNT(*) AS n FROM match_stats WHERE team_id=33').get().n;
  assert.ok(n >= 1);
});

// ---------- descobrir times via /teams (league_teams) ----------

import { syncLeagueTeams } from '../src/services/leagues.js';

test('syncLeagueTeams popula league_teams e a grade mostra sem fixtures', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (140,'La Liga',1,2025)").run();
  // nenhum fixture baixado ainda — só a liga ativa
  const client = {
    async getTeams(leagueId, season) {
      assert.equal(leagueId, 140); assert.equal(season, 2025);
      return { response: [ { team: { id: 541, name: 'Real Madrid' } }, { team: { id: 529, name: 'Barcelona' } } ] };
    },
  };
  const r = await syncLeagueTeams({ db, client });
  assert.equal(r.teams, 2);
  assert.equal(r.leagues, 1);
  // agora a cobertura mostra os 2 times, mesmo sem fixtures
  const cov = coverageByLeague(db, { minGames: 20 });
  assert.equal(cov.leagues.length, 1);
  const names = cov.leagues[0].teams.map((t) => t.name).sort();
  assert.deepEqual(names, ['Barcelona', 'Real Madrid']);
  assert.equal(cov.leagues[0].teams.every((t) => t.level === 'empty'), true);
});

test('syncLeagueTeams é idempotente (re-sync não duplica)', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (140,'La Liga',1,2025)").run();
  const client = { async getTeams() { return { response: [{ team: { id: 541, name: 'Real Madrid' } }] }; } };
  await syncLeagueTeams({ db, client });
  await syncLeagueTeams({ db, client });
  const n = db.prepare('SELECT COUNT(*) AS n FROM league_teams WHERE team_id=541').get().n;
  assert.equal(n, 1);
});

test('activeTeamIds inclui times de league_teams (pra puxar histórico dos novos)', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (140,'La Liga',1,2025)").run();
  const client = { async getTeams() { return { response: [{ team: { id: 541, name: 'RM' } }] }; } };
  await syncLeagueTeams({ db, client });
  const { activeTeamIds } = await import('../src/services/backfill.js');
  assert.ok(activeTeamIds(db).includes(541));
});

// ---------- backfill por liga (só os que faltam) ----------

import { backfillLeagueRoute } from '../src/server/controller.js';

test('backfillLeagueRoute: leagueId inválido → erro', () => {
  const r = backfillLeagueRoute({ db: db0(), client: {}, _backfillRunning: false }, { leagueId: 'x' });
  assert.match(r.error, /inválido/);
});

test('backfillLeagueRoute: liga sem times pede Descobrir times', () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active) VALUES (39,'L',1)").run();
  const r = backfillLeagueRoute({ db, client: {}, _backfillRunning: false }, { leagueId: 39 });
  assert.equal(r.started, false);
  assert.match(r.message, /Descobrir times/);
});

test('backfillLeagueRoute: puxa só os times que faltam daquela liga', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (39,'Premier',1,2025)").run();
  db.prepare("INSERT INTO league_teams (league_id,team_id,team_name) VALUES (39,1,'A'),(39,2,'B'),(39,3,'C')").run();
  // time 1 já pronto (25 jogos) → deve ser pulado
  seedGames(db, 1, 25, 39);
  let pulled = [];
  const ctx = {
    db, _backfillRunning: false, _backfillCancel: false,
    client: {
      async getTeamLastFixtures(teamId) { pulled.push(teamId); return { response: [] }; },
      async getFixtureStatistics() { return { response: [] }; },
    },
  };
  const r = backfillLeagueRoute(ctx, { leagueId: 39 });
  assert.equal(r.started, true);
  assert.equal(r.teams, 2);   // 2 e 3 faltam
  assert.equal(r.skipped, 1); // o 1 está pronto
  await new Promise((res) => setTimeout(res, 150));
  assert.ok(!pulled.includes(1), 'time pronto não é puxado');
  assert.ok(pulled.includes(2) && pulled.includes(3));
});

test('renderCoverage mostra botão por liga com a contagem dos que faltam', () => {
  const dom = new JSDOM(dashboardHtml(), { runScripts: 'dangerously', pretendToBeVisual: true });
  const B = dom.window.Bet21;
  const root = dom.window.document.createElement('div');
  B.renderCoverage(root, {
    minGames: 20, running: false,
    summary: { activeTeams: 3, ready: 1, started: 0, empty: 2, games: 25 },
    leagues: [{ id: 39, name: 'Premier', ready: 1, total: 3, pending: 2, triedIncomplete: 0, teams: [
      { teamId: 1, name: 'A', games: 25, level: 'ready' },
      { teamId: 2, name: 'B', games: 0, level: 'empty' },
      { teamId: 3, name: 'C', games: 0, level: 'empty' },
    ] }],
  });
  var b = root.querySelector('[data-fill-league="39"]');
  assert.ok(b, 'deve ter o botão por liga');
  assert.match(b.textContent, /2/); // faltam 2
});

// ---------- tried_empty: tentou e não achou partidas (vermelho) ----------

test('backfillTeam marca last_try e coverage classifica tried_empty', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (39,'L',1,2025)").run();
  db.prepare("INSERT INTO league_teams (league_id,team_id,team_name) VALUES (39,77,'FantasmaFC')").run();
  // cliente que não acha jogos pra esse time
  const client = { async getTeamLastFixtures() { return { empty: true, response: [] }; }, async getFixtureStatistics() { return { response: [] }; } };
  const { backfillTeam } = await import('../src/services/backfill.js');
  await backfillTeam({ db, client }, 77, {});
  const row = db.prepare('SELECT last_try_at, last_try_stored FROM league_teams WHERE team_id=77').get();
  assert.ok(row.last_try_at, 'deve registrar a tentativa');
  assert.equal(row.last_try_stored, 0);
  // cobertura: o time aparece como tried_empty (vermelho), não empty
  const cov = coverageByLeague(db, { minGames: 20 });
  const t = cov.leagues[0].teams.find((x) => x.teamId === 77);
  assert.equal(t.level, 'tried_empty');
  assert.equal(cov.summary.triedEmpty, 1);
  assert.equal(cov.summary.empty, 0);
});

test('time nunca tentado fica empty (cinza), não tried_empty', () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active) VALUES (39,'L',1)").run();
  db.prepare("INSERT INTO league_teams (league_id,team_id,team_name) VALUES (39,88,'NovoTime')").run();
  const cov = coverageByLeague(db, { minGames: 20 });
  const t = cov.leagues[0].teams.find((x) => x.teamId === 88);
  assert.equal(t.level, 'empty');
});

test('backfillLeagueRoute pula os tried_empty (não re-tenta os vermelhos)', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (39,'L',1,2025)").run();
  db.prepare("INSERT INTO league_teams (league_id,team_id,team_name) VALUES (39,1,'A'),(39,2,'B')").run();
  // time 1 já foi tentado e veio vazio
  db.prepare("UPDATE league_teams SET last_try_at=?, last_try_stored=0 WHERE team_id=1").run(Date.now());
  let pulled = [];
  const ctx = { db, _backfillRunning: false, _backfillCancel: false,
    client: { async getTeamLastFixtures(id){ pulled.push(id); return { response: [] }; }, async getFixtureStatistics(){ return { response: [] }; } } };
  const r = backfillLeagueRoute(ctx, { leagueId: 39 });
  assert.equal(r.started, true);
  assert.equal(r.teams, 1, 'só o time 2 (o 1 é vermelho, pulado)');
  await new Promise((res) => setTimeout(res, 120));
  assert.ok(!pulled.includes(1), 'não re-tenta o tried_empty');
  assert.ok(pulled.includes(2));
});

test('clicar de novo num tried_empty (time avulso) é permitido', async () => {
  // o clique no time NÃO bloqueia tried_empty — o usuário pode forçar de novo
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (39,'L',1,2025)").run();
  db.prepare("INSERT INTO league_teams (league_id,team_id,team_name) VALUES (39,5,'X')").run();
  db.prepare("UPDATE league_teams SET last_try_at=?, last_try_stored=0 WHERE team_id=5").run(Date.now());
  let pulled = [];
  const ctx = { db, _backfillRunning: false,
    client: { async getTeamLastFixtures(id){ pulled.push(id); return { response: [] }; }, async getFixtureStatistics(){ return { response: [] }; } } };
  const { backfillTeamRoute } = await import('../src/server/controller.js');
  const r = backfillTeamRoute(ctx, { teamId: 5 });
  assert.equal(r.started, true);
  await new Promise((res) => setTimeout(res, 120));
  assert.ok(pulled.includes(5), 'clique no time força a nova tentativa');
});

// ---------- amarelo: completar parciais e não marcar truncado por cota ----------

import { backfillTeam, RequestBudget } from '../src/services/backfill.js';

test('backfillTeam NÃO marca como tentado se a cota truncou', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active) VALUES (39,'L',1)").run();
  db.prepare("INSERT INTO league_teams (league_id,team_id,team_name) VALUES (39,50,'Parcial')").run();
  // orçamento de só 1 req: gasta na listagem, e trunca antes de buscar stats
  const budget = new RequestBudget(1);
  const client = {
    async getTeamLastFixtures() {
      return { response: [
        { fixture: { id: 1, timestamp: 1700000000, status: { short: 'FT', long: 'FT', elapsed: 90 } }, league: { id: 39, season: 2025 }, teams: { home: { id: 50 }, away: { id: 51 } }, goals: { home: 1, away: 0 }, score: { halftime: {} } },
      ] };
    },
    async getFixtureStatistics() { return { response: [] }; },
  };
  const r = await backfillTeam({ db, client }, 50, { budget });
  assert.equal(r.truncated, true);
  const row = db.prepare('SELECT last_try_at FROM league_teams WHERE team_id=50').get();
  assert.equal(row.last_try_at, null, 'truncado pela cota não marca tentativa → continua puxável');
});

test('backfillLeagueRoute padrão pula tentados; includeTried re-varre', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (39,'L',1,2025)").run();
  db.prepare("INSERT INTO league_teams (league_id,team_id,team_name) VALUES (39,1,'A'),(39,2,'B')").run();
  // time 1: amarelo JÁ tentado (5 jogos). time 2: cinza nunca tentado.
  seedGames(db, 1, 5, 39);
  db.prepare("UPDATE league_teams SET last_try_at=? WHERE team_id=1").run(Date.now());

  // padrão: só puxa o 2 (o 1 já foi tentado)
  let pulled1 = [];
  const ctx1 = { db, _backfillRunning: false, _backfillCancel: false,
    client: { async getTeamLastFixtures(id){ pulled1.push(id); return { response: [] }; }, async getFixtureStatistics(){ return { response: [] }; } } };
  const r1 = backfillLeagueRoute(ctx1, { leagueId: 39 });
  assert.equal(r1.teams, 1);
  await new Promise((res) => setTimeout(res, 120));
  assert.deepEqual(pulled1.sort(), [2]);

  // includeTried: re-varre o 1 também
  let pulled2 = [];
  const ctx2 = { db, _backfillRunning: false, _backfillCancel: false,
    client: { async getTeamLastFixtures(id){ pulled2.push(id); return { response: [] }; }, async getFixtureStatistics(){ return { response: [] }; } } };
  const r2 = backfillLeagueRoute(ctx2, { leagueId: 39, includeTried: true });
  assert.equal(r2.teams, 2);
  await new Promise((res) => setTimeout(res, 120));
  assert.ok(pulled2.includes(1) && pulled2.includes(2), 'includeTried re-varre o amarelo tentado');
});

test('coverage: pending=não-tentados; amarelo-tentado vira exhausted (completo)', () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (39,'L',1,2025)").run();
  db.prepare("INSERT INTO league_teams (league_id,team_id,team_name) VALUES (39,1,'cinza'),(39,2,'amareloNovo'),(39,3,'amareloTentado')").run();
  seedGames(db, 2, 4, 39);  // amarelo nunca tentado → pending
  seedGames(db, 3, 4, 39);  // amarelo
  db.prepare("UPDATE league_teams SET last_try_at=? WHERE team_id=3").run(Date.now()); // tentado → exhausted
  const cov = coverageByLeague(db, { minGames: 20 });
  const L = cov.leagues[0];
  assert.equal(L.pending, 2, 'cinza(1) + amarelo-novo(2) = 2');
  assert.equal(L.exhausted, 1, 'amarelo-tentado(3) = completo/exhausted');
  assert.equal(L.triedIncomplete, 0, 'esgotados não entram em triedIncomplete');
  // o time 3 fica azul (exhausted), não amarelo
  assert.equal(L.teams.find((t) => t.teamId === 3).level, 'exhausted');
});

// ---------- regressão: time vindo SÓ de fixtures (não em league_teams) ----------

test('markTry registra time que só existe em fixtures (vira vermelho, não fica preso)', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (71,'Serie B',1,2025)").run();
  // Remo só em fixtures, NÃO em league_teams (cenário real: baixado antes da tabela existir)
  db.prepare("INSERT INTO fixtures (id,league_id,home_team_id,away_team_id,home_team,away_team,kickoff,status_short) VALUES (5000,71,100,200,'Remo','Paysandu',1700000000,'NS')").run();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM league_teams WHERE team_id=100").get().n, 0);

  const { backfillTeam } = await import('../src/services/backfill.js');
  const client = { async getTeamLastFixtures(){ return { response: [] }; }, async getFixtureStatistics(){ return { response: [] }; } };
  await backfillTeam({ db, client }, 100, {});

  // agora foi inserido em league_teams com a tentativa marcada
  const row = db.prepare("SELECT team_name, last_try_at FROM league_teams WHERE team_id=100").get();
  assert.ok(row, 'time deve ter sido inserido em league_teams');
  assert.ok(row.last_try_at, 'deve marcar a tentativa');
  assert.equal(row.team_name, 'Remo');
  // e na cobertura fica vermelho (tried_empty), não preso
  const cov = coverageByLeague(db, { minGames: 20 });
  const remo = cov.leagues[0].teams.find((t) => t.teamId === 100);
  assert.equal(remo.level, 'tried_empty');
});

test('time só-em-fixtures que ACHA jogos vira verde/amarelo e fica marcado', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (71,'Serie B',1,2025)").run();
  db.prepare("INSERT INTO fixtures (id,league_id,home_team_id,away_team_id,home_team,away_team,kickoff,status_short) VALUES (5001,71,101,201,'Vitoria','Bahia',1700000000,'NS')").run();
  const { backfillTeam } = await import('../src/services/backfill.js');
  const client = {
    async getTeamLastFixtures(){ return { response: [
      { fixture: { id: 6100, timestamp: 1690000000, status: { short: 'FT', long: 'FT', elapsed: 90 } }, league: { id: 71, season: 2025 }, teams: { home: { id: 101 }, away: { id: 301 } }, goals: { home: 2, away: 1 }, score: { halftime: {} } },
    ] }; },
    async getFixtureStatistics(){ return { response: [
      { team: { id: 101 }, statistics: [{ type: 'Corner Kicks', value: 7 }] },
      { team: { id: 301 }, statistics: [{ type: 'Corner Kicks', value: 4 }] },
    ] }; },
  };
  await backfillTeam({ db, client }, 101, {});
  const n = db.prepare('SELECT COUNT(*) AS n FROM match_stats WHERE team_id=101').get().n;
  assert.ok(n >= 1, 'pegou jogo com stats');
  const row = db.prepare("SELECT last_try_at FROM league_teams WHERE team_id=101").get();
  assert.ok(row && row.last_try_at, 'marcado como tentado');
});

// ---------- o caso do Remo: 19 jogos, já tentado → exhausted (azul), não amarelo ----------

test('time com 19 jogos já tentado fica exhausted (azul), não partial', () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (71,'Serie B',1,2025)").run();
  db.prepare("INSERT INTO league_teams (league_id,team_id,team_name) VALUES (71,100,'Remo')").run();
  seedGames(db, 100, 19, 71); // 19 jogos (< 20)
  db.prepare("UPDATE league_teams SET last_try_at=? WHERE team_id=100").run(Date.now()); // já puxado
  const cov = coverageByLeague(db, { minGames: 20 });
  const remo = cov.leagues[0].teams.find((t) => t.teamId === 100);
  assert.equal(remo.games, 19);
  assert.equal(remo.level, 'exhausted', 'tentado + 19 jogos = completo até onde a API tem');
  // não entra no "que faltam" (pending) — o botão da liga não vai re-puxar
  assert.equal(cov.leagues[0].pending, 0);
});

test('o mesmo time com 19 jogos mas NUNCA tentado fica partial (amarelo, a puxar)', () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (71,'Serie B',1,2025)").run();
  db.prepare("INSERT INTO league_teams (league_id,team_id,team_name) VALUES (71,100,'Remo')").run();
  seedGames(db, 100, 19, 71);
  // sem last_try_at → nunca tentado
  const cov = coverageByLeague(db, { minGames: 20 });
  const remo = cov.leagues[0].teams.find((t) => t.teamId === 100);
  assert.equal(remo.level, 'partial', 'nunca tentado → ainda a puxar');
  assert.equal(cov.leagues[0].pending, 1, 'entra no que faltam');
});

test('backfillLeagueRoute padrão NÃO re-puxa o exhausted', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (71,'Serie B',1,2025)").run();
  db.prepare("INSERT INTO league_teams (league_id,team_id,team_name) VALUES (71,100,'Remo')").run();
  seedGames(db, 100, 19, 71);
  db.prepare("UPDATE league_teams SET last_try_at=? WHERE team_id=100").run(Date.now());
  let pulled = [];
  const ctx = { db, _backfillRunning: false, _backfillCancel: false,
    client: { async getTeamLastFixtures(id){ pulled.push(id); return { response: [] }; }, async getFixtureStatistics(){ return { response: [] }; } } };
  const r = backfillLeagueRoute(ctx, { leagueId: 71 });
  assert.equal(r.started, false, 'nada a puxar — o único time está esgotado');
});

// ---------- Copa do Mundo: season velha no banco e o "Descobrir times" ----------

test('Descobrir times: season velha (2022) → fallback acha a vigente e auto-corrige', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (1,'World Cup',1,2022)").run();
  const asked = [];
  const ctx = { db, client: { async getTeams(leagueId, season){
    asked.push(season);
    // 2022 não devolve nada (Copa acabou); o ano atual devolve as 48 seleções
    if (season === 2022) return { response: [] };
    if (season === new Date().getFullYear()) {
      return { response: Array.from({ length: 48 }, (_, i) => ({ team: { id: 100 + i, name: 'Sel' + i } })) };
    }
    return { response: [] };
  } } };
  const r = await syncLeagueTeams(ctx, { onlyLeagueId: 1 });
  assert.equal(r.teams, 48, 'achou as 48 seleções na temporada vigente');
  assert.ok(asked.includes(2022), 'tentou a season do banco primeiro');
  // auto-corrigiu a season da liga
  assert.equal(db.prepare('SELECT season FROM leagues WHERE id = 1').get().season, new Date().getFullYear());
  // e agora a Copa APARECE na aba Dados (tem times)
  const cov = coverageByLeague(db, { minGames: 20 });
  const copa = cov.leagues.find((L) => L.id === 1);
  assert.ok(copa, 'Copa aparece na cobertura');
  assert.equal(copa.total, 48);
});

test('Descobrir times: season do banco ok → 1 chamada só, sem fallback', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (39,'PL',1,2025)").run();
  let calls = 0;
  const ctx = { db, client: { async getTeams(){ calls++; return { response: [ { team: { id: 1, name: 'A' } } ] }; } } };
  await syncLeagueTeams(ctx, { onlyLeagueId: 39 });
  assert.equal(calls, 1, 'não gasta chamada extra quando a primeira funciona');
});
