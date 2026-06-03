// Subir com o Windows (opcional). Escreve um .bat na pasta "Inicializar" do
// usuário que sobe o dashboard no logon. Best-effort: no-op fora do Windows,
// e qualquer erro é devolvido (nunca lança).

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../config/env.js';

const BAT_NAME = 'Bet21.bat';

/** Pasta "Startup" do usuário no Windows (ou null em outros SOs). */
export function startupDir() {
  if (process.platform !== 'win32') return null;
  const appData = process.env.APPDATA;
  if (!appData) return null;
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

function batContents() {
  // start "" /min  → abre minimizado; /d define o diretório de trabalho.
  return [
    '@echo off',
    `cd /d "${PROJECT_ROOT}"`,
    'start "" /min cmd /c "npm run dashboard"',
  ].join('\r\n') + '\r\n';
}

/** Liga o autostart (cria o .bat). Devolve {ok, path?, skipped?, error?}. */
export function enableAutostart() {
  try {
    const dir = startupDir();
    if (!dir) return { ok: false, skipped: 'autostart só no Windows' };
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = join(dir, BAT_NAME);
    writeFileSync(path, batContents(), 'utf8');
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Desliga o autostart (remove o .bat). */
export function disableAutostart() {
  try {
    const dir = startupDir();
    if (!dir) return { ok: false, skipped: 'autostart só no Windows' };
    const path = join(dir, BAT_NAME);
    if (existsSync(path)) unlinkSync(path);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Aplica a config start_with_windows (chamado no boot do dashboard). */
export function syncAutostart(enabled) {
  return enabled ? enableAutostart() : disableAutostart();
}
