// Odds AO VIVO no motor: parser do /odds/live + tick usando linha fresca.
// Bug real: o motor comparava o modelo de agora com a odd PRÉ-JOGO (linha já estourada).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveCornerLines } from '../src/api/oddsParser.js';
import { openDb } from '../src/db/index.js';
import { liveEngineTick } from '../src/services/loops.js';

// ---------- parser ----------

function liveItem(markets){ return { odds: markets }; }

test('parseLiveCornerLines extrai linhas com handicap e ignora suspensas', () => {
  const item = liveItem([
    { name: 'Over/Under Corners', values: [
      { value: 'Over', odd: '1.42', handicap: '12.5', suspended: false },
      { value: 'Under', odd: '2.67', handicap: '12.5', suspended: false },
      { value: 'Over', odd: '2.82', handicap: '13.5', suspended: false },
      { value: 'Over', odd: '6.40', handicap: '14.5', suspended: true },  // suspensa!
    ] },
  ]);
  const lines = parseLiveCornerLines(item);
  assert.equal(lines.length, 2, 'só as não-suspensas com over');
  assert.deepEqual(lines.map((l) => l.line), [12.5, 13.5]);
  assert.equal(lines[0].overOdd, 1.42);
  assert.equal(lines[0].underOdd, 2.67);
  assert.equal(lines[1].overOdd, 2.82);
});

test('parseLiveCornerLines ignora mercados de 1º tempo e não-cantos', () => {
  const item = liveItem([
    { name: '1st Half Corners Over/Under', values: [ { value: 'Over', odd: '2.0', handicap: '5.5' } ] },
    { name: 'Over/Under Goals', values: [ { value: 'Over', odd: '1.8', handicap: '2.5' } ] },
    { name: 'Total Corners', values: [ { value: 'Over', odd: '1.9', handicap: '11.5' } ] },
  ]);
  const lines = parseLiveCornerLines(item);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].line, 11.5);
});

test('parseLiveCornerLines: linha implausível é descartada', () => {
  const item = liveItem([
    { name: 'Corners Over/Under', values: [
      { value: 'Over', odd: '1.9', handicap: '55.5' },  // absurda
      { value: 'Over', odd: '1.9', handicap: '10.5' },
    ] },
  ]);
  const lines = parseLiveCornerLines(item);
  assert.deepEqual(lines.map((l) => l.line), [10.5]);
});

// ---------- integração: o caso Goiás ----------

function setupGame(db){
  db.prepare("INSERT INTO leagues (id,name,active) VALUES (72,'Serie B',1)").run();
  // jogo ao vivo: linha PRÉ-JOGO 10.25 (já estourada com 12 cantos)
  db.prepare(`INSERT INTO fixtures (id, league_id, season, kickoff, home_team_id, home_team, away_team_id, away_team,
    status_short, monitored, corner_line, corner_over_odd, corner_bookmaker, odds_home, odds_draw, odds_away)
    VALUES (900, 72, 2025, 1700000000, 1, 'Goias', 2, 'Novorizontino', '2H', 1, 10.25, 1.98, 'pre', 1.8, 3.4, 4.2)`).run();
  // histórico pros dois times (λ pré-jogo) — 25 jogos cada com ~10 cantos
  const ins = db.prepare(`INSERT INTO match_stats (fixture_id, team_id, opponent_id, league_id, season, played_at, is_home, corners_for, corners_against)
    VALUES (?, ?, ?, 72, 2025, ?, 1, 5, 5)`);
  let fid = 1000;
  for (let i = 0; i < 25; i++) { ins.run(fid++, 1, 9, 1690000000 + i*86400); ins.run(fid++, 2, 9, 1690000000 + i*86400); }
  // amostras ao vivo: ritmo morno até os 70, ACELERANDO forte dos 72 aos 80 (pressão sobe)
  const sm = db.prepare(`INSERT INTO live_samples (fixture_id, minute, shots_on_home, shots_on_away, dangerous_home, dangerous_away, corners_home, corners_away, shots_home, shots_away, goals_home, goals_away)
    VALUES (900, ?, ?, 0, ?, 0, ?, 0, ?, 0, 0, 1)`);
  for (let m = 40; m <= 70; m += 2) sm.run(m, m*0.08, m*0.5, m*0.10, m*0.18);
  for (let m = 72; m <= 80; m += 2) sm.run(m, 70*0.08 + (m-70)*0.5, 70*0.5 + (m-70)*3.0, 70*0.10 + (m-70)*0.35, 70*0.18 + (m-70)*0.9);
}

test('tick ao vivo usa odds AO VIVO quando em janela ativa (caso Goiás)', async () => {
  const db = openDb(':memory:');
  setupGame(db);
  let liveOddsCalled = 0;
  const ctx = {
    db, engine: { running: true },
    client: {
      async getLiveFixtures(){ return { response: [ { fixture: { id: 900, status: { elapsed: 80 } }, goals: { home: 0, away: 1 } } ] }; },
      async getFixtureStatistics(){ return { response: [
        { team: { id: 1 }, statistics: [ { type: 'Corner Kicks', value: 12 }, { type: 'Shots on Goal', value: 11 }, { type: 'Dangerous Attacks', value: 65 }, { type: 'Total Shots', value: 22 } ] },
        { team: { id: 2 }, statistics: [ { type: 'Corner Kicks', value: 0 }, { type: 'Shots on Goal', value: 2 }, { type: 'Dangerous Attacks', value: 18 }, { type: 'Total Shots', value: 6 } ] },
      ] }; },
      async getLiveOdds(){ liveOddsCalled++; return { response: [ liveItem([
        { name: 'Over/Under Corners', values: [
          { value: 'Over', odd: '2.82', handicap: '13.5', suspended: false },
          { value: 'Over', odd: '1.42', handicap: '12.5', suspended: false },
        ] },
      ]) ] }; },
    },
  };
  const r = await liveEngineTick(ctx, {});
  assert.equal(r.checked, 1);
  assert.ok(liveOddsCalled >= 1, 'buscou odds ao vivo (estava na janela 80-86)');
  const snap = ctx.liveState.get(900);
  assert.equal(snap.oddsSource, 'live', 'usou as odds AO VIVO, não as pré-jogo');
  // com a linha fresca (12.5 @ 1.42 / 13.5 @ 2.82) e pressão subindo, o EV fecha → dispara
  assert.equal(r.fired, 1, 'sinal dispara com a odd ao vivo (a pré-jogo 10.25 estava morta)');
  const sig = db.prepare('SELECT * FROM signals WHERE fixture_id = 900').get();
  assert.ok(sig, 'sinal gravado');
  assert.ok([12.5, 13.5].includes(sig.line), 'usou uma linha AO VIVO (12.5 ou 13.5), não a 10.25 pré-jogo');
});

test('fora da janela: NÃO gasta chamada de odds ao vivo', async () => {
  const db = openDb(':memory:');
  setupGame(db);
  let liveOddsCalled = 0;
  const ctx = {
    db, engine: { running: true },
    client: {
      async getLiveFixtures(){ return { response: [ { fixture: { id: 900, status: { elapsed: 60 } }, goals: { home: 0, away: 4 } } ] }; },
      async getFixtureStatistics(){ return { response: [] }; },
      async getLiveOdds(){ liveOddsCalled++; return { response: [] }; },
    },
  };
  await liveEngineTick(ctx, {});
  assert.equal(liveOddsCalled, 0, 'aos 60 min (fora de 32-41 e 80-86) não busca odds live');
});
