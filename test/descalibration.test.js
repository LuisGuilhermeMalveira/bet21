// Descalibração pré-live: de-vig, detector (over/under + âncora Pinnacle),
// gradeBet under, e o ciclo disparo → settle → contabilidade.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { impliedProb, devigPair, vigOf } from '../src/model/devig.js';
import { evaluateDescalibration, fireValueSignal, evaluateFixturesForValue } from '../src/services/descalibration.js';
import { gradeBet, sideOfMarket, periodCorners, settleFixture } from '../src/services/settle.js';
import { upsertFixture, upsertMatchStats } from '../src/services/fixturesSync.js';
import { parseFixture, parseTeamStatistics, buildMatchStatsRows } from '../src/api/statsParser.js';

function db0() { return openDb(':memory:'); }

// ---------- de-vig ----------

test('impliedProb: 1/odd, null pra odd inválida', () => {
  assert.equal(impliedProb(2.0), 0.5);
  assert.equal(impliedProb(1.0), null);
  assert.equal(impliedProb(0), null);
});

test('devigPair: remove a margem e soma 1', () => {
  const d = devigPair(1.90, 1.90);
  assert.ok(Math.abs(d.over + d.under - 1) < 1e-9);
  assert.ok(d.over === 0.5 && d.under === 0.5);
  assert.ok(d.margin > 0); // 1.90/1.90 tem margem
});

test('devigPair: lado favorito recebe prob maior', () => {
  const d = devigPair(1.50, 2.60); // over favorito
  assert.ok(d.over > d.under);
});

test('vigOf: margem em fração', () => {
  const v = vigOf(1.90, 1.90);
  assert.ok(v > 0.05 && v < 0.06);
});

// ---------- detector ----------

const PINN_OK = { corner_pinn_over_odd: 1.80, corner_pinn_under_odd: 2.05 };

test('detector: over com valor quando λ alto e Pinnacle concorda', () => {
  const fx = { corner_line: 10.5, corner_over_odd: 1.95, corner_under_odd: 1.95, corner_bookmaker: 'B365', ...PINN_OK };
  const r = evaluateDescalibration(fx, 12.5, { evMin: 0.08, edgeMin: 0.05 });
  assert.equal(r.hasValue, true);
  assert.equal(r.side, 'over');
  assert.ok(r.ev >= 0.08 && r.edge >= 0.05);
});

test('detector: bloqueia quando aposta contra a Pinnacle', () => {
  // modelo quer under (λ baixo), mas Pinnacle favorece over forte
  const fx = { corner_line: 10.5, corner_over_odd: 2.50, corner_under_odd: 1.55, corner_bookmaker: 'X',
    corner_pinn_over_odd: 1.50, corner_pinn_under_odd: 2.60 };
  const r = evaluateDescalibration(fx, 8.0, { evMin: 0.08, edgeMin: 0.05 });
  assert.equal(r.hasValue, false);
  assert.match(r.reason, /Pinnacle/);
});

test('detector: sem Pinnacle não dispara (âncora obrigatória)', () => {
  const fx = { corner_line: 10.5, corner_over_odd: 2.30, corner_under_odd: 1.62, corner_bookmaker: 'X' };
  const r = evaluateDescalibration(fx, 12.5, { evMin: 0.08, edgeMin: 0.05, requirePinnacle: true });
  assert.equal(r.hasValue, false);
  assert.match(r.reason, /Pinnacle/);
});

test('detector: sem par over/under não avalia', () => {
  const fx = { corner_line: 10.5, corner_over_odd: 1.95, corner_under_odd: null, ...PINN_OK };
  const r = evaluateDescalibration(fx, 12.5, {});
  assert.equal(r.hasValue, false);
  assert.match(r.reason, /par over\/under/);
});

test('detector: EV abaixo do corte não dispara, mas devolve motivo', () => {
  // odds quase justas → EV baixo
  const fx = { corner_line: 10.5, corner_over_odd: 1.40, corner_under_odd: 3.00, corner_bookmaker: 'X', ...PINN_OK };
  const r = evaluateDescalibration(fx, 11.0, { evMin: 0.08, edgeMin: 0.05 });
  assert.equal(r.hasValue, false);
  assert.ok(r.reason);
});

// ---------- gradeBet (under) ----------

test('gradeBet under: ganha quando saem menos cantos que a linha', () => {
  assert.equal(gradeBet('under', 10.5, 8, 1, 1.9).status, 'green');
  assert.equal(gradeBet('under', 10.5, 12, 1, 1.9).status, 'red');
});

test('gradeBet over: ganha quando saem mais', () => {
  assert.equal(gradeBet('over', 10.5, 12, 1, 1.9).status, 'green');
  assert.equal(gradeBet('over', 10.5, 8, 1, 1.9).status, 'red');
});

test('gradeBet: linha inteira batida = void', () => {
  assert.equal(gradeBet('over', 10, 10, 1, 1.9).status, 'void');
  assert.equal(gradeBet('under', 10, 10, 1, 1.9).status, 'void');
});

