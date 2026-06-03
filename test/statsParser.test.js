import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFixture, isFinished, parsePercent, parseTeamStatistics, buildMatchStatsRows,
} from '../src/api/statsParser.js';

function apiFixture() {
  return {
    fixture: { id: 700, timestamp: 1900000000, status: { short: 'FT', long: 'Match Finished', elapsed: 90 } },
    league: { id: 39, season: 2025, name: 'Premier League' },
    teams: { home: { id: 33, name: 'Man United' }, away: { id: 40, name: 'Liverpool' } },
    goals: { home: 2, away: 1 },
    score: { halftime: { home: 1, away: 0 } },
  };
}

function apiStats() {
  return [
    { team: { id: 33, name: 'Man United' }, statistics: [
      { type: 'Corner Kicks', value: 7 },
      { type: 'Total Shots', value: 14 },
      { type: 'Shots on Goal', value: 6 },
      { type: 'Ball Possession', value: '55%' },
      { type: 'Yellow Cards', value: 2 },
      { type: 'Red Cards', value: null },
      { type: 'Fouls', value: 11 },
    ] },
    { team: { id: 40, name: 'Liverpool' }, statistics: [
      { type: 'Corner Kicks', value: 4 },
      { type: 'Total Shots', value: 9 },
      { type: 'Shots on Goal', value: 3 },
      { type: 'Ball Possession', value: '45%' },
    ] },
  ];
}

test('parsePercent converte "55%" → 55 e aceita número', () => {
  assert.equal(parsePercent('55%'), 55);
  assert.equal(parsePercent(45), 45);
  assert.equal(parsePercent(null), null);
});

test('parseFixture normaliza placar, times, data e competição', () => {
  const pf = parseFixture(apiFixture());
  assert.equal(pf.id, 700);
  assert.equal(pf.status_short, 'FT');
  assert.equal(pf.home_team_id, 33);
  assert.equal(pf.away_team, 'Liverpool');
  assert.equal(pf.goals_home, 2);
  assert.equal(pf.ht_goals_home, 1);
  assert.equal(pf.competition, 'Premier League');
});

test('isFinished true só para FT/AET/PEN', () => {
  assert.equal(isFinished({ status_short: 'FT' }), true);
  assert.equal(isFinished({ status_short: 'NS' }), false);
  assert.equal(isFinished({ status_short: '1H' }), false);
});

test('parseTeamStatistics mapeia os type da API pros nossos campos', () => {
  const m = parseTeamStatistics(apiStats());
  const ht = m.get(33);
  assert.equal(ht.corners_for, 7);
  assert.equal(ht.shots, 14);
  assert.equal(ht.shots_on, 6);
  assert.equal(ht.possession, 55);
  assert.equal(ht.yellow, 2);
  assert.equal(ht.red, null);
  assert.equal(ht.fouls, 11);
  assert.equal(ht.dangerous_attacks, null); // não vem no histórico
});

test('buildMatchStatsRows cruza os dois times (corners_against = do adversário)', () => {
  const pf = parseFixture(apiFixture());
  const stats = parseTeamStatistics(apiStats());
  const rows = buildMatchStatsRows(pf, stats, 12345);
  assert.equal(rows.length, 2);

  const home = rows.find((r) => r.team_id === 33);
  const away = rows.find((r) => r.team_id === 40);

  assert.equal(home.is_home, 1);
  assert.equal(home.corners_for, 7);
  assert.equal(home.corners_against, 4);   // cantos do adversário
  assert.equal(home.opponent_id, 40);
  assert.equal(home.goals_for, 2);
  assert.equal(home.goals_against, 1);
  assert.equal(home.ht_goals_for, 1);

  assert.equal(away.is_home, 0);
  assert.equal(away.corners_for, 4);
  assert.equal(away.corners_against, 7);
  assert.equal(away.goals_for, 1);
  assert.equal(home.created_at, 12345);
});

test('buildMatchStatsRows: sem ids de time → vazio (não inventa linha)', () => {
  const rows = buildMatchStatsRows({ home_team_id: null, away_team_id: null }, new Map());
  assert.equal(rows.length, 0);
});

test('buildMatchStatsRows: estatística faltando vira null (não quebra)', () => {
  const pf = parseFixture(apiFixture());
  // só o mandante tem stats; visitante sem bloco
  const partial = parseTeamStatistics([apiStats()[0]]);
  const rows = buildMatchStatsRows(pf, partial);
  const away = rows.find((r) => r.team_id === 40);
  assert.equal(away.corners_for, null);          // visitante sem stats
  const home = rows.find((r) => r.team_id === 33);
  assert.equal(home.corners_against, null);      // adversário sem stats
  assert.equal(home.corners_for, 7);             // mas o mandante tem
});
