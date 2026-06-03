import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiGatekeeper } from '../src/api/gatekeeper.js';

// Relógio falso: sleep "passa o tempo" instantaneamente, deixando os testes
// determinísticos e rápidos (sem esperar 60s de verdade).
function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
    sleepRecorder() {
      const sleeps = [];
      const sleep = (ms) => { sleeps.push(ms); t += ms; return Promise.resolve(); };
      return { sleep, sleeps };
    },
  };
}

// Resposta falsa no formato fetch (headers.get + json()).
function fakeRes({ status = 200, body, headers = {} } = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => (map.has(k.toLowerCase()) ? map.get(k.toLowerCase()) : null) },
    json: async () => (body !== undefined ? body : { results: 1, response: [{ ok: true }] }),
  };
}

test('espaça as chamadas pelo intervalo mínimo (nunca rajada)', async () => {
  const clock = makeClock();
  const { sleep } = clock.sleepRecorder();
  const calls = [];
  const fetchFn = async (url) => {
    calls.push({ url, at: clock.now() });
    return fakeRes({ headers: { 'x-ratelimit-remaining': 100 } });
  };
  const gk = new ApiGatekeeper({ fetchFn, sleep, now: clock.now, minIntervalMs: 350 });

  await Promise.all([gk.request('a'), gk.request('b'), gk.request('c')]);

  assert.equal(calls.length, 3);
  assert.ok(calls[1].at - calls[0].at >= 350, 'segunda chamada deve respeitar o intervalo');
  assert.ok(calls[2].at - calls[1].at >= 350, 'terceira chamada deve respeitar o intervalo');
});

test('prioriza o ao vivo sobre normal e backfill', async () => {
  const clock = makeClock();
  const { sleep } = clock.sleepRecorder();
  const order = [];
  const fetchFn = async (url) => {
    order.push(url);
    return fakeRes({ headers: { 'x-ratelimit-remaining': 100 } });
  };
  const gk = new ApiGatekeeper({ fetchFn, sleep, now: clock.now, minIntervalMs: 0 });

  // Enfileira em ordem "errada" de propósito.
  await Promise.all([
    gk.request('backfill', {}, { priority: 'low' }),
    gk.request('normal', {}, { priority: 'normal' }),
    gk.request('live', {}, { priority: 'live' }),
  ]);

  assert.deepEqual(order, ['live', 'normal', 'backfill']);
});

test('backoff e retry em 429, depois sucesso', async () => {
  const clock = makeClock();
  const { sleep, sleeps } = clock.sleepRecorder();
  let n = 0;
  const fetchFn = async () => {
    n += 1;
    if (n === 1) return fakeRes({ status: 429, body: {} });
    return fakeRes({ headers: { 'x-ratelimit-remaining': 100 } });
  };
  const gk = new ApiGatekeeper({
    fetchFn, sleep, now: clock.now,
    minIntervalMs: 0, baseBackoffMs: 1000,
  });

  const result = await gk.request('x');
  assert.equal(n, 2, 'deve ter repetido a chamada uma vez');
  assert.equal(result.ok, true);
  assert.ok(sleeps.includes(1000), 'deve ter feito backoff de 1000ms na primeira falha');
});

test('quando restam poucas chamadas no minuto, espera o minuto virar', async () => {
  const clock = makeClock();
  const { sleep, sleeps } = clock.sleepRecorder();
  const fetchFn = async () =>
    // só 1 restante no minuto (<= margem padrão 2) → próxima deve esperar
    fakeRes({ headers: { 'x-ratelimit-remaining': 1 } });
  const gk = new ApiGatekeeper({ fetchFn, sleep, now: clock.now, minIntervalMs: 0, minuteWindowMs: 60000 });

  await gk.request('a');
  await gk.request('b');

  assert.ok(
    sleeps.some((ms) => ms >= 60000),
    'deve ter esperado ~1 minuto antes da segunda chamada'
  );
});

test('200 com resultado vazio = dado indisponível, não erro', async () => {
  const clock = makeClock();
  const { sleep } = clock.sleepRecorder();
  const fetchFn = async () =>
    fakeRes({ body: { results: 0, response: [] }, headers: { 'x-ratelimit-remaining': 100 } });
  const gk = new ApiGatekeeper({ fetchFn, sleep, now: clock.now, minIntervalMs: 0 });

  const r = await gk.request('odds');
  assert.equal(r.empty, true);
  assert.equal(r.ok, true);
  assert.equal(r.error, undefined);
});

test('erro de rate limit dentro do corpo 200 também faz backoff e retry', async () => {
  const clock = makeClock();
  const { sleep } = clock.sleepRecorder();
  let n = 0;
  const fetchFn = async () => {
    n += 1;
    if (n === 1) return fakeRes({ body: { errors: { rateLimit: 'Too many requests' }, response: [] } });
    return fakeRes({ headers: { 'x-ratelimit-remaining': 100 } });
  };
  const gk = new ApiGatekeeper({ fetchFn, sleep, now: clock.now, minIntervalMs: 0, baseBackoffMs: 500 });

  const r = await gk.request('y');
  assert.equal(n, 2);
  assert.equal(r.ok, true);
});

test('lê headers e expõe stats pro painel de saúde', async () => {
  const clock = makeClock();
  const { sleep } = clock.sleepRecorder();
  const fetchFn = async () =>
    fakeRes({
      headers: {
        'x-ratelimit-remaining': 250,
        'x-ratelimit-limit': 300,
        'x-ratelimit-requests-remaining': 7000,
        'x-ratelimit-requests-limit': 7500,
      },
    });
  const gk = new ApiGatekeeper({ fetchFn, sleep, now: clock.now, minIntervalMs: 0 });

  await gk.request('a');
  const s = gk.stats();
  assert.equal(s.remainingMinute, 250);
  assert.equal(s.limitMinute, 300);
  assert.equal(s.remainingDay, 7000);
  assert.equal(s.limitDay, 7500);
  assert.equal(s.totalCalls, 1);
});

test('esgota retries de rede e rejeita (sem repetir pra sempre)', async () => {
  const clock = makeClock();
  const { sleep } = clock.sleepRecorder();
  const fetchFn = async () => { throw new Error('ECONNRESET'); };
  const gk = new ApiGatekeeper({ fetchFn, sleep, now: clock.now, minIntervalMs: 0, maxRetries: 2 });

  await assert.rejects(() => gk.request('a'), /ECONNRESET/);
});
