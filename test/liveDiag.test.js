// Diagnóstico do tick ao vivo: registra POR QUÊ não disparou (tira do escuro).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { liveEngineTick } from '../src/services/loops.js';

function db0(){ return openDb(':memory:'); }

// captura eventos logados
function evbox(db){
  const out = [];
  const orig = db.prepare.bind(db);
  return { events: out };
}

function lastEvents(db, type){
  return db.prepare('SELECT * FROM app_events WHERE type = ? ORDER BY id DESC LIMIT 5').all(type);
}

test('engine desligado: tick não faz nada', async () => {
  const db = db0();
  const ctx = { db, engine: { running: false }, client: { async getLiveFixtures(){ return { response: [] }; } } };
  const r = await liveEngineTick(ctx, {});
  assert.equal(r.skipped, 'engine desligado');
});

test('sem jogos ao vivo no mundo: não loga ruído', async () => {
  const db = db0();
  const ctx = { db, engine: { running: true }, client: { async getLiveFixtures(){ return { response: [] }; } } };
  const r = await liveEngineTick(ctx, {});
  assert.equal(r.checked, 0);
  assert.equal(r.fired, 0);
  // não deve ter evento de "live" reclamando (sem jogos é o caso comum)
  const evs = lastEvents(db, 'live');
  assert.equal(evs.length, 0, 'sem jogos ao vivo não gera log');
});

test('jogos ao vivo mas nenhum é nosso: loga aviso', async () => {
  const db = db0();
  // jogo ao vivo de uma liga que não temos
  const ctx = { db, engine: { running: true }, client: {
    async getLiveFixtures(){ return { response: [ { fixture: { id: 999, status: { elapsed: 85 } }, goals: { home: 0, away: 0 } } ] }; },
  } };
  const r = await liveEngineTick(ctx, {});
  assert.equal(r.checked, 0, 'nenhum jogo nosso');
  const evs = lastEvents(db, 'live');
  assert.ok(evs.length >= 1, 'deve logar que há jogos no mundo mas nenhum nosso');
  assert.match(evs[0].message, /nenhum é de liga ativa/i);
});
