import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiFootball, buildQuery } from '../src/api/apifootball.js';
import { ApiGatekeeper } from '../src/api/gatekeeper.js';

// Porteiro com fetch falso que só registra a URL/options chamadas.
function spyClient({ apiKey = 'KEY123' } = {}) {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    return {
      status: 200, ok: true,
      headers: { get: () => null },
      json: async () => ({ results: 1, response: [{ ok: true }] }),
    };
  };
  const gk = new ApiGatekeeper({ fetchFn, sleep: async () => {}, now: () => 1000, minIntervalMs: 0 });
  const client = new ApiFootball({ gatekeeper: gk, apiKey });
  return { client, calls, gk };
}

test('buildQuery ignora vazio/null/undefined', () => {
  assert.equal(buildQuery({ a: 1, b: '', c: null, d: undefined, e: 'x' }), '?a=1&e=x');
  assert.equal(buildQuery({}), '');
});

test('monta URL no host v3 e envia header x-apisports-key', async () => {
  const { client, calls } = spyClient();
  await client.getFixtures({ date: '2026-05-31', league: 39, season: 2025 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/v3\.football\.api-sports\.io\/fixtures\?/);
  assert.match(calls[0].url, /date=2026-05-31/);
  assert.match(calls[0].url, /league=39/);
  assert.equal(calls[0].options.headers['x-apisports-key'], 'KEY123');
});

test('getLiveFixtures: array de ids vira id-id-id; default = all', async () => {
  const { client, calls } = spyClient();
  await client.getLiveFixtures([111, 222, 333]);
  assert.match(calls[0].url, /live=111-222-333/);
  await client.getLiveFixtures();
  assert.match(calls[1].url, /live=all/);
});

test('endpoints de stats/predictions/odds usam o parâmetro fixture', async () => {
  const { client, calls } = spyClient();
  await client.getFixtureStatistics(900);
  await client.getPredictions(900);
  await client.getOdds(900);
  assert.match(calls[0].url, /\/fixtures\/statistics\?fixture=900/);
  assert.match(calls[1].url, /\/predictions\?fixture=900/);
  assert.match(calls[2].url, /\/odds\?fixture=900/);
});

test('exige porteiro no construtor', () => {
  assert.throws(() => new ApiFootball({ apiKey: 'x' }), /porteiro|gatekeeper/i);
});

test('ao vivo tem prioridade sobre backfill mesmo enfileirado depois', async () => {
  const { client, calls } = spyClient();
  // dispara backfill (low) e, logo em seguida, ao vivo (live)
  await Promise.all([
    client.getTeamLastFixtures(33, 30), // low
    client.getLiveFixtures('all'),      // live
  ]);
  // o ao vivo deve ter ido primeiro
  assert.match(calls[0].url, /live=all/);
  assert.match(calls[1].url, /team=33/);
});
