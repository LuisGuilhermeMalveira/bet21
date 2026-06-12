// syncFixtures no modo "próximos jogos por liga" + filtro da pré-live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { syncFixtures } from '../src/server/controller.js';

function db0(){ return openDb(':memory:'); }
function fx(id, lg, daysAhead){
  const ts = Math.floor(Date.now()/1000) + daysAhead*86400;
  return { fixture:{ id, timestamp: ts, status:{ short:'NS', long:'NS', elapsed:null } },
    league:{ id: lg, season: 2025 }, teams:{ home:{ id: lg*10, name:'H' }, away:{ id: lg*10+1, name:'A' } },
    goals:{ home:null, away:null }, score:{ halftime:{} } };
}

test('syncFixtures (modo próximos): 1 req por liga ativa, usa next', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (39,'PL',1,2025)").run();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (71,'BR',1,2025)").run();
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (140,'LL',0,2025)").run(); // inativa
  const calls = [];
  const client = { async getFixtures(params){ calls.push(params); return { response: [ fx(params.league*100, params.league, 3) ] }; } };
  const r = await syncFixtures({ db, client }, {});
  assert.equal(r.leagues, 2, 'só as 2 ativas');
  assert.equal(r.spent, 2, '1 requisição por liga ativa');
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.next != null), 'usa o parâmetro next');
  assert.ok(calls.every((c) => c.league != null), 'passa league');
  // NÃO passa season: "próximos N" são da temporada vigente; season velha no banco
  // (ex.: Copa do Mundo gravada como 2022) fazia a busca voltar vazia.
  assert.ok(calls.every((c) => c.season === undefined), 'não passa season com next');
  // gravou os jogos
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fixtures').get().n, 2);
});

test('syncFixtures sem liga ativa avisa', async () => {
  const db = db0();
  const r = await syncFixtures({ db, client: {} }, {});
  assert.equal(r.synced, 0);
  assert.match(r.message, /liga ativa/i);
});

test('syncFixtures modo legado (data) ainda funciona', async () => {
  const db = db0();
  let usedDate = null;
  const client = { async getFixtures(params){ usedDate = params.date; return { response: [] }; } };
  const r = await syncFixtures({ db, client }, { date: '2026-06-01' });
  assert.equal(usedDate, '2026-06-01', 'busca a data quando fornecida');
  assert.equal(r.date, '2026-06-01');
});

test('Copa do Mundo com season velha no banco: sync traz os jogos vigentes mesmo assim', async () => {
  const db = db0();
  // a liga ficou gravada com a temporada ANTIGA (2022) — o caso real do usuário
  db.prepare("INSERT INTO leagues (id,name,active,season) VALUES (1,'World Cup',1,2022)").run();
  const client = { async getFixtures(params){
    // a API, SEM season, devolve os próximos da temporada vigente (2026)
    assert.equal(params.season, undefined, 'não restringe por season');
    return { response: [
      { fixture: { id: 5001, timestamp: Math.floor(Date.now()/1000)+3*86400, status: { short:'NS', long:'NS', elapsed:null } },
        league: { id: 1, season: 2026 },
        teams: { home: { id: 6, name: 'Brazil' }, away: { id: 31, name: 'Morocco' } },
        goals: { home: null, away: null }, score: { halftime: {} } },
    ] };
  } };
  const r = await syncFixtures({ db, client }, {});
  assert.equal(r.synced, 1, 'o jogo da Copa 2026 entrou');
  const fx = db.prepare('SELECT * FROM fixtures WHERE id = 5001').get();
  assert.equal(fx.season, 2026, 'a season do JOGO vem da resposta (2026), não do banco velho');
  assert.match(fx.home_team, /Brazil/);
});
