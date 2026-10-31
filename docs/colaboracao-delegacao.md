# Delegação de tarefas

Este documento é o contrato da **fila de tarefas** no Hub (porta do MyBots, por padrão 8790). Cobre criar, consultar, cancelar, o ciclo de vida e os eventos. Não cobre mensagem solta entre bots.

A política de quem pode delegar para quem **não está implementada aqui**. As assinaturas já são as do PR #15:

- `checarColab(pedido: PedidoColab): ResultadoColab`
- `registrarAuditoria(evento: EventoAuditoria): void`
- `registrarAoParar(fn): () => void` e `notificarParada(e: ParadaColab)` em `parar.ts`

Os arquivos `packages/hub/src/colab/seguranca.ts` e `packages/hub/src/colab/parar.ts` deste PR são stubs com essas assinaturas, para o Hub funcionar sem o #15. Se o #15 entrar na main antes, no rebase **apague os dois stubs** e fique com os arquivos de lá — a fila já chama essas funções. Enquanto o stub de segurança estiver no lugar, `checarColab` devolve `{ ok: true }` e `registrarAuditoria` não grava.

Nenhum bot aprova tarefa. Pagar, enviar, apagar, publicar e o resto que já pede o chefe continua em `POST /api/approvals`.

## Rotas

Autenticação, igual ao resto do `/api`:

- Painel (humano): sem senha configurada a rota abre; com `MYBOTS_UI_PASSWORD`, vale o cookie ou `X-MyBots-Key`.
- Bot: `Authorization: Bearer <token>` e `X-MyBots-Bot: <id>`. Se o header do bot vier com token que não é dele, a resposta é 401 e a tarefa não nasce. Com token válido, `de` é o bot autenticado — o corpo não escolhe outro.

| Método | Caminho | Quem |
| --- | --- | --- |
| POST | `/api/colab/tarefas` | cria |
| GET | `/api/colab/tarefas?bot=&status=` | lista a fila |
| GET | `/api/colab/tarefas/:id` | uma tarefa |
| POST | `/api/colab/tarefas/:id/cancelar` | cancela |

`bot` na lista é o **destinatário** (`para`): a fila daquele bot, da mais antiga para a mais nova. `status` é opcional. Sem os dois, devolve todas.

`GET` também varre prazos vencidos antes de responder, para a leitura não mentir o estado.

### POST /api/colab/tarefas

```json
{
  "de": "ana",
  "para": "bruno",
  "objetivo": "Conferir o estoque de monitores",
  "contexto": "A loja perguntou se ainda tem Acer 27.",
  "criterioSucesso": "Quantidade por modelo, com a fonte.",
  "prazo": "2026-11-01T18:00:00-03:00",
  "formatoEntrega": "uma frase"
}
```

| Campo | Obrigatório | Notas |
| --- | --- | --- |
| de | sim para humano; no bot é ignorado se vier igual ao token | quem pediu. Sem token de bot e sem `de`, vira `"humano"`. |
| para | sim | id do bot que executa. Não pode ser humano nem o próprio `de`. |
| objetivo | sim | até 2000 caracteres |
| contexto | sim | string, pode ser vazia; até 20000 |
| criterioSucesso | sim | string, pode ser vazia; até 2000 |
| prazo | não | epoch em milissegundos, epoch em segundos (entre 1e9 e 1e11) ou ISO 8601 |
| formatoEntrega | não | até 500 caracteres |

Resposta 200:

```json
{ "id": "t…", "status": "queued" }
```

`queued` é o estado **na criação**. Na mesma hora o Hub pode passar para `running` (bot online e livre) ou para `failed` (prazo já vencido). O estado vivo chega no evento `colab.tarefa` e no `GET`.

### GET /api/colab/tarefas/:id

```json
{
  "id": "t…",
  "de": "ana",
  "para": "bruno",
  "objetivo": "…",
  "contexto": "…",
  "criterioSucesso": "…",
  "prazo": 1760000000000,
  "formatoEntrega": "uma frase",
  "status": "done",
  "profundidade": 1,
  "tarefaMaeId": null,
  "resultado": { "resumo": "Temos 12 monitores Acer.", "arquivos": ["estoque.txt"] },
  "criadaEm": 1760000000000,
  "atualizadaEm": 1760000001000
}
```

`prazo` e `formatoEntrega` e `tarefaMaeId` podem ser `null`. `resultado` só existe depois que a tarefa sai do fluxo (ou ao falhar/cancelar).

### POST /api/colab/tarefas/:id/cancelar

Corpo opcional: `{ "motivo": "não precisa mais" }`. Sem motivo, fica `"cancelada pelo solicitante"`.

Quem cancela: o humano (sem header de bot) qualquer tarefa; o bot só a que ele pediu (`de` igual a ele). Tarefa de humano não é cancelada por bot.

Resposta 200: `{ "id", "status": "cancelled", "resultado" }`.

### Erros

