// Validação da INTERFACE com jsdom — renderização real do DOM.
// Bugs de DOM não aparecem em teste de backend; aqui montamos a SPA num
// documento jsdom, desligamos o autorun, e exercitamos as funções de render.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { dashboardHtml, TABS } from '../src/server/html.js';

let dom, win, doc;

before(() => {
  dom = new JSDOM(dashboardHtml(), { runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.__BET21_AUTORUN__ = false; } });
  win = dom.window; doc = win.document;
});

test('a SPA cria todas as abas e painéis', () => {
  assert.equal(doc.querySelectorAll('.tab').length, TABS.length);
  for (const t of TABS) {
    assert.ok(doc.querySelector('.tab[data-tab="' + t.id + '"]'), 'falta a aba ' + t.id);
    assert.ok(doc.querySelector('#panel-' + t.id), 'falta o painel ' + t.id);
  }
});

test('window.Bet21 expõe as funções de render', () => {
  const B = win.Bet21;
  assert.ok(B);
  for (const fn of ['renderHealth', 'renderPrelive', 'renderSignals', 'renderAccounting', 'renderConfig', 'renderLeagues', 'renderCoverage', 'switchTab', 'appendLog']) {
    assert.equal(typeof B[fn], 'function', 'falta ' + fn);
  }
});

test('switchTab mostra um painel e esconde os outros', () => {
  win.Bet21.switchTab('prelive');
  assert.equal(doc.querySelector('#panel-prelive').hidden, false);
  assert.equal(doc.querySelector('#panel-painel').hidden, true);
  assert.ok(doc.querySelector('.tab[data-tab="prelive"]').classList.contains('active'));
});

test('renderHealth desenha as luzes e o aviso de honestidade', () => {
  const root = doc.querySelector('#panel-painel');
  win.Bet21.renderHealth(root, {
    apiKey: { ok: true }, requestsDay: { remaining: 7000, limit: 7500 },
    requestsMinute: { remaining: 250, limit: 300 },
    captureEnabled: { ok: true }, engine: { ok: false },
    odds: { withOdds: 5, withoutOdds: 2 }, activeLeagues: 8,
    lastSettle: Date.now(), lastCapture: Date.now(), lastBackfill: null,
  });
  assert.ok(root.querySelector('.lights'));
  assert.ok(root.querySelector('.disclaimer').textContent.match(/não garante lucro/i));
  assert.ok(root.querySelector('#engineBtn'));
  assert.ok(root.querySelector('#log'));
  assert.equal(root.querySelectorAll('.light').length >= 7, true);
});

test('renderAccounting mostra o KPI de CLV e o aviso de amostra pequena', () => {
  const root = doc.querySelector('#panel-contabilidade');
  win.Bet21.renderAccounting(root, {
    summary: { nSettled: 3, profit: 1.1, roi: 0.367, hitRate: 0.67, avgClv: 0.058, clvPositiveRate: 0.67, smallSample: true, smallSampleNote: 'Amostra pequena (3 sinais liquidados) — não tire conclusões.' },
  });
  assert.ok(root.querySelector('.kpi.clv'), 'CLV deve ter destaque');
  assert.match(root.querySelector('.disclaimer').textContent, /amostra pequena/i);
  assert.match(root.textContent, /CLV médio/);
});

