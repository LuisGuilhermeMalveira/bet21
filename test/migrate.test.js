import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, existingColumns, sanitizeAlterDef, tableExists } from '../src/db/migrate.js';
import { SCHEMA } from '../src/db/schema.js';

test('migração cria todas as tabelas do schema num banco novo', () => {
  const db = new DatabaseSync(':memory:');
  const report = migrate(db);
  for (const t of SCHEMA) {
    assert.ok(tableExists(db, t.name), `tabela ${t.name} deveria existir`);
  }
  assert.deepEqual(
    report.created.sort(),
    SCHEMA.map((t) => t.name).sort()
  );
});

test('migração é idempotente (rodar duas vezes não altera nada nem dá erro)', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const second = migrate(db);
  assert.equal(second.created.length, 0);
  assert.equal(second.addedColumns.length, 0);
});

test('migração é ADITIVA: adiciona colunas que faltam sem apagar dados', () => {
  const db = new DatabaseSync(':memory:');
  // Simula um banco criado por versão ANTIGA: tabela leagues só com id e name.
  db.exec('CREATE TABLE leagues (id INTEGER PRIMARY KEY, name TEXT)');
  db.prepare('INSERT INTO leagues (id, name) VALUES (?, ?)').run(39, 'Premier League');

  const report = migrate(db);

  // Os dados antigos continuam lá.
  const row = db.prepare('SELECT * FROM leagues WHERE id = 39').get();
  assert.equal(row.name, 'Premier League');

  // E as colunas novas do schema apareceram.
  const cols = existingColumns(db, 'leagues');
  for (const col of Object.keys(SCHEMA.find((t) => t.name === 'leagues').columns)) {
    assert.ok(cols.has(col), `coluna ${col} deveria ter sido adicionada`);
  }
  // Coluna com NOT NULL DEFAULT 0 deve assumir o default na linha existente.
  assert.equal(row.active === undefined ? 0 : row.active, 0);
  assert.ok(report.addedColumns.some((c) => c.table === 'leagues' && c.column === 'active'));
});

test('índices únicos garantem anti-repetição em signals e unicidade em match_stats', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);

  db.prepare('INSERT INTO signals (fixture_id, market, status) VALUES (?, ?, ?)').run(100, 'W2', 'pending');
  assert.throws(
    () => db.prepare('INSERT INTO signals (fixture_id, market, status) VALUES (?, ?, ?)').run(100, 'W2', 'pending'),
    /UNIQUE/i,
    'não pode haver dois sinais W2 pro mesmo jogo'
  );
  // Mercado diferente no mesmo jogo é permitido.
  db.prepare('INSERT INTO signals (fixture_id, market, status) VALUES (?, ?, ?)').run(100, '1T', 'pending');

  db.prepare('INSERT INTO match_stats (fixture_id, team_id) VALUES (?, ?)').run(5, 33);
  assert.throws(
    () => db.prepare('INSERT INTO match_stats (fixture_id, team_id) VALUES (?, ?)').run(5, 33),
    /UNIQUE/i
  );
});

test('sanitizeAlterDef remove restrições incompatíveis com ALTER ADD COLUMN', () => {
  assert.equal(sanitizeAlterDef('INTEGER PRIMARY KEY AUTOINCREMENT'), 'INTEGER');
  assert.equal(sanitizeAlterDef('TEXT UNIQUE'), 'TEXT');
  // NOT NULL sem default é removido (ALTER não permite); com default é mantido.
  assert.equal(sanitizeAlterDef('INTEGER NOT NULL'), 'INTEGER');
  assert.equal(sanitizeAlterDef('INTEGER NOT NULL DEFAULT 0'), 'INTEGER NOT NULL DEFAULT 0');
  assert.equal(sanitizeAlterDef("TEXT NOT NULL DEFAULT 'pending'"), "TEXT NOT NULL DEFAULT 'pending'");
});
