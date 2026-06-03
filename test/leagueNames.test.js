// Nome de exibição das ligas: apelido conhecido ou nome + país.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayLeagueName } from '../src/services/leagueNames.js';

test('usa apelido conhecido por id', () => {
  assert.equal(displayLeagueName({ id: 71, name: 'Serie A', country: 'Brazil' }), 'Brasileirão Série A');
  assert.equal(displayLeagueName({ id: 72, name: 'Serie B', country: 'Brazil' }), 'Brasileirão Série B');
  assert.equal(displayLeagueName({ id: 39, name: 'Premier League', country: 'England' }), 'Premier League');
  assert.equal(displayLeagueName({ id: 135, name: 'Serie A', country: 'Italy' }), 'Serie A (Itália)');
  assert.equal(displayLeagueName({ id: 13, name: 'CONMEBOL Libertadores', country: 'World' }), 'Libertadores');
});

test('liga fora do mapa: acrescenta país (traduzido) pra desambiguar', () => {
  assert.equal(displayLeagueName({ id: 9999, name: 'Serie A', country: 'Italy' }), 'Serie A (Itália)');
  assert.equal(displayLeagueName({ id: 9998, name: 'Primera División', country: 'Argentina' }), 'Primera División (Argentina)');
  assert.equal(displayLeagueName({ id: 9997, name: 'Serie B', country: 'Brazil' }), 'Serie B (Brasil)');
});

test('não duplica país quando o nome já o contém', () => {
  assert.equal(displayLeagueName({ id: 9000, name: 'Brazilian Serie A', country: 'Brazil' }), 'Brazilian Serie A');
  assert.equal(displayLeagueName({ id: 9000, name: 'Liga Portugal', country: 'Portugal' }), 'Liga Portugal');
});

test('sem país: devolve o nome cru', () => {
  assert.equal(displayLeagueName({ id: 9000, name: 'Some Cup' }), 'Some Cup');
});

test('entradas degeneradas não quebram', () => {
  assert.equal(displayLeagueName(null), '—');
  assert.equal(displayLeagueName({ id: 5000 }), 'Liga #5000');
});
