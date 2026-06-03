# Deploy no Railway (plano Hobby, ~US$5/mês)

O Bet21 precisa rodar **24/7** (os loops capturam dados ao vivo a cada minuto) e ter
**disco persistente** (o SQLite com seu histórico). O plano **Hobby** do Railway atende
os dois: não hiberna e permite volume. O trial grátis NÃO serve (hiberna e perde dados).

## Visão geral

São 5 etapas: subir o código → criar o projeto → adicionar um **volume** (disco) →
configurar as **variáveis de ambiente** → gerar o domínio. Uma vez feito, todo `git push`
re-deploya sozinho.

---

## 1. Subir o código pro GitHub

O `.gitignore` já protege o que não pode ir (o `.env`, o banco `data/*.db`). Então:

```bash
cd C:\shared\Bet21
git init
git add .
git commit -m "Bet21 pronto pra deploy"
```

Crie um repositório **privado** no GitHub (privado porque é seu sistema pessoal) e:

```bash
git remote add origin https://github.com/SEU_USUARIO/bet21.git
git branch -M main
git push -u origin main
```

> Confirme que o `.env` **não** foi enviado (não deve aparecer no GitHub). O `.gitignore`
> cuida disso, mas vale conferir.

---

## 2. Criar o projeto no Railway

1. Em railway.app → **New Project** → **Deploy from GitHub repo**.
2. Selecione o repositório `bet21`.
3. O Railway detecta Node automaticamente (via Nixpacks) e já lê o `railway.json` e o
   `.nvmrc` (Node 22, que o `node:sqlite` exige). O `start` já está configurado.
4. O primeiro build vai rodar. **Não se preocupe se ele reiniciar** — falta o volume e as
   variáveis, que faremos agora.

---

## 3. Adicionar o volume (disco persistente) — ESSENCIAL

Sem isso, **seu histórico some a cada deploy**.

1. No serviço, aba **Variables** ou **Settings** → procure **Volumes** → **+ New Volume**.
2. Monte em: **`/data`**  (mount path).
3. Salve. O Railway vai redeployar com o disco montado.

---

## 4. Variáveis de ambiente

No serviço → aba **Variables** → adicione:

| Variável | Valor | Pra quê |
|---|---|---|
| `APIFOOTBALL_KEY` | sua chave da API-Football | buscar dados |
| `BET21_DB_PATH` | `/data/corner_signals.db` | banco no volume persistente |
| `TELEGRAM_BOT_TOKEN` | (opcional) token do bot | notificações |
| `TELEGRAM_CHAT_ID` | (opcional) seu chat id | notificações |

**Não** precisa setar `PORT` — o Railway injeta sozinho, e o app já lê dela.

> O `BET21_DB_PATH` apontando pro `/data` é o que liga o banco ao volume do passo 3.
> Backups ficam em `/data/backups/` automaticamente (seguem o banco).

---

## 5. Gerar o domínio

1. Aba **Settings** → **Networking** → **Generate Domain**.
2. Vai sair algo como `bet21-production.up.railway.app`.
3. Abra no navegador — é o seu dashboard, agora rodando 24/7.

---

## Primeiro uso no deploy

O banco começa **vazio** (o volume é novo). Então, na primeira vez:

1. Aba **Ligas** → **Sincronizar ligas** → ative as que quer.
2. Aba **Pré-live** → **Sincronizar jogos** (baixa os próximos jogos).
3. Aba **Dados** → **Descobrir times**, depois encha o histórico liga por liga.
4. Os loops já estão rodando — os sinais começam a cair sozinhos conforme houver
   histórico e odds.

### (Opcional) Levar seu histórico do PC pro deploy

Se você já encheu bastante histórico no PC e não quer refazer, dá pra subir o arquivo
`data/corner_signals.db` pro volume. O jeito mais simples é usar o **Railway CLI**:

```bash
npm i -g @railway/cli
railway login
railway link        # escolhe o projeto bet21
# copie o banco local pro volume (ajuste o caminho do serviço conforme o CLI pedir)
```

Como o CLI muda de versão, se preferir me avise que te passo o comando exato da versão
atual — ou simplesmente recomece o histórico no deploy (é só tempo de API, não custa nada
além das requisições).

---

## Custo e manutenção

- **Hobby ~US$5/mês** cobre de sobra um app pequeno como este.
- Acompanhe o uso em **Usage** no painel do Railway.
- Todo `git push` na branch `main` re-deploya automaticamente.
- O app reinicia sozinho se cair (configurado no `railway.json`).

## Aviso honesto

Rodar no deploy **não melhora os sinais** — só tira a dependência do seu PC ligado. A
validação continua sendo a mesma: paper-trade primeiro, CLV como juiz, dinheiro real só
depois que o CLV provar vantagem ao longo de muitos sinais.
