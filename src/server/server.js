// Servidor do dashboard — node:http nativo, zero dependências.
//   • Serve a SPA com Cache-Control: no-store (senão o navegador usa JS velho do cache).
//   • Roteia /api/* pelo router (testável à parte).
//   • Stream de eventos ao vivo via SSE em /api/events/stream.

import http from 'node:http';
import { dashboardHtml } from './html.js';
import { handleApi } from './router.js';

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',   // ARMADILHA: sem isto o navegador serve JS antigo do cache
    ...headers,
  });
  res.end(payload);
}

async function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2_000_000) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

/**
 * Cria o servidor. ctx = { db, client, gatekeeper, secrets, engine, sse }.
 * sse é um Set de respostas conectadas (gerenciado aqui).
 */
export function createServer(ctx) {
  ctx.sse = ctx.sse || new Set();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    // SPA
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      return send(res, 200, dashboardHtml());
    }

    // SSE de eventos ao vivo
    if (req.method === 'GET' && path === '/api/events/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(': conectado\n\n');
      ctx.sse.add(res);
      req.on('close', () => ctx.sse.delete(res));
      return;
    }

    // API
    if (path.startsWith('/api/')) {
      const query = Object.fromEntries(url.searchParams.entries());
      const payload = req.method === 'POST' ? await readBody(req) : query;
      const { status, body } = await handleApi(ctx, req.method, path, payload);
      return send(res, status, body);
    }

    return send(res, 404, { error: 'não encontrado' });
  });

  return server;
}

/** Empurra um evento pra todos os clientes SSE conectados. */
export function broadcastEvent(ctx, ev) {
  if (!ctx.sse) return;
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of ctx.sse) {
    try { res.write(line); } catch { ctx.sse.delete(res); }
  }
}