test('renderPrelive tem botões de ação, status e coluna de odds', () => {
  const root = doc.querySelector('#panel-prelive');
  win.Bet21._preliveDays = 7;
  const soon = Math.floor(Date.now() / 1000) + 2 * 86400;
  win.Bet21.renderPrelive(root, { ranking: [
    { fixtureId: 123, home: 'A', away: 'B', league: 'PL', kickoff: soon, score: 70, lambda: 10, cornerLine: 9.5, cornerOdd: 1.9, cornerUnderOdd: 1.95, bookmaker: 'Bet365', monitored: true },
    { fixtureId: 124, home: 'C', away: 'D', league: 'PL', kickoff: soon, score: 60, lambda: 9, cornerLine: null, monitored: false },
  ] });
  assert.ok(root.querySelector('#syncFixtures'), 'botão sincronizar jogos');
  assert.ok(root.querySelector('#captureLot'), 'botão capturar odds em lote');
  assert.ok(root.querySelector('#backfillStatus'), 'linha de status do histórico');
  assert.ok(root.querySelector('[data-recapture="123"]'));
  assert.ok(root.querySelector('[data-diagnose="123"]'));
  assert.match(root.textContent, /9\.5/);     // linha de cantos
  assert.match(root.textContent, /sem odds/); // o jogo 124 sem odds
});

test('renderSignals monta a tabela com CLV e status coloridos', () => {
  const root = doc.querySelector('#panel-sinais');
  win.Bet21.renderSignals(root, {
    summary: { nTotal: 2, green: 1, red: 1, nPending: 0 },
    table: [
      { jogo: 'A x B', mercado: 'W2', linha: 9.5, oddEntrada: 2.0, oddFechamento: 1.8, clv: 14.3, resultado: 'green', lucro: 1.0, cantos: 12 },
      { jogo: 'C x D', mercado: '1T', linha: 4.5, oddEntrada: 1.9, oddFechamento: 2.0, clv: -7.3, resultado: 'red', lucro: -1.0, cantos: 3 },
    ],
  });
  assert.equal(root.querySelectorAll('tbody tr').length, 2);
  assert.ok(root.querySelector('.pill.green'));
  assert.ok(root.querySelector('.pill.red'));
  assert.match(root.textContent, /14\.3%/);
});

test('renderConfig cria campos por tipo (texto, checkbox, select) e botão restaurar', () => {
  const root = doc.querySelector('#panel-config');
  win.Bet21.renderConfig(root, {
    settings: { stake_per_signal: { value: 1, type: 'float', group: 'Banca', label: 'Stake', help: 'tam', recommended: '1' } },
    model: {
      distribution: { value: 'poisson', type: 'enum', options: ['poisson', 'negbin'], group: 'Modelo', label: 'Distribuição', help: 'd' },
      ev_min: { value: 0.03, type: 'float', group: 'Modelo', label: 'EV min', help: 'e' },
    },
  });
  assert.ok(root.querySelector('input[data-key="stake_per_signal"]'));
  assert.ok(root.querySelector('select[data-key="distribution"]'));
  assert.equal(root.querySelectorAll('select[data-key="distribution"] option').length, 2);
  assert.ok(root.querySelector('[data-reset-key="ev_min"]'));
});

test('renderLeagues marca principais e tem botões de ativação em massa', () => {
  const root = doc.querySelector('#panel-ligas');
  win.Bet21.renderLeagues(root, { leagues: [
    { id: 39, name: 'Premier League', country: 'England', active: 1, is_main: 1, season: 2025 },
    { id: 61, name: 'Ligue 1', country: 'France', active: 0, is_main: 0, season: 2025 },
  ] });
  assert.ok(root.querySelector('[data-mode="main"]'));
  assert.ok(root.querySelector('[data-mode="all"]'));
  assert.ok(root.querySelector('input[data-league="39"]').checked);
  assert.match(root.textContent, /★/); // principal marcada
});

test('appendLog insere a linha mais recente no topo do log', () => {
  const root = doc.querySelector('#panel-painel');
  const log = root.querySelector('#log') || doc.createElement('div');
  win.Bet21.appendLog(log, { ts: Date.now(), level: 'signal', message: 'W2 DISPAROU' });
  win.Bet21.appendLog(log, { ts: Date.now(), level: 'info', message: 'odds capturadas' });
  assert.match(log.firstChild.textContent, /odds capturadas/); // a última entra no topo
  assert.ok(log.querySelector('.signal') || log.textContent.match(/DISPAROU/));
});

