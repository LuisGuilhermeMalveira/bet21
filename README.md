# Bet21

Disparador caseiro de sinais de **over de escanteios** em futebol, que roda no seu PC.

## ⚠️ Postura honesta (leia antes de tudo)

O Bet21 **NÃO garante lucro**. Apostas têm margem da casa e a maioria das pessoas
perde no longo prazo. Este app é um **processo pra descobrir se existe vantagem
(edge) sobre o mercado e explorá-la com disciplina** — não uma máquina de dinheiro.

- A métrica que valida vantagem é o **CLV** (closing line value), **não** o lucro de curto prazo.
- **Nada** deve ser apostado com dinheiro real antes de validar em paper-trade.
- Casas de aposta **limitam ganhadores**. Isto **não é** consultoria financeira.

## Stack

- **Node.js 22+** (testado no v22 e no v24). **Zero dependências de produção** — só APIs nativas:
  `node:sqlite`, `node:http`, `node:test`, `fetch`. Tudo em ESM.
- Banco **SQLite** local em `data/corner_signals.db`, sem ORM.
- Migração **aditiva**: atualizar o app nunca apaga dados.

## Como rodar (Windows + PowerShell)

1. Instale o Node 22+ (você tem o v24 — ótimo).
2. Abra o PowerShell na pasta do projeto:
   ```powershell
   cd C:\shared\Bet21
   ```
3. Copie os segredos e preencha a chave da API:
   ```powershell
   copy .env.example .env
   notepad .env
   ```
   (Telegram é opcional; o app funciona sem ele.)
4. Rode os testes pra confirmar que está tudo certo:
   ```powershell
   npm test
   ```
5. Sanidade do banco (cria/migra e lista as tabelas):
   ```powershell
   npm run db:check
   ```
6. Abrir o dashboard (a tela do app):
   ```powershell
   npm run dashboard
   ```
   Depois abra **http://localhost:21321** no navegador. Sem a chave da API o painel abre,
   mas sincronizar/capturar exige a chave no `.env`.

## Puxar histórico (setup inicial — recomendado fazer uma só vez)

Antes de começar a usar, popule o banco com histórico de cantos dos times. Faz diferença:
a pré-live deixa de mostrar "sem histórico suficiente" e passa a calcular λ (expectativa de cantos).

**Opção A: Pelo terminal (mais rápido — recomendado)**

Rodas uma só vez antes de abrir o dashboard:

```powershell
cd C:\shared\Bet21
npm run backfill
```

Isso puxa os últimos 30 jogos de cada time das ligas ativas, respeita o rate limit, e leva alguns minutos (uma requisição por jogo, espaçadas). Aceita flags opcionais:

```powershell
npm run backfill -- --cap=500 --games=20 --leagues=39,61
```

- `--cap=1500` (padrão): limite máximo de requisições (não estoura a cota de 7500/dia).
- `--games=30` (padrão): quantos jogos/time puxar (quanto mais, mais requisições).
- `--leagues=39,61` (padrão: todas ativas): filtrar só alguns (IDs de liga separados por vírgula).

**Opção B: Pelo dashboard**

Aba **Jogos de hoje**, botão **"Puxar histórico (cantos)"**. Roda em segundo plano e mostra progresso
no log (Painel). Mais lento que o terminal, mas dá pra acompanhar.

Depois que terminar (check no terminal ou vendo o status em "Jogos de hoje" subir), abra o dashboard,
vá na aba **Pré-live** e deve aparecer λ (expectativa de cantos) — aí sabe que funcionou.


> Se `npm test` reclamar que falta o jsdom, rode uma vez: `npm install --no-save jsdom`.

> Dica pra quando o dashboard existir: ao atualizar o app, **encerre o processo node**
> antes de extrair a nova versão, e recarregue o navegador com **Ctrl+Shift+R**
> (recarga forçada, sem cache).

## Estado da construção

Construído em blocos, com testes verdes a cada etapa.

