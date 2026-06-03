#!/usr/bin/env node

// Script de backfill: puxar histórico de cantos.
// Roda com: npm run backfill [--cap=1500] [--games=30] [--leagues=39,61]

import { openDb } from '../src/db/index.js';
import { loadEnv, getSecrets } from '../src/config/env.js';
import { ApiGatekeeper } from '../src/api/gatekeeper.js';
import { ApiFootball } from '../src/api/apifootball.js';
import { runBackfill, activeTeamIds } from '../src/services/backfill.js';

async function main() {
  try {
    // Parse args
    const args = process.argv.slice(2);
    let cap = 1500, games = 30, leagueIds = null;
    for (const arg of args) {
      if (arg.startsWith('--cap=')) cap = parseInt(arg.substring(6), 10);
      if (arg.startsWith('--games=')) games = parseInt(arg.substring(8), 10);
      if (arg.startsWith('--leagues=')) leagueIds = arg.substring(10).split(',').map(x => parseInt(x, 10));
    }

    // Init
    loadEnv();
    const db = openDb();
    const secrets = getSecrets();

    if (!secrets.apiKey) {
      console.error('❌ APIFOOTBALL_KEY não está configurada em .env');
      db.close();
      process.exit(1);
    }

    // Cria porteiro e cliente (cliente recebe um OBJETO de opções)
    const gatekeeper = new ApiGatekeeper({ minIntervalMs: 220, maxPerMinute: 280 });
    const client = new ApiFootball({ gatekeeper, apiKey: secrets.apiKey });

    // Times (com filtro opcional de ligas)
    let teamIds = activeTeamIds(db);
    if (leagueIds && leagueIds.length > 0) {
      const placeholders = leagueIds.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT DISTINCT home_team_id AS id FROM fixtures WHERE league_id IN (${placeholders})
        UNION
        SELECT DISTINCT away_team_id FROM fixtures WHERE league_id IN (${placeholders})
      `).all(...leagueIds, ...leagueIds);
      teamIds = rows.map(r => r.id);
    }

    if (teamIds.length === 0) {
      console.error('❌ Nenhum time encontrado. Sincronize jogos e ative ligas primeiro.');
      db.close();
      process.exit(1);
    }

    // Roda o backfill
    const ctx = { db, secrets, gatekeeper, client, engine: { running: false } };
    console.log(`\n📋 Backfill de histórico de cantos`);
    console.log(`   Times: ${teamIds.length} · Jogos/time: ${games} · Limite: ${cap} requisições\n`);

    const startTime = Date.now();
    const result = await runBackfill(ctx, { teamIds, last: games, cap });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n✅ Concluído em ${elapsed}s`);
    console.log(`   ${result.matchStatsStored} jogos guardados`);
    console.log(`   ${result.apiCallsMade}/${cap} requisições usadas`);
    if (result.stoppedEarly) {
      console.log(`   ⚠️  Parou no limite. Rode novamente amanhã para continuar.`);
    }

    db.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Erro:', err?.message || err);
    process.exit(1);
  }
}

main();
