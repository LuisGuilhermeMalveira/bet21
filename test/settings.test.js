import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/db/migrate.js';
import * as cfg from '../src/config/settings.js';
import { coerce } from '../src/config/settings.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  return db;
}

test('coerce converte para o tipo declarado (inclui vírgula decimal e bool em pt)', () => {
  assert.equal(coerce('int', '30'), 30);
  assert.equal(coerce('float', '1,5'), 1.5);
  assert.equal(coerce('float', '0.03'), 0.03);
  assert.equal(coerce('bool', 'sim'), true);
  assert.equal(coerce('bool', 'false'), false);
  assert.equal(coerce('bool', 1), true);
  assert.equal(coerce('enum', 'poisson'), 'poisson');
});

test('get devolve o padrão quando nada foi salvo', () => {
  const db = freshDb();
  assert.equal(cfg.get(db, 'settings', 'stake_per_signal'), 1.0);
  assert.equal(cfg.get(db, 'model', 'ev_min'), 0.03);
  assert.equal(cfg.get(db, 'model', 'distribution'), 'poisson');
});

test('set grava coagido e get lê de volta o valor novo', () => {
  const db = freshDb();
  cfg.set(db, 'settings', 'stake_per_signal', '2,5'); // string da tela, vírgula
  assert.equal(cfg.get(db, 'settings', 'stake_per_signal'), 2.5);

  cfg.set(db, 'settings', 'odds_capture_enabled', 'false');
  assert.equal(cfg.get(db, 'settings', 'odds_capture_enabled'), false);

  cfg.set(db, 'model', 'distribution', 'negbin');
  assert.equal(cfg.get(db, 'model', 'distribution'), 'negbin');
});

test('reset volta ao padrão de fábrica', () => {
  const db = freshDb();
  cfg.set(db, 'model', 'ev_min', '0,10');
  assert.equal(cfg.get(db, 'model', 'ev_min'), 0.1);
  cfg.reset(db, 'model', 'ev_min');
  assert.equal(cfg.get(db, 'model', 'ev_min'), 0.03);
});

test('chave desconhecida é rejeitada (proteção contra typo)', () => {
  const db = freshDb();
  assert.throws(() => cfg.get(db, 'settings', 'nao_existe'), /desconhecida/);
  assert.throws(() => cfg.set(db, 'model', 'nao_existe', 1), /desconhecida/);
});

test('all() mescla padrão + salvo e marca isDefault corretamente', () => {
  const db = freshDb();
  cfg.set(db, 'settings', 'stake_per_signal', 3);
  const everything = cfg.all(db, 'settings');
  assert.equal(everything.stake_per_signal.value, 3);
  assert.equal(everything.stake_per_signal.isDefault, false);
  assert.equal(everything.bankroll_stop_units.isDefault, true);
  // metadados pra tela presentes
  assert.ok(everything.stake_per_signal.label);
  assert.ok(everything.stake_per_signal.help);
  assert.ok(everything.stake_per_signal.group);
});

test('modelParams() e settings() devolvem mapas coagidos completos', () => {
  const db = freshDb();
  const mp = cfg.modelParams(db);
  assert.equal(typeof mp.ev_min, 'number');
  assert.equal(mp.distribution, 'poisson');
  const s = cfg.settings(db);
  assert.equal(typeof s.window_w2_min, 'number');
  assert.equal(typeof s.odds_capture_enabled, 'boolean');
});
