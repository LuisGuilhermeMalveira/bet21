#!/usr/bin/env node

import { openDb } from '../src/db/index.js';
import { loadEnv, getSecrets } from '../src/config/env.js';
import { ApiGatekeeper } from '../src/api/gatekeeper.js';
import { ApiFootball } from '../src/api/apifootball.js';
import { runBackfill, activeTeamIds } from '../src/services/backfill.js';

// Parse flags
const args = process.argv.slice(2);
let cap = 1500, games = 30, leagueFilter = null;
for (const arg of args) {
  if (arg.startsWith('--cap=')) cap = parseInt(arg.slice(6));
  if (arg.startsWith('--games=')) games = parseInt(arg.slice(8));
  if (arg.startsWith('--leagues=')) leagueFilter = arg.slice(10).split(',').map(x => parseInt(x));
}

// Setup
loadEnv();
const db = openDb();
const secrets = getSecrets();

if (!secrets.apiKey) {
  console.error('❌ APIFOOTBALL_KEY não em .env');
  db.close();
  process.exit(1);
}

const gk = new ApiGatekeeper({ minIntervalMs: 350, maxPerMinute: 50 });
const client = new ApiFootball(secrets.apiKey, gk);

// Times
let teamIds = activeTeamIds(db);
if (leagueFilter && leagueFilter.length > 0) {
  const ph = leagueFilter.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT DISTINCT home_team_id id FROM fixtures WHERE league_id IN (${ph})
    UNION SELECT DISTINCT away_team_id id FROM fixtures WHERE league_id IN (${ph})
  `).all(...leagueFilter, ...leagueFilter);
  teamIds = rows.map(r => r.id);
}

if (teamIds.length === 0) {
  console.error('❌ Nenhum time. Sincronize jogos e ative ligas.');
  db.close();
  process.exit(1);
}

// Roda
const ctx = { db, secrets, gatekeeper: gk, client, engine: { running: false } };
console.log(`\n📋 Backfill: ${teamIds.length} times, ${games} jogos/time, cap ${cap}\n`);

const t0 = Date.now();
runBackfill(ctx, { teamIds, last: games, cap })
  .then(s => {
    const t = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n✅ OK em ${t}s: ${s.matchStatsStored} jogos, ${s.apiCallsMade}/${cap} req`);
    if (s.stoppedEarly) console.log('   ⚠️  Parou no limite.');
  })
  .catch(e => console.error('❌ Erro:', e?.message || e))
  .finally(() => { db.close(); process.exit(0); });
