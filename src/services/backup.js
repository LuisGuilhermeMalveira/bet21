// Backup do banco: cópia datada do arquivo SQLite, mantendo só os N mais recentes.
// Best-effort — nunca derruba o app. O histórico e os sinais são valiosos.

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { DEFAULT_DB_PATH } from '../db/index.js';

function stamp(now) {
  const d = now instanceof Date ? now : new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const RX = /^corner_signals-\d{8}-\d{6}\.db$/;

/**
 * Faz um backup datado e poda os mais antigos.
 * @param {{dbPath?:string, dir?:string, keep?:number, now?:number|Date}} [opts]
 * @returns {{ok:boolean, file?:string, removed?:number, skipped?:string, error?:string}}
 */
export function backupDb({ dbPath = DEFAULT_DB_PATH, dir, keep = 20, now = new Date() } = {}) {
  try {
    if (dbPath !== ':memory:' && !existsSync(dbPath)) {
      return { ok: false, skipped: 'banco ainda não existe' };
    }
    const backupsDir = dir || join(dirname(dbPath), 'backups');
    if (!existsSync(backupsDir)) mkdirSync(backupsDir, { recursive: true });

    const dest = join(backupsDir, `corner_signals-${stamp(now)}.db`);
    copyFileSync(dbPath, dest);

    // Poda: mantém os `keep` mais recentes (por data de modificação).
    let removed = 0;
    const files = readdirSync(backupsDir)
      .filter((f) => RX.test(f))
      .map((f) => ({ f, t: statSync(join(backupsDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const x of files.slice(Math.max(1, keep))) {
      try { unlinkSync(join(backupsDir, x.f)); removed++; } catch { /* ignora */ }
    }
    return { ok: true, file: dest, removed };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
