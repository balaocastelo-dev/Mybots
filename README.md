# MyBots

Equipe de agentes de IA do sua empresa: **um Bot por PC**, todos comandados por texto e voz numa interface estilo WhatsApp, conversando entre si e pedindo sua aprovação antes de qualquer ação crítica.

![interface](docs/screenshot.png)

> **Padrão da casa:** todo bot nasce no Claude (`direct` + `anthropic/claude-haiku-4-5`), herdando a
> `ANTHROPIC_API_KEY` do `.env` da raiz — ninguém digita chave em bot nenhum. O Hub confere essa chave
> com a Anthropic no boot e mostra o veredito em `GET /api/health` (`chaveDaCasa`).
> A auditoria completa de 29/10 (o que foi testado, os defeitos corrigidos e os bots novos) está em
> [docs/MYBOTS-auditoria-29-10.md](docs/MYBOTS-auditoria-29-10.md).

## Como funciona

```
 você (navegador / celular)
        │ texto · voz
        ▼
 ┌──────────────────── Hub (PC principal) ────────────────────┐
 │ API + WebSocket · SQLite · interface web · MCP "mybots"    │
 └───────┬──────────────────┬──────────────────┬──────────────┘
         │ WebSocket (LAN ou Tailscale)        │
   ┌─────▼─────┐      ┌─────▼─────┐      ┌─────▼─────┐
   │ PC 1      │      │ PC 2      │      │ PC N      │
   │ mybots-node│     │ mybots-node│     │ mybots-node│
   │ engine:    │      │ engine:    │      │ engine:    │
   │ opencode   │      │ direct     │      │ direct     │
   └───────────┘      └───────────┘      └───────────┘
   modelo: OpenCode grátis · Gemini · Claude · Nous Portal · Ollama · OpenRouter
```

