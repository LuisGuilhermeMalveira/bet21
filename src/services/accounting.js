// Contabilidade — CLV é a métrica-rei.
//
// CLV (closing line value): compara a odd que você pegou (entrada) com a odd de
// fechamento. Para uma aposta em over (back), CLV positivo = você pegou odd MAIOR
// que a de fechamento (o mercado encurtou a seu favor). É o melhor indicador de
// que há vantagem real — bem mais confiável que o lucro de curto prazo.
//
// Inclui o arsenal de filtros combináveis e o AVISO de amostra pequena (< 30),
// proteção obrigatória contra overfitting / conclusões de recortes minúsculos.

/** CLV em %: (odd_entrada / odd_fechamento − 1). Positivo = bateu o fechamento. */
export function clvPercent(openOdd, closeOdd) {
  if (!Number.isFinite(openOdd) || !Number.isFinite(closeOdd) || closeOdd <= 1) return null;
  return openOdd / closeOdd - 1;
}

/** Estado do placar sob a ótica do favorito, a partir do contexto do sinal. */
export function favoriteScoreState(context) {
  if (!context || !context.favorite || !context.score) return 'desconhecido';
  const m = String(context.score).match(/(-?\d+)\s*-\s*(-?\d+)/);
  if (!m) return 'desconhecido';
  const gh = Number(m[1]), ga = Number(m[2]);
  const fav = context.favorite;
  const diff = fav === 'home' ? gh - ga : fav === 'away' ? ga - gh : 0;
  if (diff > 0) return 'ganhando';
  if (diff < 0) return 'perdendo';
  return 'empatando';
}

/**
 * Carrega os sinais já enriquecidos (join com fixtures/leagues, contexto parseado, CLV).
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function loadSignals(db) {
  const rows = db.prepare(`
    SELECT s.*, f.league_id AS f_league_id, f.home_team, f.away_team,
           f.kickoff, l.name AS league_name
      FROM signals s
      LEFT JOIN fixtures f ON f.id = s.fixture_id
      LEFT JOIN leagues l ON l.id = f.league_id
     ORDER BY s.created_at ASC
  `).all();

  return rows.map((r) => {
    let ctx = {};
    try { ctx = r.context ? JSON.parse(r.context) : {}; } catch { ctx = {}; }
    const clv = clvPercent(r.open_odd, r.close_odd);
    return {
      id: r.id, fixtureId: r.fixture_id, market: r.market,
      leagueId: r.f_league_id, league: r.league_name || null,
      homeTeam: r.home_team, awayTeam: r.away_team, kickoff: r.kickoff,
      line: r.line, openOdd: r.open_odd, closeOdd: r.close_odd, bookmaker: r.bookmaker,
      stake: r.stake, modelProb: r.model_prob, ev: r.ev,
      status: r.status, profit: r.profit_units, resultCorners: r.result_corners,
      minute: r.minute, createdAt: r.created_at, settledAt: r.settled_at,
      pressure: ctx.pressure ?? null,
      favorite: ctx.favorite ?? null,
      scoreState: favoriteScoreState(ctx),
      reasons: ctx.reasons ?? [],
      clv,
      clvSign: clv == null ? null : (clv >= 0 ? 'positive' : 'negative'),
    };
  });
}

const between = (v, lo, hi) =>
  (lo == null || (Number.isFinite(v) && v >= lo)) && (hi == null || (Number.isFinite(v) && v <= hi));

/**
 * Aplica os filtros combináveis. Campos ausentes no filtro = "não filtra por isso".
 * @param {Array} signals  saída de loadSignals
 * @param {object} f
 */