test('sideOfMarket e periodCorners reconhecem PL_OVER/PL_UNDER', () => {
  assert.equal(sideOfMarket('PL_OVER'), 'over');
  assert.equal(sideOfMarket('PL_UNDER'), 'under');
  assert.equal(periodCorners('PL_OVER', { total: 11 }), 11);
  assert.equal(periodCorners('PL_UNDER', { total: 11 }), 11);
});

// ---------- disparo + settle ----------

function seedValueFixture(db, { id = 800, line = 10.5, over = 1.95, under = 1.95 } = {}) {
  db.prepare("INSERT OR IGNORE INTO leagues (id,name,active) VALUES (39,'PL',1)").run();
  db.prepare(`INSERT INTO fixtures (id,league_id,home_team_id,away_team_id,home_team,away_team,kickoff,status_short,
              corner_line,corner_over_odd,corner_under_odd,corner_bookmaker,corner_pinn_over_odd,corner_pinn_under_odd,monitored)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, 39, 10, 11, 'Casa', 'Fora', Math.floor(Date.now()/1000)+3600, 'NS', line, over, under, 'B365', 1.80, 2.05, 1);
  return id;
}

test('fireValueSignal grava sinal pendente PL_OVER e não duplica', () => {
  const db = db0();
  const id = seedValueFixture(db);
  const fx = db.prepare('SELECT * FROM fixtures WHERE id=?').get(id);
  const ev = evaluateDescalibration(fx, 12.5, { evMin: 0.08, edgeMin: 0.05 });
  const r1 = fireValueSignal(db, fx, ev, { stake: 1 });
  assert.equal(r1.fired, true);
  assert.equal(r1.market, 'PL_OVER');
  const sig = db.prepare("SELECT * FROM signals WHERE fixture_id=? AND market='PL_OVER'").get(id);
  assert.ok(sig);
  assert.equal(sig.status, 'pending');
  // segunda chamada não duplica
  const r2 = fireValueSignal(db, fx, ev, { stake: 1 });
  assert.equal(r2.fired, false);
});

test('ciclo completo: dispara over pré-live, joga termina, settle marca green e calcula CLV', async () => {
  const db = db0();
  const id = seedValueFixture(db, { line: 10.5, over: 1.95 });
  // fechamento do over encurtou (1.80) → CLV positivo esperado
  db.prepare('UPDATE fixtures SET corner_close_odd = 1.80 WHERE id=?').run(id);
  const fx = db.prepare('SELECT * FROM fixtures WHERE id=?').get(id);
  const ev = evaluateDescalibration(fx, 12.5, { evMin: 0.08, edgeMin: 0.05 });
  fireValueSignal(db, fx, ev, { stake: 1 });

  // cliente falso: jogo terminou com 13 cantos (7+6) → over 10.5 = green
  const client = {
    async getFixtureStatistics() {
      return { response: [
        { team: { id: 10 }, statistics: [{ type: 'Corner Kicks', value: 7 }] },
        { team: { id: 11 }, statistics: [{ type: 'Corner Kicks', value: 6 }] },
      ] };
    },
  };
  // marca como terminado
  db.prepare("UPDATE fixtures SET status_short='FT' WHERE id=?").run(id);
  const res = await settleFixture({ db, client }, id);
  assert.ok(res.settled >= 1);
  const sig = db.prepare("SELECT * FROM signals WHERE fixture_id=? AND market='PL_OVER'").get(id);
  assert.equal(sig.status, 'green');
  assert.equal(sig.result_corners, 13);
  assert.ok(sig.profit_units > 0);
  // CLV: entrada 1.95 vs fechamento 1.80 → positivo
  assert.equal(sig.close_odd, 1.80);
});

test('ciclo under: dispara under, jogo com poucos cantos → green', async () => {
  const db = db0();
  // λ baixo + Pinnacle favorecendo under
  const id = seedValueFixture(db, { id: 801, line: 11.5, over: 2.40, under: 1.58 });
  db.prepare('UPDATE fixtures SET corner_pinn_over_odd=2.20, corner_pinn_under_odd=1.72, corner_under_close_odd=1.45 WHERE id=?').run(id);
  const fx = db.prepare('SELECT * FROM fixtures WHERE id=?').get(id);
  const ev = evaluateDescalibration(fx, 8.5, { evMin: 0.08, edgeMin: 0.05 });
  assert.equal(ev.side, 'under');
  fireValueSignal(db, fx, ev, { stake: 1 });

  const client = { async getFixtureStatistics() {
    return { response: [
      { team: { id: 10 }, statistics: [{ type: 'Corner Kicks', value: 4 }] },
      { team: { id: 11 }, statistics: [{ type: 'Corner Kicks', value: 5 }] },
    ] };
  } };
  db.prepare("UPDATE fixtures SET status_short='FT' WHERE id=?").run(id);
  await settleFixture({ db, client }, id);
  const sig = db.prepare("SELECT * FROM signals WHERE fixture_id=? AND market='PL_UNDER'").get(id);
  assert.equal(sig.status, 'green'); // 9 cantos < 11.5
  assert.equal(sig.close_odd, 1.45); // usou o fechamento do UNDER
});