- [x] **Bloco 1 — Fundação**
  - Estrutura de pastas + `package.json` (ESM, zero deps, scripts com `--no-warnings --experimental-sqlite`).
  - Banco SQLite com **migração aditiva** (cria tabelas/colunas que faltam, nunca apaga dados).
  - **Porteiro de API** (rate limiter central): espaçamento, espera quando o minuto acaba,
    backoff em 429, prioridade pro ao vivo, "200 vazio" tratado como dado indisponível.
  - Camada de **configuração** (settings + parâmetros do modelo) com coerção de tipo e "restaurar padrão".
  - `normalize()` (undefined → null) e log de eventos.
  - **20 testes** (`node:test`) cobrindo migração, configuração e porteiro.
- [x] **Bloco 2 — Cliente API-Football + parsing de odds**
  - Cliente fino (`src/api/apifootball.js`): toda chamada passa pelo porteiro, com prioridade (ao vivo > normal > backfill).
  - Parsing (`src/api/oddsParser.js`): identifica o mercado pelo **id** (45 = jogo todo, 77 = 1º tempo),
    ignora 57/58/85/338, trava de plausibilidade, **line shopping** (melhor over entre casas + qual casa), favorito do 1x2.
  - Captura (`src/services/oddsCapture.js`): **sempre sobrescreve ou limpa** (sem `COALESCE`), preserva só a odd de abertura,
    grava snapshots, captura de fechamento, e o **diagnóstico** dos mercados crus (🔍).
  - **+27 testes** cobrindo a armadilha do `COALESCE`, plausibilidade, line shopping e o cliente.
- [x] **Bloco 3 — Coleta de histórico → `match_stats`**
  - Extrator (`src/api/statsParser.js`): normaliza jogos e cruza as estatísticas dos dois times
    (corners a favor/sofridos, chutes, posse, cartões, gols 1T/final) — funções puras.
  - Upsert idempotente (`src/services/fixturesSync.js`): jogos e `match_stats` sem duplicar; flag de monitorado.
  - Backfill (`src/services/backfill.js`): **setup** (últimos N por time) e **diário incremental**;
    pula jogo já processado **sem gastar requisição**, respeita um **teto** de requisições e o porteiro.
  - **+15 testes** cobrindo incremental, teto, e o cruzamento dos times.
- [x] **Bloco 4 — Modelo pré-jogo + backtest**
  - Distribuições (`src/model/distributions.js`): Poisson e Binomial Negativa (pmf/cdf/sf), P(over linha), EV — em espaço-log, estável.
  - Modelo (`src/model/pregame.js`): taxas de ataque/defesa **por mando** com **decaimento** (mais peso no recente),
    λ do jogo ajustado pela força do favorito e pelo knob; P(over) e EV. Histórico insuficiente → não prevê.
  - Backtest (`src/services/backtest.js`): **sem look-ahead**, MAE do modelo vs "chutar a média",
    aviso de **amostra pequena** (< 30), veredito honesto. Mede poder preditivo, não lucro.
  - **+24 testes**, incluindo a checagem de que o modelo bate a média num mundo separável e que não há look-ahead.
- [x] **Bloco 5 — Engine ao vivo**
  - Pressão (`src/model/pressure.js`): ritmo recente vs médio, composto de chutes no gol/ataques perigosos/cantos/chutes, com clamp e flag "subindo".
  - Fator de placar (`src/model/scoreline.js`): perdendo ataca mais, jogo morto rende menos.
  - Modelo ao vivo (`src/model/live.js`): projeta o λ pro tempo restante, P(over) e **escolha da linha por melhor EV** entre as casas.
  - Engine (`src/services/liveEngine.js`): janelas W2/1T (W1/2T desligadas), **dados faltantes não disparam**,
    **anti-repetição**, **stop de banca**, e o **contexto do disparo** gravado (rastreabilidade).
  - **+25 testes**: dispara quando deve e recusa em cada bloqueio (favorito ganhando, fora da janela, sem dados, sem EV, stop, anti-repetição).
- [x] **Bloco 6 — Settle + contabilidade/CLV**
  - Settle (`src/services/settle.js`): liquida pelos cantos do **período certo** (total/1ºT/2ºT), green/red/void,
    grava lucro, fechamento e cantos que saíram, encerra o jogo e grava `match_stats`. Só gasta requisição se há pendentes.
  - Contabilidade (`src/services/accounting.js`): **CLV (métrica-rei)**, ROI, taxa de acerto, série do bankroll,
    **arsenal de filtros combináveis** (mercado/liga/status/EV/odd/minuto/placar/pressão/casa/CLV±) e **aviso de amostra pequena** (< 30).
  - **+20 testes** cobrindo período, grade, filtros e o aviso anti-overfitting.
