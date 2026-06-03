// Leitor de .env nativo — zero dependências.
// Só usamos .env para SEGREDOS (chave da API, tokens do Telegram).
// Tudo o mais é configurado na tela e fica no banco.
//
// Importante (lição da versão anterior): NÃO depender de variável de ambiente
// de sessão do terminal, que some ao trocar de janela do PowerShell. Por isso
// lemos de um ARQUIVO .env, não do ambiente do shell.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, '..', '..');

/**
 * Faz o parse do conteúdo de um .env em objeto. Ignora comentários e linhas vazias,
 * remove aspas simples/duplas ao redor do valor.
 * @param {string} text
 * @returns {Record<string,string>}
 */
export function parseEnv(text) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Lê o arquivo .env do projeto (se existir). Não sobrescreve o que já existe
 * em process.env (variáveis reais do sistema têm prioridade).
 * @param {string} [envPath]
 * @returns {Record<string,string>}
 */
export function loadEnv(envPath = join(PROJECT_ROOT, '.env')) {
  if (!existsSync(envPath)) return {};
  const parsed = parseEnv(readFileSync(envPath, 'utf8'));
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return parsed;
}

/** Atalhos pros segredos, já com fallback pra string vazia. */
export function getSecrets() {
  loadEnv();
  return {
    apiKey: process.env.APIFOOTBALL_KEY || '',
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    port: Number(process.env.PORT) || 21321,
  };
}
