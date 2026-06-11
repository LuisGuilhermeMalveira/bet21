// Origem da verdade dos padrões do Bet21.
// Tudo aqui é editável na tela (aba Configuração) e salvo no banco.
// "value" é o padrão de fábrica; "restaurar padrão" volta pra cá.
//
// Tipos: 'bool' | 'int' | 'float' | 'text' | 'enum'
// (o tipo guia a renderização do campo e a coerção ao salvar)

/** @typedef {{value:any,type:string,group:string,label:string,help:string,recommended?:string,options?:string[],min?:number,max?:number}} Setting */

/** Configurações gerais do app (tabela app_settings). @type {Record<string, Setting>} */
export const DEFAULT_SETTINGS = {
  // --- Captura de odds ---
  odds_capture_enabled: {
    value: true, type: 'bool', group: 'Captura de odds',
    label: 'Captura automática de odds ligada',
    help: 'Loop de fundo que preenche odds faltantes aos poucos, espaçado pelo porteiro.',
    recommended: 'ligado',
  },
  odds_capture_per_round: {
    value: 8, type: 'int', group: 'Captura de odds', min: 1, max: 50,
    label: 'Jogos por rodada de captura',
    help: 'Quantos jogos sem odds o loop tenta resolver a cada volta. Menos = mais suave com a API.',
    recommended: '8',
  },
  odds_capture_window_hours: {
    value: 48, type: 'int', group: 'Captura de odds', min: 1, max: 240,
    label: 'Janela de horas à frente',
    help: 'Só captura odds de jogos que começam dentro dessa janela.',
    recommended: '48',
  },
  odds_capture_interval_sec: {
    value: 90, type: 'int', group: 'Captura de odds', min: 15, max: 3600,
    label: 'Intervalo do loop (segundos)',
    help: 'Tempo entre rodadas do loop de captura.',
    recommended: '90',
  },
  closing_capture_minutes_before: {
    value: 8, type: 'int', group: 'Captura de odds', min: 1, max: 60,
    label: 'Capturar fechamento (min antes do kickoff)',
    help: 'Captura automática da odd de fechamento pouco antes do apito inicial. Essencial pro CLV.',
    recommended: '8',
  },

  // --- Janelas de entrada ---
  window_w2_min: {
    value: 80, type: 'int', group: 'Janelas de entrada', min: 0, max: 90,
    label: 'W2 — início da janela (min)',
    help: 'Mercado do jogo todo, reta final. Exige favorito não-ganhando e pressão subindo. O cálculo já mescla os cantos do jogo todo + o ritmo atual + a pressão na reta final.',
    recommended: '80',
  },
  window_w2_max: {
    value: 86, type: 'int', group: 'Janelas de entrada', min: 0, max: 95,
    label: 'W2 — fim da janela (min)',
    help: 'Para de observar aqui pra te sobrar tempo de apostar antes do fim (90). 86 dá ~4 min de folga (tick + odd + sua aposta).',
    recommended: '86',
  },
  window_1t_min: {
    value: 32, type: 'int', group: 'Janelas de entrada', min: 0, max: 45,
    label: '1T — início da janela (min)',
    help: 'Mercado do 1º tempo; projeta cantos até os 45 com base no ritmo do jogo até aqui.',
    recommended: '32',
  },
  window_1t_max: {
    value: 41, type: 'int', group: 'Janelas de entrada', min: 0, max: 45,
    label: '1T — fim da janela (min)',
    help: 'Para de observar aqui pra te sobrar tempo de apostar antes do intervalo (45). 41 dá ~4 min de folga.',
    recommended: '41',
  },
  window_w1_enabled: {
    value: false, type: 'bool', group: 'Janelas de entrada',
    label: 'Ativar W1 (fim do 1º tempo, jogo todo)',
    help: 'Janela extra, desligada por padrão. Ligue só após validar as principais.',
    recommended: 'desligado',
  },
  window_2t_enabled: {
    value: false, type: 'bool', group: 'Janelas de entrada',
    label: 'Ativar 2T (2º tempo)',
    help: 'Janela extra, desligada por padrão.',
    recommended: 'desligado',
  },

  // --- Plausibilidade das linhas ---
  line_min_full: {
    value: 7.5, type: 'float', group: 'Plausibilidade das linhas', min: 0, max: 30,
    label: 'Linha mínima plausível (jogo todo)',
    help: 'Linha de total de cantos abaixo disso quase sempre é canto de um time capturado por engano → rejeitar.',
    recommended: '7.5',
  },
  line_max_full: {
    value: 16.5, type: 'float', group: 'Plausibilidade das linhas', min: 0, max: 40,
    label: 'Linha máxima plausível (jogo todo)',
    help: 'Teto de plausibilidade do total do jogo.',
    recommended: '16.5',
  },
  line_min_ht: {
    value: 2.5, type: 'float', group: 'Plausibilidade das linhas', min: 0, max: 20,
    label: 'Linha mínima plausível (1º tempo)',
    help: 'Faixa menor para o mercado de 1º tempo.',
    recommended: '2.5',
  },
  line_max_ht: {
    value: 8.5, type: 'float', group: 'Plausibilidade das linhas', min: 0, max: 20,
    label: 'Linha máxima plausível (1º tempo)',
    help: 'Teto de plausibilidade do 1º tempo.',
    recommended: '8.5',
  },

  // --- Banca ---
  stake_per_signal: {
    value: 1.0, type: 'float', group: 'Banca', min: 0, max: 1000,
    label: 'Stake por sinal (unidades)',
    help: 'Tamanho fixo da aposta de cada sinal, em unidades. Mantenha pequeno e constante.',
    recommended: '1',
  },
  bankroll_stop_units: {
    value: 20.0, type: 'float', group: 'Banca', min: 0, max: 100000,
    label: 'Stop de banca (unidades de prejuízo)',
    help: 'Se o prejuízo acumulado passar disso, o app para de disparar. Proteção contra tilt.',
    recommended: '20',
  },

  // --- Histórico ---
  history_games_per_team: {
    value: 30, type: 'int', group: 'Histórico', min: 5, max: 100,
    label: 'Jogos de histórico por time',
    help: 'Quantos jogos recentes de cada time puxar no setup. Alimenta as médias.',
    recommended: '30',
  },
  history_daily_hour_brt: {
    value: 4, type: 'int', group: 'Histórico', min: 0, max: 23,
    label: 'Hora da atualização diária (BRT)',
    help: 'Madrugada, incremental. Só adiciona jogos que terminaram desde a última vez.',
    recommended: '4',
  },
  history_backfill_request_cap: {
    value: 1500, type: 'int', group: 'Histórico', min: 50, max: 7000,
    label: 'Teto de requisições do backfill',
    help: 'Limite de segurança para o backfill não comer a cota diária toda de uma vez.',
    recommended: '1500',
  },
  history_complete_threshold: {
    value: 20, type: 'int', group: 'Histórico', min: 5, max: 60,
    label: 'Jogos pra considerar um time "pronto"',
    help: 'No "Puxar histórico", times com pelo menos isto de jogos são pulados (não gastam API). O modo "forçar tudo" ignora esta trava.',
    recommended: '20',
  },
  fixtures_next_per_league: {
    value: 10, type: 'int', group: 'Sistema', min: 1, max: 50,
    label: 'Próximos jogos a buscar por liga',
    help: 'Ao "Sincronizar jogos", quantos jogos futuros pegar de cada liga ativa. Cada liga custa ~1 requisição (independe deste número). A Pré-live filtra por 7/14/30 dias depois.',
    recommended: '10',
  },
  prelive_value_enabled: {
    value: true, type: 'bool', group: 'Descalibração',
    label: 'Disparar sinais pré-live de valor',
    help: 'Procura odds descalibradas (over/under) antes do jogo e dispara sinal pendente. Depende do λ estar calibrado — o CLV é o juiz.',
    recommended: 'ligado',
  },
  prelive_value_ev_min: {
    value: 0.08, type: 'float', group: 'Descalibração', min: 0.01, max: 0.5,
    label: 'EV mínimo pra disparar (fração)',
    help: '0.08 = 8%. Só dispara descalibração gritante. Maior = menos sinais, mais exigente.',
    recommended: '0.08',
  },
  prelive_value_edge_min: {
    value: 0.05, type: 'float', group: 'Descalibração', min: 0.01, max: 0.3,
    label: 'Edge mínimo (fração de pontos de prob)',
    help: '0.05 = 5 pontos de discordância entre o modelo e a casa (de-vigada).',
    recommended: '0.05',
  },
  prelive_value_require_pinnacle: {
    value: true, type: 'bool', group: 'Descalibração',
    label: 'Exigir Pinnacle como âncora',
    help: 'Não dispara contra a Pinnacle nem sem ela. Trava de sanidade — recomendado deixar ligado.',
    recommended: 'ligado',
  },
  prelive_value_window_hours: {
    value: 24, type: 'int', group: 'Descalibração', min: 1, max: 72,
    label: 'Janela de antecedência (horas)',
    help: 'Quão cedo antes do jogo a triagem de descalibração roda.',
    recommended: '24',
  },

  // --- Sistema ---
  engine_running: {
    value: false, type: 'bool', group: 'Sistema',
    label: 'Engine ao vivo ligado',
    help: 'Estado do motor ao vivo. Ligado/desligado pelo botão no Painel — guardado aqui pra sobreviver a reinícios (no deploy, o container reinicia e zeraria a memória).',
    recommended: 'ligue pelo Painel',
  },
  start_with_windows: {
    value: false, type: 'bool', group: 'Sistema',
    label: 'Subir com o Windows',
    help: 'Desligado por padrão. Ligue só quando confiar no app — senão ele consome API de fundo sem supervisão.',
    recommended: 'desligado',
  },
  backup_interval_hours: {
    value: 12, type: 'int', group: 'Sistema', min: 1, max: 168,
    label: 'Intervalo de backup do banco (horas)',
    help: 'Cópia datada do arquivo SQLite. O histórico e os sinais são valiosos.',
    recommended: '12',
  },
  backup_keep: {
    value: 20, type: 'int', group: 'Sistema', min: 1, max: 200,
    label: 'Quantos backups manter',
    help: 'Os mais antigos além desse número são apagados.',
    recommended: '20',
  },
  live_tick_interval_sec: {
    value: 60, type: 'int', group: 'Sistema', min: 20, max: 600,
    label: 'Intervalo do engine ao vivo (segundos)',
    help: 'A cada quanto tempo o engine olha os jogos ao vivo. Menos = mais responsivo, mais API.',
    recommended: '60',
  },
  settle_interval_minutes: {
    value: 20, type: 'int', group: 'Sistema', min: 5, max: 240,
    label: 'Intervalo do settle (minutos)',
    help: 'A cada quanto tempo o app tenta liquidar jogos terminados.',
    recommended: '20',
  },
  telegram_enabled: {
    value: true, type: 'bool', group: 'Sistema',
    label: 'Avisar no Telegram',
    help: 'Manda mensagem quando dispara um sinal e o resumo diário. Só funciona com o bot configurado no .env.',
    recommended: 'ligado',
  },
  daily_summary_hour_brt: {
    value: 9, type: 'int', group: 'Sistema', min: 0, max: 23,
    label: 'Hora do resumo diário (BRT)',
    help: 'Hora do dia (0-23) em que manda o resumo de CLV/ROI no Telegram.',
    recommended: '9',
  },
};

