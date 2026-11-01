# Progresso

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
