// Notificações no Telegram. OPCIONAL: sem token/chat no .env, tudo vira no-op
// silencioso (o app funciona 100% sem Telegram; os sinais aparecem no dashboard).
// O fetch é injetável (ctx.fetchFn) pra testar sem rede.

import * as cfg from '../config/settings.js';

const TG_API = 'https://api.telegram.org';

/** Há token e chat configurados? */
export function telegramConfigured(secrets) {
  return !!(secrets && secrets.telegramToken && secrets.telegramChatId);
}

/** O usuário ligou o aviso na Configuração? (default: ligado) */
export function telegramEnabled(ctx) {
  try {
    return cfg.get(ctx.db, 'settings', 'telegram_enabled') !== false;
  } catch {
    return true;
  }
}

/** Envia uma mensagem. Devolve {ok, skipped?, status?, error?} — nunca lança. */
export async function sendTelegram(ctx, text, { fetchFn } = {}) {
  const secrets = ctx.secrets || {};
  if (!telegramConfigured(secrets)) return { ok: false, skipped: 'telegram não configurado' };
  if (!telegramEnabled(ctx)) return { ok: false, skipped: 'aviso desligado' };

  const f = fetchFn || ctx.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, skipped: 'sem fetch disponível' };

  const url = `${TG_API}/bot${secrets.telegramToken}/sendMessage`;
  try {
    const res = await f(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: secrets.telegramChatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const ok = !!(res && (res.ok || res.status === 200));
    return { ok, status: res?.status };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(1)}%`);

/** Formata a mensagem de um sinal disparado. Aceita um objeto flexível. */
export function formatSignalMessage(sig = {}) {
  const mkt = sig.market === '1T' ? '1º tempo' : 'jogo todo';
  const odd = sig.over_odd ?? sig.overOdd ?? sig.open_odd;
  const linhas = [
    `🔔 <b>Sinal Bet21</b> · over de cantos (${mkt})`,
    sig.match ? `⚽ ${sig.match}` : null,
    `📈 Over <b>${sig.line}</b> @ ${odd ?? '?'} (${sig.bookmaker ?? '?'})`,
    (sig.minute != null || sig.score) ? `⏱️ ${sig.minute != null ? sig.minute + "'" : ''}${sig.score ? ' · ' + sig.score : ''}` : null,
    sig.ev != null ? `💡 EV ${pct(sig.ev)}` : null,
    '',
    '⚠️ Triagem do modelo, sem garantia. Aposte com responsabilidade.',
  ].filter((l) => l !== null);
  return linhas.join('\n');
}

/** Formata o resumo diário a partir do relatório da contabilidade. */
export function formatDailySummary(report = {}) {
  const s = report.summary || report || {};
  const linhas = [
    '📊 <b>Bet21 — resumo</b>',
    `Sinais: ${s.count ?? 0}`,
    `CLV médio: ${pct(s.avgClv)}${s.smallSample ? ' (amostra pequena ⚠️)' : ''}`,
    `ROI: ${pct(s.roi)}`,
    `Acerto: ${pct(s.hitRate)}`,
    s.bankrollUnits != null ? `Banca: ${s.bankrollUnits > 0 ? '+' : ''}${s.bankrollUnits.toFixed(2)}u` : null,
    '',
    '🏁 O CLV é a métrica-rei. Lucro de curto prazo não valida nada.',
  ].filter((l) => l !== null);
  return linhas.join('\n');
}

/** Notifica um sinal (respeita a config telegram_enabled). */
export async function notifySignal(ctx, sig, opts) {
  return sendTelegram(ctx, formatSignalMessage(sig), opts);
}

/** Notifica o resumo diário. */
export async function notifyDailySummary(ctx, report, opts) {
  return sendTelegram(ctx, formatDailySummary(report), opts);
}
