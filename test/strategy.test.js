// Backtest da estratégia: "se o app existisse no passado, teria funcionado?"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { strategyBacktest } from '../src/services/backtest.js';

function db0(){ return openDb(':memory:'); }

// Semeia uma liga onde DOIS times "canteiros" jogam muito acima da média da liga.
// O modelo (com histórico) deve detectar e a simulação deve lucrar nos overs deles.
function seedLeague(db, { leagueId = 71, nTeams = 8, rounds = 30 } = {}){
  db.prepare("INSERT INTO leagues (id,name,country,active,season) VALUES (?,?,?,1,2025)").run(leagueId, 'Liga T', 'Brazil');
  const ins = db.prepare(`INSERT INTO match_stats (fixture_id, team_id, opponent_id, league_id, season, played_at, is_home, corners_for, corners_against)
    VALUES (?,?,?,?,2025,?,?,?,?)`);
  let fid = 1; let ts = 1600000000;
  for (let r = 0; r < rounds; r++) {
    for (let a = 1; a <= nTeams; a += 2) {
      const home = a, away = a + 1;
      // times 1 e 2: jogos com MUITO canto (14); os outros: 8
      const big = (home <= 2 || away <= 2);
      const total = big ? 14 : 8;
      const ch = Math.ceil(total / 2), ca = total - ch;
      ins.run(fid, home, away, leagueId, ts, 1, ch, ca);
      ins.run(fid, away, home, leagueId, ts, 0, ca, ch);
      fid += 1; ts += 86400;
    }
  }
}

test('strategyBacktest: modelo bate o baseline quando há padrão real', () => {
  const db = db0();
  seedLeague(db);
  const r = strategyBacktest(db, { minPriorGames: 8 });
  assert.ok(r.evaluated > 50, 'avaliou bastante jogo');
  assert.ok(r.maeModel < r.maeBaseline, 'o modelo erra menos que chutar a média (há padrão pra achar)');
  assert.ok(r.improvementPct > 0);
});

test('strategyBacktest: viés por liga aparece e simulação lucra com odds sintéticas', () => {
  const db = db0();
  seedLeague(db);
  const r = strategyBacktest(db, { minPriorGames: 8 });
  assert.ok(Array.isArray(r.leagues) && r.leagues.length >= 1, 'tem detalhe por liga');
  assert.ok(r.leagues[0].n >= 20);
  // a simulação deve apostar (os jogos dos canteiros desviam da linha da liga) e dar lucro
  assert.ok(r.simulation.nBets > 0, 'fez apostas simuladas');
  assert.ok(r.simulation.profit > 0, 'lucra num mundo com padrão claro (sanidade da mecânica)');
  assert.ok(r.simulation.hitRate > 0.5);
});

test('strategyBacktest: sem histórico devolve veredito de vazio', () => {
  const db = db0();
  const r = strategyBacktest(db, {});
  assert.equal(r.evaluated, 0);
  assert.match(r.verdict, /backfill|avaliáveis/i);
});

test('anti-vazamento: o primeiro jogo de cada time é pulado (sem passado)', () => {
  const db = db0();
  seedLeague(db, { rounds: 3 }); // pouco histórico
  const r = strategyBacktest(db, { minPriorGames: 8 });
  assert.ok(r.skipped > 0, 'jogos sem passado suficiente são pulados, não chutados');
});
