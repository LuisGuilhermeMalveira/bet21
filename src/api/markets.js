// IDs de mercado da API-Football (confirmados em campo, padrão da API).
//
// Identificamos o mercado pelo ID, NÃO pelo nome (o nome varia por casa/idioma).
// O nome só serve de reserva quando a casa não manda o id.

export const MARKET = {
  CORNERS_FULL: 45,      // "Corners Over Under" = total do JOGO TODO  ✅
  CORNERS_HT: 77,        // "Total Corners 1st Half" = 1º TEMPO         ✅
  MATCH_WINNER: 1,       // 1x2 (pra achar o favorito)
};

// Mercados de cantos que NÃO queremos (capturados por engano davam linha errada):
//  57/58 = cantos por time (Home/Away); 85 = total 3-way; 338 = par/ímpar.
export const IGNORED_CORNER_MARKETS = new Set([57, 58, 85, 338]);

// Reserva por nome: se a casa não mandar id, tentamos casar pelo nome.
// Mantido propositalmente restritivo pra não pegar mercado errado.
export const NAME_FALLBACK = {
  full: [/^corners over\/?under$/i, /^total corners$/i, /^over\/under corners$/i],
  ht: [/1st half/i, /first half/i, /1º? tempo/i, /primeiro tempo/i],
};

// Nome de mercado que indica "por time" / "3-way" / "par-ímpar" → rejeitar mesmo por nome.
export const NAME_REJECT = [
  /home|away|mandante|visitante/i,
  /3-?way/i,
  /odd|even|par|[ií]mpar/i,
  /race|aposta sem|asian/i,
];