- **Hub** (`packages/hub`): roteia mensagens (você → Bot, Bot → Bot), guarda conversas, aprovações, perguntas, memória compartilhada e auditoria; serve a interface; expõe um servidor MCP com as ferramentas da equipe.
- **Nó** (`packages/node`): roda em cada PC. Dois motores:
  - `opencode` — o Bot é um agente do [OpenCode](https://opencode.ai) (`opencode serve`) com persona própria; é o jeito de usar os **modelos grátis** (`big-pickle`, `glm-5.3-flash-free`…) e também Gemini, Claude ou qualquer provedor que o OpenCode suporte. As ferramentas da equipe chegam por MCP.
  - `direct` — o nó fala direto com a API do modelo (Gemini, Claude/Anthropic, Nous Portal, Ollama, OpenRouter, Groq, LM Studio…) e roda um loop de ferramentas próprio (terminal com aprovação, arquivos, web, perguntar ao chefe, consultar colegas). Não precisa de nada instalado além do Node.
- **Interface** (`packages/ui`): lista de Bots e grupos com status ao vivo, chat com cartões de aprovação e de pergunta, anexos, rotinas (⏰), criação e configuração de Bots (+ novo bot / ⚙️), e **voz**: as respostas são faladas (voz neural pt-BR pelo Hub) e o microfone envia sozinho quando você para de falar, voltando a ouvir depois que o Bot responde (modo conversa 🗣️).
- **Pensamentos escondidos**: alguns modelos (ex.: `big-pickle`) escrevem o raciocínio em inglês antes de responder; o Hub separa isso da resposta (`packages/hub/src/thoughts.ts`) — não aparece no chat nem é falado, fica só em `meta.thought`.

## Instalação no Windows

Pré-requisito: Node.js 20+ (o instalador baixa se faltar). Copie esta pasta para cada PC (ou `git clone`). Com npm 12+ os scripts de instalação de dependências ficam bloqueados até serem aprovados — os instaladores já fazem `npm install-scripts approve better-sqlite3 esbuild` e consertam o `opencode.exe` global, que o npm 12 deixa com um placeholder.

**PC principal (Hub):**

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-hub.ps1            # -AutoStart para subir no logon
.\start-hub.cmd
```

Anote o token impresso (fica em `.env`) e o endereço `http://IP:8790`.

**Cada PC de Bot:**

```powershell
Set-ExecutionPolicy -Scope Process Bypass
# modelo grátis do OpenCode (padrão)
.\scripts\install-node.ps1 -Bot joao-videomaker -Nome "João Videomaker" -Funcao "Videomaker da empresa" -Avatar 🎬 -Hub ws://192.168.0.10:8790 -Token SEU_TOKEN
.\bots\joao-videomaker\start-bot.cmd
```

Outros provedores (todos testados):

| Provedor | Parâmetros do `install-node.ps1` | Chave |
| --- | --- | --- |
| OpenCode grátis | `-Engine opencode -Provider opencode -Modelo big-pickle` (ou `glm-5.3-flash-free`, `deepseek-v4.1-flash-free`…) | nenhuma (se pedir login: `opencode` → `/connect`) |
| Gemini | `-Engine direct -Provider gemini -Modelo gemini-2.5-flash -ApiKey AIza…` | `GEMINI_API_KEY` |
| Claude | `-Engine direct -Provider anthropic -Modelo claude-sonnet-5-5 -ApiKey sk-ant-…` | `ANTHROPIC_API_KEY` |
| Nous Portal | `-Engine direct -Provider nous -Modelo stepfun/step-3.7-flash:free -ApiKey …` | `NOUS_API_KEY` |
| Ollama (RTX 4090) | `-Engine direct -Provider ollama -Modelo qwen3:30b -BaseUrl http://IP-DA-4090:11434/v1` | nenhuma |
| OpenRouter | `-Engine direct -Provider openrouter -Modelo <modelo>:free -ApiKey sk-or-…` | `OPENROUTER_API_KEY` |

Qualquer provedor acima também funciona **dentro do OpenCode** trocando `-Engine opencode` (o nó escreve o `opencode.json` do workspace com o provedor, o agente e o MCP do Hub).

Edite a personalidade em `bots/<bot>/persona.md`. Exemplos de configuração em `examples/`.

**Criar Bots pela interface.** Na lista, "+ novo bot": nome, função, avatar, voz, provedor/modelo, personalidade. "Roda neste PC" → o Hub escreve `bots/<id>/` e inicia o nó na hora (e reinicia se cair); "Roda em outro PC" → mostra o comando do `install-node.ps1` para colar lá. O ⚙️ no chat edita, reinicia, para, mostra o log e exclui. Pastas `bots/<id>/` criadas pelo script no PC do Hub são adotadas e iniciadas pelo Hub automaticamente.

**Atalho de app:** `.\scripts\create-shortcut.ps1` cria "MyBots" na Área de Trabalho, abrindo a interface numa janela própria do Chrome/Edge.

## Voz

| Função | Padrão | Alternativas (variáveis no `.env` do Hub) |
| --- | --- | --- |
| Fala (TTS) | `MYBOTS_TTS=edge` — vozes neurais pt-BR da Microsoft, grátis, sem chave (`pt-BR-AntonioNeural`, `FranciscaNeural`, `ThalitaNeural`…; uma por Bot, ou `bot.voice`) | `piper` (`MYBOTS_TTS_URL=http://127.0.0.1:5000`, local) · `openai` (`MYBOTS_TTS_URL`, `MYBOTS_TTS_KEY`, `MYBOTS_TTS_MODEL`) · `none` (voz do navegador) |
| Escuta (STT) | reconhecimento do navegador (Chrome/Edge), sem instalar nada | `MYBOTS_STT_URL=http://IP-DA-4090:8000/v1` apontando para um servidor whisper compatível com a API da OpenAI (faster-whisper-server/Speaches, whisper.cpp) + `MYBOTS_STT_MODEL`, `MYBOTS_STT_KEY` — a interface passa a gravar o áudio e mandar para o Hub |

Nos dois modos a frase é enviada sozinha ~1,3 s depois que você para de falar; o botão 🔊 liga/desliga a resposta falada e o 🗣️ o modo conversa.

### Captação: o que faz o microfone escrever o que foi dito (30/10)

Queixa do chefe: *"falo uma coisa e o mic cata e escreve outra"*. Eram quatro causas somadas,
e a maior delas era um defeito, não um ajuste.

1. **O arquivo nascia quebrado.** Em `escutaComGravador` todos os gravadores empurravam os
   pedaços para a **mesma lista**. O último pedaço de um gravador chega *depois* do `stop()` —
   ou seja, depois da troca de lista — e caía no começo do arquivo seguinte, **antes do
   cabeçalho**. Às vezes o decodificador recusava o arquivo inteiro (`Invalid data found when
   processing input` no `stt.log`); nos outros casos descartava o começo em silêncio e o
   Whisper transcrevia a frase sem a primeira palavra. Agora cada gravador tem a lista dele.
2. **O giro do gravador comia a primeira sílaba.** No silêncio o gravador reiniciava de
   1,2 em 1,2 s, e o reinício apaga o que já foi gravado. Como a fala só é confirmada depois de
   140 ms acima da régua, o giro podia cair exatamente no começo da frase. Agora só gira depois
   de 700 ms **sem som nenhum** (régua baixa, `PRE_SOM`), e de 3 em 3 s.
3. **O navegador entregava áudio "tratado".** `autoGainControl` bombeia o chiado no silêncio e
   `noiseSuppression` apaga consoante fraca — os dois atrapalham o Whisper. Saíram; o
   cancelamento de eco **fica** (sem ele o bot se ouve pelo alto-falante). Pede-se 1 canal e
   16 kHz, que é o formato que o Whisper usa por dentro.
4. **O modelo e o vocabulário.** O `stt-server.py` rodava no `small` e sem contexto. Passou a
   `large-v3` (cai sozinho para `medium`/`small` se a VRAM não couber, **nunca abaixo de
   `small`**) com `condition_on_previous_text=False`, queda de temperatura, limiares de
   alucinação e um `initial_prompt` curto com os nomes da casa.

Medido com a **mesma gravação** ("Kevinho, pede pro João Videomaker fazer um Reels do SSD
Sandisk de 1 tera… no sua empresa do Conta2, na Conta1. Confere o estoque no o ERP"):

| | o que saiu |
| --- | --- |
| antes (`small`, sem vocabulário) | "Jo**ãovi de uma quer**… SSD **Sandiz** de um **tero**… na **Anxieta**… no **Blin**" |
| agora (`large-v3` + vocabulário) | a frase inteira certa, inclusive SanDisk, Conta1 e o ERP |

Mais dois guarda-corpos: áudio com menos de 2 KB (clique, tosse, porta batendo) nem sai da
interface nem passa do `/api/stt` — mandar isso ao Whisper não devolve silêncio, devolve frase
inventada; e o servidor descarta o que tem `no_speech_prob` alto com confiança baixa.

**Microfone errado** é a outra causa comum. Quando a máquina tem mais de uma entrada, a barra da
chamada mostra um seletor (a escolha fica no navegador, em `mybots.microfone`).

Variáveis: `MYBOTS_STT_MODEL` (padrão `large-v3`), `MYBOTS_STT_VOCAB` (termos extras, separados
por vírgula), `MYBOTS_VRAM_RESERVA_GB` (padrão 4). O prompt do Whisper tem teto de 700
caracteres — passar disso derruba a chamada com *"No position encodings are defined for
positions >= 448"*.

### ⏹ Parar é parar — e parar é parar tudo

Uma função só (`stopEverything`, em `ui/src/stop.ts`; `hub.pararTudo` do outro lado), chamada pelo
botão **⏹ Parar**, pela tecla **Esc**, ao trocar de conversa, ao fechar a janela, quando outra
janela assume e por `POST /api/stop`. Ela cala a fala (inclusive o `cancel→resume→cancel` que o
Chrome exige quando a voz está pausada), fecha o microfone e o auto-envio, aborta o que os bots
estão gerando e os comandos em execução, cancela os cartões de aprovação e pergunta pendentes,
manda **todas** as janelas pararem (BroadcastChannel + WebSocket) e segura as rotinas por 2 s.
O que o nó mandar atrasado é descartado, e a mensagem cortada fica marcada como "interrompido".

### Chamada de voz (📞 no cabeçalho do chat) — é telefone, não walkie-talkie

- **Ele fala enquanto escreve.** O modelo responde em fluxo (`stream`) e o Hub manda para a voz
  cada FRASE pronta (`speech.delta`), já sem o raciocínio do modelo. A primeira palavra sai em
  ~2 s em vez de esperar o texto inteiro. Meia frase nunca é falada (a voz gaguejaria).
- **O microfone não fecha.** Durante a chamada ele ouve o tempo todo, inclusive enquanto fala.
- **Você fala, ele cala.** O silêncio é instantâneo, antes de qualquer ida ao servidor. Se o que
  o microfone pegou era eco do alto-falante ou barulho da loja, a fala **volta de onde parou**;
  se era você mesmo, o que ele estava gerando é abortado e sua frase vai na hora.
- Contra o eco: cancelamento do navegador + régua de volume mais alta enquanto ele fala +
  descarte do que repete as palavras que ele acabou de dizer (`pareceEco`).
- **Dinheiro é lido como gente lê:** "R$ 3058,00" vira "três mil e cinquenta e oito reais", e
  "12x" vira "12 vezes" (`dinheiroPorExtenso`, aplicado em toda limpeza de fala).
- Prova ao vivo: `node scripts/teste-fala-viva.mjs <bot> "pergunta"` mostra em que milissegundo
  cada pedaço de fala saiu e quando o texto terminou.

## Rotinas, grupos, arquivos e canais

- **Rotinas**: ⏰ no chat (ou o próprio Bot com `schedule`): cron de 5 campos no fuso do PC do Hub; "Rodar agora", pausar, apagar. O Bot recebe `[Rotina "nome"] prompt` e executa como se fosse você.
- **Grupos**: "+ novo" na lista; a mensagem vai a todos os membros; cada Bot responde o que é da sua área e a fala dos colegas entra no contexto dos outros sem gerar resposta (sem loop de conversa entre bots).
- **Arquivos**: 📎 na interface manda para o Bot (o link vai junto da mensagem); o Bot manda com `send_file` / `screenshot` (ou `mybots-local_send_file` / `mybots-local_screenshot` no OpenCode) e aparece no chat; `GET /api/files/:id`.
- **Canais externos (WhatsApp via CRM, e-mail)**: o CRM posta em `POST /api/channels/incoming` `{channel, from, botId, text}` (Bearer `MYBOTS_CHANNEL_INBOUND_KEY` ou o token do hub); a resposta do Bot é enviada ao webhook `MYBOTS_CHANNEL_WEBHOOK_URL` como `{channel, to, botId, text}`. A conversa fica em `channel:<canal>:<from>:<bot>` e o Bot é instruído a tratar como cliente (sem executar comandos).

## O que os Bots sabem fazer

| Ferramenta (direct) | No OpenCode | O que faz |
| --- | --- | --- |
| `run_command` | `bash` | roda no terminal do PC; comandos que mudam algo pedem **aprovação** na interface (Permitir / Permitir sempre / Negar) |
| `read_file`, `write_file`, `list_dir` | `read`, `write`, `edit`, `glob` | arquivos do workspace |
| `fetch_url` | `webfetch` | lê páginas |
| `ask_user` | `mybots_ask_user` | pergunta ao chefe com botões e espera |
| `ask_bot` / `send_to_bot` / `list_bots` | `mybots_ask_bot` / `mybots_send_to_bot` / `mybots_list_bots` | fala com os colegas (o Hub roteia entre PCs; a conversa fica salva em `pair:a:b`) |
| `request_approval` | `mybots_request_approval` | aprovação para ações fora do terminal (pagar, enviar, publicar) |
| `set_status`, `notify_user` | `mybots_set_status`, `mybots_notify_user` | status na lista de contatos; notificação |
| `remember`, `recall` | `mybots_remember`, `mybots_recall` | memória compartilhada da equipe |

## Segurança

- Nós só conectam com token (`MYBOTS_HUB_TOKEN` único ou `MYBOTS_NODE_TOKENS=bot:token,…`). Sem token configurado o Hub aceita qualquer nó e avisa — só para testes.
- `opencode serve` fica em `127.0.0.1` com senha; só o nó fala com ele.
- Comandos: lista de auto-permitidos (leitura), lista de negados (`format`, `diskpart`, `shutdown`, `rm -rf /`…), o resto pede aprovação. "Permitir sempre" vale por comando e expira (24 h por padrão).
- Tudo fica na tabela `audit` (`GET /api/audit`).
- Interface: defina `MYBOTS_UI_PASSWORD` e abra `http://IP:8790/?k=SENHA`. Fora da LAN, use Tailscale.

## Testes

```bash
npm install
npm run build:ui
npm test              # hub + 3 nós (Nous/OpenAI-compat, Anthropic, Gemini) contra um modelo de mentira — 41 testes
npm run test:opencode # o mesmo com o OpenCode de verdade (precisa de `npm i -g opencode-ai`) — 8 testes
```

Os testes cobrem: resposta por cada provedor, status ao vivo, ferramentas, aprovação (permitir e negar), pergunta com botões, Bot consultando Bot, grupos, rotinas, arquivos (envio e anexo), canal externo com webhook, voz (TTS Edge real e STT), filtro de pensamentos, criar/editar/parar/excluir Bots pela API, bot offline, erro de modelo, bot excluído que não ressuscita (pasta marcada `.removido`) e adoção no padrão da casa e, no OpenCode, permissão de `bash`, `mybots_ask_user`, `mybots_ask_bot`, `mybots-local_send_file` via MCP e grupos com `noReply`.

## API

`GET /api/bots` · `GET /api/conversations` · `GET /api/conversations/:id/messages` · `POST /api/send {conversationId, text, attachments?}` · `GET/POST /api/approvals[/:id]` · `GET/POST /api/questions[/:id]` · `GET/POST/PATCH/DELETE /api/groups` · `GET/POST/PATCH/DELETE /api/routines` + `POST /api/routines/:id/run` · `GET/POST/PATCH/DELETE /api/managed[/:id]` + `start|stop|restart|logs` · `POST /api/bots/:id/parar` (para só esse bot) · `GET /api/providers` · `POST /api/upload` · `GET /api/files/:id` · `POST /api/channels/incoming` · `GET /api/voice/config` · `POST /api/stt` · `POST /api/tts` · `GET /api/audit` · WebSocket `/ws/ui` · MCP `/mcp` (Bearer token + `X-MyBots-Bot`).

## Roteiro

- [x] Fase 0 — OpenCode em cada PC
- [x] Fase 1 — Hub + nó + interface (texto), vários PCs
- [x] Fase 2 — ask_bot, ask_user com botões, aprovações, status, memória, MCP para o OpenCode
- [x] Fase 3 — voz: TTS Edge/Piper/OpenAI pelo Hub, STT whisper opcional, envio automático ao parar de falar, modo conversa, atalho de app
- [x] Fase 4 — rotinas agendadas, grupos, arquivos e captura de tela, canal externo por webhook
- [x] Fase 5 — criar e configurar Bots pela interface (hospedados pelo Hub), filtro de pensamentos
- [ ] Próximos — app Electron com tray e atalho global do microfone; adaptador pronto para o CRM WhatsApp; vozes clonadas por Bot

## Imagem sem a placa (30/10/2026)

`generate_image` passou a gerar **de graça na nuvem**, sem tocar na RTX 4090. Ordem dos
provedores: `pollinations` (FLUX, sem chave e sem conta) → `cloudflare` (FLUX schnell, camada
grátis, precisa de conta sem cartão) → `comfy` (a placa) → `gemini` → `openai`. Trocar a ordem:
`MYBOTS_MEDIA_ORDER` no `.env`.

Com imagem de referência os dois gratuitos se desligam e a vez passa ao ComfyUI/Gemini — eles
só fazem texto→imagem. Cotas e auditoria continuam valendo (`/api/media/budget`).
Teste: `tests/media.test.ts`.

## Excluir bot é acabar com tudo (30/10/2026)

Excluir tirava o bot da lista e deixava a conversa de pé — com mensagem pela metade, fala
em curso e a tela ainda apontada para ele. Agora, ao excluir:
`stop` do processo → `finalizeStreams` (fecha a resposta em andamento) → apaga rotinas,
aprovações e perguntas → **apaga a conversa direta e as de bot para bot** → a interface
limpa mensagens, ferramentas, aprovações e avisos daquele bot, fecha o chat aberto e **cala
o TTS**. Grupos continuam (são de todos); memória da equipe e arquivos só saem com `?purge=1`.
Teste no e2e, conferido ao contrário (com o código antigo ele reprova).

Avatares ("amebas") da lista agora no dobro do tamanho (`Avatar` padrão 176).

## O coração do sistema é intocável (30/10/2026, manhã)

Regra do chefe: travado de verdade é **só** o que mantém o MyBots de pé e o conhecimento
da casa. O resto — pasta de bot, workspace, log, temporário — o Médico apaga e arruma
sozinho, que é a função dele. Uma trava que atrapalha o Médico de trabalhar seria
desligada numa semana.

Intocável (`tocaCoracaoDoSistema` em `packages/node/src/tools.ts`): `packages/`,
`node_modules/`, `scripts/`, `package.json`/`tsconfig`, `packages/hub/data` e o
`mybots.sqlite` (conhecimento, memória, conversas, auditoria), `dados/`, o `.env` e a
pasta do Médico. Também não dá para matar o Hub (`Stop-Process` em cima de `*mybots*`
ou da janela do Hub) — matar o nó de **um** bot pela id dele continua liberado.

Não é persona, é código: não passa no MODO DEUS, não passa com "permitir sempre", não
passa nem com o OK do chefe no cartão — porque o estrago é justamente o que impediria de
desfazer. Vale nos dois motores (o `direct` e o `opencode`, que tinha porta dos fundos) e
também no `write_file`, que escreve sem passar pelo terminal. Apagar é sempre barrado;
**editar** código em `packages/` continua liberado, senão o Médico não conseguiria
consertar o sistema — o que não se edita é banco, chaves e dados.

`tests/trava.test.ts` cobre os dois lados: 10 comandos que têm de ser barrados e 9 que
têm de passar.

## Excluir bot: o pedido morria antes de sair da tela (30/10/2026, manhã)

O chefe excluía um bot, confirmava, e o bot continuava na lista. O Hub estava certo (a
mesma exclusão pela API responde `200` em 0,6 s): **o pedido nunca saía do navegador**.
O `confirm()` tira o foco da janela, e o menu do bot fechava sozinho no `blur` — o React
desmontava o menu com o clique ainda parado dentro do `confirm`, e o `fetch` morria no
meio do caminho. Agora o menu fecha **antes** de perguntar, então não há mais o que
desmontar, e o pedido vai antes da animação do avatar.

Junto disso: o menu engolia a resposta do Hub. Um `400` ou `401` virava "não aconteceu
nada" na tela — foi o que fez a gente caçar no escuro um pedido que o servidor nem
recebeu. Agora a falha aparece com o motivo.

## Parar é por bot, e excluir mata o processo (30/10/2026, madrugada)

Dois defeitos que o chefe viu e que tinham a mesma raiz: ninguém conferia se o que foi
mandado parar parou de verdade.

**Excluir.** O `stop` disparava um `taskkill` e seguia em frente sem olhar o resultado.
Quando o processo escapava, o nó reconectava ao Hub em 1 s, dizia "olá", e o Hub recriava
a linha dele na tabela `bots`: **o bot excluído reaparecia sozinho no painel** (o
`node.log` dos testes do chefe mostra o nó vivo depois do excluir, e a auditoria mostra
`node.connected` 27 minutos depois do `bot.removed`). Agora:

- `BotManager.stop()` é `async`, mata o processo, **varre a máquina atrás de qualquer
  nó órfão daquele bot** (pela linha de comando `bots\<id>\mybots-node.json`, o que
  também pega bot subido na mão pelo `start-bot.cmd`) e **só volta depois de conferir
  que morreu** (até 6 rodadas);
- tabela `bots_excluidos` (lápide) gravada **antes** de matar: se o nó escapar, ou morar
  em outro PC, o `hello` dele é **recusado** e o Hub manda `error` com `fatal: true`;
- o nó que recebe erro fatal **encerra de vez** em vez de reconectar para sempre;
- criar bot com o mesmo id tira a lápide.

**Parar.** Parar mandava abortar **uma** conversa (a direta). O trabalho podia estar numa
rotina, num grupo ou numa conversa entre bots e seguia correndo — e o único "parar de
verdade" era o Pânico, que cala todo mundo. Agora existe `hub.pararBot(botId)`, individual:
aborta tudo daquele bot (`abort "*"`), fecha o stream, **cancela as aprovações e perguntas
dele**, solta quem esperava resposta dele e fecha a sala em que ele tinha a vez. O bot ao
lado não sente nada. O Pânico passou a ser esse mesmo caminho aplicado a todos.

E, no nó, abortar **soltava** a rodada mas **não soltava os cartões**: ela ficava parada
para sempre dentro de um `await` que nunca voltava, a conversa continuava marcada como "em
andamento" e **o bot ficava surdo para tudo que viesse depois**. Parecia parado; estava
travado. `pararTrabalho()` em `engines/direct.ts` agora resolve os waiters daquela conversa.

Na tela: `⏹` vermelho ao lado de **cada bot** que está trabalhando, "⏹ Parar o que está
fazendo" no menu do bot (separado de "⏻ Desligar o bot"), e o `⏹` do chat agora funciona
**também em grupo** (para cada membro, um por um). Rota nova: `POST /api/bots/:id/parar`.

Dois testes novos no e2e (41 no total): parar um bot não derruba o cartão do outro; e o
nó de um bot excluído que volta a conectar é recusado com `fatal`.

## Menu de botão direito no chat (30/10/2026)

Botão direito em qualquer bolha (ou toque longo no celular, ou o `⋯` que aparece no hover)
abre o menu da mensagem — `packages/ui/src/ContextMenu.tsx`.

- **Pedido do chefe:** editar (a bolha vira caixa de texto; Enter envia, Esc desiste),
  reenviar, voltar aqui, copiar, fixar, apagar. `↑` no campo vazio edita o último pedido.
- **Resposta do bot:** tentar de novo, ler em voz alta, guardar na memória da casa,
  voltar aqui (devolve o pedido ao campo), copiar, salvar .md, ver detalhes, fixar, apagar.
- **Com texto selecionado:** perguntar sobre isso, explicar melhor, ler, copiar.

Nada é apagado de verdade: `messages.deleted_at` esconde, e a barra **Desfazer** (10 s) traz
de volta o lote inteiro (`unrewind` pelo mesmo carimbo). Toda leitura de histórico filtra
`deleted_at IS NULL`.

Rotas: `POST /api/conversations/:id/rewind|unrewind`, `GET …/export?format=md|json`,
`POST /api/messages/:id/edit|retry|pin|remember`, `DELETE /api/messages/:id`.
Antes de mexer no histórico o Hub **para a conversa**: aborta o stream, fecha a resposta pela
metade e cancela aprovações e perguntas daquele turno. Depois manda `history.reset` ao nó —
o motor `direct` troca o histórico do arquivo, e o `opencode` abandona a sessão e leva o que
sobrou como contexto na próxima mensagem. Evento `conversation.changed` faz as outras janelas
e o celular recarregarem.

Ainda **não** tem: dividir a partir daqui (exige lista de conversas na interface, hoje a
coluna é de bots) e versões `‹ 2/3 ›` na bolha editada.
Testes: 2 no e2e, um deles conferido ao contrário (sem o `history.reset` o nó continua com o
pedido rebobinado e o teste reprova).
