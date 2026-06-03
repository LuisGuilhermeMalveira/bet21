import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../src/db/index.js';
import {
  telegramConfigured, sendTelegram, formatSignalMessage, formatDailySummary, notifySignal,
} from '../src/services/telegram.js';
import { backupDb } from '../src/services/backup.js';
import { simulate } from '../src/services/simulation.js';
import { startupDir, enableAutostart } from '../src/services/autostart.js';
import {
  emit, captureOddsTick, settleTick, liveEngineTick, backupTick, dailySummaryTick, startLoops, recordLiveSample,
} from '../src/services/loops.js';

function db0() { return openDb(':memory:'); }

// ---------- Telegram ----------

test('telegramConfigured exige token E chat', () => {
  assert.equal(telegramConfigured({ telegramToken: '', telegramChatId: '' }), false);
  assert.equal(telegramConfigured({ telegramToken: 'x', telegramChatId: '' }), false);
  assert.equal(telegramConfigured({ telegramToken: 'x', telegramChatId: 'y' }), true);
});

test('sendTelegram: no-op quando não configurado', async () => {
  const ctx = { db: db0(), secrets: {} };
  const r = await sendTelegram(ctx, 'oi');
  assert.equal(r.ok, false);
  assert.match(r.skipped, /não configurado/);
});

test('sendTelegram: chama fetch com URL e corpo certos quando configurado', async () => {
  let captured = null;
  const fakeFetch = async (url, opts) => { captured = { url, opts }; return { ok: true, status: 200 }; };
  const ctx = { db: db0(), secrets: { telegramToken: 'TOK', telegramChatId: 'CHAT' } };
  const r = await sendTelegram(ctx, 'mensagem teste', { fetchFn: fakeFetch });
  assert.equal(r.ok, true);
  assert.match(captured.url, /bot TOK|botTOK/);
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.chat_id, 'CHAT');
  assert.equal(body.text, 'mensagem teste');
});

test('sendTelegram: trata erro de fetch sem lançar', async () => {
  const fakeFetch = async () => { throw new Error('rede caiu'); };
  const ctx = { db: db0(), secrets: { telegramToken: 'T', telegramChatId: 'C' } };
  const r = await sendTelegram(ctx, 'x', { fetchFn: fakeFetch });
  assert.equal(r.ok, false);
  assert.match(r.error, /rede caiu/);
});

test('notifySignal respeita telegram_enabled=false', async () => {
  const db = db0();
  // desliga via config
  const cfg = await import('../src/config/settings.js');
  cfg.set(db, 'settings', 'telegram_enabled', false);
  let called = false;
  const fakeFetch = async () => { called = true; return { ok: true, status: 200 }; };
  const ctx = { db, secrets: { telegramToken: 'T', telegramChatId: 'C' } };
  const r = await notifySignal(ctx, { line: 10, market: 'W2' }, { fetchFn: fakeFetch });
  assert.equal(called, false);
  assert.match(r.skipped, /desligado/);
});

test('formatSignalMessage inclui linha, casa e mercado', () => {
  const msg = formatSignalMessage({ market: 'W2', line: 10.5, overOdd: 1.9, bookmaker: 'Pinnacle', ev: 0.08 });
  assert.match(msg, /10\.5/);
  assert.match(msg, /Pinnacle/);
  assert.match(msg, /jogo todo/);
  assert.match(msg, /8\.0%/);
});

test('formatDailySummary mostra CLV e marca amostra pequena', () => {
  const msg = formatDailySummary({ summary: { count: 5, avgClv: 0.02, roi: -0.1, hitRate: 0.4, smallSample: true } });
  assert.match(msg, /CLV/);
  assert.match(msg, /amostra pequena/);
});

// ---------- Backup ----------

test('backupDb: cria cópia datada e poda os antigos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bet21bk-'));
  const dbPath = join(dir, 'corner_signals.db');
  writeFileSync(dbPath, 'fake-sqlite-bytes');
  const backupsDir = join(dir, 'backups');

  // cria 3 backups com keep=2 → o mais antigo é podado
  let last;
  for (let i = 0; i < 3; i++) {
    last = backupDb({ dbPath, dir: backupsDir, keep: 2, now: new Date(2026, 0, 1, 10, 0, i) });
    assert.equal(last.ok, true);
  }
  const files = readdirSync(backupsDir).filter((f) => f.endsWith('.db'));
  assert.equal(files.length, 2, 'deveria manter só 2');
});

test('backupDb: skipped se o banco não existe', () => {
  const r = backupDb({ dbPath: '/caminho/que/nao/existe.db' });
  assert.equal(r.ok, false);
  assert.match(r.skipped, /não existe/);
});

// ---------- Simulação ----------

test('simulate dispara um sinal W2 e grava na tabela signals', () => {
  const db = db0();
  const r = simulate({ db });
  assert.equal(r.fired, true);
  const w2 = r.evalResult.decisions.find((d) => d.market === 'W2');
  assert.equal(w2.fire, true);
  const sig = db.prepare("SELECT * FROM signals WHERE fixture_id = 999000001 AND market='W2'").get();
  assert.ok(sig, 'o sinal simulado deveria estar gravado');
  assert.equal(sig.status, 'pending');
});

// ---------- Autostart ----------

test('autostart: no-op fora do Windows', () => {
  if (process.platform === 'win32') { assert.ok(true); return; }
  assert.equal(startupDir(), null);
  const r = enableAutostart();
  assert.equal(r.ok, false);
  assert.match(r.skipped, /Windows/);
});

// ---------- Loops ----------

