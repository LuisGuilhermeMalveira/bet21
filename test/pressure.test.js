import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePressure } from '../src/model/pressure.js';

// Gera amostras cumulativas com taxa constante de cada métrica por minuto.
function steady(nMin, perMin = { shots_on: 0.2, dangerous: 1, corners: 0.15, shots: 0.4 }) {
  const out = [];
  for (let m = 1; m <= nMin; m++) {
    out.push({
      minute: m,
      shots_on_home: m * perMin.shots_on, shots_on_away: 0,
      dangerous_home: m * perMin.dangerous, dangerous_away: 0,
      corners_home: m * perMin.corners, corners_away: 0,
      shots_home: m * perMin.shots, shots_away: 0,
    });
  }
  return out;
}

test('amostras vazias/insuficientes → pressão 1, rising false, ok=false', () => {
  assert.deepEqual(computePressure([]), { pressure: 1, rising: false, components: null, ok: false });
  assert.equal(computePressure([{ minute: 10 }]).ok, false);
});

test('ritmo recente = ritmo médio → pressão ~1 e rising false', () => {
  const r = computePressure(steady(60), { windowMin: 15 });
  assert.ok(Math.abs(r.pressure - 1) < 1e-6, `pressão ${r.pressure}`);
  assert.equal(r.rising, false);
});

test('acelerar no fim → pressão > 1 e rising true', () => {
  // 40 min calmos, depois 20 min muito intensos
  const calm = steady(40, { shots_on: 0.1, dangerous: 0.5, corners: 0.1, shots: 0.2 });
  const last = calm[calm.length - 1];
  const hot = [];
  for (let i = 1; i <= 20; i++) {
    hot.push({
      minute: 40 + i,
      shots_on_home: last.shots_on_home + i * 0.6,
      shots_on_away: 0,
      dangerous_home: last.dangerous_home + i * 3,
      dangerous_away: 0,
      corners_home: last.corners_home + i * 0.5,
      corners_away: 0,
      shots_home: last.shots_home + i * 1.2,
      shots_away: 0,
    });
  }
  const r = computePressure([...calm, ...hot], { windowMin: 15 });
  assert.ok(r.pressure > 1.2, `esperava pressão alta, veio ${r.pressure}`);
  assert.equal(r.rising, true);
});

test('clamp limita a pressão ao teto', () => {
  // explosão absurda no fim
  const base = steady(50, { shots_on: 0.05, dangerous: 0.2, corners: 0.05, shots: 0.1 });
  const last = base[base.length - 1];
  const boom = [];
  for (let i = 1; i <= 10; i++) {
    boom.push({
      minute: 50 + i,
      shots_on_home: last.shots_on_home + i * 5,
      dangerous_home: last.dangerous_home + i * 20,
      corners_home: last.corners_home + i * 4,
      shots_home: last.shots_home + i * 10,
      shots_on_away: 0, dangerous_away: 0, corners_away: 0, shots_away: 0,
    });
  }
  const r = computePressure([...base, ...boom], { windowMin: 10, clampMax: 2.0 });
  assert.ok(r.pressure <= 2.0 + 1e-9);
  assert.equal(r.pressure, 2.0);
});

test('pesos customizados são respeitados', () => {
  // só cantos aceleram; com peso 100% em cantos a pressão sobe, com 0% não.
  const calm = steady(40, { shots_on: 0.2, dangerous: 1, corners: 0.1, shots: 0.4 });
  const last = calm[calm.length - 1];
  const hot = [];
  for (let i = 1; i <= 20; i++) {
    hot.push({
      minute: 40 + i,
      shots_on_home: last.shots_on_home + i * 0.2,   // mesmo ritmo
      dangerous_home: last.dangerous_home + i * 1,
      corners_home: last.corners_home + i * 0.8,     // cantos disparam
      shots_home: last.shots_home + i * 0.4,
      shots_on_away: 0, dangerous_away: 0, corners_away: 0, shots_away: 0,
    });
  }
  const samples = [...calm, ...hot];
  const onlyCorners = computePressure(samples, { windowMin: 15, weights: { shots_on: 0, dangerous: 0, corners: 1, shots: 0 } });
  const noCorners = computePressure(samples, { windowMin: 15, weights: { shots_on: 0.5, dangerous: 0.5, corners: 0, shots: 0 } });
  assert.ok(onlyCorners.pressure > noCorners.pressure);
  assert.ok(onlyCorners.pressure > 1.3);
  assert.ok(Math.abs(noCorners.pressure - 1) < 0.05);
});
