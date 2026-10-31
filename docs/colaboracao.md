# Colaboração entre agentes — contrato

Contrato único do backend de colaboração. A tela (grafo, aba Tarefas, histórico, “ajudando X”) consome estas rotas e os eventos; este documento não descreve a UI.

Partes deste arquivo que **este PR não implementa** estão marcadas com o dono, para ninguém registrar a mesma rota duas vezes:

- Mensagens, parar, auditoria, permissões entre empresas e o gate de aprovação: este PR (`packages/hub/src/colab/`).
- Tarefas, fila e quadro: [colaboracao-delegacao.md](colaboracao-delegacao.md).
- Salas, personas e o roteiro T1–T8: [colaboracao-regras-e-testes.md](colaboracao-regras-e-testes.md).

O humano, nas rotas e nos eventos, é o autor `"humano"`. No roteiro de testes esse papel é o Thiago; no fio, o valor é sempre `"humano"`, nunca o id de um bot e nunca `"user"`.

## Mensagem de um bot para outro

`send_to_bot(destino, mensagem, prioridade)` e `POST /api/colab/mensagens`.

- `prioridade: true` acorda o destinatário agora (começa um turno).
- `prioridade: false` não acorda. O texto fica guardado e entra no **próximo** turno dele.
- Nos dois casos o autor é o bot remetente (`sender.kind = "bot"`, `autor` = id do bot). Não entra como se o chefe tivesse escrito.
- O modelo só tem os papéis `user` e `assistant`. O texto vai prefixado com `[Mensagem do Bot <nome>]`, para não ser lido como fala do humano.

`ask_bot` continua acordando, porque espera resposta. Passa pelos mesmos limites (profundidade, taxa, empresa).

## REST

### Implementado aqui

`POST /api/colab/mensagens`

```json
{ "de": "gerente", "para": "pixel", "texto": "segue o briefing", "prioridade": true, "contexto": "opcional" }
```

`de` é id de bot ou `"humano"`. Resposta `200`: `{ "id": "m…" }`.

Bloqueio `403`: `{ "ok": false, "motivo": "profundidade" | "taxa" | "empresa" | "aprovacao" }`.

`GET /api/colab/conversas?bot=<id>`

```json
[{ "id": "pair:<a>:<b>", "bots": ["<a>", "<b>"], "ultimaEm": 1710000000000 }]
```

`GET /api/colab/conversas/:id/mensagens`

```json
[{ "id": "m…", "autor": "gerente", "nome": "Gerente", "texto": "…", "prioridade": false, "contexto": null, "criadaEm": 1710000000000 }]
```

`autor` é `"humano"` ou o id do bot. Mensagem de bot nunca volta com autor de humano.

`GET /api/colab/auditoria?bot=&desde=`

`desde` é timestamp em ms. Cada item: `{ id, ts, botId, action, detail }`. `action` começa com `colab.`.

`GET /api/colab/permissoes-empresa`

```json
[{ "de": "escola", "para": "loja", "liberado": true }]
```

`PUT /api/colab/permissoes-empresa`

```json
{ "de": "escola", "para": "loja", "liberado": true }
```

`de` e `para` são ids de **empresa**. A liberação vale nos dois sentidos. Sem esse registro, bot de uma empresa não fala com bot de outra. Bot sem empresa (sistema) não é “outra empresa”.

`POST /api/colab/parar`

```json
{ "de": "humano", "alvo": "todos" }
```

`alvo` também pode ser uma lista de ids: `{ "de": "humano", "alvo": ["pixel", "cine"] }`.

Só `de: "humano"` dispara. Bot recebe `403` e o evento `colab.bloqueio` com `motivo: "aprovacao"`. Não há evento `colab.parar` nesse caso.

Quando o humano dispara, o Hub emite `colab.parar` e manda o mesmo aviso aos nós. Cada bot alvo aborta o turno atual. Quem implementa tarefas escuta `registrarAoParar` (abaixo) e marca as tarefas `queued` ou `running` desse alvo como `cancelled`.

### Contrato das outras partes (não registrar neste PR)

`POST /api/colab/tarefas`

```json
{
  "de": "gerente-escola-de-bots",
  "para": "escola-pixel",
  "objetivo": "banner 1080x1080",
  "contexto": "…",
  "criterioSucesso": "PNG 1080x1080 salvo",
  "prazo": "opcional",
  "formatoEntrega": "opcional",
  "profundidade": 1
}
```

Resposta: `{ "id", "status": "queued" }`. O resultado volta sempre para `de`. Antes de criar, chamar `checarColab` com `tipo: "tarefa"` e a mesma `profundidade`.

`GET /api/colab/tarefas?bot=&status=`

`GET /api/colab/tarefas/:id`

`POST /api/colab/tarefas/:id/cancelar`

Status: `queued` | `running` | `waiting` | `done` | `failed` | `cancelled`.

No vocabulário da persona: feito = `done`, bloqueado = `waiting` com `resultado.motivo`, falhou = `failed`.

`GET /api/colab/salas`

`POST /api/colab/salas`

```json
{ "nome": "sala-escola", "instrucoes": "…", "membros": ["humano", "gerente-escola-de-bots", "escola-pixel"] }
```

