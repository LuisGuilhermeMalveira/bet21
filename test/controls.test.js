// Recursos: parar backfill, excluir sinal, manter aba no F5 (hash).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openDb } from '../src/db/index.js';
import { cancelBackfillRoute, deleteSignalRoute } from '../src/server/controller.js';
import { runBackfill } from '../src/services/backfill.js';
import { recordSignal } from '../src/services/liveEngine.js';
import { dashboardHtml } from '../src/server/html.js';

function db0() { return openDb(':memory:'); }

// ---------- cancelar backfill ----------

test('cancelBackfillRoute: sem backfill rodando avisa', () => {
  const r = cancelBackfillRoute({ db: db0(), _backfillRunning: false });
  assert.equal(r.canceled, false);
});

test('cancelBackfillRoute: marca a flag quando rodando', () => {
  const ctx = { db: db0(), _backfillRunning: true };
  const r = cancelBackfillRoute(ctx);
  assert.equal(r.canceled, true);
  assert.equal(ctx._backfillCancel, true);
});

test('runBackfill respeita o cancelamento e para no meio', async () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active) VALUES (39,'L',1)").run();
  // 3 times "faltando" (via league_teams pra não depender de fixtures)
  db.prepare("INSERT INTO league_teams (league_id,team_id,team_name) VALUES (39,1,'A'),(39,2,'B'),(39,3,'C')").run();
  let calls = 0;
  const ctx = {
    db, _backfillCancel: false,
    client: {
      async getTeamLastFixtures() { calls++; ctx._backfillCancel = true; return { response: [] }; }, // cancela após o 1º
      async getFixtureStatistics() { return { response: [] }; },
    },
  };
  const totals = await runBackfill(ctx, { minGames: 20, cap: 100, force: true });
  assert.equal(totals.canceled, true);
  assert.equal(calls, 1, 'parou após o primeiro time');
  assert.ok(totals.teams <= 1);
});

// ---------- excluir sinal ----------

test('deleteSignalRoute: id inválido → erro', () => {
  const r = deleteSignalRoute({ db: db0() }, { id: 'xx' });
  assert.match(r.error, /inválido/);
});

test('deleteSignalRoute: remove o sinal do banco', () => {
  const db = db0();
  db.prepare("INSERT INTO leagues (id,name,active) VALUES (39,'L',1)").run();
  db.prepare("INSERT INTO fixtures (id,league_id,home_team_id,away_team_id,home_team,away_team) VALUES (10,39,1,2,'A','B')").run();
  recordSignal(db, 10, { market: 'PL_OVER', line: 9.5, overOdd: 1.9, prob: 0.6, ev: 0.1 }, { stake: 1 });
  const sig = db.prepare("SELECT id FROM signals WHERE fixture_id=10").get();
  assert.ok(sig);
  const r = deleteSignalRoute({ db }, { id: sig.id });
  assert.equal(r.deleted, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM signals').get().n, 0);
});

test('deleteSignalRoute: id inexistente não quebra', () => {
  const r = deleteSignalRoute({ db: db0() }, { id: 99999 });
  assert.equal(r.deleted, false);
});

// ---------- persistência da aba (hash) ----------

test('renderSignals tem botão de excluir por linha', () => {
  const dom = new JSDOM(dashboardHtml(), { runScripts: 'dangerously', pretendToBeVisual: true });
  const B = dom.window.Bet21;
  const root = dom.window.document.createElement('div');
  B.renderSignals(root, { summary: {}, table: [
    { id: 7, jogo: 'A x B', mercado: 'PL_OVER', linha: 9.5, oddEntrada: 1.9, clv: null, resultado: 'pending', lucro: null, cantos: null },
  ] }, 'pending');
  assert.ok(root.querySelector('[data-del-signal="7"]'), 'deve ter o botão excluir com o id');
});

test('switchTab grava o hash e _validTab valida', () => {
  const dom = new JSDOM(dashboardHtml(), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/' });
  const B = dom.window.Bet21;
  assert.equal(B._validTab('sinais'), true);
  assert.equal(B._validTab('inexistente'), false);
  B.switchTab('sinais');
  assert.equal(dom.window.location.hash, '#sinais');
});
