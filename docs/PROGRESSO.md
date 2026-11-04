# Progresso

## 2026-11-04 — Menu da conta no rodapé

- Clicar no nome no rodapé da lista abre o menu: uso “Ilimitado, grátis”, baixar o celular em `/downloads/MyBots.apk`, baixar o Windows só no navegador (some no app; `MYBOTS_WINDOWS_URL` vazia deixa “ainda não publicado”), Suporte, Configurações e Sair.
- Configurações ganhou as abas Computador, Permissões, Uso e Atualizações. O cofre que já existia continua: a lista mostra nome e máscara, nunca a senha.
- O app Android marca o user agent com `MyBotsApp` para o menu saber que não é o navegador.
- Não reiniciei Hub nem nó e não usei as portas 8787/8791.
- Arquivos: `packages/shared/src/casa.ts`, `packages/ui/src/menuPerfil.tsx`, `perfil.ts`, `configuracoes/*`, `App.tsx`, `main.tsx`, `styles.css`, `packages/hub/src/casaArquivo.ts`, `server.ts`, `authOnline.ts`, `android/`.
- `docs/HANDOFF.md` não está neste repositório; nada a marcar lá.
- Teste: `tests/perfil.test.ts` (6) passou. Prints do menu no computador e no celular.

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