/** Parâmetros do modelo de cantos (tabela model_params). @type {Record<string, Setting>} */
export const DEFAULT_MODEL_PARAMS = {
  // EV / probabilidade
  ev_min: {
    value: 0.03, type: 'float', group: 'Modelo', min: 0, max: 1,
    label: 'EV mínimo pra disparar',
    help: 'Só dispara se o valor esperado (EV) ficar acima disso. EV = P·(odd-1) - (1-P).',
    recommended: '0.03',
  },
  prob_min: {
    value: 0.55, type: 'float', group: 'Modelo', min: 0, max: 1,
    label: 'Probabilidade mínima do modelo',
    help: 'Piso de P(over) pra considerar a linha. Evita apostar em moeda no ar.',
    recommended: '0.55',
  },
  // Pressão (composição — soma deve dar 1.0)
  pressure_w_shots_on: {
    value: 0.30, type: 'float', group: 'Modelo', min: 0, max: 1,
    label: 'Peso da pressão: chutes no gol',
    help: 'Componente da pressão ao vivo. Os quatro pesos somam 1,0.',
    recommended: '0.30',
  },
  pressure_w_dangerous: {
    value: 0.30, type: 'float', group: 'Modelo', min: 0, max: 1,
    label: 'Peso da pressão: ataques perigosos',
    help: 'Componente da pressão ao vivo.',
    recommended: '0.30',
  },
  pressure_w_corners: {
    value: 0.25, type: 'float', group: 'Modelo', min: 0, max: 1,
    label: 'Peso da pressão: cantos recentes',
    help: 'Componente da pressão ao vivo.',
    recommended: '0.25',
  },
  pressure_w_shots: {
    value: 0.15, type: 'float', group: 'Modelo', min: 0, max: 1,
    label: 'Peso da pressão: chutes totais',
    help: 'Componente da pressão ao vivo.',
    recommended: '0.15',
  },
  pressure_clamp_min: {
    value: 0.5, type: 'float', group: 'Modelo', min: 0.1, max: 1,
    label: 'Pressão: limite inferior',
    help: 'A razão de pressão é limitada a esta faixa pra não explodir o modelo.',
    recommended: '0.5',
  },
  pressure_clamp_max: {
    value: 2.0, type: 'float', group: 'Modelo', min: 1, max: 5,
    label: 'Pressão: limite superior',
    help: 'Teto da razão de pressão.',
    recommended: '2.0',
  },
  // Histórico / decaimento
  recency_halflife_games: {
    value: 8, type: 'int', group: 'Modelo', min: 1, max: 60,
    label: 'Meia-vida do decaimento (jogos)',
    help: 'Quanto mais recente o jogo, mais peso. Esta é a meia-vida do decaimento exponencial.',
    recommended: '8',
  },
  distribution: {
    value: 'poisson', type: 'enum', group: 'Modelo', options: ['poisson', 'negbin'],
    label: 'Distribuição de cantos',
    help: 'Poisson (simples) ou Binomial Negativa (variância maior, mais realista p/ cantos).',
    recommended: 'poisson',
  },
  negbin_dispersion: {
    value: 8.0, type: 'float', group: 'Modelo', min: 1, max: 100,
    label: 'Dispersão da Binomial Negativa (r)',
    help: 'Só usado se a distribuição for negbin. r menor = mais variância.',
    recommended: '8.0',
  },
  // Knob global da calibração
  calibration_knob: {
    value: 1.0, type: 'float', group: 'Modelo', min: 0.5, max: 1.5,
    label: 'Knob global de calibração',
    help: 'Ajuste fino único aplicado ao λ do modelo. A rotina de calibração mexe nisto em passos pequenos.',
    recommended: '1.0',
  },
  favorite_corner_coef: {
    value: 0.08, type: 'float', group: 'Modelo', min: 0, max: 0.5,
    label: 'Ajuste por força do favorito',
    help: 'Quanto a diferença de força (do 1x2) aumenta o λ de cantos. Favorito forte pressiona mais. Mantenha pequeno (risco de overfit).',
    recommended: '0.08',
  },
  ht_share: {
    value: 0.46, type: 'float', group: 'Modelo', min: 0.3, max: 0.6,
    label: 'Fração de cantos no 1º tempo',
    help: 'O 2º tempo costuma ter um pouco mais de cantos. Usado pra estimar o λ pré-jogo do 1º tempo (o histórico não separa por tempo).',
    recommended: '0.46',
  },
};

/** Junta os dois mapas indicando a tabela de cada um. */
export const ALL_DEFAULTS = {
  settings: DEFAULT_SETTINGS,
  model: DEFAULT_MODEL_PARAMS,
};
