// Parsing de odds da API-Football — funções PURAS (sem banco), fáceis de testar.
//
// O que resolvemos aqui (onde mais se errou antes):
//   1. Identificar o mercado pelo ID (45 = jogo todo, 77 = 1º tempo), nunca pelo nome.
//   2. Trava de plausibilidade: descartar linha fora da faixa (canto de um time pego por engano).
//   3. Line shopping: melhor odd de OVER entre as casas, pra mesma linha, guardando a casa.
//   4. Escolher a linha "principal" (a mais central/equilibrada) pra captura/pré-live.
//   5. Extrair o favorito do 1x2.

import { MARKET, IGNORED_CORNER_MARKETS, NAME_FALLBACK, NAME_REJECT } from './markets.js';

/**
 * Interpreta um rótulo de aposta tipo "Over 9.5" / "Under 10".
 * @returns {{side:'over'|'under', line:number}|null}
 */
export function parseSide(value) {
  if (value == null) return null;
  const s = String(value).trim().toLowerCase();
  const m = s.match(/(over|under|mais|menos)\s*(?:de\s+)?([0-9]+(?:\.[0-9]+)?)/);
  if (!m) return null;
  const side = m[1] === 'over' || m[1] === 'mais' ? 'over' : 'under';
  const line = parseFloat(m[2]);
  if (!Number.isFinite(line)) return null;
  return { side, line };
}

/** Decide se um "bet" (mercado) é de cantos TOTAL do jogo, do 1º tempo, ou nenhum. */
export function classifyCornerBet(bet) {
  const id = Number(bet?.id);
  if (IGNORED_CORNER_MARKETS.has(id)) return null;
  if (id === MARKET.CORNERS_FULL) return 'full';
  if (id === MARKET.CORNERS_HT) return 'ht';

  // Reserva por nome só quando NÃO veio id reconhecível.
  if (id === MARKET.CORNERS_FULL || id === MARKET.CORNERS_HT) return null; // já tratado
  const name = String(bet?.name || '');
  if (!name) return null;
  if (NAME_REJECT.some((re) => re.test(name))) return null;
  const isCorner = /corner|escanteio|canto/i.test(name);
  if (!isCorner) return null;
  if (NAME_FALLBACK.ht.some((re) => re.test(name))) return 'ht';
  if (NAME_FALLBACK.full.some((re) => re.test(name))) return 'full';
  return null;
}

/**
 * Agrega odds de cantos de TODAS as casas de um jogo, por período e por linha.
 * @param {object} fixtureOdds  um item de response[] de /odds
 * @returns {{full:Map<number,LineAgg>, ht:Map<number,LineAgg>, raw:Array}}
 * @typedef {{line:number, bestOver:{odd:number,bookmaker:string}|null, bestUnder:{odd:number,bookmaker:string}|null, count:number}} LineAgg
 */
export function collectCornerMarkets(fixtureOdds) {
  const full = new Map();
  const ht = new Map();
  const raw = [];

  const bookmakers = fixtureOdds?.bookmakers || [];
  for (const bk of bookmakers) {
    const bkName = bk?.name || String(bk?.id ?? '?');
    for (const bet of bk?.bets || []) {
      const kind = classifyCornerBet(bet);
      if (!kind) continue;
      raw.push({ bookmaker: bkName, marketId: Number(bet.id), marketName: bet.name, values: bet.values });
      const target = kind === 'full' ? full : ht;
      for (const v of bet.values || []) {
        const parsed = parseSide(v.value);
        const odd = Number(v.odd);
        if (!parsed || !Number.isFinite(odd) || odd <= 1) continue;
        if (!target.has(parsed.line)) {
          target.set(parsed.line, { line: parsed.line, bestOver: null, bestUnder: null, count: 0 });
        }
        const agg = target.get(parsed.line);
        agg.count += 1;
        if (parsed.side === 'over') {
          if (!agg.bestOver || odd > agg.bestOver.odd) agg.bestOver = { odd, bookmaker: bkName };
        } else {
          if (!agg.bestUnder || odd > agg.bestUnder.odd) agg.bestUnder = { odd, bookmaker: bkName };
        }
      }
    }
  }
  return { full, ht, raw };
}