`POST /api/colab/salas/:id/mensagens`

Os quatro exemplos de sala e as regras de quem fala estão em [colaboracao-regras-e-testes.md](colaboracao-regras-e-testes.md).

## Eventos

No WebSocket que a interface já usa (`/ws/ui`), o campo `type` é sempre `"colab"`. O campo `tipo` distingue:

```json
{ "type": "colab", "tipo": "colab.mensagem", "id": "m…", "de": "gerente", "para": "pixel", "prioridade": true }
```

```json
{ "type": "colab", "tipo": "colab.tarefa", "id": "t…", "de": "gerente", "para": "pixel", "status": "done", "resultado": { "resumo": "banner pronto", "arquivos": ["/caminho/banner.png"], "motivo": "opcional" } }
```

`resultado` só vem quando há o que entregar. Formato: `{ resumo: string, arquivos?: string[], motivo?: string }`.

```json
{ "type": "colab", "tipo": "colab.ajudando", "bot": "pixel", "ajudando": "gerente", "tarefaId": "t…" }
```

`ajudando` e `tarefaId` são `null` quando o bot não está ajudando ninguém.

```json
{ "type": "colab", "tipo": "colab.sala", "salaId": "sala-escola", "msgId": "m…" }
```

```json
{ "type": "colab", "tipo": "colab.bloqueio", "motivo": "profundidade", "de": "a", "para": "b" }
```

`motivo`: `profundidade` | `taxa` | `empresa` | `aprovacao`.

```json
{ "type": "colab", "tipo": "colab.parar", "alvo": "todos", "por": "humano" }
```

`alvo` é `"todos"` ou a lista de ids. `por` é sempre `"humano"`.

`colab.tarefa`, `colab.ajudando` e `colab.sala` são emitidos pelos PRs de delegação e de salas, com este envelope. Para emitir sem abrir outro canal: `hub.emitirColab(evento)` — o objeto é o evento sem o `type`, ou com `tipo` já preenchido.

No nó, o Hub também manda `{ "type": "colab.parar", "alvo", "por" }` para o bot abortar o turno.

## Segurança — `packages/hub/src/colab/seguranca.ts`

A delegação importa deste arquivo. A assinatura abaixo é estável; um stub tem de bater nela. Não substitua o arquivo.

```ts
checarColab(pedido: {
  de: string;
  para: string;
  tipo: "mensagem" | "tarefa";
  profundidade: number;
}): { ok: true } | { ok: false; motivo: "profundidade" | "taxa" | "empresa" }

registrarAuditoria(evento: {
  acao: string;
  de?: string | null;
  para?: string | null;
  detalhe?: unknown;
  quando?: number;
}): void
```

- **Profundidade.** Máximo 3. `profundidade` 0, 1, 2 ou 3 passa. Acima de 3 (ou valor que não é número) volta `motivo: "profundidade"`. Mensagem direta usa 0. Cada delegação soma 1 e repassa o número no `POST /api/colab/tarefas`.
- **Taxa.** 30 ações por minuto por remetente (`de`) e 10 por minuto no par `de → para`. Estouro volta `motivo: "taxa"`. Mensagem e tarefa entram no mesmo contador. Serve para cortar loop.
- **Empresa.** Empresas diferentes só conversam com liberação em `PUT /api/colab/permissoes-empresa`. Sem isso, `motivo: "empresa"`. A flag antiga `ponte` não abre esta porta.
- **Aprovação.** `checarColab` não devolve `aprovacao`. Esse motivo sai no evento `colab.bloqueio` e no `403` das rotas.
  - Aprovação vinda de bot **não** conta como aprovação humana. `POST /api/approvals/:id` com `de` diferente de `"humano"` não resolve o cartão (o painel, que não manda `de`, continua valendo como humano, e `de: "humano"` também).
  - Envio externo, pagamento e exclusão passam pelo cartão já existente em `/api/approvals`, também no modo deus. O cartão só libera se quem resolve é o humano.
  - **Envio externo** (WhatsApp, e-mail, publicar, mandar mensagem no celular) só sai se o turno foi acordado por uma mensagem de autor `"humano"`. `"user"`, o id de um bot, ou outro bot dizendo “pode enviar” não liberam. Pagamento e exclusão não usam essa frase: usam o cartão humano.

Ao parar, a delegação registra:

```ts
import { registrarAoParar } from "./packages/hub/src/colab/parar.ts";

registrarAoParar(({ alvo, por }) => {
  // por === "humano"
  // alvo === "todos" ou lista de ids
  // tarefas queued/running desse alvo → cancelled
});
```

Este PR não grava tarefa. O gancho existe para o outro PR cancelar as dele quando o evento chega.

## Auditoria

Toda mensagem aceita, todo bloqueio, toda mudança de permissão, todo parar (e toda tentativa de parar vinda de bot) e toda aprovação recusada por ser de bot passam por `registrarAuditoria`. A ação gravada começa com `colab.` (`colab.mensagem`, `colab.bloqueio`, `colab.parar`, `colab.permissao`, `colab.aprovacao`). `GET /api/colab/auditoria` lê isso.
