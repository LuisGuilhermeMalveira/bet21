// Nome de exibição das ligas. Muitas ligas se chamam "Serie A", "Serie B",
// "Primera División"… então: usamos o nome popular (Brasileirão, Premier League)
// quando há, e senão acrescentamos o país pra desambiguar.

// Apelidos por ID da API-Football (os que têm nome conhecido no Brasil).
const NICKNAME_BY_ID = {
  71: 'Brasileirão Série A',
  72: 'Brasileirão Série B',
  73: 'Copa do Brasil',
  13: 'Libertadores',
  11: 'Sul-Americana',
  39: 'Premier League',
  140: 'La Liga',
  135: 'Serie A (Itália)',
  78: 'Bundesliga',
  61: 'Ligue 1',
  2: 'Champions League',
  3: 'Europa League',
  848: 'Conference League',
  94: 'Primeira Liga (Portugal)',
  88: 'Eredivisie (Holanda)',
  203: 'Süper Lig (Turquia)',
  253: 'MLS',
  262: 'Liga MX',
  128: 'Liga Argentina',
  130: 'Copa Argentina',
  1: 'Copa do Mundo',
  4: 'Eurocopa',
  9: 'Copa América',
};

// País traduzido pro português quando ajuda (a API manda em inglês).
const COUNTRY_PT = {
  Brazil: 'Brasil', England: 'Inglaterra', Spain: 'Espanha', Italy: 'Itália',
  Germany: 'Alemanha', France: 'França', Portugal: 'Portugal', Netherlands: 'Holanda',
  Turkey: 'Turquia', Argentina: 'Argentina', 'USA': 'EUA', Mexico: 'México',
  Belgium: 'Bélgica', Scotland: 'Escócia', Switzerland: 'Suíça', Austria: 'Áustria',
  Greece: 'Grécia', Russia: 'Rússia', Ukraine: 'Ucrânia', Colombia: 'Colômbia',
  Chile: 'Chile', Uruguay: 'Uruguai', Paraguay: 'Paraguai', Ecuador: 'Equador',
  Peru: 'Peru', Bolivia: 'Bolívia', Japan: 'Japão', 'South-Korea': 'Coreia do Sul',
  China: 'China', Australia: 'Austrália', World: 'Mundial',
};

export function countryPt(country) {
  if (!country) return null;
  return COUNTRY_PT[country] || country;
}

/**
 * Nome amigável de uma liga.
 * @param {{id:number, name:string, country?:string}} league
 * @returns {string}
 */
export function displayLeagueName(league) {
  if (!league) return '—';
  const id = Number(league.id);
  if (NICKNAME_BY_ID[id]) return NICKNAME_BY_ID[id];

  const name = (league.name || '').trim();
  const pais = countryPt(league.country);

  // Sem país conhecido → devolve o nome cru.
  if (!pais) return name || `Liga #${id}`;
  // Nome já contém o país (ex.: "Brazilian Serie A") → não duplica.
  if (name && league.country && name.toLowerCase().includes(String(league.country).toLowerCase())) return name;
  if (name && pais && name.toLowerCase().includes(pais.toLowerCase())) return name;
  // Nome genérico → acrescenta o país pra desambiguar.
  return name ? `${name} (${pais})` : `Liga #${id}`;
}