/**
 * Extrai a linha de cantos da PINNACLE (âncora de calibração), com over E under.
 * A Pinnacle tem margem baixíssima — é o "preço justo" de referência do mercado.
 * Pega, entre as linhas plausíveis que a Pinnacle cota, a mais central (over perto de 2.0).
 * @param {object} fixtureOdds  item de response[] de /odds
 * @param {'full'|'ht'} period
 * @param {{min:number,max:number}} bounds
 * @returns {{line:number, overOdd:number|null, underOdd:number|null}|null}
 */
export function pinnacleLine(fixtureOdds, period, bounds) {
  const wantId = period === 'ht' ? MARKET.CORNERS_HT : MARKET.CORNERS_FULL;
  let best = null;
  for (const bk of fixtureOdds?.bookmakers || []) {
    const name = String(bk?.name || '').toLowerCase();
    if (!name.includes('pinnacle')) continue;
    for (const bet of bk?.bets || []) {
      const kind = classifyCornerBet(bet);
      const matches = (Number(bet.id) === wantId) || (kind === period);
      if (!matches) continue;
      const byLine = new Map();
      for (const v of bet.values || []) {
        const parsed = parseSide(v.value);
        const odd = Number(v.odd);
        if (!parsed || !Number.isFinite(odd) || odd <= 1) continue;
        if (!byLine.has(parsed.line)) byLine.set(parsed.line, { line: parsed.line, overOdd: null, underOdd: null });
        const agg = byLine.get(parsed.line);
        if (parsed.side === 'over') agg.overOdd = odd; else agg.underOdd = odd;
      }
      for (const agg of byLine.values()) {
        if (!isPlausibleLine(agg.line, bounds) || agg.overOdd == null) continue;
        const dist = Math.abs(agg.overOdd - 2.0);
        if (!best || dist < best._dist) best = { ...agg, _dist: dist };
      }
    }
  }
  if (!best) return null;
  delete best._dist;
  return best;
}

/** True se a linha está dentro da faixa de plausibilidade. */
export function isPlausibleLine(line, { min, max }) {
  return Number.isFinite(line) && line >= min && line <= max;
}

/**
 * Escolhe a linha "principal" do mercado: entre as linhas PLAUSÍVEIS, a mais
 * equilibrada (over-odd mais perto de 2.0) — costuma ser a linha central/mais líquida.
 * Em empate, prefere a linha com mais cotações (count) e a menor.
 * @param {Map<number,LineAgg>} byLine
 * @param {{min:number,max:number}} bounds
 * @returns {{line:number, overOdd:number, underOdd:number|null, bookmaker:string}|null}
 */
export function pickPrincipalLine(byLine, bounds) {
  let best = null;
  for (const agg of byLine.values()) {
    if (!isPlausibleLine(agg.line, bounds)) continue;
    if (!agg.bestOver) continue;
    const dist = Math.abs(agg.bestOver.odd - 2.0);
    const cand = {
      line: agg.line,
      overOdd: agg.bestOver.odd,
      underOdd: agg.bestUnder ? agg.bestUnder.odd : null,
      bookmaker: agg.bestOver.bookmaker,
      _dist: dist,
      _count: agg.count,
    };
    if (
      !best ||
      cand._dist < best._dist - 1e-9 ||
      (Math.abs(cand._dist - best._dist) <= 1e-9 && cand._count > best._count) ||
      (Math.abs(cand._dist - best._dist) <= 1e-9 && cand._count === best._count && cand.line < best.line)
    ) {
      best = cand;
    }
  }
  if (!best) return null;
  delete best._dist;
  delete best._count;
  return best;
}

/**
 * Todas as linhas plausíveis com a melhor over (pro DISPARO escolher por EV).
 * @returns {Array<{line:number, overOdd:number, underOdd:number|null, bookmaker:string}>}
 */
export function plausibleLines(byLine, bounds) {
  const out = [];
  for (const agg of byLine.values()) {
    if (!isPlausibleLine(agg.line, bounds) || !agg.bestOver) continue;
    out.push({
      line: agg.line,
      overOdd: agg.bestOver.odd,
      underOdd: agg.bestUnder ? agg.bestUnder.odd : null,
      bookmaker: agg.bestOver.bookmaker,
    });
  }
  out.sort((a, b) => a.line - b.line);
  return out;
}