- [x] **Bloco 7 — Dashboard SPA**
  - Servidor `node:http` nativo (`src/server/server.js`): serve a SPA com **Cache-Control: no-store**, API e **SSE** de eventos.
  - SPA vanilla (`src/server/html.js`): 8 abas (Painel com luzes de saúde + log ao vivo + liga/desliga engine, Pré-live, Jogos de hoje, Sinais, Histórico, Contabilidade, Configuração, Ligas), botões ↻/🔍.
  - Serviços novos: ligas (`src/services/leagues.js`, sincronizar/ativar em massa) e pré-live (`src/services/prelive.js`, ranking de triagem).
  - Roteador testável (`src/server/router.js` + `controller.js`).
  - **+34 testes**: rotas (ctx falso) e **renderização real com jsdom** (abas, saúde, tabelas, config, aviso de amostra).
  - Rodar com `npm run dashboard` → http://localhost:21321
  - **Botão "Puxar histórico (cantos)"** na aba Jogos de hoje: dispara o backfill em segundo plano
    (puxa os últimos N jogos dos times das ligas ativas → alimenta as médias do modelo), com status e progresso no log.
- [x] **Bloco 8 — Automação, Telegram, backup, simulação, autostart**
  - **Loops de fundo** (`src/services/loops.js`): captura de odds, captura de fechamento (CLV), settle, **engine ao vivo** (vigia os jogos minuto a minuto e dispara sinais), backup e resumo diário — todos best-effort, um erro nunca derruba o app.
  - **Telegram opcional** (`src/services/telegram.js`): avisa no celular quando dispara um sinal e manda o resumo diário de CLV/ROI. Sem o bot no `.env`, vira no-op silencioso (o app funciona 100% sem).
  - **Backup datado** (`src/services/backup.js`): cópia do SQLite em `data/backups/`, mantendo os N mais recentes.
  - **Modo simulação** (`src/services/simulation.js`): botão 🧪 no Painel dispara um sinal de teste sem gastar API.
  - **Subir com o Windows** (`src/services/autostart.js`): liga/desliga pela Configuração.
  - Porteiro acelerado pra **300 req/min** (alinhado ao plano).
  - **+18 testes** (telegram, backup, simulação, autostart, loops, e o engine ao vivo disparando de ponta a ponta). **Total: 177 testes verdes.**

**Tudo pronto.** Para usar no dia a dia: `npm run dashboard`, ligue o **engine** no Painel, e (opcional) configure o Telegram no `.env`.

## Aba "Ao vivo" (visual do engine em ação)

Com o engine ligado, a aba **Ao vivo** mostra **um card por jogo** que ele está vigiando, atualizando a cada 15s. Cada card traz: minuto e placar, total de cantos, a **pressão** (com seta de subindo/esfriando) e um **mini-gráfico** da tendência, a **janela** atual (W2/1T) e — o mais útil — o **motivo** de estar disparando ou não ("fora da janela", "favorito ganhando", "observando — sem EV suficiente", etc.). Quando dispara, o card fica verde e o sinal vai pro log, Telegram e aba Sinais.

Custo de API: **zero a mais** — a aba só expõe o que o engine já calcula a cada tick.

## Enchendo o histórico sem estourar a cota (por liga ou por time)

Para economizar a cota da API, **não há mais botões que puxam tudo de uma vez**. O preenchimento é granular e fica na grade de Cobertura (aba Jogos de hoje):

- **Botão por liga**: cada liga na grade tem um botão "↓ N que faltam" que puxa só os times daquela liga que ainda não estão prontos (pula os completos). Quando a liga fecha, vira "completa ✓".
- **Clique no time**: clicar num quadradinho puxa só aquele clube. Útil pra um recém-promovido ou completar um específico.
- **Descobrir times** (~1 req/liga): popula a grade com os clubes de cada liga ativa, pra você ver o que falta antes de gastar.
- A barra mostra a **cota de API restante no dia** — dose o gasto olhando esse número.

