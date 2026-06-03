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
  assert.ok(calls.every((c) => c.league && c.season), 'passa league e season');
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