/**
 * Extrai o favorito do mercado 1x2 (Match Winner, id 1), pela menor odd.
 * @returns {{home:number, draw:number, away:number, favorite:'home'|'away'|'draw', bookmaker:string}|null}
 */
export function parseMatchWinner(fixtureOdds) {
  for (const bk of fixtureOdds?.bookmakers || []) {
    for (const bet of bk?.bets || []) {
      if (Number(bet.id) !== MARKET.MATCH_WINNER) continue;
      let home = null, draw = null, away = null;
      for (const v of bet.values || []) {
        const label = String(v.value).toLowerCase();
        const odd = Number(v.odd);
        if (!Number.isFinite(odd)) continue;
        if (label === 'home' || label === '1') home = odd;
        else if (label === 'draw' || label === 'x') draw = odd;
        else if (label === 'away' || label === '2') away = odd;
      }
      if (home == null && away == null) continue;
      const entries = [['home', home], ['away', away], ['draw', draw]].filter(([, v]) => v != null);
      entries.sort((a, b) => a[1] - b[1]);
      return { home, draw, away, favorite: entries[0][0], bookmaker: bk?.name || String(bk?.id ?? '?') };
    }
  }
  return null;
}

/**
 * Resumo de odds de um jogo: linha principal de cantos (full e ht) + favorito.
 * É o que a captura grava. Campos ausentes vêm como null (sem odds), nunca "valor velho".
 * @param {object} fixtureOdds
 * @param {{full:{min,max}, ht:{min,max}}} bounds
 */
export function summarizeOdds(fixtureOdds, bounds) {
  const { full, ht, raw } = collectCornerMarkets(fixtureOdds);
  return {
    full: pickPrincipalLine(full, bounds.full),
    ht: pickPrincipalLine(ht, bounds.ht),
    fullLines: plausibleLines(full, bounds.full),
    htLines: plausibleLines(ht, bounds.ht),
    pinnFull: pinnacleLine(fixtureOdds, 'full', bounds.full),
    matchWinner: parseMatchWinner(fixtureOdds),
    raw,
  };
}

/**
 * Extrai as linhas de cantos das ODDS AO VIVO (/odds/live).
 * O formato live é diferente do pré-jogo: cada mercado tem values com
 * { value: 'Over'|'Under', odd, handicap: '12.5', suspended }.
 * A linha vem no handicap (não no texto), e odds suspensas não são apostáveis.
 *
 * @param {object} liveItem  item de response[] de /odds/live (tem .odds[])
 * @param {{min:number,max:number}} [bounds]  faixa plausível de linhas (jogo todo)
 * @returns {Array<{line:number, overOdd:number, underOdd:number|null, bookmaker:string}>}
 *          uma entrada por linha disponível, com a melhor odd de over (apostável agora)
 */
export function parseLiveCornerLines(liveItem, bounds = { min: 2, max: 30 }) {
  const byLine = new Map();
  for (const market of liveItem?.odds || []) {
    const name = String(market?.name || '').toLowerCase();
    // mercados de cantos do jogo todo (evita cartões, gols, e mercados de 1º tempo aqui)
    if (!name.includes('corner')) continue;
    if (name.includes('1st') || name.includes('first half') || name.includes('half')) continue;
    if (!(name.includes('over') || name.includes('under') || name.includes('total'))) continue;
    for (const v of market?.values || []) {
      if (v?.suspended) continue;                    // odd suspensa = não dá pra apostar
      const side = String(v?.value || '').toLowerCase();
      const line = Number(v?.handicap);
      const odd = Number(v?.odd);
      if (!Number.isFinite(line) || !Number.isFinite(odd) || odd <= 1) continue;
      if (!isPlausibleLine(line, bounds)) continue;
      if (!byLine.has(line)) byLine.set(line, { line, overOdd: null, underOdd: null, bookmaker: 'live' });
      const agg = byLine.get(line);
      if (side === 'over') { if (agg.overOdd == null || odd > agg.overOdd) agg.overOdd = odd; }
      else if (side === 'under') { if (agg.underOdd == null || odd > agg.underOdd) agg.underOdd = odd; }
    }
  }
  // só linhas com over apostável (o motor aposta over ao vivo)
  return [...byLine.values()].filter((x) => x.overOdd != null).sort((a, b) => a.line - b.line);
}