| HTTP | Quando | Corpo |
| --- | --- | --- |
| 400 | campo faltando, prazo inválido, destino humano, delegar para si | `{ "error": "…" }` |
| 401 | `X-MyBots-Bot` sem token que combine | `{ "error": "token do bot inválido" }` |
| 403 | bot tenta usar `de` de outro, ou cancelar tarefa alheia | `{ "error": "…" }` |
| 403 | `checarColab` recusou | `{ "error": "delegação bloqueada", "motivo": "profundidade" \| "taxa" \| "empresa" }` |
| 404 | id que não existe | `{ "error": "tarefa não encontrada" }` |
| 409 | transição ilegal (cancelar o que já terminou, por exemplo) | `{ "error": "transição inválida: done → cancelled" }` |

No 403 de bloqueio a tarefa **não é gravada** e o Hub emite `colab.bloqueio`.

## Status e transições

`queued` → `running` → `waiting` → `done` | `failed` | `cancelled`

| De | Pode ir para |
| --- | --- |
| queued | running, failed, cancelled |
| running | waiting, done, failed, cancelled |
| waiting | running, done, failed, cancelled |
| done, failed, cancelled | nada |

- **queued**: na fila do destinatário. Uma por vez: só a mais antiga sobe, e só se ele não tem outra `running` ou `waiting`.
- **running**: o pedido já foi entregue e o turno dele começou.
- **waiting**: ele delegou uma filha e está parado nessa até a filha terminar. A filha voltar põe a mãe de novo em `running` e acorda o bot com o resultado.
- **done**: a resposta do destinatário, na conversa da tarefa, virou `resultado.resumo`.
- **failed**: prazo vencido (`motivo: "prazo vencido"`) ou resposta vazia (`motivo: "resposta vazia"`).
- **cancelled**: `cancelar` ou `colab.parar`.

Prazo vencido em `queued`, `running` ou `waiting` vira `failed` na hora, no `GET`, na subida do Hub e a cada 5 segundos. A fila é SQLite (`colab_tarefas`): reiniciar o Hub não perde a tarefa; se o prazo passou enquanto estava fora, ela nasce `failed`.

Bot offline: a tarefa fica `queued`. Quando ele manda `hello`, o Hub despacha. Se ele cai no meio de um `running`, o próximo `hello` reenvia o pedido.

## Resultado

```ts
resultado?: { resumo: string; arquivos?: string[]; motivo?: string }
```

`motivo` é de `failed` e `cancelled`. `arquivos` é opcional em qualquer desfecho. O texto que o bot responde na conversa da tarefa vira `resumo`. O Hub não pede ao bot que aprove a entrega.

## Profundidade

- Tarefa criada por humano (`chamador` sem token de bot): `profundidade` **0**, sem mãe.
- Bot delegando sem tarefa em curso: **1**.
- Bot com tarefa `running` ou `waiting` em que ele é o destinatário: a nova é filha, `tarefaMaeId` aponta para essa, `profundidade` = a da mãe + 1.

O teto padrão é **3**. Quem aplica é `checarColab` (motivo `"profundidade"`). O stub atual não recusa. Este módulo só repassa o número e obedece `{ ok: false }`.

## O que acontece na conversa

Conversa da tarefa: `pair:<de>:<para>` (ids em ordem). Se `de` é humano (`humano`, `user`, `chefe`, `sistema`), a conversa é `dm:<para>`.

1. Ao despachar, o destinatário recebe uma mensagem com objetivo, contexto, critério, formato e prazo, e o turno dele começa.
2. A resposta dele (`text.done` naquela conversa, com a tarefa `running`) fecha como `done`.
3. Em `done`, `failed` ou `cancelled`, o resultado volta para `de` numa mensagem que **acorda** o solicitante (evento no WebSocket do nó + turno). Humano não tem nó: a mensagem fica no chat e o evento vai para a interface.
4. O evento `colab.tarefa` sai em toda mudança. `colab.ajudando` diz se o destinatário está em `running` ou `waiting`.

## Eventos WebSocket

Saem para a interface (`/ws/ui`), no mesmo canal dos outros eventos do Hub.

### colab.tarefa

```json
{ "type": "colab.tarefa", "id": "t…", "de": "ana", "para": "bruno", "status": "done", "resultado": { "resumo": "Temos 12." } }
```

`resultado` só quando já existe.

### colab.ajudando

```json
{ "type": "colab.ajudando", "bot": "bruno", "ajudando": true, "tarefaId": "t…" }
```

`ajudando: false` e `tarefaId: null` quando ele não tem tarefa `running` nem `waiting`.

### colab.bloqueio

```json
{ "type": "colab.bloqueio", "motivo": "empresa", "de": "ana", "para": "bruno" }
```

`motivo` é só `profundidade`, `taxa` ou `empresa`. Não cria tarefa.

### colab.parar (a interface manda, o Hub recebe)

```json
{ "type": "colab.parar", "alvo": "todos", "por": "humano" }
```

`alvo` também pode ser uma lista de ids (`["bruno","caio"]`). `por` tem que ser `"humano"`. Outro valor não faz nada.

