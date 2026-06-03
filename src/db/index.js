// Abertura do banco SQLite (node:sqlite, sem ORM) e helpers utilitários.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PROJECT_ROOT } from '../config/env.js';
import { migrate } from './migrate.js';

// Caminho do banco: por padrão data/corner_signals.db dentro do projeto, mas pode
// ser sobrescrito por BET21_DB_PATH (essencial em deploy, onde o disco persistente
// fica num ponto de montagem fixo, ex.: /data/corner_signals.db no Railway).
export const DEFAULT_DB_PATH = process.env.BET21_DB_PATH
  ? process.env.BET21_DB_PATH
  : join(PROJECT_ROOT, 'data', 'corner_signals.db');

/**
 * Abre (ou cria) o banco e aplica a migração aditiva.
 * @param {string} [path]  Caminho do arquivo, ou ':memory:' nos testes.
 * @returns {DatabaseSync}
 */
export function openDb(path = DEFAULT_DB_PATH) {
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(path);
  migrate(db);
  return db;
}

/**
 * SQLite não aceita `undefined`. Normaliza qualquer valor:
 *   undefined -> null; NaN -> null; booleano -> 0/1; resto inalterado.
 * (Lição da versão anterior: gravar undefined explodia silenciosamente.)
 */
export function normalize(v) {
  if (v === undefined) return null;
  if (typeof v === 'number' && Number.isNaN(v)) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

/** Normaliza um array de parâmetros para bind. */
export function normalizeAll(arr) {
  return arr.map(normalize);
}

/**
 * Grava um evento no log (alimenta o painel ao vivo).
 * @param {DatabaseSync} db
 */
export function logEvent(db, { level = 'info', type = 'generic', message = '', data = null } = {}) {
  db.prepare(
    'INSERT INTO app_events (ts, level, type, message, data) VALUES (?, ?, ?, ?, ?)'
  ).run(
    Date.now(),
    level,
    type,
    message,
    data == null ? null : JSON.stringify(data)
  );
}
