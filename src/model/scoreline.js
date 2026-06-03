// Fator de situação do placar.
//
// Time perdendo ataca mais → mais cantos. Jogo decidido/morto → menos.
// O efeito cresce com o avanço do jogo (lateness): no início pesa pouco.

/**
 * @param {{goalDiff?:number, minute?:number, marketEnd?:number}} args
 *   goalDiff = gols mandante − gols visitante (o sinal não importa; usamos |diff|)
 * @returns {number} multiplicador em [0.6, 1.4]
 */
export function scorelineFactor({ goalDiff = 0, minute = 0, marketEnd = 90 } = {}) {
  const absd = Math.abs(goalDiff);
  const lateness = Math.min(1, Math.max(0, minute / marketEnd));

  let push;
  if (absd === 0) push = 0.10;        // empate: ambos querem ganhar → um pouco mais
  else if (absd === 1) push = 0.20;   // 1 gol: perdedor pressiona forte → mais cantos
  else if (absd === 2) push = 0.0;    // 2 gols: neutro
  else push = -0.30;                  // 3+ gols: jogo morto → menos

  const factor = 1 + push * lateness;
  return Math.min(1.4, Math.max(0.6, factor));
}