test('renderPrelive traz o disclaimer, filtro de dias e indicadores 🟢/⚪', () => {
  const root = doc.querySelector('#panel-prelive');
  win.Bet21._preliveDays = 7; // padrão
  const soon = Math.floor(Date.now() / 1000) + 2 * 86400; // daqui a 2 dias (dentro de 7)
  const far = Math.floor(Date.now() / 1000) + 20 * 86400; // daqui a 20 dias (fora de 7/14)
  win.Bet21.renderPrelive(root, { ranking: [
    { fixtureId: 1, home: 'A', away: 'B', league: 'PL', kickoff: soon, score: 80, lambda: 11.2, cornerLine: 9.5, cornerOdd: 1.9, monitored: true },
    { fixtureId: 2, home: 'C', away: 'D', league: 'PL', kickoff: far, score: 70, lambda: 10, monitored: false },
  ] });
  assert.match(root.querySelector('.disclaimer').textContent, /triagem/i);
  // filtro padrão 7 dias: mostra o jogo de 2 dias, esconde o de 20
  assert.ok(root.querySelector('[data-diagnose="1"]'), 'jogo próximo aparece');
  assert.equal(root.querySelector('[data-diagnose="2"]'), null, 'jogo distante fica fora do filtro de 7 dias');
  assert.match(root.textContent, /🟢/);
  // tem os chips de filtro
  assert.ok(root.querySelector('[data-days="7"]'));
  assert.ok(root.querySelector('[data-days="30"]'));
});

test('renderPrelive: filtro "Tudo" mostra jogos distantes', () => {
  const root = doc.querySelector('#panel-prelive');
  win.Bet21._preliveDays = 7; // garante o padrão
  const far = Math.floor(Date.now() / 1000) + 60 * 86400;
  win.Bet21.renderPrelive(root, { ranking: [
    { fixtureId: 9, home: 'X', away: 'Y', league: 'PL', kickoff: far, score: 50, lambda: 9, monitored: false },
  ] });
  // por padrão (7d) não aparece
  assert.equal(root.querySelector('[data-diagnose="9"]'), null);
  // clica em "Tudo"
  root.querySelector('[data-days="null"]').click();
  assert.ok(root.querySelector('[data-diagnose="9"]'), 'com "Tudo" o jogo distante aparece');
});

test('renderPrelive: clicar no cabeçalho ordena e inverte', () => {
  const root = doc.querySelector('#panel-prelive');
  win.Bet21._preliveDays = null; // Tudo, pra não filtrar por data
  win.Bet21._preliveSort = { key: 'kickoff', dir: 'asc' };
  const t = Math.floor(Date.now() / 1000);
  win.Bet21.renderPrelive(root, { ranking: [
    { fixtureId: 1, home: 'Zebra', away: 'B', league: 'PL', kickoff: t + 100, score: 30, lambda: 8 },
    { fixtureId: 2, home: 'Alfa', away: 'C', league: 'PL', kickoff: t + 200, score: 90, lambda: 12 },
    { fixtureId: 3, home: 'Meio', away: 'D', league: 'PL', kickoff: t + 300, score: 60, lambda: 10 },
  ] });
  function firstFixtureId(){
    var tr = root.querySelector('#preliveBody tr');
    var btn = tr.querySelector('[data-recapture]');
    return btn ? btn.getAttribute('data-recapture') : null;
  }
  // clica em "Nota" → começa decrescente (maior nota primeiro) → fixture 2 (score 90)
  var notaTh = [...root.querySelectorAll('[data-sort]')].find((th) => th.getAttribute('data-sort') === 'score');
  notaTh.click();
  assert.equal(firstFixtureId(), '2', 'maior nota primeiro');
  // clica de novo → inverte pra crescente → fixture 1 (score 30)
  notaTh = [...root.querySelectorAll('[data-sort]')].find((th) => th.getAttribute('data-sort') === 'score');
  notaTh.click();
  assert.equal(firstFixtureId(), '1', 'menor nota primeiro após inverter');
});

