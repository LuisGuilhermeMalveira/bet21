// A SPA do Bet21 — HTML + CSS + JS vanilla numa string, servida pelo node:http.
// Sem framework, sem build. As funções de render ficam em window.Bet21 pra
// poderem ser testadas com jsdom (bugs de DOM não aparecem em teste de backend).

export const TABS = [
  { id: 'painel', label: 'Painel' },
  { id: 'prelive', label: 'Pré-live' },
  { id: 'live', label: 'Ao vivo' },
  { id: 'dados', label: 'Dados' },
  { id: 'sinais', label: 'Sinais' },
  { id: 'historico', label: 'Histórico' },
  { id: 'contabilidade', label: 'Contabilidade' },
  { id: 'config', label: 'Configuração' },
  { id: 'ligas', label: 'Ligas' },
];

export function dashboardHtml() {
  const tabButtons = TABS.map(
    (t) => `<button class="tab" data-tab="${t.id}">${t.label}</button>`
  ).join('');
  const tabPanels = TABS.map(
    (t) => `<section class="panel" id="panel-${t.id}" data-panel="${t.id}" hidden></section>`
  ).join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bet21 — sinais de cantos</title>
<style>
  :root{
    --bg:#0e1116; --panel:#161b22; --panel2:#1c232c; --border:#2a313c;
    --fg:#e6edf3; --muted:#9aa7b4; --accent:#3b82f6; --green:#2ea043; --red:#da3633;
    --yellow:#d29922; --chip:#21262d;
  }
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
  header{display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid var(--border);background:var(--panel)}
  header h1{font-size:18px;margin:0;letter-spacing:.5px}
  header .sub{color:var(--muted);font-size:12px}
  .tabs{display:flex;flex-wrap:wrap;gap:4px;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--panel)}
  .tab{background:transparent;border:1px solid transparent;color:var(--muted);padding:7px 12px;border-radius:8px;cursor:pointer;font-size:13px}
  .tab:hover{color:var(--fg);background:var(--panel2)}
  .tab.active{color:var(--fg);background:var(--panel2);border-color:var(--border)}
  main{padding:18px;max-width:1100px;margin:0 auto}
  .panel{animation:fade .15s ease}
  @keyframes fade{from{opacity:.4}to{opacity:1}}
  h2{font-size:15px;margin:0 0 12px;color:var(--fg)}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px}
  .grid{display:grid;gap:10px}
  .lights{grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
  .light{display:flex;align-items:center;gap:9px;background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:10px 12px}
  .dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--muted)}
  .dot.ok{background:var(--green)} .dot.bad{background:var(--red)} .dot.warn{background:var(--yellow)}
  .light .l{font-size:12px;color:var(--muted)} .light .v{font-size:13px}
  .kpis{grid-template-columns:repeat(auto-fit,minmax(130px,1fr))}
  .kpi{background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:12px}
  .kpi .n{font-size:22px;font-weight:600} .kpi .k{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px}
  .kpi.clv{border-color:var(--accent)}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--border);white-space:nowrap}
  th{color:var(--muted);font-weight:500;font-size:11px;text-transform:uppercase}
  tr:hover td{background:var(--panel2)}
  .btn{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:13px}
  .btn.ghost{background:var(--panel2);color:var(--fg);border:1px solid var(--border)}
  .btn.ghost.sm.active{background:var(--accent);color:#04130a;border-color:var(--accent);font-weight:600}
  th.sortable:hover{color:var(--fg);background:var(--panel2)}
  .btn.sm{padding:3px 8px;font-size:13px}
  .btn:hover{filter:brightness(1.1)}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .pill{display:inline-block;padding:2px 8px;border-radius:20px;background:var(--chip);font-size:11px;color:var(--muted)}
  .pill.green{background:rgba(46,160,67,.18);color:#5ad17a}
  .pill.red{background:rgba(218,54,51,.18);color:#ff7b72}
  .pill.pending{background:rgba(210,153,34,.18);color:#e3b341}
  .muted{color:var(--muted)} .right{text-align:right} .pos{color:#5ad17a} .neg{color:#ff7b72}
  .disclaimer{background:rgba(210,153,34,.10);border:1px solid rgba(210,153,34,.4);border-radius:10px;padding:10px 12px;font-size:12.5px;color:#e3b341;margin-bottom:14px}
  .log{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;background:#0a0d12;border:1px solid var(--border);border-radius:10px;padding:10px;height:240px;overflow:auto}
  .log .e{padding:2px 0;border-bottom:1px solid #161b22}
  .log .t{color:var(--muted)} .log .signal{color:#5ad17a} .log .warn{color:#e3b341} .log .error{color:#ff7b72}
  .cfg-group{margin-bottom:18px}
  .cfg-item{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)}
  .cfg-item .desc{font-size:12px;color:var(--muted)}
  .cfg-item input,.cfg-item select{background:var(--panel2);border:1px solid var(--border);color:var(--fg);border-radius:7px;padding:6px 8px;font-size:13px;width:120px}
  .toggle{font-size:13px}
  .score{font-weight:600;padding:2px 8px;border-radius:7px;background:var(--panel2)}
  .live-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
  .lcard{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:13px 14px}
  .lcard.fired{border-color:var(--green)}
  .lwin{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:20px;font-size:11.5px;background:var(--chip);color:var(--muted);white-space:nowrap}
  .lwin.w2,.lwin.fired{background:rgba(46,160,67,.16);color:#5ad17a}
  .lwin.wait{background:rgba(210,153,34,.16);color:#e3b341}
  .lwin.block{background:rgba(218,54,51,.16);color:#ff7b72}
  .lwin.watch{background:rgba(59,130,246,.16);color:#79b8ff}
  .ldot{width:9px;height:9px;border-radius:50%;display:inline-block}
  @keyframes lpulse{0%,100%{opacity:1}50%{opacity:.3}}
  .lblink{width:8px;height:8px;border-radius:50%;background:var(--red);display:inline-block;animation:lpulse 1.4s infinite}
  .cvcell{width:18px;height:18px;border-radius:4px;display:inline-block;cursor:pointer;transition:transform .08s}
  .cvcell:hover{transform:scale(1.25)}
  .cvcell.sm{width:13px;height:13px;cursor:default}
  .cvcell.sm:hover{transform:none}
  .cvleg{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
  .cvseg{height:100%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500}
  .cvleagues{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px;margin-top:14px}
  .cvleague{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
  .filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:12px}
  .filters input,.filters select{background:var(--panel2);border:1px solid var(--border);color:var(--fg);border-radius:7px;padding:6px 8px;font-size:12.5px}
  a{color:var(--accent)}
</style>
</head>
<body>
<header>
  <h1>⚽ Bet21</h1>
  <span class="sub">sinais de over de cantos — uso pessoal · sem garantia de lucro · o que vale é o CLV</span>
</header>
<nav class="tabs">${tabButtons}</nav>
<main>${tabPanels}</main>

<script>
(function(){
  "use strict";
  const Bet21 = window.Bet21 = {};
  const $ = (s, r) => (r||document).querySelector(s);
  const el = (tag, attrs={}, html) => { const n=document.createElement(tag); for(const k in attrs) n.setAttribute(k, attrs[k]); if(html!=null) n.innerHTML=html; return n; };
  const fmt = (n,d=2)=> (n==null||isNaN(n))?'—':Number(n).toFixed(d);
  const pct = (n,d=1)=> (n==null||isNaN(n))?'—':(Number(n)*100).toFixed(d)+'%';
  const ago = (ts)=>{ if(!ts) return 'nunca'; const s=Math.floor((Date.now()-ts)/1000); if(s<60)return s+'s atrás'; if(s<3600)return Math.floor(s/60)+'min atrás'; return Math.floor(s/3600)+'h atrás'; };
  const time = (sec)=> sec? new Date(sec*1000).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
  Bet21._util = { fmt, pct, ago, time };

  // ---------- RENDER (puro, testável com jsdom) ----------

  Bet21.renderHealth = function(root, h){
    const dot = (ok)=> '<span class="dot '+(ok?'ok':'bad')+'"></span>';
    const warnDot = (ok)=> '<span class="dot '+(ok?'ok':'warn')+'"></span>';
    root.innerHTML =
      '<div class="disclaimer">O Bet21 não garante lucro. É um processo pra descobrir se há vantagem (edge) via <b>CLV</b>. Nada de dinheiro real antes de validar em paper-trade.</div>'
      + '<div class="card"><h2>Saúde</h2><div class="grid lights">'
      + '<div class="light">'+dot(h.apiKey.ok)+'<div><div class="l">Chave da API</div><div class="v">'+(h.apiKey.ok?'OK':'faltando')+'</div></div></div>'
      + '<div class="light">'+warnDot(h.requestsDay.remaining==null||h.requestsDay.remaining>200)+'<div><div class="l">Requisições hoje</div><div class="v">'+(h.requestsDay.remaining??'—')+(h.requestsDay.limit?(' / '+h.requestsDay.limit):'')+'</div></div></div>'
      + '<div class="light">'+warnDot(h.requestsMinute.remaining==null||h.requestsMinute.remaining>3)+'<div><div class="l">Requisições no minuto</div><div class="v">'+(h.requestsMinute.remaining??'—')+(h.requestsMinute.limit?(' / '+h.requestsMinute.limit):'')+'</div></div></div>'
      + '<div class="light">'+dot(h.captureEnabled.ok)+'<div><div class="l">Captura de odds</div><div class="v">'+(h.captureEnabled.ok?'ligada':'desligada')+'</div></div></div>'
      + '<div class="light">'+warnDot(h.engine.ok)+'<div><div class="l">Engine ao vivo</div><div class="v">'+(h.engine.ok?'LIGADO':'desligado')+'</div></div></div>'
      + '<div class="light"><span class="dot"></span><div><div class="l">Jogos com / sem odds</div><div class="v">'+(h.odds.withOdds||0)+' / '+(h.odds.withoutOdds||0)+'</div></div></div>'
      + '<div class="light"><span class="dot"></span><div><div class="l">Ligas ativas</div><div class="v">'+(h.activeLeagues||0)+'</div></div></div>'
      + '<div class="light"><span class="dot"></span><div><div class="l">Último settle / captura</div><div class="v">'+ago(h.lastSettle)+' · '+ago(h.lastCapture)+'</div></div></div>'
      + '</div>'
      + (h.apiKey.ok?'':'<p class="muted">⚠ '+(h.apiKey.fix||'')+'</p>')
      + '</div>'
      + '<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Engine ao vivo</h2>'
      + '<div class="row"><button class="btn ghost" id="simBtn">🧪 Simular sinal</button>'
      + '<button class="btn" id="engineBtn">'+(h.engine.ok?'Desligar engine':'Ligar engine')+'</button></div></div></div>'
      + '<div class="card"><h2>Log ao vivo</h2><div class="log" id="log"></div></div>';
    return root;
  };

  Bet21._preliveDays = 7;  // filtro padrão
  Bet21._preliveSort = { key: 'kickoff', dir: 'asc' }; // ordenação padrão: data crescente
  Bet21.renderPrelive = function(root, data){
    Bet21._preliveData = data; // guarda pra re-filtrar sem nova chamada
    // colunas ordenáveis: rótulo + chave do dado + tipo
    var COLS = [
      { label: '', key: null },                          // ícone 🟢
      { label: 'Nota', key: 'score', type: 'num' },
      { label: 'Jogo', key: 'home', type: 'str' },
      { label: 'Liga', key: 'league', type: 'str' },
      { label: 'Início', key: 'kickoff', type: 'num' },
      { label: 'Cantos (linha · odds)', key: 'cornerLine', type: 'num' },
      { label: 'λ', key: 'lambda', type: 'num' },
      { label: 'Valor', key: 'value', type: 'value' },   // ordena por EV
      { label: '', key: null },                          // ações
    ];
    function sortVal(r, col){
      if(col.key==='value') return r.value ? (r.value.ev||0) : -Infinity; // sem valor vai pro fim
      var v = r[col.key];
      if(col.type==='num'){ return (v==null||isNaN(v)) ? -Infinity : Number(v); }
      return (v==null?'':String(v)).toLowerCase();
    }
    function rowHtml(r){
      var valueCell;
      if(r.value){
        var v=r.value;
        valueCell='<span class="lwin '+(v.side==='over'?'w2':'watch')+'" title="modelo '+Math.round(v.modelProb*100)+'% vs casa '+Math.round(v.marketProb*100)+'%">'
          +'🎯 '+(v.side==='over'?'OVER':'UNDER')+' '+v.line+' · EV +'+(v.ev*100).toFixed(0)+'%</span>';
      } else {
        valueCell='<span class="muted" style="font-size:11px">'+(r.valueReason||'—')+'</span>';
      }
      var oddsCell;
      if(r.cornerLine!=null){
        oddsCell='<b>'+r.cornerLine+'</b>'
          +(r.cornerOdd?' · O '+fmt(r.cornerOdd,2):'')
          +(r.cornerUnderOdd?' · U '+fmt(r.cornerUnderOdd,2):'')
          +(r.bookmaker?' <span class="muted" style="font-size:11px">'+r.bookmaker+'</span>':'');
      } else { oddsCell='<span class="muted">sem odds</span>'; }
      return '<tr><td>'+(r.monitored?'🟢':'⚪')+'</td><td><b>'+r.score+'</b></td>'
        +'<td>'+(r.home||'?')+' x '+(r.away||'?')+'</td><td class="muted">'+(r.league||'—')+'</td>'
        +'<td class="muted">'+time(r.kickoff)+'</td><td>'+oddsCell+'</td>'
        +'<td>'+(r.lambda??'—')+'</td><td>'+valueCell+'</td>'
        +'<td><button class="btn ghost sm" data-recapture="'+r.fixtureId+'" title="Capturar odds deste jogo">↻</button> '
        +'<button class="btn ghost sm" data-diagnose="'+r.fixtureId+'" title="Diagnosticar mercados">🔍</button></td></tr>';
    }
    function filtered(){
      var all = ((Bet21._preliveData && Bet21._preliveData.ranking) || []).slice();
      var days = Bet21._preliveDays;
      if(days!=null){
        var limit = Math.floor(Date.now()/1000) + days*86400;
        all = all.filter(function(r){ return r.kickoff==null || r.kickoff <= limit; });
      }
      // ordena conforme o estado
      var st = Bet21._preliveSort, col = COLS.filter(function(c){ return c.key===st.key; })[0];
      if(col){
        var mul = st.dir==='desc' ? -1 : 1;
        all.sort(function(a,b){
          var va=sortVal(a,col), vb=sortVal(b,col);
          if(va<vb) return -1*mul; if(va>vb) return 1*mul; return 0;
        });
      }
      return all;
    }
    function headHtml(){
      var st = Bet21._preliveSort;
      return '<tr>'+COLS.map(function(c){
        if(!c.key) return '<th>'+c.label+'</th>';
        var arrow = st.key===c.key ? (st.dir==='asc'?' ▲':' ▼') : '';
        return '<th class="sortable" data-sort="'+c.key+'" style="cursor:pointer;user-select:none" title="Ordenar por '+c.label+'">'+c.label+arrow+'</th>';
      }).join('')+'</tr>';
    }
    function paint(){
      var list = filtered();
      var thead = root.querySelector('#preliveHead');
      if(thead) thead.innerHTML = headHtml();
      var body = list.map(rowHtml).join('');
      var tb = root.querySelector('#preliveBody');
      if(tb) tb.innerHTML = body || '<tr><td colspan="9" class="muted">Nenhum jogo nesse período. Clique em "Sincronizar jogos" ou aumente o filtro.</td></tr>';
      var cnt = root.querySelector('#preliveCount');
      if(cnt) cnt.textContent = list.length + ' jogo(s)';
      root.querySelectorAll('[data-days]').forEach(function(b){
        b.classList.toggle('active', String(Bet21._preliveDays)===b.getAttribute('data-days'));
      });
      // liga o clique de ordenação nos cabeçalhos
      root.querySelectorAll('[data-sort]').forEach(function(th){
        th.onclick=function(){
          var k=th.getAttribute('data-sort'), st=Bet21._preliveSort;
          if(st.key===k){ st.dir = (st.dir==='asc'?'desc':'asc'); }      // mesmo clique → inverte
          else { st.key=k; st.dir = (k==='home'||k==='league')?'asc':'desc'; } // texto começa A→Z; número começa do maior
          paint();
        };
      });
      if(Bet21._wirePreliveButtons) Bet21._wirePreliveButtons(root);
    }
    Bet21._repaintPrelive = paint;
    function chip(label,val){ return '<button class="btn ghost sm" data-days="'+val+'">'+label+'</button>'; }
    root.innerHTML='<div class="disclaimer">O ranking é <b>triagem</b> (onde olhar). A coluna <b>Valor</b> marca odds descalibradas (over/under) vs o modelo, ancoradas na Pinnacle — essas viram sinal pré-live pendente. CLV é o juiz, não o resultado.</div>'
      +'<div class="card"><div class="row" style="justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px">'
        +'<h2 style="margin:0">Pré-live</h2>'
        +'<div class="row" style="gap:8px"><button class="btn" id="syncFixtures" title="Baixa os próximos jogos das ligas ativas (~1 req por liga)">Sincronizar jogos</button>'
        +'<button class="btn ghost" id="captureLot" title="Captura odds dos próximos jogos sem odds">Capturar odds (lote)</button></div></div>'
      +'<div id="backfillStatus" class="muted" style="font-size:12px;margin-bottom:10px"></div>'
      +'<div class="row" style="justify-content:space-between;margin-bottom:12px">'
        +'<div class="row" style="gap:6px">'+chip('7 dias',7)+chip('14 dias',14)+chip('30 dias',30)+chip('Tudo','null')+'</div>'
        +'<span class="muted" style="font-size:12px" id="preliveCount"></span></div>'
      +'<table><thead id="preliveHead"></thead><tbody id="preliveBody"></tbody></table></div>';
    // chips de filtro (não precisam de api)
    root.querySelectorAll('[data-days]').forEach(function(b){
      b.onclick=function(){ var v=b.getAttribute('data-days'); Bet21._preliveDays = (v==='null'?null:Number(v)); paint(); };
    });
    paint();
    return root;
  };

  // mini-gráfico de pressão (sparkline) a partir de uma série de números
  function sparkline(series, rising){
    var s = series||[];
    if(s.length < 2) return '<svg width="104" height="30" aria-hidden="true"></svg>';
    var lo = Math.min.apply(null,s), hi = Math.max.apply(null,s);
    var span = (hi-lo)||1, W=104, H=30, pad=4, n=s.length;
    var col = rising ? '#5ad17a' : '#9aa7b4';
    var pts = s.map(function(v,i){
      var x = pad + (W-2*pad)*(n===1?0:i/(n-1));
      var y = H-pad - (H-2*pad)*((v-lo)/span);
      return x.toFixed(1)+','+y.toFixed(1);
    }).join(' ');
    return '<svg width="104" height="30" viewBox="0 0 104 30" aria-hidden="true">'
      +'<polyline fill="none" stroke="'+col+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="'+pts+'"/></svg>';
  }

  Bet21.renderLive = function(root, data){
    if(!data.running){
      root.innerHTML='<div class="card"><h2>Ao vivo</h2><p class="muted">O engine ao vivo está <b>desligado</b>. Ligue no Painel pra ele começar a vigiar os jogos — os cards aparecem aqui.</p></div>';
      return root;
    }
    var games = data.games||[];
    if(!games.length){
      root.innerHTML='<div class="card"><div class="row" style="justify-content:space-between"><div class="row"><span class="lblink"></span><span>Engine ligado — nenhum jogo monitorado ao vivo agora.</span></div><span class="muted" id="liveClock"></span></div>'
        +'<p class="muted" style="margin:10px 0 0">Quando um jogo das suas ligas ativas estiver acontecendo, ele aparece aqui com pressão, janela e o motivo de disparar (ou não).</p></div>';
      return root;
    }
    var cards = games.map(function(g){
      var s = g.status;
      var winCls = s==='fired'?'fired':(s==='block'?'block':(s==='wait'?'wait':(s==='watch'?'watch':(g.window==='W2'?'w2':''))));
      var winLabel = s==='fired'?'<i class="ti ti-bell" style="font-size:13px"></i> sinal disparado'
        : (g.window? (g.window+(s==='watch'?' ativa':'')) : 'sem janela');
      var dotCol = s==='fired'?'#2ea043':(g.line!=null&&g.corners!=null&&(g.line-g.corners)<=2?'#d29922':'#9aa7b4');
      var arrow = g.rising?'<i class="ti ti-trending-up" style="color:#5ad17a;font-size:15px;vertical-align:-3px"></i>':'<i class="ti ti-trending-down" style="color:#9aa7b4;font-size:15px;vertical-align:-3px"></i>';
      var pVal = g.pressure!=null ? '<b style="color:'+(g.rising?'#5ad17a':'#e6edf3')+'">'+g.pressure.toFixed(2)+'</b> '+arrow : '<span class="muted">coletando…</span>';
      var lineRow = (g.line!=null&&g.ev!=null) ? '<div style="margin-top:11px;padding-top:9px;border-top:1px solid var(--border);font-size:12.5px">'
          +(s==='fired'?'over ':'melhor linha ')+'<b>'+g.line+'</b>'+(g.overOdd?(' @ '+g.overOdd):'')
          +(g.prob!=null?(' · prob <b>'+Math.round(g.prob*100)+'%</b>'):'')
          +' · EV <b style="color:'+(g.ev>=0.03?'#5ad17a':'#e3b341')+'">'+(g.ev>=0?'+':'')+(g.ev*100).toFixed(1)+'%</b></div>'
        : '';
      var statusRow = s==='fired' ? '' :
        '<div class="muted" style="font-size:12px;margin-top:'+(lineRow?'7px':'10px;padding-top:9px;border-top:1px solid var(--border)')+'"><i class="ti ti-'+(s==='block'?'ban':'clock')+'" style="font-size:13px;vertical-align:-2px"></i> '+g.statusLabel+'</div>';
      return '<div class="lcard'+(s==='fired'?' fired':'')+'">'
        +'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">'
          +'<div><div><b>'+g.match+'</b></div><div class="muted" style="font-size:12px">'+(g.minute!=null?g.minute+"'":'')+' · '+g.score+(g.league?(' · '+g.league):'')+'</div></div>'
          +'<span class="lwin '+winCls+'">'+winLabel+'</span></div>'
        +'<div style="display:flex;align-items:center;gap:14px;margin-top:11px;flex-wrap:wrap">'
          +'<span style="font-size:13px"><span class="ldot" style="background:'+dotCol+'"></span> <b>'+(g.corners!=null?g.corners:'—')+'</b> <span class="muted">cantos</span></span>'
          +'<span style="font-size:13px">pressão '+pVal+'</span>'
          +'<span style="margin-left:auto">'+sparkline(g.series,g.rising)+'</span></div>'
        +lineRow+statusRow+'</div>';
    }).join('');
    root.innerHTML='<div class="card" style="padding:11px 14px"><div class="row" style="justify-content:space-between">'
        +'<div class="row"><span class="lblink"></span><span style="font-size:13px">Engine ao vivo ligado · <span class="muted">'+games.length+' jogo(s) sendo vigiados · atualiza a cada 15s</span></span></div>'
        +'<span class="muted" style="font-size:12px" id="liveClock"></span></div></div>'
      +'<div class="live-grid">'+cards+'</div>';
    return root;
  };

  // tom de amarelo conforme o time se aproxima do limiar (mais cheio = mais claro)
  function amberShade(games, minGames){
    var t = Math.min(1, games/Math.max(1,minGames));
    return t<0.5?'#7a5a12':(t<0.8?'#b07d1e':'#e3b341');
  }
  function cvColor(t, minGames){
    if(t.level==='ready') return '#2ea043';        // verde: pronto (≥ limiar)
    if(t.level==='exhausted') return '#1f6feb';     // azul: tudo que a API tem (<limiar, já tentado)
    if(t.level==='tried_empty') return '#da3633';   // vermelho: tentei e não achou nada
    if(t.level==='empty') return '#30363d';         // cinza: ainda não puxei
    return amberShade(t.games, minGames);           // amarelo: parcial (dá pra puxar mais)
  }
  Bet21.renderCoverage = function(root, data){
    if(!data || !data.summary){ root.innerHTML='<div class="card"><h2>Dados</h2><p class="muted">Carregando cobertura…</p></div>'; return root; }
    var s=data.summary, mg=data.minGames||20, total=s.activeTeams||1;
    var done = (s.ready||0) + (s.exhausted||0);             // verde + azul = concluídos
    var pctDone = Math.round((done/total)*100);
    var seg = '';
    function segPart(n,color,txtcol){ if(!n) return ''; var w=n/total*100; return '<div class="cvseg" style="width:'+w+'%;background:'+color+';color:'+txtcol+'">'+(w>5?n:'')+'</div>'; }
    seg = '<div style="height:24px;border-radius:8px;overflow:hidden;display:flex;background:var(--panel2);border:1px solid var(--border)">'
      + segPart(s.ready, '#2ea043', '#06210f')
      + segPart(s.exhausted, '#1f6feb', '#04153a')
      + segPart(s.started, '#d29922', '#3a2a05')
      + segPart(s.empty, '#30363d', '#9aa7b4')
      + segPart(s.triedEmpty, '#da3633', '#3a0a09')
      + '</div>';
    var legend = '<div style="display:flex;gap:14px;margin-top:10px;flex-wrap:wrap">'
      +'<span class="cvleg"><span class="cvcell sm"style="background:#2ea043"></span> prontos (≥'+mg+')</span>'
      +'<span class="cvleg"><span class="cvcell sm" style="background:#1f6feb"></span> completo (&lt;'+mg+', sem mais na API)</span>'
      +'<span class="cvleg"><span class="cvcell sm" style="background:#d29922"></span> a puxar (1–'+(mg-1)+')</span>'
      +'<span class="cvleg"><span class="cvcell sm" style="background:#30363d"></span> ainda não puxei</span>'
      +'<span class="cvleg"><span class="cvcell sm" style="background:#da3633"></span> sem partidas na API</span></div>';

    var leagueCards = (data.leagues||[]).map(function(L){
      var cells = L.teams.map(function(t){
        var hint;
        if(t.level==='tried_empty') hint=' — sem partidas na API (clique pra tentar de novo)';
        else if(t.level==='exhausted') hint=' jogos — completo (a API não tem mais)';
        else hint=' jogos (clique pra puxar)';
        var label = t.level==='tried_empty' ? t.name : (t.name+' — '+t.games);
        return '<span class="cvcell" data-team="'+t.teamId+'" data-name="'+(t.name||'').replace(/"/g,'')+'" style="background:'+cvColor(t,mg)+'" title="'+label+hint+'"></span>';
      }).join('');
      var pending = L.pending||0, triedInc = L.triedIncomplete||0;
      var btn;
      if(data.running){ btn='<span class="muted" style="font-size:11px">aguarde…</span>'; }
      else if(pending>0){
        btn='<button class="btn ghost sm" data-fill-league="'+L.id+'" title="Puxa os '+pending+' times ainda não tentados">↓ '+pending+' que faltam</button>';
        if(triedInc>0) btn+=' <button class="btn ghost sm" data-fill-league-all="'+L.id+'" title="Re-varre '+triedInc+' já tentados">+'+triedInc+'</button>';
      } else if(triedInc>0){
        btn='<button class="btn ghost sm" data-fill-league-all="'+L.id+'" title="Re-varre os '+triedInc+' já tentados">↻ '+triedInc+' tentados</button>';
      } else {
        btn='<span class="lwin w2" style="font-size:11px">completa ✓</span>';
      }
      var pct = Math.round(((L.ready+(L.exhausted||0))/Math.max(1,L.total))*100);
      return '<div class="cvleague">'
        +'<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:9px">'
          +'<div><span style="font-weight:500">'+L.name+'</span> <span class="muted" style="font-size:12px">'+pct+'% · '+(L.ready+(L.exhausted||0))+'/'+L.total+'</span></div>'
          +'<span class="row" style="gap:6px">'+btn+'</span></div>'
        +'<div style="display:flex;gap:4px;flex-wrap:wrap">'+cells+'</div></div>';
    }).join('');

    root.innerHTML='<div class="card">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">'
        +'<div><h2 style="margin:0 0 2px">Banco de dados — cobertura do histórico</h2>'
        +'<span class="muted" style="font-size:12.5px">'+(s.games||0)+' jogos guardados'
        +(data.quota&&data.quota.remaining!=null?(' · API hoje: <b style="color:'+(data.quota.remaining<500?'#e3b341':'#5ad17a')+'">'+data.quota.remaining+'</b>'+(data.quota.limit?('/'+data.quota.limit):'')+' req'):'')
        +(data.running?' · <span style="color:#5ad17a">preenchendo agora…</span>':'')+'</span></div>'
        +'<span class="row" style="gap:10px;align-items:center">'
        +(data.running?'<button class="btn ghost" id="cancelBackfillBtn" style="color:#ff7b72">⏹ Parar</button>':'<button class="btn ghost" id="syncTeamsBtn" title="Lista os clubes de cada liga ativa (~1 req por liga)">Descobrir times</button>')
        +'</span></div>'
      +'<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:8px"><span style="font-size:30px;font-weight:600;color:#5ad17a">'+pctDone+'%</span>'
        +'<span style="font-size:13px" class="muted">do banco completo ('+done+'/'+total+' times)</span></div>'
      +seg+legend+'</div>'
      +(leagueCards?('<div class="cvleagues">'+leagueCards+'</div>'):'<div class="card"><p class="muted">Nenhuma liga ativa com times. Vá em "Ligas", ative as que quer, depois use "Descobrir times".</p></div>');
    return root;
  };

  // rótulo amigável do mercado/lado
  function marketLabel(m){
    if(m==='PL_OVER') return 'Over (pré)';
    if(m==='PL_UNDER') return 'Under (pré)';
    if(m==='W2') return 'Ao vivo W2';
    if(m==='1T') return 'Ao vivo 1T';
    if(m==='2T') return 'Ao vivo 2T';
    if(m==='W1') return 'Ao vivo W1';
    return m||'—';
  }
  Bet21.renderSignals = function(root, data, mode){
    mode = mode||'all';
    const isHist = mode==='settled';
    const rows=(data.table||[]).map(function(t){
      const cls = t.resultado==='green'?'green':t.resultado==='red'?'red':'pending';
      const resTxt = t.resultado==='pending'?'aguardando':t.resultado;
      return '<tr><td>'+t.jogo+'</td><td><span class="pill">'+marketLabel(t.mercado)+'</span></td><td>'+(t.linha??'—')+'</td>'
        +'<td>'+fmt(t.oddEntrada,2)+'</td><td>'+fmt(t.oddFechamento,2)+'</td>'
        +'<td class="'+(t.clv>=0?'pos':'neg')+'">'+(t.clv==null?'—':t.clv+'%')+'</td>'
        +'<td><span class="pill '+cls+'">'+resTxt+'</span></td>'
        +'<td class="'+((t.lucro||0)>=0?'pos':'neg')+'">'+(t.lucro==null?'—':fmt(t.lucro,2))+'</td>'
        +'<td class="muted">'+(t.cantos??'—')+'</td>'
        +'<td><button class="btn ghost sm" data-del-signal="'+t.id+'" title="Excluir este sinal">🗑</button></td></tr>';
    }).join('');
    const s=data.summary||{};
    const title = isHist?'Histórico (sinais liquidados)':'Sinais ativos (aguardando resultado)';
    const kpis = isHist
      ? '<div class="kpi"><div class="n">'+(s.green||0)+'/'+(s.red||0)+'</div><div class="k">green/red</div></div>'
        +'<div class="kpi"><div class="n '+((s.avgClv||0)>=0?'pos':'neg')+'">'+(s.avgClv==null?'—':(s.avgClv*100).toFixed(1)+'%')+'</div><div class="k">CLV médio'+(s.smallSample?' ⚠️':'')+'</div></div>'
        +'<div class="kpi"><div class="n '+((s.roi||0)>=0?'pos':'neg')+'">'+(s.roi==null?'—':(s.roi*100).toFixed(1)+'%')+'</div><div class="k">ROI</div></div>'
        +'<div class="kpi"><div class="n '+((s.bankrollUnits||0)>=0?'pos':'neg')+'">'+(s.bankrollUnits==null?'—':(s.bankrollUnits>0?'+':'')+s.bankrollUnits.toFixed(2)+'u')+'</div><div class="k">banca</div></div>'
      : '<div class="kpi"><div class="n">'+(s.nPending||0)+'</div><div class="k">aguardando</div></div>';
    const emptyMsg = isHist?'Nenhum sinal liquidado ainda. Quando um jogo terminar, o resultado aparece aqui.':'Nenhum sinal ativo agora. Sinais de valor pré-live e ao vivo aparecem aqui enquanto aguardam o resultado.';
    const note = isHist
      ? '<p class="muted" style="margin:0 0 12px;font-size:12.5px">🏁 O <b>CLV</b> é a métrica-rei. Resultado de jogo é variância; CLV positivo na média é o que prova que a triagem acha valor.</p>'
      : '<p class="muted" style="margin:0 0 12px;font-size:12.5px">Estes ainda não terminaram. O resultado (green/red) e o CLV vão pro <b>Histórico</b> quando o jogo liquidar.</p>';
    root.innerHTML='<div class="card"><h2>'+title+'</h2>'+note
      +'<div class="grid kpis" style="margin-bottom:12px">'+kpis+'</div>'
      +'<table><thead><tr><th>Jogo</th><th>Mercado</th><th>Linha</th><th>Entrada</th><th>Fech.</th><th>CLV</th><th>Resultado</th><th>Lucro</th><th>Cantos</th><th></th></tr></thead><tbody>'
      +(rows||'<tr><td colspan="10" class="muted">'+emptyMsg+'</td></tr>')+'</tbody></table></div>';
    // ligar os botões de excluir
    root.querySelectorAll('[data-del-signal]').forEach(function(btn){
      btn.onclick=function(){
        var id=btn.getAttribute('data-del-signal');
        if(!confirm('Excluir este sinal? Isso remove do histórico/contabilidade.')) return;
        btn.disabled=true;
        fetch('/api/signals/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:Number(id)})})
          .then(function(r){return r.json();}).then(function(){ var tr=btn.closest('tr'); if(tr) tr.remove(); });
      };
    });
    return root;
  };

  Bet21.renderAccounting = function(root, data){
    const s=data.summary||{};
    const warn = s.smallSampleNote? '<div class="disclaimer">⚠ '+s.smallSampleNote+'</div>':'';
    // valor de 1 unidade em R$ (0 = mostrar em unidades). Guardado no navegador via variável.
    if(Bet21._unitValue==null) Bet21._unitValue = 0;
    function money(u){
      if(u==null) return '—';
      if(Bet21._unitValue>0){
        var v = u*Bet21._unitValue;
        return 'R$ '+(v>=0?'':'-')+Math.abs(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
      }
      return fmt(u,2)+'u';
    }
    function paintKpis(){
      var lucroEl=root.querySelector('#kpiLucro'); if(lucroEl) lucroEl.textContent=money(s.profit);
      var stakedEl=root.querySelector('#kpiStaked'); if(stakedEl) stakedEl.textContent=money(s.staked);
      var bankEl=root.querySelector('#kpiBank'); if(bankEl){ var b=s.profit; bankEl.textContent=(b!=null&&b>0?'+':'')+money(b); bankEl.className='n '+((b||0)>=0?'pos':'neg'); }
    }
    Bet21._paintAccounting = paintKpis;
    root.innerHTML= warn
      +'<div class="card"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:6px">'
        +'<h2 style="margin:0">Contabilidade</h2>'
        +'<div class="row" style="gap:8px;align-items:center"><span class="muted" style="font-size:12.5px">Valor da unidade:</span>'
        +'<span class="muted">R$</span><input id="unitValue" type="number" min="0" step="1" placeholder="0 = em unidades" value="'+(Bet21._unitValue||'')+'" style="width:130px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--panel2);color:var(--fg)"></div></div>'
      +'<p class="muted" style="margin:0 0 12px;font-size:12px">Digite quanto vale 1 unidade (ex.: 50) pra ver lucro e total apostado em reais. Deixe 0 pra ver em unidades. Não altera o histórico — só a forma de exibir.</p>'
      +'<div class="grid kpis">'
      +'<div class="kpi"><div class="n">'+(s.nSettled||0)+'</div><div class="k">liquidados</div></div>'
      +'<div class="kpi"><div class="n" id="kpiLucro"></div><div class="k">lucro</div></div>'
      +'<div class="kpi"><div class="n" id="kpiStaked"></div><div class="k">total apostado</div></div>'
      +'<div class="kpi"><div class="n">'+pct(s.roi)+'</div><div class="k">ROI</div></div>'
      +'<div class="kpi"><div class="n">'+pct(s.hitRate,0)+'</div><div class="k">acerto</div></div>'
      +'<div class="kpi clv"><div class="n">'+pct(s.avgClv)+'</div><div class="k">CLV médio ★</div></div>'
      +'<div class="kpi"><div class="n">'+pct(s.clvPositiveRate,0)+'</div><div class="k">CLV+ taxa</div></div>'
      +'</div><p class="muted" style="margin-top:10px">O CLV é a métrica-rei: mede se você bate a linha de fechamento. Lucro de curto prazo engana; CLV positivo sustentado é o sinal de vantagem real.</p></div>'
      +'<div class="card"><h2>Backtest (pré-jogo)</h2><div id="btResult" class="muted">Clique para rodar.</div><button class="btn ghost" id="runBacktest" style="margin-top:8px">Rodar backtest</button></div>';
    paintKpis();
    var inp=root.querySelector('#unitValue');
    if(inp) inp.oninput=function(){ var v=parseFloat(inp.value); Bet21._unitValue=(isFinite(v)&&v>0)?v:0; paintKpis(); };
    return root;
  };

  Bet21.renderConfig = function(root, data){
    function group(which, all){
      const byGroup={};
      Object.keys(all).forEach(function(k){ const it=all[k]; (byGroup[it.group]=byGroup[it.group]||[]).push([k,it]); });
      return Object.keys(byGroup).map(function(g){
        const items=byGroup[g].map(function(pair){
          const k=pair[0], it=pair[1]; let field;
          if(it.type==='bool') field='<input type="checkbox" data-which="'+which+'" data-key="'+k+'" '+(it.value?'checked':'')+'>';
          else if(it.type==='enum') field='<select data-which="'+which+'" data-key="'+k+'">'+(it.options||[]).map(function(o){return '<option '+(o===it.value?'selected':'')+'>'+o+'</option>';}).join('')+'</select>';
          else field='<input type="text" data-which="'+which+'" data-key="'+k+'" value="'+it.value+'">';
          return '<div class="cfg-item"><div><div>'+it.label+'</div><div class="desc">'+it.help+(it.recommended?(' <span class="pill">padrão: '+it.recommended+'</span>'):'')+'</div></div>'
            +'<div class="row">'+field+'<button class="btn ghost sm" data-reset-which="'+which+'" data-reset-key="'+k+'">↺</button></div></div>';
        }).join('');
        return '<div class="cfg-group"><h2>'+g+'</h2>'+items+'</div>';
      }).join('');
    }
    root.innerHTML='<div class="card">'+group('settings',data.settings||{})+'</div>'
      +'<div class="card">'+group('model',data.model||{})+'</div>';
    return root;
  };

  Bet21._leaguesSort = { key: 'main', dir: 'desc' }; // padrão: principais primeiro
  Bet21.renderLeagues = function(root, data){
    Bet21._leaguesData = data;
    var COLS = [
      { label: 'Ativa', key: 'active', type: 'num' },
      { label: 'Liga', key: 'name', type: 'str' },
      { label: 'País', key: 'country', type: 'str' },
      { label: 'Temporada', key: 'season', type: 'num' },
    ];
    function nameOf(l){ return l.displayName || l.name || ''; }
    function countryOf(l){ return l.countryPt || l.country || ''; }
    function sortVal(l, col){
      if(col.key==='active') return l.active ? 1 : 0;
      if(col.key==='name') return nameOf(l).toLowerCase();
      if(col.key==='country') return countryOf(l).toLowerCase();
      if(col.key==='season') return (l.season==null||isNaN(l.season)) ? -Infinity : Number(l.season);
      return '';
    }
    function sorted(){
      var all = ((Bet21._leaguesData && Bet21._leaguesData.leagues) || []).slice();
      var st = Bet21._leaguesSort;
      if(st.key==='main'){
        // padrão: principais → ativas → nome
        all.sort(function(a,b){
          if((b.is_main?1:0)!==(a.is_main?1:0)) return (b.is_main?1:0)-(a.is_main?1:0);
          if((b.active?1:0)!==(a.active?1:0)) return (b.active?1:0)-(a.active?1:0);
          return nameOf(a).toLowerCase()<nameOf(b).toLowerCase()?-1:1;
        });
        return all;
      }
      var col = COLS.filter(function(c){ return c.key===st.key; })[0];
      if(col){
        var mul = st.dir==='desc'?-1:1;
        all.sort(function(a,b){ var va=sortVal(a,col), vb=sortVal(b,col); if(va<vb) return -1*mul; if(va>vb) return 1*mul; return 0; });
      }
      return all;
    }
    function headHtml(){
      var st = Bet21._leaguesSort;
      return '<tr>'+COLS.map(function(c){
        var arrow = st.key===c.key ? (st.dir==='asc'?' ▲':' ▼') : '';
        return '<th class="sortable" data-sort="'+c.key+'" style="cursor:pointer;user-select:none" title="Ordenar por '+c.label+'">'+c.label+arrow+'</th>';
      }).join('')+'</tr>';
    }
    function bodyHtml(){
      var list = sorted();
      return list.map(function(l){
        return '<tr><td><input type="checkbox" data-league="'+l.id+'" '+(l.active?'checked':'')+'></td>'
          +'<td>'+(l.is_main?'★ ':'')+nameOf(l)+'</td><td class="muted">'+(countryOf(l)||'—')+'</td>'
          +'<td class="muted">'+(l.season||'—')+'</td></tr>';
      }).join('') || '<tr><td colspan="4" class="muted">Clique em "Sincronizar ligas".</td></tr>';
    }
    function paint(){
      var th=root.querySelector('#leaguesHead'); if(th) th.innerHTML=headHtml();
      var tb=root.querySelector('#leaguesBody'); if(tb) tb.innerHTML=bodyHtml();
      // re-liga os checkboxes (foram recriados)
      if(Bet21._wireLeagueChecks) Bet21._wireLeagueChecks(root);
      // liga ordenação
      root.querySelectorAll('#leaguesHead [data-sort]').forEach(function(h){
        h.onclick=function(){
          var k=h.getAttribute('data-sort'), st=Bet21._leaguesSort;
          if(st.key===k){ st.dir=(st.dir==='asc'?'desc':'asc'); }
          else { st.key=k; st.dir=(k==='name'||k==='country')?'asc':'desc'; }
          paint();
        };
      });
    }
    Bet21._repaintLeagues = paint;
    root.innerHTML='<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Ligas</h2>'
      +'<div class="row"><button class="btn ghost" id="syncLeagues">Sincronizar ligas</button>'
      +'<button class="btn ghost" data-mode="main">Só principais</button>'
      +'<button class="btn ghost" data-mode="all">Ativar todas</button>'
      +'<button class="btn ghost" data-mode="none">Desativar todas</button></div></div>'
      +'<table><thead id="leaguesHead"></thead><tbody id="leaguesBody"></tbody></table></div>';
    paint();
    return root;
  };

  Bet21.appendLog = function(logEl, ev){
    const line=el('div',{class:'e'});
    const t=new Date(ev.ts||Date.now()).toLocaleTimeString('pt-BR');
    line.innerHTML='<span class="t">'+t+'</span> <span class="'+(ev.level||'')+'">'+(ev.message||'')+'</span>';
    logEl.insertBefore(line, logEl.firstChild);
    while(logEl.childNodes.length>200) logEl.removeChild(logEl.lastChild);
    return line;
  };

  // ---------- TABS ----------
  Bet21.switchTab = function(id){
    document.querySelectorAll('.tab').forEach(function(b){ b.classList.toggle('active', b.dataset.tab===id); });
    document.querySelectorAll('.panel').forEach(function(p){ p.hidden = (p.dataset.panel!==id); });
    try { if(typeof location!=='undefined' && location.hash !== '#'+id) history.replaceState(null,'','#'+id); } catch(e){}
    if(Bet21._onTab) Bet21._onTab(id);
    return id;
  };
  // ids de aba válidos (pra validar o hash)
  Bet21._validTab = function(id){ return ['painel','prelive','live','dados','sinais','historico','contabilidade','config','ligas'].indexOf(id)>=0; };

  // ---------- WIRING (só no navegador; jsdom não dispara isto) ----------
  Bet21.init = function(){
    const api = {
      get: function(p){ return fetch(p).then(function(r){return r.json();}); },
      post: function(p,b){ return fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})}).then(function(r){return r.json();}); }
    };
    Bet21._api = api;
    let healthData = null;

    function loadTab(id){
      const root = $('#panel-'+id);
      stopLivePoll(); stopCoveragePoll();
      if(id==='painel'){ api.get('/api/health').then(function(h){ healthData=h; Bet21.renderHealth(root,h); wirePainel(root); startSSE(); }); }
      else if(id==='prelive'){ api.get('/api/prelive').then(function(d){ Bet21.renderPrelive(root,d); wirePrelive(root); }); }
      else if(id==='live'){ api.get('/api/live/state').then(function(d){ Bet21.renderLive(root,d); startLivePoll(); }); }
      else if(id==='dados'){ loadCoverage(); }
      else if(id==='sinais'){ api.get('/api/signals?status=pending').then(function(d){ Bet21.renderSignals(root,d,'pending'); }); }
      else if(id==='historico'){ api.get('/api/signals?status=settled').then(function(d){ Bet21.renderSignals(root,d,'settled'); }); }
      else if(id==='contabilidade'){ api.get('/api/accounting').then(function(d){ Bet21.renderAccounting(root,d); wireAccounting(root); }); }
      else if(id==='config'){ api.get('/api/config').then(function(d){ Bet21.renderConfig(root,d); wireConfig(root); }); }
      else if(id==='ligas'){ api.get('/api/leagues').then(function(d){ Bet21.renderLeagues(root,d); wireLeagues(root); }); }
    }
    Bet21._onTab = loadTab;

    var coveragePoll=null;
    function loadCoverage(){
      var box=$('#panel-dados'); if(!box) return;
      Promise.all([api.get('/api/backfill/coverage'), api.get('/api/health').catch(function(){return null;})]).then(function(arr){
        var d=arr[0], h=arr[1];
        var b=$('#panel-dados'); if(!b) return;
        // só atualiza se ainda estamos na aba dados (evita pisar em outra aba)
        if($('.tab.active') && $('.tab.active').dataset.tab!=='dados'){ stopCoveragePoll(); return; }
        if(h && h.requestsDay) d.quota={ remaining:h.requestsDay.remaining, limit:h.requestsDay.limit };
        Bet21.renderCoverage(b, d);
        wireCoverage(b, d.running);
        if(d.running){ if(!coveragePoll) coveragePoll=setInterval(loadCoverage, 5000); }
        else stopCoveragePoll();
      });
    }
    function wireCoverage(box, running){
      var st=box.querySelector('#syncTeamsBtn');
      if(st) st.onclick=function(){
        st.disabled=true; var o=st.textContent; st.textContent='descobrindo...';
        api.post('/api/sync/teams',{}).then(function(r){
          st.disabled=false; st.textContent=o;
          if(r.error){ alert(r.error); }
          else { alert('Times descobertos: '+r.teams+' em '+r.leagues+' liga(s) ('+r.spent+' req). A grade já mostra todos.'); loadCoverage(); }
        });
      };
      var cb=box.querySelector('#cancelBackfillBtn');
      if(cb) cb.onclick=function(){
        cb.disabled=true; cb.textContent='parando...';
        api.post('/api/backfill/cancel',{}).then(function(r){
          if(r.message && !r.canceled) alert(r.message);
          loadCoverage();
        });
      };
      function fillLeague(b, lid, includeTried){
        if(running){ alert('Espere o backfill atual terminar.'); return; }
        b.disabled=true; b.textContent='puxando...';
        api.post('/api/backfill/league',{leagueId:Number(lid),includeTried:includeTried}).then(function(r){
          if(r.error){ alert(r.error); b.disabled=false; }
          else if(r.started===false){ alert(r.message||'Nada a puxar.'); b.disabled=false; }
          else { loadCoverage(); }
        });
      }
      box.querySelectorAll('[data-fill-league]').forEach(function(b){
        b.onclick=function(){ fillLeague(b, b.getAttribute('data-fill-league'), false); };
      });
      box.querySelectorAll('[data-fill-league-all]').forEach(function(b){
        b.onclick=function(){
          if(!confirm('Re-varrer os times já tentados dessa liga? Gasta API e pode não trazer nada novo.')) return;
          fillLeague(b, b.getAttribute('data-fill-league-all'), true);
        };
      });
      box.querySelectorAll('.cvcell[data-team]').forEach(function(c){
        c.onclick=function(){
          if(running){ alert('Espere o backfill atual terminar antes de puxar um time.'); return; }
          var id=c.getAttribute('data-team'), nm=c.getAttribute('data-name')||('#'+id);
          if(!confirm('Puxar o histórico de '+nm+' agora?')) return;
          c.style.outline='2px solid #79b8ff';
          api.post('/api/backfill/team',{teamId:Number(id)}).then(function(r){
            if(r.error){ alert(r.error); c.style.outline=''; }
            else if(r.started===false){ alert(r.message||'Já rodando.'); c.style.outline=''; }
            else { loadCoverage(); } // começa a atualizar; o polling segue enquanto rodar
          });
        };
      });
    }
    function stopCoveragePoll(){ if(coveragePoll){ clearInterval(coveragePoll); coveragePoll=null; } }

    var livePoll=null;
    function startLivePoll(){
      stopLivePoll();
      livePoll=setInterval(function(){
        var root=$('#panel-live');
        if(!root||$('.tab.active').dataset.tab!=='live'){ stopLivePoll(); return; }
        api.get('/api/live/state').then(function(d){ Bet21.renderLive(root,d); });
      }, 15000);
    }
    function stopLivePoll(){ if(livePoll){ clearInterval(livePoll); livePoll=null; } }

    function wirePainel(root){
      const b=$('#engineBtn',root);
      if(b) b.onclick=function(){ api.post('/api/engine',{on:!(healthData&&healthData.engine.ok)}).then(function(){ loadTab('painel'); }); };
      const sim=$('#simBtn',root);
      if(sim) sim.onclick=function(){ sim.disabled=true; sim.textContent='🧪 simulando...'; api.post('/api/simulate',{}).then(function(r){ sim.disabled=false; sim.textContent='🧪 Simular sinal'; alert(r.fired?'✅ Simulação disparou um sinal de teste! Veja em Sinais e no log.':'A simulação rodou mas não disparou. Veja os motivos no log.'); loadTab('painel'); }); };
    }
    let es=null;
    function startSSE(){
      var logEl=$('#log'); if(!logEl) return;
      // Sempre reabastece o log atual com os eventos recentes (corrige troca de aba).
      api.get('/api/events?n=40').then(function(d){ var el=$('#log'); if(el){ (d.events||[]).reverse().forEach(function(e){ Bet21.appendLog(el,e); }); } });
      if(es||typeof EventSource==='undefined') return; // SSE conecta uma vez só
      es=new EventSource('/api/events/stream');
      es.onmessage=function(m){ var el=$('#log'); if(el){ try{ Bet21.appendLog(el, JSON.parse(m.data)); }catch(e){} } };
    }
    // wiring da Pré-live: botões de ação + religamento das linhas (acesso a api/loadTab)
    Bet21._wirePreliveButtons = function(root){
      root.querySelectorAll('[data-recapture]').forEach(function(btn){ btn.onclick=function(){ btn.textContent='...'; api.post('/api/odds/capture',{scope:'fixture',fixtureId:Number(btn.dataset.recapture)}).then(function(){ loadTab('prelive'); }); }; });
      root.querySelectorAll('[data-diagnose]').forEach(function(btn){ btn.onclick=function(){ api.get('/api/odds/diagnose?fixture='+btn.dataset.diagnose).then(function(d){ alert(JSON.stringify(d.markets||d,null,2)); }); }; });
    };
    function wirePrelive(root){
      Bet21._wirePreliveButtons(root); // religa as linhas já pintadas
      const sf=$('#syncFixtures',root); if(sf) sf.onclick=function(){ sf.disabled=true; var o=sf.textContent; sf.textContent='buscando...'; api.post('/api/sync/fixtures',{}).then(function(r){ sf.disabled=false; sf.textContent=o; if(r&&r.message){ alert(r.message); } else if(r){ alert('Próximos jogos: '+r.synced+' baixados de '+r.leagues+' liga(s) ativa(s) ('+r.spent+' req).'); } loadTab('prelive'); }); };
      const cl=$('#captureLot',root); if(cl) cl.onclick=function(){ cl.disabled=true; var o=cl.textContent; cl.textContent='capturando...'; api.post('/api/odds/capture',{scope:'lot'}).then(function(){ loadTab('prelive'); }); };
      refreshBackfillStatus(root);
    }
    function refreshBackfillStatus(root){
      const el2=$('#backfillStatus',root); if(!el2) return;
      api.get('/api/backfill/status').then(function(s){
        // Definição ÚNICA e consistente: prontos (≥N jogos) + faltam = total ativo.
        var falta = s.teamsNeeding===0 ? ' · todos prontos ✓' : (' · faltam '+s.teamsNeeding);
        var started = (s.teamsWithHistory!=null && s.teamsReady!=null && s.teamsWithHistory>s.teamsReady)
          ? ' ('+(s.teamsWithHistory-s.teamsReady)+' começados)' : '';
        el2.textContent='Histórico: '+s.teamsReady+'/'+s.activeTeams+' times prontos (≥'+(s.minGames||20)+' jogos)'
          +falta+started+' · '+(s.games!=null?s.games:'?')+' jogos guardados'+(s.running?' · rodando agora...':'');
      });
    }
    function wireAccounting(root){
      const rb=$('#runBacktest',root); if(rb) rb.onclick=function(){ rb.textContent='rodando...'; api.get('/api/backtest').then(function(b){ $('#btResult',root).textContent=b.verdict+' (avaliados: '+b.evaluated+', MAE modelo '+fmt(b.maeModel)+' vs média '+fmt(b.maeBaseline)+')'; rb.textContent='Rodar backtest'; }); };
    }
    function wireConfig(root){
      root.querySelectorAll('[data-key]').forEach(function(inp){
        inp.onchange=function(){ const v= inp.type==='checkbox'? inp.checked : inp.value; api.post('/api/config',{which:inp.dataset.which,key:inp.dataset.key,value:v}); };
      });
      root.querySelectorAll('[data-reset-key]').forEach(function(btn){ btn.onclick=function(){ api.post('/api/config',{which:btn.dataset.resetWhich,key:btn.dataset.resetKey,reset:true}).then(function(){ loadTab('config'); }); }; });
    }
    Bet21._wireLeagueChecks = function(root){
      root.querySelectorAll('[data-league]').forEach(function(cb){ cb.onchange=function(){ api.post('/api/leagues/activate',{ids:[Number(cb.dataset.league)],active:cb.checked}); }; });
    };
    function wireLeagues(root){
      const sl=$('#syncLeagues',root); if(sl) sl.onclick=function(){ sl.textContent='...'; api.post('/api/sync/leagues',{}).then(function(){ loadTab('ligas'); }); };
      root.querySelectorAll('[data-mode]').forEach(function(btn){ btn.onclick=function(){ api.post('/api/leagues/activate',{mode:btn.dataset.mode}).then(function(){ loadTab('ligas'); }); }; });
      Bet21._wireLeagueChecks(root);
    }

    document.querySelectorAll('.tab').forEach(function(b){ b.onclick=function(){ Bet21.switchTab(b.dataset.tab); }; });
    var initial = (typeof location!=='undefined' && location.hash) ? location.hash.slice(1) : '';
    Bet21.switchTab(Bet21._validTab(initial) ? initial : 'painel');
    if(typeof window!=='undefined') window.addEventListener('hashchange', function(){
      var h=location.hash.slice(1); if(Bet21._validTab(h)) Bet21.switchTab(h);
    });
  };

  if(typeof document!=='undefined' && document.readyState!=='loading' && window.__BET21_AUTORUN__!==false && typeof fetch!=='undefined'){
    // autorun no navegador real
    Bet21.init();
  } else if(typeof document!=='undefined'){
    document.addEventListener('DOMContentLoaded', function(){ if(window.__BET21_AUTORUN__!==false && typeof fetch!=='undefined') Bet21.init(); });
  }
})();
</script>
</body>
</html>`;
}
