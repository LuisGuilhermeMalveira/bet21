import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/db/migrate.js';
import { periodCorners, gradeOver, settleFixture, runSettle, recordClosingForSignal } from '../src/services/settle.js';

function db0() { const db = new DatabaseSync(':memory:'); migrate(db); return db; }

function addFinishedFixture(db, id, { homeId = 33, awayId = 40, htH = 2, htA = 1 } = {}) {
  db.prepare(`INSERT INTO fixtures (id, home_team_id, home_team, away_team_id, away_team, status_short,
              ht_corners_home, ht_corners_away, corner_close_odd, ht_corner_close_odd, kickoff)
              VALUES (?,?,?,?,?, 'FT', ?, ?, ?, ?, ?)`)
    .run(id, homeId, 'H', awayId, 'A', htH, htA, 1.80, 2.30, 1000);
}
function addSignal(db, fixtureId, market, line, openOdd = 2.0, stake = 1) {
  db.prepare(`INSERT INTO signals (fixture_id, market, line, open_odd, stake, status, created_at)
              VALUES (?,?,?,?,?, 'pending', 1)`).run(fixtureId, market, line, openOdd, stake);
}
function statsClient(ch, ca) {
  return { _n: 0, async getFixtureStatistics() { this._n++; return { ok: true, empty: false, response: [
    { team: { id: 33 }, statistics: [{ type: 'Corner Kicks', value: ch }] },
    { team: { id: 40 }, statistics: [{ type: 'Corner Kicks', value: ca }] },
  ] }; } };
}

test('periodCorners usa o período certo de cada mercado', () => {
  assert.equal(periodCorners('W2', { total: 11, htTotal: 4 }), 11);
  assert.equal(periodCorners('W1', { total: 11, htTotal: 4 }), 11);
  assert.equal(periodCorners('1T', { total: 11, htTotal: 4 }), 4);
  assert.equal(periodCorners('2T', { total: 11, htTotal: 4 }), 7);   // 11 - 4
  assert.equal(periodCorners('1T', { total: 11, htTotal: null }), null);
});

test('gradeOver: green/red/void e lucro correto', () => {
  assert.deepEqual(gradeOver(9.5, 11, 1, 2.0), { status: 'green', profit: 1.0 });   // 1·(2-1)
  assert.deepEqual(gradeOver(9.5, 8, 1, 2.0), { status: 'red', profit: -1 });
  assert.deepEqual(gradeOver(10, 10, 1, 2.0), { status: 'void', profit: 0 });        // push
  assert.equal(gradeOver(9.5, NaN, 1, 2.0), null);
});

test('settleFixture: liquida W2 pelo total e grava cantos/fechamento', async () => {
  const db = db0();
  addFinishedFixture(db, 100);
  addSignal(db, 100, 'W2', 9.5, 2.0);
  const r = await settleFixture({ db, client: statsClient(7, 5) }, 100); // total 12
  assert.equal(r.settled, 1);
  const sig = db.prepare('SELECT * FROM signals WHERE fixture_id=100').get();
  assert.equal(sig.status, 'green');
  assert.equal(sig.result_corners, 12);
  assert.equal(sig.profit_units, 1.0);
  assert.equal(sig.close_odd, 1.80);   // proxy do fechamento do mercado full
});

test('settleFixture: liquida 1T pelos cantos do 1º tempo (congelados)', async () => {
  const db = db0();
  // ht congelado: 3 + 2 = 5 cantos no 1º tempo
  db.prepare(`INSERT INTO fixtures (id, home_team_id, away_team_id, status_short, ht_corners_home, ht_corners_away, ht_corner_close_odd)
              VALUES (200, 33, 40, 'FT', 3, 2, 2.10)`).run();
  addSignal(db, 200, '1T', 4.5, 2.2);
  const r = await settleFixture({ db, client: statsClient(8, 6) }, 200); // total 14, mas 1T usa htTotal=5
  const sig = db.prepare('SELECT * FROM signals WHERE fixture_id=200').get();
  assert.equal(sig.result_corners, 5);
  assert.equal(sig.status, 'green'); // 5 > 4.5
  assert.equal(sig.close_odd, 2.10);
});

test('settleFixture: também grava o pacote completo em match_stats', async () => {
  const db = db0();
  addFinishedFixture(db, 300);
  addSignal(db, 300, 'W2', 9.5);
  await settleFixture({ db, client: statsClient(6, 4) }, 300);
  const n = db.prepare('SELECT COUNT(*) n FROM match_stats WHERE fixture_id=300').get().n;
  assert.equal(n, 2);
});

test('runSettle só gasta requisição quando há pendentes e jogo terminado', async () => {
  const db = db0();
  addFinishedFixture(db, 400);            // tem sinal pendente
  addSignal(db, 400, 'W2', 9.5);
  // jogo sem sinal nenhum não deve ser tocado
  addFinishedFixture(db, 401);
  const client = statsClient(7, 5);
  const totals = await runSettle({ db, client });
  assert.equal(totals.fixtures, 1);       // só o 400
  assert.equal(totals.settled, 1);
  assert.equal(client._n, 1);             // 1 requisição só
});

test('runSettle não liquida jogo ainda em andamento', async () => {
  const db = db0();
  db.prepare(`INSERT INTO fixtures (id, home_team_id, away_team_id, status_short, kickoff) VALUES (500, 33, 40, '2H', ?)`).run(Math.floor(Date.now()/1000));
  addSignal(db, 500, 'W2', 9.5);
  const client = statsClient(7, 5);
  const totals = await runSettle({ db, client });
  assert.equal(totals.settled, 0);
  assert.equal(client._n, 0);             // não gastou nada
  assert.equal(db.prepare("SELECT status FROM signals WHERE fixture_id=500").get().status, 'pending');
});

test('1T sem cantos do 1º tempo congelados → segue pendente (não chuta)', async () => {
  const db = db0();
  db.prepare(`INSERT INTO fixtures (id, home_team_id, away_team_id, status_short) VALUES (600, 33, 40, 'FT')`).run();
  addSignal(db, 600, '1T', 4.5);
  await settleFixture({ db, client: statsClient(8, 6) }, 600);
  assert.equal(db.prepare('SELECT status FROM signals WHERE fixture_id=600').get().status, 'pending');
});

test('recordClosingForSignal grava a odd de fechamento observada', () => {
  const db = db0();
  addFinishedFixture(db, 700);
  addSignal(db, 700, 'W2', 9.5, 2.0);
  const id = db.prepare('SELECT id FROM signals WHERE fixture_id=700').get().id;
  recordClosingForSignal(db, id, 1.70);
  assert.equal(db.prepare('SELECT close_odd FROM signals WHERE id=?').get(id).close_odd, 1.70);
});
