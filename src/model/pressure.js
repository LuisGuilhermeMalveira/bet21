// Pressão ao vivo — quão intenso está o jogo AGORA vs a média dele.
//
// Composição (pesos da spec, configuráveis):
//   chutes no gol 30% · ataques perigosos 30% · cantos recentes 25% · chutes 15%
//
// Para cada métrica: razão = (ritmo na janela recente) / (ritmo médio do jogo).
// Razão > 1 = acelerando; < 1 = esfriando. A pressão final é a soma ponderada,
// limitada a [clampMin, clampMax] pra não explodir o modelo.
//
// As amostras (live_samples) são CUMULATIVAS por minuto (placar e contadores).

export const DEFAULT_WEIGHTS = { shots_on: 0.30, dangerous: 0.30, corners: 0.25, shots: 0.15 };

function metricTotals(s) {
  return {
    shots_on: (s.shots_on_home || 0) + (s.shots_on_away || 0),
    dangerous: (s.dangerous_home || 0) + (s.dangerous_away || 0),
    corners: (s.corners_home || 0) + (s.corners_away || 0),
    shots: (s.shots_home || 0) + (s.shots_away || 0),
  };
}

function mergeWeights(w) {
  return { ...DEFAULT_WEIGHTS, ...(w || {}) };
}

/**
 * Calcula a pressão a partir das amostras ao vivo.
 * @param {Array} samples  live_samples (cumulativos), em qualquer ordem
 * @param {{windowMin?:number, clampMin?:number, clampMax?:number, weights?:object}} [opts]
 * @returns {{pressure:number, rising:boolean, components:object|null, ok:boolean}}
 */
export function computePressure(samples, opts = {}) {
  const weights = mergeWeights(opts.weights);
  const clampMin = opts.clampMin ?? 0.5;
  const clampMax = opts.clampMax ?? 2.0;

  if (!Array.isArray(samples) || samples.length < 2) {
    return { pressure: 1, rising: false, components: null, ok: false };
  }
  const sorted = [...samples].sort((a, b) => (a.minute - b.minute));
  const last = sorted[sorted.length - 1];
  const nowMin = last.minute;
  if (!(nowMin > 0)) return { pressure: 1, rising: false, components: null, ok: false };

  // Janela; se o jogo ainda é curto, encolhe pra caber duas janelas.
  let W = opts.windowMin ?? 15;
  if (nowMin < 2 * W) W = Math.max(1, Math.floor(nowMin / 2));

  const at = (t) => {
    let chosen = sorted[0];
    for (const s of sorted) { if (s.minute <= t) chosen = s; else break; }
    return chosen;
  };
  const sNow = last;
  const sW = at(nowMin - W);
  const s2W = at(nowMin - 2 * W);

  const metrics = ['shots_on', 'dangerous', 'corners', 'shots'];
  const minsRecent = Math.max(1, nowMin - sW.minute);
  const minsPrev = Math.max(1, sW.minute - s2W.minute);

  const ratio = {};
  let pressure = 0, recentCombined = 0, prevCombined = 0;
  const tNow = metricTotals(sNow), tW = metricTotals(sW), t2W = metricTotals(s2W);

  for (const m of metrics) {
    const recentRate = (tNow[m] - tW[m]) / minsRecent;
    const avgRate = tNow[m] / nowMin;
    const prevRate = (tW[m] - t2W[m]) / minsPrev;
    ratio[m] = avgRate > 0 ? recentRate / avgRate : 1;
    pressure += weights[m] * ratio[m];
    recentCombined += weights[m] * recentRate;
    prevCombined += weights[m] * prevRate;
  }

  pressure = Math.min(clampMax, Math.max(clampMin, pressure));
  const rising = recentCombined > prevCombined + 1e-9;
  return { pressure, rising, components: ratio, ok: true };
}
