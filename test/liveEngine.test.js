import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/db/migrate.js';
import { settings as cfgSettings, modelParams } from '../src/config/settings.js';
import {
  evaluateLiveFixture, favoriteWinning, hasSignal, bankrollStopHit,
  recordSignal, processDecisions,
} from '../src/services/liveEngine.js';

function cfg() {
  const db = new DatabaseSync(':memory:'); migrate(db);
  return { db, c: { settings: cfgSettings(db), model: modelParams(db) } };
}

// Amostras ao vivo que ACELERAM no fim (garante pressão subindo p/ W2).
function risingSamples(toMin = 85) {
  const out = [];
  for (let m = 1; m <= 60; m++) {
    out.push({ minute: m, shots_on_home: m * 0.1, dangerous_home: m * 0.5, corners_home: m * 0.08, shots_home: m * 0.2, shots_on_away: 0, dangerous_away: 0, corners_away: 0, shots_away: 0 });
  }
  const last = out[out.length - 1];
  for (let i = 1; i <= toMin - 60; i++) {
    out.push({
      minute: 60 + i,
      shots_on_home: last.shots_on_home + i * 0.5,
      dangerous_home: last.dangerous_home + i * 3,
      corners_home: last.corners_home + i * 0.4,
      shots_home: last.shots_home + i * 1.2,
      shots_on_away: 0, dangerous_away: 0, corners_away: 0, shots_away: 0,
    });
  }
  return out;
}

const W2_STATE = {
  minute: 85, cornersTotal: 9, htCornersTotal: 4,
  goalsHome: 0, goalsAway: 1,        // favorito (home) NÃO ganhando
  favorite: 'home', lambdaPregame: 11,
  samples: risingSamples(85),
  fullLines: [{ line: 9.5, overOdd: 2.0, bookmaker: 'CasaA' }, { line: 10.5, overOdd: 3.2, bookmaker: 'CasaB' }],
  htLines: [],
};

test('favoriteWinning identifica corretamente', () => {
  assert.equal(favoriteWinning('home', 2, 1), true);
  assert.equal(favoriteWinning('home', 0, 1), false);
  assert.equal(favoriteWinning('away', 0, 2), true);
  assert.equal(favoriteWinning(null, 3, 0), false);
});

test('W2 DISPARA com favorito não-ganhando, pressão subindo e EV positivo', () => {
  const { c } = cfg();
  const r = evaluateLiveFixture(W2_STATE, c);
  const w2 = r.decisions.find((d) => d.market === 'W2');
  assert.equal(w2.fire, true, `motivo: ${w2.reason}`);
  assert.ok(w2.line >= 9.5);
  assert.ok(w2.ev >= c.model.ev_min);
  assert.ok(w2.context.reasons.length >= 3);
});

test('NÃO dispara W2 se o favorito está ganhando', () => {
  const { c } = cfg();
  const r = evaluateLiveFixture({ ...W2_STATE, goalsHome: 2, goalsAway: 0 }, c);
  const w2 = r.decisions.find((d) => d.market === 'W2');
  assert.equal(w2.fire, false);
  assert.equal(w2.reason, 'favorito ganhando');
});

test('NÃO dispara fora da janela de minutos', () => {
  const { c } = cfg();
  const r = evaluateLiveFixture({ ...W2_STATE, minute: 60 }, c);
  const w2 = r.decisions.find((d) => d.market === 'W2');
  assert.equal(w2.fire, false);
  assert.equal(w2.reason, 'fora da janela');
});

test('NÃO dispara sem dados ao vivo (regra de dados faltantes)', () => {
  const { c } = cfg();
  const r = evaluateLiveFixture({ ...W2_STATE, samples: [] }, c);
  const w2 = r.decisions.find((d) => d.market === 'W2');
  assert.equal(w2.fire, false);
  assert.equal(w2.reason, 'dados ao vivo insuficientes');
});

test('NÃO dispara sem odds, sem λ, ou sem contagem de cantos', () => {
  const { c } = cfg();
  assert.equal(evaluateLiveFixture({ ...W2_STATE, fullLines: [] }, c).decisions.find(d => d.market === 'W2').reason, 'sem odds');
  assert.equal(evaluateLiveFixture({ ...W2_STATE, lambdaPregame: null }, c).decisions.find(d => d.market === 'W2').reason, 'sem λ pré-jogo');
  assert.equal(evaluateLiveFixture({ ...W2_STATE, cornersTotal: null }, c).decisions.find(d => d.market === 'W2').reason, 'sem contagem de cantos');
});

test('NÃO dispara W2 quando a pressão não está subindo', () => {
  const { c } = cfg();
  // amostras de ritmo constante → rising false
  const steady = [];
  for (let m = 1; m <= 85; m++) steady.push({ minute: m, shots_on_home: m * 0.2, dangerous_home: m * 1, corners_home: m * 0.1, shots_home: m * 0.4, shots_on_away: 0, dangerous_away: 0, corners_away: 0, shots_away: 0 });
  const r = evaluateLiveFixture({ ...W2_STATE, samples: steady }, c);
  const w2 = r.decisions.find((d) => d.market === 'W2');
  assert.equal(w2.fire, false);
  assert.equal(w2.reason, 'pressão não está subindo');
});

