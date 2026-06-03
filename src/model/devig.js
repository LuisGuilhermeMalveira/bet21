// De-vig (remoção da margem da casa) — funções PURAS.
//
// A odd crua mente: ela embute a comissão da casa (o "vig"/"juice"). Se over e
// under pagam 1.90/1.90, a casa NÃO está dizendo 50/50 — está dizendo ~48/48 e
// ficando com ~4%. Comparar nosso modelo contra a odd crua inventa valor que não
// existe. Então tiramos a margem primeiro e só então temos a probabilidade que a
// casa realmente acredita.

/** Probabilidade implícita crua de uma odd decimal (com margem). */
export function impliedProb(odd) {
  if (!Number.isFinite(odd) || odd <= 1) return null;
  return 1 / odd;
}

/**
 * Remove a margem de um par over/under (método da proporção — simples e robusto).
 * @returns {{over:number, under:number, margin:number}|null}  probs que somam 1
 */
export function devigPair(overOdd, underOdd) {
  const qo = impliedProb(overOdd);
  const qu = impliedProb(underOdd);
  if (qo == null || qu == null) return null;
  const s = qo + qu;            // > 1; o excedente é a margem da casa
  if (!(s > 0)) return null;
  return { over: qo / s, under: qu / s, margin: s - 1 };
}

/** Margem (vig) de um par over/under, em fração (ex.: 0.04 = 4%). Null se faltar lado. */
export function vigOf(overOdd, underOdd) {
  const qo = impliedProb(overOdd);
  const qu = impliedProb(underOdd);
  if (qo == null || qu == null) return null;
  return qo + qu - 1;
}
