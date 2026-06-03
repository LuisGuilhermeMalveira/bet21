// Migração ADITIVA do banco.
//
// Garante o seguinte, de forma segura e idempotente:
//   1. Cada tabela do schema existe (CREATE TABLE IF NOT EXISTS).
//   2. Cada coluna do schema existe; se faltar (banco criado por versão antiga),
//      adiciona com ALTER TABLE ADD COLUMN — sem apagar nem reescrever dados.
//   3. Índices/uniques existem (CREATE ... IF NOT EXISTS).
//
// Atualizar o app NUNCA pode perder dados do usuário. Esta função pode rodar
// quantas vezes quiser; só adiciona o que falta.

import { SCHEMA, createTableSql } from './schema.js';

/**
 * Lê as colunas existentes de uma tabela via PRAGMA.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} table
 * @returns {Set<string>}
 */
export function existingColumns(db, table) {
  // PRAGMA table_info não aceita parâmetro vinculado; o nome vem do schema (confiável).
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set(rows.map((r) => r.name));
}

/**
 * Aplica a migração aditiva.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{created:string[], addedColumns:Array<{table:string,column:string}>}}
 */
export function migrate(db) {
  const report = { created: [], addedColumns: [] };

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('PRAGMA journal_mode = WAL');

  for (const table of SCHEMA) {
    const existedBefore = tableExists(db, table.name);
    db.exec(createTableSql(table));
    if (!existedBefore) report.created.push(table.name);
  }

  // Agora garante colunas que possam faltar em bancos antigos.
  for (const table of SCHEMA) {
    const have = existingColumns(db, table.name);
    for (const [col, def] of Object.entries(table.columns)) {
      if (have.has(col)) continue;
      // ALTER ADD COLUMN não aceita NOT NULL sem DEFAULT nem UNIQUE/PRIMARY KEY.
      // Limpamos essas restrições mantendo tipo e DEFAULT (suficiente p/ aditivo).
      const safeDef = sanitizeAlterDef(def);
      db.exec(`ALTER TABLE ${table.name} ADD COLUMN ${col} ${safeDef}`);
      report.addedColumns.push({ table: table.name, column: col });
    }
  }

  // Índices e uniques (idempotentes).
  for (const table of SCHEMA) {
    for (const idx of table.indexes ?? []) {
      db.exec(idx.sql);
    }
  }

  return report;
}

/** Tira NOT NULL (sem default), PRIMARY KEY, UNIQUE de uma definição p/ uso em ALTER ADD COLUMN. */
export function sanitizeAlterDef(def) {
  let d = def;
  // Se houver DEFAULT, NOT NULL é permitido; senão, remove o NOT NULL.
  if (!/DEFAULT/i.test(d)) {
    d = d.replace(/\bNOT NULL\b/i, '').trim();
  }
  d = d.replace(/\bPRIMARY KEY\b/i, '').replace(/\bUNIQUE\b/i, '').replace(/\bAUTOINCREMENT\b/i, '');
  return d.replace(/\s+/g, ' ').trim();
}

/** True se a tabela já existe no banco. */
export function tableExists(db, name) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
  return !!row;
}
