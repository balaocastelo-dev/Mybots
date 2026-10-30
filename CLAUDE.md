# MyBots — guia para o Claude Code

Leia este arquivo inteiro antes de mexer em qualquer coisa. Depois leia `docs/HANDOFF.md` (status + tarefas pendentes, em ordem).

## O que é
App de agentes de IA ("Bots"), um por PC, todos comandados pelo o chefe (dono do sua empresa, Campinas) por texto e voz, que conversam entre si e são gerenciados num painel estilo WhatsApp. Inspirado no Grok Bot (que é o agente da Anysphere/Cursor renomeado). Modelos: OpenCode (grátis: big-pickle, glm-5.3-flash-free…), Gemini, Claude (Anthropic), Nous Portal, Ollama, OpenRouter, Groq, LM Studio.

## Estrutura (monorepo TypeScript, npm workspaces, roda com `node --import tsx`)
- `packages/shared` — protocolo Hub⇄Node⇄UI (`src/index.ts`): tipos `BotInfo`, `BotEvent`, `NodeToHub`, `HubToNode`, `UiToHub`, `HubToUi`, `Routine`, `Group`, `VoiceConfig`; helpers `dmConversation`, `pairConversation`, `groupConversation`, `channelConversation`.
- `packages/hub` — servidor central (Fastify 5 + WebSocket + better-sqlite3 + MCP streamable HTTP em `/mcp` + cron + msedge-tts). Arquivos: `server.ts` (rotas), `hub.ts` (classe Hub: bots, conversas, grupos, rotinas, aprovações, perguntas, arquivos, canais), `db.ts`, `mcp.ts` (ferramentas que os bots usam via MCP), `voice.ts` (TTS/STT), `thoughts.ts` (filtro de "pensamentos" do modelo), `botManager.ts` (bots gerenciados: cria `bots/<id>/{mybots-node.json,persona.md,.env,workspace}` e sobe/monitora o processo), `scheduler.ts`, `config.ts`.
- `packages/node` — daemon por PC. Engines: `direct` (chama a API do modelo direto, com loop de ferramentas e aprovações) e `opencode` (sobe `opencode serve` e conversa com ele; MCP `mybots` remoto + `mybots-local` stdio). `tools.ts` (run_command, read_file, write_file, list_dir, fetch_url, ask_user, request_approval, list_bots, ask_bot, send_to_bot, set_status, notify_user, remember, recall, send_file, screenshot, schedule…), `providers/*`, `engines/direct.ts`, `engines/opencode.ts`, `localMcp.ts`, `screenshot.ts`, `config.ts`.
- `packages/ui` — React 18 + Vite 6. `src/App.tsx` (painel), `src/voice.ts` (fala/escuta, VAD, mãos livres), `src/hub.ts` (estado via WebSocket), `src/styles.css` (temas por variáveis CSS), `public/` (ícone de óculos, manifest).
- `tests/` — `e2e.test.ts` (25 testes, mock de LLM OpenAI/Anthropic/Gemini) e `opencode.test.ts` (8 testes, opencode real). `tests/mock-llm.ts` tem respostas roteirizadas.
- `scripts/` — `install-hub.ps1`, `install-node.ps1`, `create-shortcut.ps1`, `fix-taskbar-icon.ps1` (PowerShell, prontos para colar).
- `bots/` — pastas dos bots gerenciados deste PC (não versionar `.env`).

## Como rodar neste PC (Windows)
- Projeto instalado em `C:\Users\user\Desktop\mybots`. Hub em http://127.0.0.1:8790 (LAN 192.168.15.7). Token do hub está em `.env` (`MYBOTS_HUB_TOKEN`) — **nunca imprimir tokens/chaves no chat nem na saída dos bots**.
- Subir hub: `start-hub.cmd` na raiz (ou `npm run hub`). Bots gerenciados sobem junto (`manager.startAll()`).
- UI: `npm run build:ui` (o hub serve `packages/ui/dist`). Dev: `npm run dev:ui`.
- Testes: `npm test` (não precisa de internet) e `npm run test:opencode` (precisa do opencode e internet). Rode `npm test` antes de dizer que algo está pronto.
- Atalho na Área de Trabalho `MyBots.lnk` abre Chrome `--app=http://127.0.0.1:8790`.
- Porta **8787 é de outro sistema do o chefe ("Portal de Agentes — a empresa", `node hub\server.js`) — NUNCA matar esse processo.** Se precisar matar hub antigo do MyBots, mate pelo PID que está ouvindo na 8790.

## Pegadinhas do Windows já descobertas
- npm 12 bloqueia scripts de instalação: `npm install-scripts approve better-sqlite3 esbuild` (já tem `allowScripts` no package.json). Se better-sqlite3 falhar: `npm rebuild better-sqlite3`.
- `opencode.exe` global às vezes é um stub de 479 bytes; copiar o binário real de `node_modules/opencode-windows-x64/bin/`.
- PowerShell 5.1 grava UTF-8 com BOM: todo leitor de JSON/.env nosso já tira `\uFEFF`; mantenha isso.
- `node --import` precisa de URL `file://` no Windows (usar `pathToFileURL`).
- Matar árvore de processos: `taskkill /pid X /t /f`.
- `chrome.exe --app=URL` com o Chrome já aberto entrega a janela ao processo existente — não existe processo com `--app` na linha de comando; ache a janela pelo título "MyBots" (EnumWindows), não pelo processo.

## Regras do o chefe (obrigatórias)
- Fale português. Entregue comandos PowerShell prontos pra colar; ferramentas na Área de Trabalho; um launcher só.
- Peça aprovação humana antes de ações críticas (apagar, matar processos, gastar dinheiro, mexer fora do projeto).
- Prefira modelos locais/open-source e grátis quando der.
- Trabalho cuidadoso e correto > rápido. Teste antes de dizer que está pronto.
- Nunca exponha chaves/tokens. Nunca mostre "pensamentos" do modelo no chat nem na fala.
- Na UI só a lista de mensagens rola; cabeçalho/comandos ficam fixos.

## Registro de progresso (pra outro Claude acompanhar)
Ao terminar cada tarefa do `docs/HANDOFF.md`, acrescente em `docs/PROGRESSO.md` uma entrada curta: data, o que foi feito, arquivos mexidos, resultado do `npm test`, o que falta. Marque a tarefa como feita no HANDOFF.

## Convenções de código
- TypeScript estrito, sem framework extra. Mensagens e UI em pt-BR.
- Mudança de protocolo: `packages/shared` primeiro, depois hub, node, ui, e um teste em `tests/e2e.test.ts`.
- Nada de dependência nova sem necessidade (lembrar do bloqueio de scripts do npm 12).
