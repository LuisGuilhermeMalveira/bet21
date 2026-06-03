// Entry point do dashboard: npm run dashboard
// Abre o banco, monta o contexto (porteiro + cliente, se houver chave), sobe o
// servidor e inicia os loops de fundo (captura, settle, engine ao vivo, backup).

import { openDb } from '../src/db/index.js';
import { getSecrets } from '../src/config/env.js';
import * as cfg from '../src/config/settings.js';
import { ApiGatekeeper } from '../src/api/gatekeeper.js';
import { ApiFootball } from '../src/api/apifootball.js';
import { createServer } from '../src/server/server.js';
import { startLoops } from '../src/services/loops.js';
import { syncAutostart } from '../src/services/autostart.js';

const db = openDb();
const secrets = getSecrets();

// Porteiro alinhado ao plano (300/min). minIntervalMs = 60000/300 = 200ms.
const gatekeeper = new ApiGatekeeper({ minIntervalMs: 220, maxPerMinute: 280 });
const client = secrets.apiKey ? new ApiFootball({ gatekeeper, apiKey: secrets.apiKey }) : null;

const ctx = { db, secrets, gatekeeper, client, engine: { running: false } };
const server = createServer(ctx);

// Aplica "subir com o Windows" conforme a configuração (best-effort).
try { syncAutostart(cfg.get(db, 'settings', 'start_with_windows') === true); } catch { /* ignora */ }

const port = secrets.port || 21321;
let stopLoops = () => {};

server.listen(port, () => {
  console.log('\n  Bet21 rodando em  http://localhost:' + port + '\n');
  if (!secrets.apiKey) {
    console.log('  ⚠ Sem APIFOOTBALL_KEY no .env — o painel abre, mas sincronizar/capturar exige a chave.\n');
  } else {
    // Só inicia os loops se há cliente (senão não há o que automatizar).
    stopLoops = startLoops(ctx);
    console.log('  Loops de fundo ligados (captura, settle, engine ao vivo, backup).\n');
    console.log('  Dica: ligue o engine no Painel pra ele começar a vigiar os jogos ao vivo.\n');
  }
});

function shutdown() {
  try { stopLoops(); } catch { /* ignora */ }
  try { server.close(); } catch { /* ignora */ }
  try { db.close(); } catch { /* ignora */ }
  process.exitCode = 0;
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
