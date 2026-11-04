# Progresso

## 2026-11-04 — 20 bots iniciais em toda conta

- Toda conta nova nasce com os 20 ofícios além de PROGRAMADOR, SEO & AEO Desk e Director. O id continua `receita-sufixo` (8 caracteres do usuário, sem `usr_`, ou o id da empresa).
- Conta ou empresa que já existe recebe só o que falta, uma vez. Bot que já está lá não é reescrito, mesmo se o dono editou. Apagar depois não faz o bot voltar.
- Cada um tem nome em pt-BR, foto e cor lidas das páginas `https://x.ai/bot/…` com o parser do importar-link, e instruções em pt-BR (papel, o que faz, passo a passo, limites, tom), adaptadas a R$, WhatsApp, Mercado Livre e Google Ads Brasil.
- Regra em todos: nada de enviar mensagem, comprar, postar ou apagar sem o dono pedir com as próprias palavras.
- Os 20 ofícios e os três que já existiam nascem no padrão da casa: 8Token (`claude-fable-5.1`), visão e navegação ligadas.
- Arquivos: `receitas/_base/equipe-inicial.json`, `receitas/*.json` dos 20, `packages/hub/src/equipeInicial.ts`, `server.ts`, `receitas.ts`, `botManager.ts`, `importarLink.ts`, `packages/node/src/kitFerramentas.ts`, `config.ts`, `engines/direct.ts`, `packages/ui/src/avatar.tsx`, `dialogos.tsx`, `tests/equipeInicial.test.ts`.
- `docs/HANDOFF.md` não está neste repositório; nada a marcar lá.
- Teste: `node --import tsx --test tests/equipeInicial.test.ts tests/importarLink.test.ts` passou (catálogo, seed idempotente, isolamento por tenant, kit de visão/navegação).

## 2026-11-04 — 8Token, visão e navegação no nascimento

- Todo bot novo (qualquer conta, inclusive gerente, cofre, receita e link) nasce no 8Token: base `https://8token.tech/v1` (OpenAI), modelo `claude-fable-5.1`. A chave é `EIGHTTOKEN_API_KEY` no `.env` do Hub.
- Migração idempotente da equipe inicial ainda no motor automático. Escolha manual ou chave colada no bot não é reescrita.
- Se o 8Token falhar, o Vigia segue para Z.ai, Groq ou Ollama (`exceto` o que acabou de falhar).
- Visão ligada: imagem multimodal; vídeo sem suporte vira quadros ffmpeg + transcrição. Navegação ligada: `buscar_web` e `navegador` no PC do próprio bot, com instruções no prompt base.
- Arquivos: `packages/shared/src/padrao.ts`, `packages/hub/src/botManager.ts`, `videoPipeline.ts`, `media.ts`, `chaves.ts`, `packages/node/src/vision.ts`, `buscaWeb.ts`, `kitFerramentas.ts`, `continuarTarefa.ts`, `packages/ui/src/dialogos.tsx`, `.env.example`, `docs/PROVEDORES.md`, `tests/padrao8token.test.ts`.
- `docs/HANDOFF.md` não está neste repositório.
- `node --import tsx --test tests/padrao8token.test.ts`: 9 testes ok (padrão, migração, Vigia, visão, pipeline falso e ffmpeg, kit, busca, mock multimodal). O e2e de adoção também passou no 8Token. `EIGHTTOKEN_API_KEY` não está neste ambiente: o ensaio com modelo real fica para o Hub. Falhas já existentes na main (não desta mudança): ociosidade do PC com `sempreLigado`, ordem pollinations/cloudflare, agrupamento da lista e `run_command` fora do kit de vídeo.

## 2026-11-04 — Receber bot por link