test('renderPrelive: ordenar por Jogo (texto) começa A→Z', () => {
  const root = doc.querySelector('#panel-prelive');
  win.Bet21._preliveDays = null;
  win.Bet21._preliveSort = { key: 'kickoff', dir: 'asc' };
  const t = Math.floor(Date.now() / 1000);
  win.Bet21.renderPrelive(root, { ranking: [
    { fixtureId: 1, home: 'Zebra', away: 'B', league: 'PL', kickoff: t + 100, score: 30 },
    { fixtureId: 2, home: 'Alfa', away: 'C', league: 'PL', kickoff: t + 200, score: 90 },
  ] });
  var jogoTh = [...root.querySelectorAll('[data-sort]')].find((th) => th.getAttribute('data-sort') === 'home');
  jogoTh.click();
  var firstBtn = root.querySelector('#preliveBody tr [data-recapture]');
  assert.equal(firstBtn.getAttribute('data-recapture'), '2', 'Alfa (A) vem antes de Zebra (Z)');
});

test('renderPrelive: jogos sem valor vão pro fim ao ordenar por Valor', () => {
  const root = doc.querySelector('#panel-prelive');
  win.Bet21._preliveDays = null;
  win.Bet21._preliveSort = { key: 'kickoff', dir: 'asc' };
  const t = Math.floor(Date.now() / 1000);
  win.Bet21.renderPrelive(root, { ranking: [
    { fixtureId: 1, home: 'A', away: 'B', league: 'PL', kickoff: t + 100, score: 30 }, // sem valor
    { fixtureId: 2, home: 'C', away: 'D', league: 'PL', kickoff: t + 200, score: 90, value: { side: 'over', line: 9.5, odd: 1.9, ev: 0.15, edge: 0.08, modelProb: 0.6, marketProb: 0.52 } },
  ] });
  var valTh = [...root.querySelectorAll('[data-sort]')].find((th) => th.getAttribute('data-sort') === 'value');
  valTh.click(); // decrescente: maior EV primeiro
  var firstBtn = root.querySelector('#preliveBody tr [data-recapture]');
  assert.equal(firstBtn.getAttribute('data-recapture'), '2', 'o com valor (EV 15%) vem primeiro');
});

test('renderLeagues: país em português e ordenação por coluna', () => {
  const root = doc.querySelector('#panel-ligas');
  win.Bet21._leaguesSort = { key: 'main', dir: 'desc' };
  win.Bet21.renderLeagues(root, { leagues: [
    { id: 88, name: 'Eredivisie', displayName: 'Eredivisie (Holanda)', country: 'Netherlands', countryPt: 'Holanda', season: 2025, active: 1, is_main: 1 },
    { id: 39, name: 'Premier League', displayName: 'Premier League', country: 'England', countryPt: 'Inglaterra', season: 2025, active: 0, is_main: 1 },
  ] });
  // país traduzido aparece
  assert.match(root.textContent, /Holanda/);
  assert.match(root.textContent, /Inglaterra/);
  assert.equal(root.textContent.includes('Netherlands'), false, 'não mostra o país em inglês');
  // cabeçalhos clicáveis
  assert.ok(root.querySelector('[data-sort="name"]'));
  assert.ok(root.querySelector('[data-sort="country"]'));
  assert.ok(root.querySelector('[data-sort="season"]'));
});