Botões mantidos no topo: **Sincronizar jogos** (baixa os jogos do dia, custo baixo) e **Capturar odds (lote)** (pega odds dos próximos jogos).

### Próximos jogos e filtro de período

A aba **Pré-live** concentra tudo do dia a dia: os botões **Sincronizar jogos** (baixa os próximos jogos das ligas ativas, ~1 req por liga) e **Capturar odds (lote)**, o ranking de triagem com nota/λ/Valor, a coluna de **odds de cantos** (linha · over · under), e um filtro **7 / 14 / 30 dias / Tudo** (padrão 7). Trocar o filtro é instantâneo e **não gasta API**. Os **cabeçalhos das colunas são clicáveis** pra ordenar (Nota, Jogo, Liga, Início, Cantos, λ, Valor): o primeiro clique ordena, o segundo inverte (▲/▼). Quantos jogos pegar por liga é configurável em Configuração → Sistema ("Próximos jogos a buscar por liga", padrão 10).

### Nomes das ligas

Como muitas ligas se chamam igual ("Serie A", "Serie B", "Primera División"), o app mostra o **nome popular** quando existe (Brasileirão Série A, Premier League, La Liga…) e, quando a liga não é conhecida aqui, acrescenta o **país** pra desambiguar (ex.: "Serie A (Itália)", "Eredivisie (Holanda)"). O **país aparece em português** (Holanda, Inglaterra, Espanha…). Isso vale na **lista de Ligas** e na aba **Dados**. Na aba Ligas, os **cabeçalhos (Ativa, Liga, País, Temporada) são clicáveis** pra ordenar — clique inverte a ordem (▲/▼).

### Banco de dados — cobertura do histórico (aba "Dados")

A aba **Dados** mostra o preenchimento do backfill: um % geral do banco no topo, a barra por categoria, e **um cartão por liga** (espaçado), cada quadradinho um clube colorido por estado:

- 🟩 **verde** — pronto (≥ N jogos)
- 🔵 **azul** — completo: já puxei e a API só tem < N jogos desse time (não puxa de novo)
- 🟨 **amarelo** — tem 1 a N-1 jogos mas **nunca puxei de verdade** (ex.: restos de confronto) — vale puxar
- ⬜ **cinza** — ainda não puxei
- 🟥 **vermelho** — já tentei e a API **não tinha nenhuma partida** desse time

Assim, ao longo do mês, você vê de relance o que ainda vale puxar (cinza/amarelo) e ignora o que já esgotou (azul/vermelho). O cabeçalho mostra a **cota de API restante no dia**.

Como encher (tudo granular, pra poupar cota): botão **"↓ N que faltam"** por liga puxa os times **cinza e os amarelos que ainda não foram tentados** (pula prontos, azuis e vermelhos). Isso resolve um detalhe importante: quando você puxa um time, o adversário ganha "restos" dos confrontos e fica amarelo sem ter sido puxado de verdade — esses amarelos entram no "que faltam" e são completados. Um time já puxado que não chega a N jogos vira **azul** (a API não tem mais) e não é re-puxado. **Clique no quadradinho** puxa um time específico (e força nova tentativa mesmo num azul/vermelho), e **Descobrir times** (~1 req/liga) popula a grade. Botão **⏹ Parar** encerra um backfill em andamento. Se a cota corta um time no meio, ele **não** é marcado como tentado — continua puxável depois.

**Parar o backfill:** enquanto um backfill em lote roda, aparece um botão **⏹ Parar** no cabeçalho da cobertura. Ele encerra logo após o time atual (sem corromper nada) — útil pra não gastar mais cota.

**Excluir um sinal:** nas abas Sinais e Histórico, cada linha tem um botão 🗑 pra remover aquele sinal (sai do histórico e da contabilidade). Útil pra descartar um disparo que você não quer registrar.

