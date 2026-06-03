import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/db/migrate.js';
import {
  clvPercent, favoriteScoreState, loadSignals, applyFilters, summarize,
  bankrollSeries, signalTable, report,
} from '../src/services/accounting.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function db0() {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.prepare("INSERT INTO leagues (id, name, active) VALUES (39, 'Premier League', 1)").run();
  db.prepare("INSERT INTO fixtures (id, league_id, home_team, away_team, kickoff) VALUES (1, 39, 'A', 'B', 1000)").run();
  db.prepare("INSERT INTO fixtures (id, league_id, home_team, away_team, kickoff) VALUES (2, 39, 'C', 'D', 2000)").run();
  return db;
}

// insere um sinal já liquidado
function addSig(db, { id, fixtureId = 1, market = 'W2', line = 9.5, open = 2.0, close = 1.8,
  ev = 0.1, minute = 85, status = 'green', profit = 1.0, stake = 1, bookmaker = 'CasaA',
  pressure = 1.8, favorite = 'home', score = '0-1', created = 1000, settled = 1100 } = {}) {
  const ctx = JSON.stringify({ pressure, favorite, score, reasons: ['r1', 'r2', 'r3'] });
  db.prepare(`INSERT INTO signals (id, fixture_id, market, line, open_odd, close_odd, ev, minute,
              status, profit_units, result_corners, stake, bookmaker, context, created_at, settled_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, fixtureId, market, line, open, close, ev, minute, status, profit, 11, stake, bookmaker, ctx, created, settled);
}

test('clvPercent: positivo quando a entrada bate o fechamento', () => {
  assert.ok(close(clvPercent(2.0, 1.8), 2.0 / 1.8 - 1));  // +11.1%
  assert.ok(clvPercent(2.0, 1.8) > 0);
  assert.ok(clvPercent(1.8, 2.0) < 0);                     // peguei odd pior que o fechamento
  assert.equal(clvPercent(2.0, null), null);
  assert.equal(clvPercent(2.0, 1.0), null);
});

test('favoriteScoreState lê o placar sob a ótica do favorito', () => {
  assert.equal(favoriteScoreState({ favorite: 'home', score: '0-1' }), 'perdendo');
  assert.equal(favoriteScoreState({ favorite: 'home', score: '2-0' }), 'ganhando');
  assert.equal(favoriteScoreState({ favorite: 'away', score: '1-2' }), 'ganhando');
  assert.equal(favoriteScoreState({ favorite: 'home', score: '1-1' }), 'empatando');
  assert.equal(favoriteScoreState({}), 'desconhecido');
});

test('loadSignals enriquece com liga, contexto e CLV', () => {
  const db = db0();
  addSig(db, { id: 1 });
  const sigs = loadSignals(db);
  assert.equal(sigs.length, 1);
  assert.equal(sigs[0].league, 'Premier League');
  assert.equal(sigs[0].scoreState, 'perdendo');
  assert.ok(sigs[0].clv > 0);
  assert.equal(sigs[0].clvSign, 'positive');
});

test('summarize: ROI, taxa de acerto, CLV médio', () => {
  const db = db0();
  addSig(db, { id: 1, status: 'green', profit: 1.0, open: 2.0, close: 1.8 });
  addSig(db, { id: 2, status: 'red', profit: -1.0, open: 1.9, close: 2.0, fixtureId: 2 });
  const s = summarize(loadSignals(db));
  assert.equal(s.nSettled, 2);
  assert.equal(s.green, 1);
  assert.equal(s.red, 1);
  assert.ok(close(s.staked, 2));
  assert.ok(close(s.profit, 0));         // +1 -1
  assert.ok(close(s.roi, 0));
  assert.ok(close(s.hitRate, 0.5));
  assert.equal(typeof s.avgClv, 'number');
});

test('summarize: void fora da taxa de acerto, mas conta nos liquidados', () => {
  const db = db0();
  addSig(db, { id: 1, status: 'green', profit: 1 });
  addSig(db, { id: 2, status: 'void', profit: 0, fixtureId: 2 });
  const s = summarize(loadSignals(db));
  assert.equal(s.nSettled, 2);
  assert.equal(s.hitRate, 1);  // 1 green / (1 green + 0 red); void não entra
  assert.equal(s.void, 1);
});

test('AVISO de amostra pequena quando < 30 liquidados', () => {
  const db = db0();
  for (let i = 1; i <= 10; i++) {
    db.prepare("INSERT INTO fixtures (id, league_id, home_team, away_team, kickoff) VALUES (?,39,'X','Y',?)").run(100 + i, 1000 + i);
    addSig(db, { id: i, fixtureId: 100 + i });
  }
  const s = summarize(loadSignals(db));
  assert.equal(s.smallSample, true);
  assert.match(s.smallSampleNote, /amostra pequena/i);
});

test('sem aviso quando >= 30 liquidados', () => {
  const db = db0();
  for (let i = 1; i <= 30; i++) {
    db.prepare("INSERT INTO fixtures (id, league_id, home_team, away_team, kickoff) VALUES (?,39,'X','Y',?)").run(100 + i, 1000 + i);
    addSig(db, { id: i, fixtureId: 100 + i });
  }
  const s = summarize(loadSignals(db));
  assert.equal(s.smallSample, false);
  assert.equal(s.smallSampleNote, null);
});

test('filtros combináveis: mercado, status, EV, odd, minuto, CLV, placar, casa', () => {
  const db = db0();
  addSig(db, { id: 1, market: 'W2', status: 'green', ev: 0.10, open: 2.0, close: 1.8, minute: 85, score: '0-1', bookmaker: 'CasaA' });
  addSig(db, { id: 2, market: '1T', status: 'red', ev: 0.04, open: 1.6, close: 1.7, minute: 30, score: '2-0', bookmaker: 'CasaB', fixtureId: 2 });

  const all = loadSignals(db);
  assert.equal(applyFilters(all, { market: 'W2' }).length, 1);
  assert.equal(applyFilters(all, { status: 'red' }).length, 1);
  assert.equal(applyFilters(all, { evMin: 0.08 }).length, 1);
  assert.equal(applyFilters(all, { oddMin: 1.9 }).length, 1);
  assert.equal(applyFilters(all, { minuteMin: 80 }).length, 1);
  assert.equal(applyFilters(all, { clvSign: 'positive' }).length, 1);
  assert.equal(applyFilters(all, { scoreState: 'perdendo' }).length, 1);
  assert.equal(applyFilters(all, { bookmaker: 'CasaB' }).length, 1);
  // combinação que não casa com ninguém
  assert.equal(applyFilters(all, { market: 'W2', status: 'red' }).length, 0);
});

test('bankrollSeries acumula o lucro na ordem de liquidação', () => {
  const db = db0();
  db.prepare("INSERT INTO fixtures (id, league_id, home_team, away_team, kickoff) VALUES (3,39,'E','F',3000)").run();
  addSig(db, { id: 1, profit: 1.0, settled: 100 });
  addSig(db, { id: 2, profit: -1.0, settled: 200, fixtureId: 2 });
  addSig(db, { id: 3, profit: 0.9, settled: 300, fixtureId: 3 });
  const series = bankrollSeries(loadSignals(db));
  assert.deepEqual(series.map((p) => p.bankroll), [1.0, 0.0, 0.9]);
});

test('signalTable traz jogo, mercado, odds, CLV, resultado, lucro, cantos', () => {
  const db = db0();
  addSig(db, { id: 1 });
  const t = signalTable(loadSignals(db));
  assert.equal(t[0].jogo, 'A x B');
  assert.equal(t[0].mercado, 'W2');
  assert.equal(t[0].cantos, 11);
  assert.equal(typeof t[0].clv, 'number');
});

test('report junta tudo, filtrado', () => {
  const db = db0();
  addSig(db, { id: 1, market: 'W2' });
  addSig(db, { id: 2, market: '1T', fixtureId: 2 });
  const r = report(db, { market: 'W2' });
  assert.equal(r.summary.nTotal, 1);
  assert.equal(r.nUnfiltered, 2);
  assert.equal(r.table.length, 1);
});