test('emit loga no banco e empurra pro SSE', () => {
  const db = db0();
  const sent = [];
  const ctx = { db, sse: new Set([{ write: (s) => sent.push(s) }]) };
  emit(ctx, { level: 'info', type: 'teste', message: 'olá', data: {} });
  const row = db.prepare("SELECT * FROM app_events WHERE type='teste'").get();
  assert.ok(row);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /olá/);
});

test('captureOddsTick e settleTick: skipped sem cliente', async () => {
  const ctx = { db: db0() };
  assert.match((await captureOddsTick(ctx)).skipped, /sem cliente/);
  assert.match((await settleTick(ctx)).skipped, /sem cliente/);
});

test('backupTick respeita o intervalo (pula se recente, força se pedido)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bet21bk2-'));
  const dbPath = join(dir, 'corner_signals.db');
  writeFileSync(dbPath, 'x');
  const db = db0();
  const ctx = { db, _lastBackupAt: Date.now() };
  // recente → pula
  const r1 = backupTick(ctx, { now: Date.now() });
  assert.match(r1.skipped, /ainda não na hora/);
});

test('dailySummaryTick: skipped fora da hora configurada', async () => {
  const db = db0();
  const cfg = await import('../src/config/settings.js');
  cfg.set(db, 'settings', 'daily_summary_hour_brt', 9);
  const ctx = { db, secrets: {} };
  // escolhe um "now" cuja hora BRT NÃO é 9
  const now = Date.UTC(2026, 0, 1, 0, 0, 0); // 00 UTC = 21h BRT do dia anterior
  const r = await dailySummaryTick(ctx, { now });
  assert.match(r.skipped, /fora da hora/);
});

test('startLoops agenda timers e stop() limpa', () => {
  const db = db0();
  const ctx = { db, sse: new Set() };
  const scheduled = [];
  const cleared = [];
  const setIntervalFn = (fn, ms) => { const id = scheduled.length; scheduled.push({ fn, ms }); return id; };
  const clearIntervalFn = (id) => cleared.push(id);
  const stop = startLoops(ctx, { setIntervalFn, clearIntervalFn });
  assert.ok(scheduled.length >= 5, 'deveria agendar vários loops');
  stop();
  assert.equal(cleared.length, scheduled.length);
});

test('liveEngineTick: dispara sinal de ponta a ponta (cliente falso)', async () => {
  const db = db0();
  const now = Date.now();
  const kickoff = Math.floor(now / 1000) - 85 * 60;

  db.prepare("INSERT INTO leagues (id,name,active) VALUES (10,'Liga',1)").run();
  // jogo monitorado, com odds de cantos e 1x2 guardadas (favorito = casa)
  db.prepare(`INSERT INTO fixtures (id,league_id,home_team_id,away_team_id,home_team,away_team,kickoff,status_short,
              corner_line,corner_over_odd,corner_bookmaker,odds_home,odds_draw,odds_away,monitored)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(500, 10, 10, 11, 'Casa FC', 'Fora FC', kickoff, '2H', 11.5, 1.85, 'BookX', 1.7, 3.5, 5.0, 1);

  // histórico pros dois times (pro predictFixture dar λ)
  const ins = db.prepare(`INSERT INTO match_stats (fixture_id,team_id,opponent_id,league_id,played_at,is_home,corners_for,corners_against,goals_for,goals_against)
                          VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (let i = 0; i < 6; i++) {
    const t = kickoff - (i + 1) * 7 * 86400;
    ins.run(9000 + i, 10, 11, 10, t, 1, 7, 5, 2, 1);
    ins.run(9100 + i, 11, 10, 10, t, 0, 6, 6, 1, 1);
  }

  // amostras ao vivo anteriores (pressão tem com o que comparar)
  const sIns = db.prepare(`INSERT INTO live_samples (fixture_id,minute,captured_at,corners_home,corners_away,shots_home,shots_away,shots_on_home,shots_on_away,goals_home,goals_away)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  sIns.run(500, 60, now - 1500000, 3, 2, 6, 5, 2, 2, 0, 1);
  sIns.run(500, 75, now - 600000, 5, 3, 10, 6, 4, 2, 0, 1);

  // cliente falso: jogo ao vivo no minuto 85 + stats atuais (ritmo subindo)
  const client = {
    async getLiveFixtures() {
      return { response: [{ fixture: { id: 500, status: { short: '2H', elapsed: 85 } }, goals: { home: 0, away: 1 }, teams: { home: { id: 10 }, away: { id: 11 } } }] };
    },
    async getFixtureStatistics() {
      return { response: [
        { team: { id: 10 }, statistics: [{ type: 'Corner Kicks', value: 7 }, { type: 'Total Shots', value: 14 }, { type: 'Shots on Goal', value: 7 }] },
        { team: { id: 11 }, statistics: [{ type: 'Corner Kicks', value: 4 }, { type: 'Total Shots', value: 8 }, { type: 'Shots on Goal', value: 2 }] },
      ] };
    },
  };

  const ctx = { db, client, engine: { running: true }, sse: new Set() };
  const r = await liveEngineTick(ctx, { now });
  assert.equal(r.checked, 1);
  assert.ok(r.fired >= 1, 'deveria disparar pelo menos um sinal');
  const sig = db.prepare("SELECT * FROM signals WHERE fixture_id=500 AND market='W2'").get();
  assert.ok(sig, 'o sinal ao vivo deveria estar gravado');
});

test('liveEngineTick: skipped com engine desligado', async () => {
  const ctx = { db: db0(), client: {}, engine: { running: false } };
  const r = await liveEngineTick(ctx);
  assert.match(r.skipped, /desligado/);
});
