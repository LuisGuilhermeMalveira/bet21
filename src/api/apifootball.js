// Cliente da API-Football (api-sports.io, v3).
//
// Regra inviolável: TODA chamada passa pelo PORTEIRO (ApiGatekeeper). Este cliente
// só monta a URL/headers e escolhe a prioridade (ao vivo > normal > backfill).
// Não tem lógica de retry/limite aqui — isso é responsabilidade do porteiro.

export const API_HOST = 'v3.football.api-sports.io';
export const API_BASE = `https://${API_HOST}`;

/** Monta querystring ignorando valores vazios/null/undefined. */
export function buildQuery(params = {}) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.append(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export class ApiFootball {
  /**
   * @param {object} opts
   * @param {import('./gatekeeper.js').ApiGatekeeper} opts.gatekeeper  porteiro (obrigatório)
   * @param {string} opts.apiKey
   * @param {string} [opts.base]
   */
  constructor({ gatekeeper, apiKey, base = API_BASE } = {}) {
    if (!gatekeeper) throw new Error('ApiFootball exige um gatekeeper (porteiro).');
    this.gk = gatekeeper;
    this.apiKey = apiKey || '';
    this.base = base;
  }

  get headers() {
    return { 'x-apisports-key': this.apiKey };
  }

  /**
   * Chamada genérica via porteiro.
   * @param {string} path  ex.: '/odds'
   * @param {object} [params]
   * @param {{priority?:'live'|'normal'|'low', label?:string}} [meta]
   */
  call(path, params = {}, meta = {}) {
    const url = `${this.base}${path}${buildQuery(params)}`;
    return this.gk.request(url, { headers: this.headers, method: 'GET' }, meta);
  }

  // ---- Ligas / temporadas ----
  getLeagues(params = {}) {
    return this.call('/leagues', params, { priority: 'low', label: 'leagues' });
  }
  /** Times de uma liga/temporada (pra popular a grade de cobertura). */
  getTeams(leagueId, season) {
    return this.call('/teams', { league: leagueId, season }, { priority: 'low', label: `teams:${leagueId}` });
  }

  // ---- Jogos ----
  /** Jogos por data (YYYY-MM-DD), liga, temporada, intervalo, etc. */
  getFixtures(params = {}, meta = {}) {
    return this.call('/fixtures', params, { priority: 'normal', label: 'fixtures', ...meta });
  }
  getFixtureById(id) {
    return this.call('/fixtures', { id }, { priority: 'normal', label: `fixture:${id}` });
  }
  /** Últimos N jogos de um time (histórico/backfill → prioridade baixa). */
  getTeamLastFixtures(teamId, last = 30) {
    return this.call('/fixtures', { team: teamId, last }, { priority: 'low', label: `team:${teamId}` });
  }

  // ---- Ao vivo (prioridade máxima) ----
  /** Jogos ao vivo. ids = 'all' ou array de fixtureIds. */
  getLiveFixtures(ids = 'all') {
    const live = Array.isArray(ids) ? ids.join('-') : ids;
    return this.call('/fixtures', { live }, { priority: 'live', label: 'live' });
  }
  getFixtureStatistics(fixtureId) {
    return this.call('/fixtures/statistics', { fixture: fixtureId }, { priority: 'live', label: `stats:${fixtureId}` });
  }
  getPredictions(fixtureId) {
    return this.call('/predictions', { fixture: fixtureId }, { priority: 'normal', label: `pred:${fixtureId}` });
  }

  // ---- Odds ----
  /** Odds pré-jogo de um jogo. priority configurável (fechamento pode ser 'live'). */
  getOdds(fixtureId, meta = {}) {
    return this.call('/odds', { fixture: fixtureId }, { priority: 'normal', label: `odds:${fixtureId}`, ...meta });
  }
  /** Odds ao vivo de um jogo. */
  getLiveOdds(fixtureId) {
    return this.call('/odds/live', { fixture: fixtureId }, { priority: 'live', label: `liveodds:${fixtureId}` });
  }

  /** Status da conta (pra checar a chave e a cota). */
  getStatus() {
    return this.call('/status', {}, { priority: 'normal', label: 'status' });
  }
}