- `POST /api/bots/importar-link` com `modo: preview` (só lê) e `modo: confirmar` (cria o managed bot do usuário logado). Só aceita `https://x.ai/bot/<id>`, busca com timeout de 8s e teto de 1 MB, e não segue redirect para outro domínio.
- Lê `og:title` (tira o sufixo “by …”, ex. “Director by Balão” → Director), `og:description`, `og:image` e as cores `--share-accent`, `--share-coat-light`, `--share-coat-dark`. A descrição vira a base do prompt; se o nome for Director, PROGRAMADOR ou SEO & AEO Desk, entra a receita completa da equipe inicial.
- Na UI, “Receber por link” fica ao lado de “Novo bot”, com prévia e Confirmar. Colar `https://x.ai/bot/…` no chat abre a mesma prévia.
- Arquivos: `packages/hub/src/importarLink.ts`, `server.ts`, `botManager.ts`, `packages/ui/src/dialogos.tsx`, `App.tsx`, `conversa.tsx`, `avatar.tsx`, `linkBot.ts`, `styles.css`, `tests/importarLink.test.ts`.
- `docs/HANDOFF.md` não está neste repositório; nada a marcar lá.
- A coluna `owner_user_id` passa a ser criada depois da tabela `managed_bots`, senão um banco novo quebrava a lista (`no such column`).
- Teste: `node --import tsx --test tests/importarLink.test.ts` passou (parser, domínio, redirect, tenant). Exemplo real `https://x.ai/bot/jSCXcQoyWa04Fgh3uTK-X` lê Director, laranja `#FF9800` e a receita `director`.
## 2026-11-01 — Casca Android (WebView) do painel público

- App nativo em `android/`, pacote `info.balao.mybots`, minSdk 24. Abre `https://www.balao.info/mybots` com JavaScript, DOM storage, cookie de sessão (aceita cookie e cookie de terceiro, flush ao pausar), voltar no histórico, puxar no topo ou ícone para recarregar, tela “Sem conexão” com “Tentar novamente”, seletor de arquivo, download e link externo no navegador.
- Não mexe no Hub, no nó, nem nas portas 8787/8791. O pareamento adb de cada bot continua em `docs/ANDROID.md`.
- Workflow `.github/workflows/android-apk.yml` compila o APK debug e publica o artifact `MyBots-debug`.
- Arquivos: `android/**`, `.github/workflows/android-apk.yml`, `README.md`.
- `docs/HANDOFF.md` não está neste repositório; nada a marcar lá.
- Teste: `./gradlew assembleDebug testDebugUnitTest` passou (3 testes). `assembleRelease` também passou, assinado com a chave de debug. A casca não entra no `npm test`.
## 2026-11-01 — Celular do bot pelo cadastro Android

- Na main as empresas continuam (tabelas, painel, vínculo `celular:<empresaId>`). A ferramenta `celular` agora resolve o serial por `ServicoAndroid.cadastro(botId)` e só usa o vínculo da empresa se o bot não tiver o dele.
- `POST /api/bots/<id>/android/adotar` grava um serial já em `adb devices` como `device` (ex.: `192.168.15.5:5555`) sem código. Não chama `adb pair` nem `adb connect`. O pareamento com código segue igual. Portas 8787, 8790 e 8791 são recusadas.
- Painel: na aba Celular do bot e em Configurações → Parear, o formulário "Vincular este aparelho" fica ao lado do pareamento.
- Arquivos: `packages/hub/src/androidBot.ts`, `androidServico.ts`, `celularDoBot.ts`, `hub.ts`, `server.ts`, `packages/ui/src/telasBot.tsx`, `configuracoes/Computadores.tsx`, `configuracoes/pareamento.ts`, `packages/node/src/tools.ts`, `engines/direct.ts`, `docs/ANDROID.md`, `tests/androidBot.test.ts`, `tests/configuracoes.test.ts`.
- Teste: `tests/androidBot.test.ts` e `tests/configuracoes.test.ts` passaram. `npm test` para em `tests/pcs.test.ts`, que já vinha assim na main: PC novo nasce `sempreLigado` e a varredura não desliga a `bia`.
## 2026-11-01 — Nascimento do bot e WhatsApp por QR