O Hub não cancela a fila direto. Ele chama `notificarParada({ alvo, por })`. A fila se inscreve uma vez com `registrarAoParar` e o callback é que marca as tarefas. Quem mais publicar no mesmo barramento (o serviço de mensagem do PR #15) acorda o mesmo cancelamento.

Efeito: toda tarefa `queued`, `running` ou `waiting` em que o bot é o **destinatário** (`para`) vai para `cancelled`, com `resultado.motivo` `"parado pelo humano"`. Para cada uma o Hub emite `colab.tarefa` e avisa o solicitante (acorda o bot, se for bot). Tarefa já `done`/`failed`/`cancelled` fica. Tarefa em que o bot só é o solicitante (`de`) também fica.

## Ferramentas dos bots

As três chamam as rotas acima. Não há outro caminho.

| Ferramenta | Rota |
| --- | --- |
| `delegate_task` | `POST /api/colab/tarefas` |
| `check_task` | `GET /api/colab/tarefas/:id` |
| `cancel_task` | `POST /api/colab/tarefas/:id/cancelar` |

No engine direct os nomes são esses. No OpenCode, pelo MCP do Hub, os mesmos nomes (`mybots_delegate_task` etc.) e o MCP também chama as rotas em `http://127.0.0.1:<porta do hub>`.

`delegate_task` devolve na hora `{ id, status: "queued" }`. O resultado não volta nessa chamada: volta como mensagem nova, que acorda o bot.

Argumentos de `delegate_task`: `objetivo`, `contexto`, `criterioSucesso`, `para` (ou `paraBotId`), `prazo` opcional, `formatoEntrega` opcional. `de` é sempre o bot da sessão.

`check_task` / `cancel_task`: `taskId` (ou `id`). `cancel_task` aceita `motivo`.

## Onde está no código

| Peça | Arquivo |
| --- | --- |
| Tipos | `packages/shared/src/colab.ts` |
| Fila, transições, prazo, parar, acordar | `packages/hub/src/colab/fila.ts` |
| Rotas | `packages/hub/src/colab/rotas.ts` |
| Cliente HTTP do MCP | `packages/hub/src/colab/cliente.ts` |
| Checagem e auditoria (stub, mesma assinatura do PR #15) | `packages/hub/src/colab/seguranca.ts` |
| Barramento do parar (stub, mesma assinatura do PR #15) | `packages/hub/src/colab/parar.ts` |
| Tabela | `colab_tarefas` em `packages/hub/src/db.ts` |
| Ferramentas do nó | `delegate_task`, `check_task`, `cancel_task` em `packages/node/src/tools.ts` |

O ponto de extensão é a chamada a `checarColab({ de, para, tipo: "mensagem" | "tarefa", profundidade })` **antes** de inserir a linha, e `registrarAuditoria(evento)` em criar, transição, bloqueio e parar. `FilaDeTarefas.checar` é o gancho (em produção aponta para o módulo). O cancelamento por `colab.parar` só entra por `registrarAoParar`.

Evento de auditoria, na assinatura do PR #15. O detalhe da tarefa vai em `detalhe`:

```ts
{
  acao: string;
  de?: string | null;
  para?: string | null;
  detalhe?: unknown;
  quando?: number;
}
```

<!-- AGENTE-SEGURANCA:COMECO -->

## A completar pelo agente de segurança e de send_to_bot

Esta seção é do outro PR. Este arquivo não substitui `docs/colaboracao.md` (não existe aqui de propósito).

Se o PR #15 já estiver na main, não reescreva estes módulos: apague os stubs `seguranca.ts` e `parar.ts` deste branch no rebase. As chamadas já usam a assinatura de lá.

Substituir o stub de `packages/hub/src/colab/seguranca.ts` **sem mudar a assinatura**:

- `checarColab({ de, para, tipo: "mensagem" | "tarefa", profundidade })` → `{ ok: true }` ou `{ ok: false, motivo: "profundidade" | "taxa" | "empresa" }`.
- `registrarAuditoria(evento)` grava de verdade. A redação de segredos nos logs do Hub também é desse agente; esta fila não escreve objetivo, contexto nem resultado em log.

Regras que este módulo **não** aplica e o checador deve aplicar:

1. **Profundidade.** Recusar acima de 3. 0 é humano, cada delegação soma 1. Motivo `"profundidade"`.
2. **Taxa.** Limite de delegações por bot/janela. Motivo `"taxa"`.
3. **Empresa.** Quem fala com quem (mesma empresa, ponte, etc.). Motivo `"empresa"`.
4. **Quem pode delegar para quem**, além da empresa: papel, gerente, bot protegido. Continua sendo decisão do `checarColab`, não da fila.
5. Pedido humano sem token pode mandar `de` no corpo (profundidade 0). Se isso tiver que ser só o chefe, o checador recusa.

O que **não** fazer neste fluxo:

- Não implementar `send_to_bot` nem `POST /api/colab/mensagens` — é o outro agente. O tipo `"mensagem"` em `checarColab` já está na assinatura para ele usar.
- Não fazer o bot aprovar a delegação. Ação externa segue em `/api/approvals`.
- Não alterar o tratamento de erro nem os logs que já existem no Hub.
- Em bloqueio, não criar a tarefa. O Hub já emite `colab.bloqueio`; o checador só devolve `{ ok: false, motivo }`.

<!-- AGENTE-SEGURANCA:FIM -->