**A aba se mantém ao atualizar:** a aba aberta fica gravada na URL (#sinais, #live, etc.), então dar F5 ou recarregar volta pra onde você estava, em vez de cair no Painel.

## Sinais vs Histórico

- **Sinais** = o que está **ativo agora** (pré-live de valor + ao vivo) aguardando o resultado.
- **Histórico** = o que já **liquidou** (green/red/void), com os KPIs de CLV, ROI e banca. Um sinal nasce em Sinais e migra pro Histórico quando o jogo termina.

## Descalibração pré-live (sinais de valor over/under)

Além da triagem por nota, o app procura **odds descalibradas** antes do jogo. A lógica:

1. **De-vig**: tira a margem da casa do par over/under (a odd crua embute a comissão; sem remover, o sistema vê valor falso) → probabilidade real que a casa acredita.
2. **Modelo**: do λ calcula P(over) e P(under) na linha.
3. **Edge** = minha prob − prob da casa (de-vigada); **EV** = valor esperado do lado.
4. **Âncora Pinnacle** (obrigatória): só dispara quando concorda com a direção da Pinnacle (margem baixíssima, raramente erra o preço). Apostar contra a Pinnacle = provável erro do modelo → bloqueado. Sem Pinnacle no jogo → não dispara.
5. **Cortes**: EV ≥ 8% **e** edge ≥ 5 pontos (ajustáveis em Configuração → Descalibração).

Quando passa, dispara um **sinal pré-live pendente** (PL_OVER ou PL_UNDER). No fim do jogo o settle marca green/red pelo placar de escanteios e calcula o CLV (entrada vs fechamento, do lado certo). A coluna **Valor** na aba Pré-live marca os candidatos.

**Honestidade**: isso depende do λ estar calibrado. Se o modelo erra a média, o "valor" é fantasia — por isso a âncora Pinnacle e por isso o **CLV é o juiz**: CLV positivo na média valida a triagem; negativo significa recalibrar o modelo. Não é "achar odd gorda e apostar".

## Valor da unidade (R$) na Contabilidade

Todos os sinais apostam um stake fixo em **unidades** (paper-trade, sem dinheiro real). Na aba Contabilidade há um campo **"Valor da unidade"**: digite quanto vale 1 unidade (ex.: 50) e o **lucro** e o **total apostado** passam a aparecer em reais. Deixe 0 pra ver em unidades. É só forma de exibir — não altera o histórico nem move dinheiro de verdade. ROI, CLV e taxa de acerto são percentuais e não mudam com o valor.

## Loops automáticos (Bloco 8)

Com a chave no `.env`, o `npm run dashboard` já liga os loops sozinho. O **engine ao vivo** só começa a vigiar quando você clica **Ligar engine** no Painel (é uma trava de segurança — assim ele não consome API sem você querer).

Intervalos e comportamentos se ajustam na aba **Configuração** (grupo Sistema): intervalo do engine ao vivo, do settle, do backup, quantos backups manter, hora do resumo diário, ligar/desligar Telegram e subir-com-Windows.

### Telegram (opcional)

1. No app **@BotFather** do Telegram, crie um bot e copie o token.
2. Descubra seu chat id (mande uma mensagem pro bot e veja em `https://api.telegram.org/bot<TOKEN>/getUpdates`, ou use o **@userinfobot**).
3. No `.env`, preencha `TELEGRAM_BOT_TOKEN=` e `TELEGRAM_CHAT_ID=` e reinicie o dashboard.

## Estrutura

```
Bet21/
├─ package.json
├─ .env.example            # só segredos (chave da API, Telegram)
├─ src/
│  ├─ api/
│  │  └─ gatekeeper.js      # PORTEIRO: toda chamada à API passa por aqui
│  ├─ config/
│  │  ├─ defaults.js        # padrões de fábrica (origem da verdade da tela)
│  │  ├─ env.js             # leitor de .env nativo (segredos)
│  │  └─ settings.js        # get/set/all/reset de settings e modelo
│  └─ db/
│     ├─ schema.js          # tabelas declarativas
│     ├─ migrate.js         # migração aditiva
│     └─ index.js           # abre o banco + helpers (normalize, logEvent)
├─ scripts/
│  └─ db-check.js           # sanidade do banco
├─ test/                    # node:test
└─ data/                    # banco e backups (locais, não versionados)
```