- Cada bot nasce cumprimentando o chefe no chat e pede, nesta ordem, Gmail e WhatsApp. Gmail só fica feito quando a caixa abre na tela do PC (o dono digita a senha; ela não entra no chat nem no estado). WhatsApp só fica feito quando a sessão do QR conecta. Outra ferramenta entra com `pedir_conexao`, na hora do uso.
- WhatsApp do bot usa Baileys com `useMultiFileAuthState` em `bots/<id>/whatsapp/`. O QR aparece no painel Celular, com reserva na tela do PC, e a ferramenta `whatsapp_proprio` envia e lê. Aparelho conectado cai se o celular principal ficar ~14 dias offline.
- Arquivos: `packages/hub/src/nascimento.ts`, `gmailTela.ts`, `whatsappBot.ts`, `hub.ts`, `server.ts`, `botManager.ts`, `packages/node/src/tools.ts`, `packages/ui/src/whatsBot.tsx`, `telasBot.tsx`, `tests/nascimento.test.ts`.
- `docs/HANDOFF.md` não está neste repositório; nada a marcar lá.
- Teste: `tests/nascimento.test.ts` (6) e o e2e (46) passaram. `npm test` inteiro para nos mesmos pontos que já falham na main: PC sempre ligado vs ociosidade, ordem dos provedores de mídia e o rótulo da lista.

## 2026-10-31 — Tokens e ajustes de UI (specs + análise)

- Balcão/Bancada voltam a mandar na cor: acento claro `#E10600`, perigo `#d4453c` (o Parar deixa de parecer botão primário roxo). Tipografia Karla + Bricolage. Avatares 42 / 80 / 144 e balão de 24px metade para fora.
- Lista: empresas recolhíveis com contagem, faixa do gerente, badge vermelho de “Espera o seu OK”. Chat: pilha de aprovação, auditoria no modo deus, composer mais baixo, voz recolhível, chip “Trocas da equipe”.
- Novo bot/gerente em passos. Configurações: “Pular abertura”. Trabalhos: origem do arquivo e filtro de tipo guardado. Desktop fecha no X, no Esc e no clique fora.
- Não mexe em 8787/8791, no WebSocket da tela nem no cofre/kanban já mergeados (#19 e #22), só alinha o nome das colunas ao spec.
- Arquivos: `packages/ui/src/styles.css`, `App.tsx`, `conversa.tsx`, `dialogos.tsx`, `mensagem.tsx`, `tema.tsx`, `configuracoes/Geral.tsx`, `trabalhos.tsx`, `painelPc.tsx`, `desktop.tsx`, `celularEmpresa.tsx`, `colab/tipos.ts`.
- Teste: `npm test` passou (ui buildada antes; um skip de docker no PC por bot).

## 2026-10-31 — Celular Android por bot (aparelho real)

- Cada bot pareia um Android na mesma Wi-Fi: `POST /api/bots/<botId>/android/pair` (`ip`, `porta`, `codigo`, `portaConexao` opcional) e `GET /api/bots/<botId>/android/status` (`conectado`, `cadastrado`).
- A tela ao vivo e interativa fica em `/android/<botId>/`, no protocolo do scrcpy 5.0.1 (papel do ws-scrcpy), só em 127.0.0.1. O Chrome do aparelho abre `https://web.whatsapp.com` sem login.
- Redroid/emulador são fallback e vêm desligados. No Windows com Docker Desktop/WSL2 os dois não servem (kernel sem binder; sem `/dev/kvm` no container). Documentado em `docs/ANDROID.md`.
- Encaixe na main (PR do PC por bot já mergeado): `aparelho` e `redroid` entram no registro de `android.ts`. `avisarAndroid` roda no ligar e no desligar do PC. O registro local e o `androidHook.ts` saíram.
- Arquivos: `packages/hub/src/android.ts`, `androidProvedor.ts`, `pcs.ts`, `androidBot.ts`, `androidScrcpy.ts`, `androidStream.ts`, `androidSessao.ts`, `androidPlayer.ts`, `androidServico.ts`, `androidFallback.ts`, `ponteAndroid.ts`, `celular.ts`, `server.ts`, `tests/androidBot.test.ts`, `docs/ANDROID.md`.
- `docs/HANDOFF.md` não está neste repositório; nada a marcar lá.
- Teste: `npm test` passou neste ambiente depois de `npm run build:ui` (o e2e exige `packages/ui/dist`, que não vai no git) e de ter o `pdfinfo` para o teste do PDF, que já existia. Os testes de `tests/androidBot.test.ts` e `tests/pcs.test.ts` passam sem aparelho. Sem cadastro, `/android/<botId>/` responde 503.
