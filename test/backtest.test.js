import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/db/migrate.js';
import { upsertMatchStats } from '../src/services/fixturesSync.js';
import { teamGamesBefore, evaluableMatches, backtest, predictFixture } from '../src/services/backtest.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  return db;
}

// Cria as 2 linhas de match_stats de um jogo (mandante homeId, cantos ch x ca).
let autoFx = 1000;
function addMatch(db, { homeId, awayId, ch, ca, playedAt, leagueId = 39 }) {
  const fid = autoFx++;
  upsertMatchStats(db, {
    fixture_id: fid, team_id: homeId, team: 'H', opponent_id: awayId, opponent: 'A',
    league_id: leagueId, season: 2025, competition: 'L', played_at: playedAt, is_home: 1,
    corners_for: ch, corners_against: ca, ht_corners_for: null, ht_corners_against: null,
    shots: null, shots_on: null, dangerous_attacks: null, possession: null,
    yellow: null, red: null, fouls: null, goals_for: 1, goals_against: 0,
    ht_goals_for: 0, ht_goals_against: 0, created_at: 1,
  });
  upsertMatchStats(db, {
    fixture_id: fid, team_id: awayId, team: 'A', opponent_id: homeId, opponent: 'H',
    league_id: leagueId, season: 2025, competition: 'L', played_at: playedAt, is_home: 0,
    corners_for: ca, corners_against: ch, ht_corners_for: null, ht_corners_against: null,
    shots: null, shots_on: null, dangerous_attacks: null, possession: null,
    yellow: null, red: null, fouls: null, goals_for: 0, goals_against: 1,
    ht_goals_for: 0, ht_goals_against: 0, created_at: 1,
  });
  return fid;
}

test('teamGamesBefore não inclui o próprio jogo nem jogos futuros (sem look-ahead)', () => {
  const db = freshDb();
  addMatch(db, { homeId: 1, awayId: 2, ch: 6, ca: 4, playedAt: 100 });
  addMatch(db, { homeId: 1, awayId: 3, ch: 8, ca: 3, playedAt: 200 });
  addMatch(db, { homeId: 1, awayId: 4, ch: 5, ca: 5, playedAt: 300 });
  const before200 = teamGamesBefore(db, 1, 200);
  assert.equal(before200.length, 1);            // só o jogo de played_at=100
  assert.equal(before200[0].played_at, 100);
});

test('evaluableMatches calcula o total real de cantos do jogo', () => {
  const db = freshDb();
  addMatch(db, { homeId: 1, awayId: 2, ch: 7, ca: 4, playedAt: 100 });
  const ms = evaluableMatches(db);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].total_corners, 11);
  assert.equal(ms[0].home_team_id, 1);
  assert.equal(ms[0].away_team_id, 2);
});

test('backtest avisa amostra pequena quando há poucos jogos avaliáveis', () => {
  const db = freshDb();
  for (let i = 0; i < 12; i++) addMatch(db, { homeId: 1, awayId: 2, ch: 6, ca: 4, playedAt: 100 + i });
  const r = backtest(db, { minPriorGames: 3 });
  assert.ok(r.smallSample);
  assert.match(r.verdict, /amostra pequena/i);
});

test('backtest DETECTA poder preditivo quando os times têm forças diferentes', () => {
  const db = freshDb();
  // Mundo sintético: time "ofensivo" (1) sempre faz muitos cantos; time "fraco" (2) poucos.
  // Jogos entre vários adversários, total varia conforme quem joga → modelo deve bater a média.
  let t = 100;
  const strong = [1, 2, 3];   // fazem ~9 cantos
  const weak = [4, 5, 6];     // fazem ~3 cantos
  // monta um calendário longo e variado, alternando confrontos
  for (let round = 0; round < 20; round++) {
    for (const h of [...strong, ...weak]) {
      const a = (h % 6) + 1 === h ? ((h % 6) + 2) : ((h % 6) + 1);
      const chBase = strong.includes(h) ? 6 : 2;
      const caBase = strong.includes(a) ? 6 : 2;
      addMatch(db, { homeId: h, awayId: a, ch: chBase + (round % 2), ca: caBase + (round % 2), playedAt: t++ });
    }
  }
  const r = backtest(db, { minPriorGames: 5 });
  assert.ok(r.evaluated >= 30, `avaliados=${r.evaluated}`);
  // num mundo onde a força importa, o modelo ataque/defesa deve errar MENOS que a média global
  assert.ok(r.maeModel < r.maeBaseline, `modelo ${r.maeModel} vs baseline ${r.maeBaseline}`);
  assert.ok(r.improvementPct > 0);
});

test('backtest sem histórico → verdict pede backfill', () => {
  const db = freshDb();
  const r = backtest(db, {});
  assert.equal(r.evaluated, 0);
  assert.match(r.verdict, /backfill|avaliáveis/i);
});

test('predictFixture usa só histórico até o kickoff', () => {
  const db = freshDb();
  // histórico do time 1 e 2
  for (let i = 0; i < 8; i++) {
    addMatch(db, { homeId: 1, awayId: 9, ch: 7, ca: 4, playedAt: 100 + i });
    addMatch(db, { homeId: 2, awayId: 8, ch: 5, ca: 5, playedAt: 100 + i });
  }
  // jogo futuro a prever
  db.prepare('INSERT INTO fixtures (id, kickoff, home_team_id, away_team_id) VALUES (?,?,?,?)')
    .run(5000, 1000, 1, 2);
  const p = predictFixture(db, 5000);
  assert.ok(p.lambda > 0);
  assert.ok(p.nHome >= 5 && p.nAway >= 5);
});