test('renderLeagues: ordenar por País (A→Z) e inverter', () => {
  const root = doc.querySelector('#panel-ligas');
  win.Bet21._leaguesSort = { key: 'main', dir: 'desc' };
  win.Bet21.renderLeagues(root, { leagues: [
    { id: 1, name: 'Z-Liga', displayName: 'Z-Liga', countryPt: 'Uruguai', season: 2025, active: 0, is_main: 0 },
    { id: 2, name: 'A-Liga', displayName: 'A-Liga', countryPt: 'Argentina', season: 2025, active: 0, is_main: 0 },
  ] });
  function firstLeagueId(){
    var cb = root.querySelector('#leaguesBody tr input[data-league]');
    return cb ? cb.getAttribute('data-league') : null;
  }
  var paisTh = [...root.querySelectorAll('[data-sort]')].find((th) => th.getAttribute('data-sort') === 'country');
  paisTh.click(); // A→Z: Argentina antes de Uruguai
  assert.equal(firstLeagueId(), '2', 'Argentina (A) primeiro');
  paisTh = [...root.querySelectorAll('[data-sort]')].find((th) => th.getAttribute('data-sort') === 'country');
  paisTh.click(); // inverte: Uruguai primeiro
  assert.equal(firstLeagueId(), '1', 'Uruguai (Z) primeiro após inverter');
});

test('renderLeagues: ordenar por Ativa agrupa as ativas', () => {
  const root = doc.querySelector('#panel-ligas');
  win.Bet21._leaguesSort = { key: 'main', dir: 'desc' };
  win.Bet21.renderLeagues(root, { leagues: [
    { id: 1, name: 'Inativa', displayName: 'Inativa', countryPt: 'X', season: 2025, active: 0, is_main: 0 },
    { id: 2, name: 'Ativa', displayName: 'Ativa', countryPt: 'Y', season: 2025, active: 1, is_main: 0 },
  ] });
  var ativaTh = [...root.querySelectorAll('[data-sort]')].find((th) => th.getAttribute('data-sort') === 'active');
  ativaTh.click(); // desc: ativas (1) primeiro
  var firstCb = root.querySelector('#leaguesBody tr input[data-league]');
  assert.equal(firstCb.getAttribute('data-league'), '2', 'a ativa vem primeiro');
});

test('renderAccounting: input de valor da unidade converte lucro pra R$', () => {
  const root = doc.querySelector('#panel-contabilidade');
  win.Bet21._unitValue = 0;
  win.Bet21.renderAccounting(root, { summary: { nSettled: 10, profit: 3.5, staked: 10, roi: 0.35, hitRate: 0.6, avgClv: 0.02, clvPositiveRate: 0.7 } });
  // sem valor: mostra em unidades
  assert.match(root.querySelector('#kpiLucro').textContent, /3\.50u/);
  // digita 50 → lucro vira R$ 175,00 (3.5 × 50)
  const inp = root.querySelector('#unitValue');
  inp.value = '50';
  inp.oninput();
  assert.match(root.querySelector('#kpiLucro').textContent, /R\$\s*175,00/);
  assert.match(root.querySelector('#kpiStaked').textContent, /R\$\s*500,00/); // 10 × 50
});

test('renderAccounting: valor 0 ou vazio volta pra unidades', () => {
  const root = doc.querySelector('#panel-contabilidade');
  win.Bet21._unitValue = 50;
  win.Bet21.renderAccounting(root, { summary: { nSettled: 5, profit: 2, staked: 5, roi: 0.4 } });
  const inp = root.querySelector('#unitValue');
  inp.value = '0';
  inp.oninput();
  assert.match(root.querySelector('#kpiLucro').textContent, /2\.00u/);
});

test('renderAccounting: lucro negativo em R$ mostra sinal', () => {
  const root = doc.querySelector('#panel-contabilidade');
  win.Bet21._unitValue = 0;
  win.Bet21.renderAccounting(root, { summary: { nSettled: 8, profit: -2.4, staked: 8, roi: -0.3 } });
  const inp = root.querySelector('#unitValue');
  inp.value = '100';
  inp.oninput();
  assert.match(root.querySelector('#kpiLucro').textContent, /-R\$\s*240,00|R\$\s*-240,00/);
});
