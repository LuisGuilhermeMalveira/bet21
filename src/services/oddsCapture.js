// Captura e gravação de odds de cantos de um jogo.
//
// ARMADILHAS QUE CUSTARAM HORAS (e como evitamos):
//  • SEMPRE sobrescrever a linha/odd atual. NUNCA usar COALESCE que preserva o
//    valor antigo (foi o que deixou a linha errada 4.5 grudada pra sempre).
//  • Se a casa não tem mais o mercado de total → LIMPAR a linha (vira "sem odds").
//  • Só a ODD DE ABERTURA é preservada (pro CLV): grava na 1ª vez e não mexe mais.
//  • Na recaptura, SEMPRE resolver — nunca pular deixando dado velho. Ou grava a
//    linha certa, ou limpa a errada. (Nada de `if (!odd) continue`.)
//  • SQLite não aceita undefined → normalize tudo pra null.

import { normalize, logEvent } from '../db/index.js';
import { summarizeOdds } from '../api/oddsParser.js';
import { get as cfgGet } from '../config/settings.js';

/** Lê os limites de plausibilidade das configurações. */
export function plausibilityBounds(db) {
  return {
    full: { min: cfgGet(db, 'settings', 'line_min_full'), max: cfgGet(db, 'settings', 'line_max_full') },
    ht: { min: cfgGet(db, 'settings', 'line_min_ht'), max: cfgGet(db, 'settings', 'line_max_ht') },
  };
}

/**
 * Grava o resultado de uma captura de odds no fixture, aplicando a regra de
 * sobrescrever/limpar. Preserva apenas a odd de abertura (corner_open_odd / ht_*).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} fixtureId
 * @param {ReturnType<typeof summarizeOdds>} summary
 * @param {{now?:number, isClosing?:boolean}} [opts]
 * @returns {{full:'set'|'cleared', ht:'set'|'cleared'}}
 */
