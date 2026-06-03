// Camada de configuração: lê/grava settings e parâmetros do modelo no banco,
// caindo nos padrões de defaults.js quando não há valor salvo.
//
// Valores são guardados como JSON (texto) no banco e parseados na leitura.
// A coerção de tipo usa o "type" declarado em defaults.js, pra que valores
// vindos da tela (sempre string) virem número/booleano corretamente.

import { DEFAULT_SETTINGS, DEFAULT_MODEL_PARAMS } from './defaults.js';
import { normalize } from '../db/index.js';

const TABLES = {
  settings: { table: 'app_settings', defaults: DEFAULT_SETTINGS },
  model: { table: 'model_params', defaults: DEFAULT_MODEL_PARAMS },
};

/** Coage um valor cru (string/num/bool) para o tipo declarado. */
export function coerce(type, raw) {
  switch (type) {
    case 'bool':
      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'number') return raw !== 0;
      return /^(1|true|sim|on|yes)$/i.test(String(raw).trim());
    case 'int': {
      const n = parseInt(String(raw), 10);
      return Number.isFinite(n) ? n : 0;
    }
    case 'float': {
      const n = parseFloat(String(raw).replace(',', '.'));
      return Number.isFinite(n) ? n : 0;
    }
    case 'enum':
    case 'text':
    default:
      return String(raw);
  }
}

function space(which) {
  const s = TABLES[which];
  if (!s) throw new Error(`Espaço de config desconhecido: ${which}`);
  return s;
}

/**
 * Lê um valor de config já coagido. Cai no padrão se não houver valor salvo.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {'settings'|'model'} which
 * @param {string} key
 */
export function get(db, which, key) {
  const { table, defaults } = space(which);
  const def = defaults[key];
  if (!def) throw new Error(`Chave de config desconhecida (${which}): ${key}`);
  const row = db.prepare(`SELECT value FROM ${table} WHERE key = ?`).get(key);
  if (!row || row.value == null) return def.value;
  let parsed;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    parsed = row.value;
  }
  return coerce(def.type, parsed);
}

/**
 * Grava um valor de config (coage antes de salvar). Rejeita chave desconhecida.
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function set(db, which, key, rawValue) {
  const { table, defaults } = space(which);
  const def = defaults[key];
  if (!def) throw new Error(`Chave de config desconhecida (${which}): ${key}`);
  const value = coerce(def.type, rawValue);
  db.prepare(
    `INSERT INTO ${table} (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(normalize(value)), Date.now());
  return value;
}

/**
 * Restaura uma chave ao padrão (apaga a linha salva → leitura volta ao default).
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function reset(db, which, key) {
  const { table, defaults } = space(which);
  if (!defaults[key]) throw new Error(`Chave de config desconhecida (${which}): ${key}`);
  db.prepare(`DELETE FROM ${table} WHERE key = ?`).run(key);
  return defaults[key].value;
}

/**
 * Devolve todas as configs de um espaço, mesclando padrão + salvo, com metadados
 * (label, help, recommended, group, type) — pronto pra montar a tela.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {'settings'|'model'} which
 */
export function all(db, which) {
  const { table, defaults } = space(which);
  const saved = new Map(
    db.prepare(`SELECT key, value FROM ${table}`).all().map((r) => [r.key, r.value])
  );
  const out = {};
  for (const [key, def] of Object.entries(defaults)) {
    let value = def.value;
    if (saved.has(key) && saved.get(key) != null) {
      try {
        value = coerce(def.type, JSON.parse(saved.get(key)));
      } catch {
        value = coerce(def.type, saved.get(key));
      }
    }
    out[key] = { ...def, value, isDefault: !saved.has(key) };
  }
  return out;
}

/** Lê todos os parâmetros do modelo já coagidos (atalho usado pelo modelo). */
export function modelParams(db) {
  const out = {};
  for (const key of Object.keys(DEFAULT_MODEL_PARAMS)) {
    out[key] = get(db, 'model', key);
  }
  return out;
}

/** Lê todas as settings já coagidas (atalho). */
export function settings(db) {
  const out = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    out[key] = get(db, 'settings', key);
  }
  return out;
}