test('NÃO dispara quando nenhuma linha bate os cortes de EV/prob', () => {
  const { c } = cfg();
  // odds baixíssimas → EV negativo
  const r = evaluateLiveFixture({ ...W2_STATE, fullLines: [{ line: 9.5, overOdd: 1.05, bookmaker: 'X' }] }, c);
  const w2 = r.decisions.find((d) => d.market === 'W2');
  assert.equal(w2.fire, false);
  assert.equal(w2.reason, 'sem linha com EV/prob suficientes');
});

test('1T avalia na sua janela usando linhas e cantos do 1º tempo', () => {
  const { c } = cfg();
  const state = {
    minute: 35, cornersTotal: 5, htCornersTotal: 5,
    goalsHome: 0, goalsAway: 0, favorite: 'home', lambdaPregame: 11,
    samples: risingSamples(35).length >= 2 ? (() => { const s = []; for (let m = 1; m <= 35; m++) s.push({ minute: m, shots_on_home: m * 0.15, dangerous_home: m * 0.8, corners_home: m * 0.18, shots_home: m * 0.3, shots_on_away: 0, dangerous_away: 0, corners_away: 0, shots_away: 0 }); return s; })() : [],
    fullLines: [], htLines: [{ line: 5.5, overOdd: 2.2, bookmaker: 'CasaH' }, { line: 6.5, overOdd: 3.5, bookmaker: 'CasaH' }],
  };
  const r = evaluateLiveFixture(state, c);
  const t1 = r.decisions.find((d) => d.market === '1T');
  // não exige rising; deve ao menos avaliar a janela (disparar ou recusar por EV), não "fora da janela"
  assert.notEqual(t1.reason, 'fora da janela');
});

test('W1 e 2T vêm DESLIGADAS por padrão', () => {
  const { c } = cfg();
  const r = evaluateLiveFixture({ ...W2_STATE, minute: 45 }, c);
  assert.equal(r.decisions.find((d) => d.market === 'W1').reason, 'janela desligada');
  assert.equal(r.decisions.find((d) => d.market === '2T').reason, 'janela desligada');
});

test('processDecisions grava o sinal e respeita ANTI-REPETIÇÃO', () => {
  const { db, c } = cfg();
  db.prepare('INSERT INTO fixtures (id, home_team, away_team) VALUES (700, ?, ?)').run('A', 'B');
  const evalR = evaluateLiveFixture({ ...W2_STATE }, c);
  const out1 = processDecisions(db, 700, evalR, c);
  const w2a = out1.find((d) => d.market === 'W2');
  assert.equal(w2a.fired, true);
  assert.equal(hasSignal(db, 700, 'W2'), true);

  // segunda avaliação no mesmo jogo/mercado → não grava de novo
  const out2 = processDecisions(db, 700, evaluateLiveFixture({ ...W2_STATE }, c), c);
  const w2b = out2.find((d) => d.market === 'W2');
  assert.equal(w2b.fired, false);
  assert.match(w2b.note, /anti-repeti/i);
  const n = db.prepare('SELECT COUNT(*) n FROM signals WHERE fixture_id=700 AND market=?').get('W2').n;
  assert.equal(n, 1);
});

test('STOP de banca bloqueia novos disparos', () => {
  const { db, c } = cfg();
  db.prepare('INSERT INTO fixtures (id, home_team, away_team) VALUES (701, ?, ?)').run('A', 'B');
  // injeta prejuízo acumulado além do stop padrão (20u)
  db.prepare("INSERT INTO signals (fixture_id, market, status, profit_units) VALUES (999, 'W2', 'red', -25)").run();
  assert.equal(bankrollStopHit(db, c.settings), true);
  const out = processDecisions(db, 701, evaluateLiveFixture({ ...W2_STATE }, c), c);
  const w2 = out.find((d) => d.market === 'W2');
  assert.equal(w2.fired, false);
  assert.match(w2.note, /stop de banca/i);
});

test('recordSignal guarda o contexto do disparo (rastreabilidade)', () => {
  const { db, c } = cfg();
  db.prepare('INSERT INTO fixtures (id, home_team, away_team) VALUES (702, ?, ?)').run('A', 'B');
  const evalR = evaluateLiveFixture({ ...W2_STATE }, c);
  processDecisions(db, 702, evalR, c);
  const row = db.prepare('SELECT context, line, ev, model_prob FROM signals WHERE fixture_id=702').get();
  const ctx = JSON.parse(row.context);
  assert.ok(ctx.reasons && ctx.reasons.length >= 3);
  assert.ok('pressure' in ctx && 'lambdaRemaining' in ctx && 'needed' in ctx);
  assert.ok(Number.isFinite(row.line));
});