export function writeOddsToFixture(db, fixtureId, summary, opts = {}) {
  const now = opts.now ?? Date.now();
  const row = db.prepare('SELECT * FROM fixtures WHERE id = ?').get(fixtureId);
  if (!row) throw new Error(`Jogo ${fixtureId} não existe no banco (sincronize os jogos antes).`);

  const result = { full: 'cleared', ht: 'cleared' };

  // ---- Mercado do JOGO TODO ----
  const f = summary.full;
  if (f && Number.isFinite(f.line) && Number.isFinite(f.overOdd)) {
    // Abertura: só define se ainda não havia (NÃO sobrescreve a abertura).
    const open = row.corner_open_odd == null ? f.overOdd : row.corner_open_odd;
    db.prepare(
      `UPDATE fixtures SET
         corner_line = ?, corner_over_odd = ?, corner_under_odd = ?,
         corner_bookmaker = ?, corner_open_odd = ?, corner_odds_captured_at = ?,
         updated_at = ?
       WHERE id = ?`
    ).run(
      normalize(f.line), normalize(f.overOdd), normalize(f.underOdd),
      normalize(f.bookmaker), normalize(open), now, now, fixtureId
    );
    if (opts.isClosing) {
      db.prepare('UPDATE fixtures SET corner_close_odd = ?, corner_under_close_odd = ? WHERE id = ?')
        .run(normalize(f.overOdd), normalize(f.underOdd), fixtureId);
    }
    // Âncora Pinnacle (se a Pinnacle cotou esse jogo)
    const pf = summary.pinnFull;
    if (pf && Number.isFinite(pf.line)) {
      db.prepare('UPDATE fixtures SET corner_pinn_line = ?, corner_pinn_over_odd = ?, corner_pinn_under_odd = ? WHERE id = ?')
        .run(normalize(pf.line), normalize(pf.overOdd), normalize(pf.underOdd), fixtureId);
    } else {
      db.prepare('UPDATE fixtures SET corner_pinn_line = NULL, corner_pinn_over_odd = NULL, corner_pinn_under_odd = NULL WHERE id = ?').run(fixtureId);
    }
    result.full = 'set';
  } else {
    // Sem mercado válido → LIMPAR a linha/odd atual (não deixar valor velho!).
    // A odd de abertura é preservada de propósito (pro CLV).
    db.prepare(
      `UPDATE fixtures SET
         corner_line = NULL, corner_over_odd = NULL, corner_under_odd = NULL,
         corner_bookmaker = NULL, corner_odds_captured_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(now, now, fixtureId);
    result.full = 'cleared';
  }

  // ---- Mercado do 1º TEMPO ----
  const h = summary.ht;
  if (h && Number.isFinite(h.line) && Number.isFinite(h.overOdd)) {
    const open = row.ht_corner_open_odd == null ? h.overOdd : row.ht_corner_open_odd;
    db.prepare(
      `UPDATE fixtures SET
         ht_corner_line = ?, ht_corner_over_odd = ?, ht_corner_under_odd = ?,
         ht_corner_bookmaker = ?, ht_corner_open_odd = ?, ht_corner_odds_captured_at = ?,
         updated_at = ?
       WHERE id = ?`
    ).run(
      normalize(h.line), normalize(h.overOdd), normalize(h.underOdd),
      normalize(h.bookmaker), normalize(open), now, now, fixtureId
    );
    if (opts.isClosing) {
      db.prepare('UPDATE fixtures SET ht_corner_close_odd = ? WHERE id = ?').run(normalize(h.overOdd), fixtureId);
    }
    result.ht = 'set';
  } else {
    db.prepare(
      `UPDATE fixtures SET
         ht_corner_line = NULL, ht_corner_over_odd = NULL, ht_corner_under_odd = NULL,
         ht_corner_bookmaker = NULL, ht_corner_odds_captured_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(now, now, fixtureId);
    result.ht = 'cleared';
  }

  // 1x2 (favorito) — também sobrescreve, e limpa se sumir.
  const mw = summary.matchWinner;
  db.prepare('UPDATE fixtures SET odds_home = ?, odds_draw = ?, odds_away = ? WHERE id = ?').run(
    normalize(mw ? mw.home : null), normalize(mw ? mw.draw : null), normalize(mw ? mw.away : null), fixtureId
  );

  // Snapshot histórico (útil pro CLV) — só grava quando há linha.
  if (result.full === 'set') {
    db.prepare(
      `INSERT INTO odds_snapshots (fixture_id, market, captured_at, line, over_odd, under_odd, bookmaker)
       VALUES (?, 'W2', ?, ?, ?, ?, ?)`
    ).run(fixtureId, now, normalize(f.line), normalize(f.overOdd), normalize(f.underOdd), normalize(f.bookmaker));
  }
  if (result.ht === 'set') {
    db.prepare(
      `INSERT INTO odds_snapshots (fixture_id, market, captured_at, line, over_odd, under_odd, bookmaker)
       VALUES (?, '1T', ?, ?, ?, ?, ?)`
    ).run(fixtureId, now, normalize(h.line), normalize(h.overOdd), normalize(h.underOdd), normalize(h.bookmaker));
  }

  return result;
}

/**
 * Captura as odds de UM jogo pela API e grava (1 requisição). Sempre resolve:
 * grava a linha certa ou limpa a errada. Nunca lança por "mercado não aberto".
 *
 * @param {object} ctx
 * @param {import('node:sqlite').DatabaseSync} ctx.db
 * @param {import('../api/apifootball.js').ApiFootball} ctx.client
 * @param {number} fixtureId
 * @param {{isClosing?:boolean, priority?:'live'|'normal'|'low'}} [opts]
 */
export async function captureFixtureOdds(ctx, fixtureId, opts = {}) {
  const { db, client } = ctx;
  const bounds = plausibilityBounds(db);
  const res = await client.getOdds(fixtureId, { priority: opts.priority || 'normal' });

  // 200 vazio (mercado ainda não aberto) NÃO é erro: resolvemos limpando.
  const item = res && Array.isArray(res.response) ? res.response[0] : null;
  const summary = item
    ? summarizeOdds(item, bounds)
    : { full: null, ht: null, fullLines: [], htLines: [], matchWinner: null, raw: [] };

  const outcome = writeOddsToFixture(db, fixtureId, summary, { isClosing: opts.isClosing });
  logEvent(db, {
    level: 'info', type: 'odds_capture',
    message: `Odds do jogo ${fixtureId}: total=${outcome.full}, 1T=${outcome.ht}`,
    data: { fixtureId, ...outcome, empty: !!res?.empty },
  });
  return { outcome, summary, empty: !!res?.empty, remainingDay: res?.remainingDay ?? null };
}

/**
 * Diagnóstico (botão 🔍): retorna os mercados de cantos CRUS da API pra um jogo
 * — nome + id + valores — sem filtrar. Foi assim que descobrimos os ids reais.
 */
export async function diagnoseCornerOdds(ctx, fixtureId) {
  const { client } = ctx;
  const res = await client.getOdds(fixtureId, { priority: 'normal' });
  const item = res && Array.isArray(res.response) ? res.response[0] : null;
  const markets = [];
  for (const bk of item?.bookmakers || []) {
    for (const bet of bk?.bets || []) {
      const name = String(bet?.name || '');
      if (!/corner|escanteio|canto/i.test(name)) continue;
      markets.push({
        bookmaker: bk?.name || String(bk?.id ?? '?'),
        marketId: Number(bet.id),
        marketName: bet.name,
        values: bet.values,
      });
    }
  }
  return { fixtureId, empty: !!res?.empty, markets };
}