export function applyFilters(signals, f = {}) {
  return signals.filter((s) => {
    if (f.market && s.market !== f.market) return false;
    if (f.leagueId != null && s.leagueId !== f.leagueId) return false;
    if (f.status && s.status !== f.status) return false;
    if (f.bookmaker && s.bookmaker !== f.bookmaker) return false;
    if (f.mando && s.favorite !== f.mando) return false;
    if (f.scoreState && s.scoreState !== f.scoreState) return false;
    if (f.clvSign && s.clvSign !== f.clvSign) return false;
    if (f.from != null && !(Number.isFinite(s.createdAt) && s.createdAt >= f.from)) return false;
    if (f.to != null && !(Number.isFinite(s.createdAt) && s.createdAt <= f.to)) return false;
    if (!between(s.ev, f.evMin, f.evMax)) return false;
    if (!between(s.openOdd, f.oddMin, f.oddMax)) return false;
    if (!between(s.minute, f.minuteMin, f.minuteMax)) return false;
    if (!between(s.pressure, f.pressureMin, f.pressureMax)) return false;
    return true;
  });
}

/** Resumo de um conjunto de sinais. CLV em destaque; aviso de amostra pequena. */
export function summarize(signals, { smallSampleThreshold = 30 } = {}) {
  const settled = signals.filter((s) => s.status === 'green' || s.status === 'red' || s.status === 'void');
  const pending = signals.filter((s) => s.status === 'pending');
  const green = settled.filter((s) => s.status === 'green').length;
  const red = settled.filter((s) => s.status === 'red').length;
  const decided = green + red; // void fora do hit rate

  const staked = settled.reduce((a, s) => a + (s.stake ?? 0), 0);
  const profit = settled.reduce((a, s) => a + (s.profit ?? 0), 0);

  const clvs = signals.map((s) => s.clv).filter((x) => x != null);
  const avgClv = clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null;
  const clvPositive = clvs.filter((x) => x >= 0).length;

  return {
    nTotal: signals.length,
    nSettled: settled.length,
    nPending: pending.length,
    green, red, void: settled.filter((s) => s.status === 'void').length,
    staked,
    profit,
    roi: staked > 0 ? profit / staked : null,
    hitRate: decided > 0 ? green / decided : null,
    avgClv,
    clvPositiveRate: clvs.length ? clvPositive / clvs.length : null,
    nClv: clvs.length,
    smallSample: settled.length < smallSampleThreshold,
    smallSampleNote: settled.length < smallSampleThreshold
      ? `Amostra pequena (${settled.length} sinais liquidados) — não tire conclusões.`
      : null,
  };
}

/** Série do bankroll (lucro acumulado), ordenada por liquidação. Pro gráfico. */
export function bankrollSeries(signals) {
  const settled = signals
    .filter((s) => s.status === 'green' || s.status === 'red' || s.status === 'void')
    .sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0));
  let acc = 0;
  return settled.map((s) => {
    acc += s.profit ?? 0;
    return { at: s.settledAt, profit: s.profit ?? 0, bankroll: Number(acc.toFixed(4)) };
  });
}

/** Linhas da tabela "cada sinal" (jogo, mercado, liga, linha, odds, CLV, resultado, lucro, cantos). */
export function signalTable(signals) {
  return signals.map((s) => ({
    id: s.id,
    jogo: s.homeTeam && s.awayTeam ? `${s.homeTeam} x ${s.awayTeam}` : `#${s.fixtureId}`,
    mercado: s.market, liga: s.league, linha: s.line,
    oddEntrada: s.openOdd, oddFechamento: s.closeOdd,
    clv: s.clv != null ? Number((s.clv * 100).toFixed(1)) : null,
    resultado: s.status, lucro: s.profit, cantos: s.resultCorners,
    minuto: s.minute, ev: s.ev, casa: s.bookmaker,
  }));
}

/** Tudo de uma vez, já filtrado — o que a aba Contabilidade consome. */
export function report(db, filters = {}) {
  const all = loadSignals(db);
  const filtered = applyFilters(all, filters);
  return {
    summary: summarize(filtered),
    bankroll: bankrollSeries(filtered),
    table: signalTable(filtered),
    nUnfiltered: all.length,
  };
}
