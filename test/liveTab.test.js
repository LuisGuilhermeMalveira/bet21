// Aba "Ao vivo": snapshot do engine, rota /api/live/state e render com jsdom.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openDb } from '../src/db/index.js';
import { buildLiveSnapshot, pressureSeries } from '../src/services/loops.js';
import { liveStateRoute } from '../src/server/controller.js';
import { dashboardHtml } from '../src/server/html.js';

function fx() {
  return { id: 7, home_team: 'Casa', away_team: 'Fora', league_name: 'Série A' };
}

test('pressureSeries: devolve uma série a partir de 3+ amostras', () => {
  const samples = [
    { minute: 50, corners_home: 2, corners_away: 1, shots_home: 4, shots_away: 3, shots_on_home: 1, shots_on_away: 1 },
    { minute: 60, corners_home: 3, corners_away: 1, shots_home: 6, shots_away: 4, shots_on_home: 2, shots_on_away: 1 },
    { minute: 70, corners_home: 4, corners_away: 2, shots_home: 9, shots_away: 5, shots_on_home: 4, shots_on_away: 1 },
    { minute: 80, corners_home: 6, corners_away: 2, shots_home: 13, shots_away: 6, shots_on_home: 6, shots_on_away: 2 },
  ];
  const s = pressureSeries(samples);
  assert.ok(Array.isArray(s));
  assert.ok(s.length >= 1);
  assert.ok(s.every((p) => typeof p.pressure === 'number' && typeof p.minute === 'number'));
});

test('buildLiveSnapshot: card de jogo que disparou', () => {
  const evalResult = {
    pressure: { ok: true, pressure: 1.5, rising: true },
    decisions: [
      { market: 'W2', fire: true, reason: 'valor encontrado', line: 9.5, overOdd: 1.9, prob: 0.61, ev: 0.042 },
      { market: '1T', fire: false, reason: 'fora da janela' },
    ],
  };
  const state = { minute: 81, goalsHome: 1, goalsAway: 1, cornersTotal: 9, favorite: 'home', samples: [] };
  const snap = buildLiveSnapshot(fx(), state, evalResult);
  assert.equal(snap.status, 'fired');
  assert.equal(snap.window, 'W2');
  assert.equal(snap.line, 9.5);
  assert.equal(snap.match, 'Casa x Fora');
  assert.equal(snap.minute, 81);
  assert.equal(snap.rising, true);
});

test('buildLiveSnapshot: favorito ganhando vira status block', () => {
  const evalResult = {
    pressure: { ok: true, pressure: 0.9, rising: false },
    decisions: [{ market: 'W2', fire: false, reason: 'favorito ganhando' }],
  };
  const state = { minute: 85, goalsHome: 2, goalsAway: 0, cornersTotal: 8, favorite: 'home', samples: [] };
  const snap = buildLiveSnapshot(fx(), state, evalResult);
  assert.equal(snap.status, 'block');
  assert.match(snap.statusLabel, /favorito ganhando/);
});

test('buildLiveSnapshot: fora da janela vira status wait', () => {
  const evalResult = {
    pressure: { ok: true, pressure: 1.1, rising: false },
    decisions: [{ market: 'W2', fire: false, reason: 'fora da janela' }],
  };
  const state = { minute: 67, goalsHome: 1, goalsAway: 0, cornersTotal: 7, favorite: 'home', samples: [] };
  const snap = buildLiveSnapshot(fx(), state, evalResult);
  assert.equal(snap.status, 'wait');
});

test('liveStateRoute: engine desligado → running false', () => {
  const ctx = { db: openDb(':memory:'), engine: { running: false } };
  const r = liveStateRoute(ctx);
  assert.equal(r.running, false);
  assert.equal(r.count, 0);
});

test('liveStateRoute: devolve os snapshots e põe disparados primeiro', () => {
  const liveState = new Map();
  liveState.set(1, { fixtureId: 1, status: 'wait', minute: 60, window: 'W2' });
  liveState.set(2, { fixtureId: 2, status: 'fired', minute: 81, window: 'W2' });
  const ctx = { db: openDb(':memory:'), engine: { running: true }, liveState };
  const r = liveStateRoute(ctx);
  assert.equal(r.running, true);
  assert.equal(r.count, 2);
  assert.equal(r.games[0].status, 'fired', 'disparado deve vir primeiro');
});

// ---------- render com jsdom ----------

let win;
before(() => {
  const dom = new JSDOM(dashboardHtml(), { runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.__BET21_AUTORUN__ = false; } });
  win = dom.window;
});

test('renderLive existe e mostra aviso quando engine desligado', () => {
  const B = win.Bet21;
  assert.equal(typeof B.renderLive, 'function');
  const root = win.document.createElement('div');
  B.renderLive(root, { running: false, games: [] });
  assert.match(root.innerHTML, /desligado/);
});

test('renderLive desenha cards com placar, pressão e sparkline', () => {
  const B = win.Bet21;
  const root = win.document.createElement('div');
  B.renderLive(root, {
    running: true,
    games: [{
      fixtureId: 7, match: 'Casa x Fora', league: 'Série A', minute: 83, score: '0-1',
      corners: 10, favorite: 'home', pressure: 1.4, rising: true, window: 'W2',
      status: 'watch', statusLabel: 'observando — sem EV suficiente',
      line: 11.5, overOdd: 1.9, prob: 0.57, ev: 0.021, series: [1.0, 1.1, 1.2, 1.4],
    }],
  });
  assert.match(root.innerHTML, /Casa x Fora/);
  assert.match(root.innerHTML, /0-1/);
  assert.match(root.innerHTML, /11\.5/);
  assert.ok(root.querySelector('svg'), 'deve ter o sparkline SVG');
  assert.ok(root.querySelector('.lcard'), 'deve ter um card');
});

test('renderLive: engine ligado mas sem jogos mostra mensagem amigável', () => {
  const B = win.Bet21;
  const root = win.document.createElement('div');
  B.renderLive(root, { running: true, games: [] });
  assert.match(root.innerHTML, /nenhum jogo monitorado/i);
});
