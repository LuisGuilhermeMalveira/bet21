// PORTEIRO — rate limiter central da API-Football.
//
// REGRA DE OURO: TODA chamada à API passa por aqui. Estourar o limite por
// minuto pode bloquear o acesso. Então o porteiro:
//   1. Lê os headers de cada resposta (restantes no minuto e no dia).
//   2. Auto-regula: se sobram poucas no minuto, ESPERA o minuto virar.
//   3. Espaça as chamadas (fila com intervalo mínimo) — nunca dispara rajada.
//   4. Backoff crescente em erro 429 (e em erro de rate limit no corpo 200).
//   5. Prioriza o AO VIVO; histórico/backfill esperam.
//   6. Trata 200 com resultado vazio como "dado indisponível", não erro.
//
// Tudo é injetável (fetchFn/sleep/now) pra permitir teste determinístico.

export const PRIORITY = { live: 0, normal: 1, low: 2 };

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toNum(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export class ApiGatekeeper {
  constructor(opts = {}) {
    this.fetchFn = opts.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    this.sleep = opts.sleep || realSleep;
    this.now = opts.now || (() => Date.now());

    this.minIntervalMs = opts.minIntervalMs ?? 350;       // espaçamento entre chamadas
    this.minuteSafetyMargin = opts.minuteSafetyMargin ?? 2; // ao restar <= isso, espera virar o minuto
    this.minuteWindowMs = opts.minuteWindowMs ?? 60000;
    this.maxRetries = opts.maxRetries ?? 4;
    this.baseBackoffMs = opts.baseBackoffMs ?? 1000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 60000;
    this.onStats = opts.onStats || null;

    /** @type {Array<any>} */
    this.queue = [];
    this.running = false;
    this.seq = 0;

    this.lastCallAt = 0;
    this.remainingMinute = Infinity;
    this.remainingDay = Infinity;
    this.limitMinute = null;
    this.limitDay = null;
    this.windowStart = 0;

    this.lastError = null;
    this.lastSuccessAt = 0;
    this.totalCalls = 0;
  }

  /** Estado pro painel de saúde. */
  stats() {
    return {
      remainingMinute: this.remainingMinute === Infinity ? null : this.remainingMinute,
      remainingDay: this.remainingDay === Infinity ? null : this.remainingDay,
      limitMinute: this.limitMinute,
      limitDay: this.limitDay,
      queueLength: this.queue.length,
      lastError: this.lastError,
      lastSuccessAt: this.lastSuccessAt || null,
      totalCalls: this.totalCalls,
    };
  }

  /**
   * Enfileira uma requisição. Resolve com objeto normalizado
   * { status, ok, data, response, empty, errors, remainingMinute, remainingDay }.
   * Não rejeita por status HTTP de negócio; só rejeita em erro de rede após esgotar retries.
   * @param {string} url
   * @param {RequestInit} [options]
   * @param {{priority?:'live'|'normal'|'low', label?:string}} [meta]
   */
  request(url, options = {}, meta = {}) {
    if (!this.fetchFn) {
      return Promise.reject(new Error('Porteiro sem fetch disponível (Node < 18?).'));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({
        url,
        options,
        priority: PRIORITY[meta.priority] ?? PRIORITY.normal,
        label: meta.label || '',
        seq: this.seq++,
        retries: 0,
        resolve,
        reject,
      });
      // Ordena por prioridade e, dentro dela, por ordem de chegada (FIFO estável).
      this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      // Adia o pump um microtask pra que rajadas síncronas de request() já
      // entrem na fila antes do processamento começar (garante prioridade correta).
      queueMicrotask(() => this._pump());
    });
  }

  async _pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const item = this.queue.shift();
        await this._process(item);
      }
    } finally {
      this.running = false;
    }
  }

  _backoff(retries) {
    return Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** (retries - 1));
  }

  async _respectSpacing() {
    const since = this.now() - this.lastCallAt;
    if (this.lastCallAt && since < this.minIntervalMs) {
      await this.sleep(this.minIntervalMs - since);
    }
  }

  async _maybeWaitForMinute() {
    const t = this.now();
    if (this.windowStart === 0) this.windowStart = t;
    // Rolou um minuto desde o início da janela → reseta a contagem otimista.
    if (t - this.windowStart >= this.minuteWindowMs) {
      this.windowStart = t;
      this.remainingMinute = this.limitMinute != null ? this.limitMinute : Infinity;
    }
    // Restam poucas no minuto → espera a janela virar.
    if (this.remainingMinute <= this.minuteSafetyMargin) {
      const elapsed = this.now() - this.windowStart;
      const wait = Math.max(0, this.minuteWindowMs - elapsed) + 250;
      await this.sleep(wait);
      this.windowStart = this.now();
      this.remainingMinute = this.limitMinute != null ? this.limitMinute : Infinity;
    }
  }

  _readHeaders(res) {
    const h = res && res.headers;
    if (!h || typeof h.get !== 'function') {
      // Sem headers → decrementa local pra não perder o controle.
      if (this.remainingMinute !== Infinity) this.remainingMinute -= 1;
      return;
    }
    const remMin = toNum(h.get('x-ratelimit-remaining'));
    const remDay = toNum(h.get('x-ratelimit-requests-remaining'));
    const limMin = toNum(h.get('x-ratelimit-limit'));
    const limDay = toNum(h.get('x-ratelimit-requests-limit'));

    if (limMin != null) this.limitMinute = limMin;
    if (limDay != null) this.limitDay = limDay;
    if (remMin != null) this.remainingMinute = remMin;
    else if (this.remainingMinute !== Infinity) this.remainingMinute -= 1;
    if (remDay != null) this.remainingDay = remDay;

    if (this.onStats) this.onStats(this.stats());
  }

  _isRateLimitError(errors) {
    if (!errors) return false;
    // A API às vezes manda errors como objeto {rateLimit: "..."} ou array.
    const text = JSON.stringify(errors).toLowerCase();
    return text.includes('rate') && text.includes('limit');
  }

  async _process(item) {
    for (;;) {
      await this._respectSpacing();
      await this._maybeWaitForMinute();

      let res;
      this.lastCallAt = this.now();
      this.totalCalls += 1;
      try {
        res = await this.fetchFn(item.url, item.options);
      } catch (err) {
        // Erro de rede → backoff e tenta de novo, até esgotar.
        this.lastError = `network: ${err && err.message ? err.message : err}`;
        if (++item.retries > this.maxRetries) {
          item.reject(err);
          return;
        }
        await this.sleep(this._backoff(item.retries));
        continue;
      }

      this._readHeaders(res);
      const status = res.status;

      // 429: too many requests → backoff + força esperar o minuto.
      if (status === 429) {
        this.lastError = '429 Too Many Requests';
        if (++item.retries > this.maxRetries) {
          item.resolve({
            status, ok: false, data: null, response: null,
            empty: false, error: 'rate_limited',
            remainingMinute: this.remainingMinute, remainingDay: this.remainingDay,
          });
          return;
        }
        await this.sleep(this._backoff(item.retries));
        this.remainingMinute = 0; // próxima volta vai esperar a janela
        continue;
      }

      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      const errors = body && body.errors;
      const hasErrors = errors && (Array.isArray(errors) ? errors.length : Object.keys(errors).length);

      if (this._isRateLimitError(errors)) {
        this.lastError = 'rate limit (corpo 200)';
        if (++item.retries > this.maxRetries) {
          item.resolve({
            status, ok: false, data: body, response: null,
            empty: false, error: 'rate_limited', errors,
            remainingMinute: this.remainingMinute, remainingDay: this.remainingDay,
          });
          return;
        }
        await this.sleep(this._backoff(item.retries));
        this.remainingMinute = 0;
        continue;
      }

      // Quantos resultados vieram (formato API-Football).
      let resultCount = null;
      if (body && typeof body.results === 'number') resultCount = body.results;
      else if (body && Array.isArray(body.response)) resultCount = body.response.length;

      this.lastSuccessAt = this.now();
      this.lastError = null;

      item.resolve({
        status,
        ok: res.ok !== false && status >= 200 && status < 300,
        data: body,
        response: (body && body.response) ?? null,
        empty: resultCount === 0, // 200 vazio = dado indisponível, NÃO erro
        errors: hasErrors ? errors : null,
        remainingMinute: this.remainingMinute === Infinity ? null : this.remainingMinute,
        remainingDay: this.remainingDay === Infinity ? null : this.remainingDay,
      });
      return;
    }
  }
}
