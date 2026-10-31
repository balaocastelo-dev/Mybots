// Fila de delegação: transições, prazo, parar, bloqueio, persistência e o ciclo HTTP
// de um bot para o outro com o resultado voltando.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Db } from "../packages/hub/src/db.ts";
import { FilaDeTarefas, TRANSICOES_TAREFA, conversaDaTarefa, type PedidoCriarTarefa } from "../packages/hub/src/colab/fila.ts";
import { checarColab, registrarAuditoria } from "../packages/hub/src/colab/seguranca.ts";
import { notificarParada, registrarAoParar } from "../packages/hub/src/colab/parar.ts";
import { lerPrazo } from "../packages/hub/src/colab/rotas.ts";
import { pairConversation, type StatusTarefa, type TarefaColab } from "@mybots/shared";
import { TOOL_DEFS, runTool, urlHttpDoHub, type ToolContext } from "../packages/node/src/tools.ts";

const BASE: Omit<PedidoCriarTarefa, "de" | "para"> = {
  objetivo: "Conferir o estoque",
  contexto: "loja de informática",
  criterioSucesso: "quantidade por modelo",
  prazo: null,
  formatoEntrega: null,
  chamadorHumano: false,
};

function bancada() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-colab-"));
  const db = new Db(path.join(dir, "t.sqlite"));
  const eventos: Array<{ type: string; [k: string]: unknown }> = [];
  const acordes: Array<{ botId: string; texto: string; tarefaId: string }> = [];
  const audits: Array<{ acao: string }> = [];
  let agora = 1_700_000_000_000;
  let online = false;
  const fila = new FilaDeTarefas(db, {
    agora: () => agora,
    auditar: (e) => { audits.push(e); },
    emitir: (e) => { eventos.push(e); },
    acordar: (p) => { acordes.push(p); return true; },
    online: () => online,
  });
  return {
    dir, db, fila, eventos, acordes, audits,
    setAgora: (n: number) => { agora = n; },
    setOnline: (v: boolean) => { online = v; },
    agora: () => agora,
  };
}

function pedido(de: string, para: string, extra: Partial<PedidoCriarTarefa> = {}): PedidoCriarTarefa {
  return { ...BASE, de, para, ...extra };
}

test("stub de segurança deixa passar e a auditoria não grava", () => {
  // O arquivo de verdade (PR #15) recusa profundidade acima de 3. O stub deste PR não.
  assert.deepEqual(checarColab({ de: "a", para: "b", tipo: "tarefa", profundidade: 9 }), { ok: true });
  assert.equal(registrarAuditoria({ acao: "criar", de: "a", para: "b", detalhe: { tarefaId: "t" }, quando: 1 }), undefined);
});

test("colab.parar só cancela quem está inscrito em registrarAoParar", () => {
  const b = bancada();
  const r = b.fila.criar(pedido("ana", "bruno"));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  notificarParada({ alvo: ["bruno"], por: "humano" });
  assert.equal(b.fila.obter(r.tarefa.id)?.status, "queued");
  const soltar = registrarAoParar((e) => b.fila.receberParar(e));
  notificarParada({ alvo: ["bruno"], por: "humano" });
  assert.equal(b.fila.obter(r.tarefa.id)?.status, "cancelled");
  assert.equal(b.fila.obter(r.tarefa.id)?.resultado?.motivo, "parado pelo humano");
  soltar();
  b.db.close();
});

test("prazo aceita ms, segundos e ISO", () => {
  assert.equal(lerPrazo(null), null);
  assert.equal(lerPrazo(""), null);
  assert.equal(lerPrazo(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(lerPrazo(1_700_000_000), 1_700_000_000_000);
  assert.equal(lerPrazo("2026-11-01T15:00:00.000Z"), Date.parse("2026-11-01T15:00:00.000Z"));
  assert.equal(lerPrazo("amanhã"), "invalido");
  assert.equal(lerPrazo(-1), "invalido");
});

test("as ferramentas do nó apontam para as rotas de tarefa", () => {
  const nomes = new Set(TOOL_DEFS.map((d) => d.name));
  assert.equal(nomes.has("delegate_task"), true);
  assert.equal(nomes.has("check_task"), true);
  assert.equal(nomes.has("cancel_task"), true);
  assert.equal(urlHttpDoHub({ hub: "ws://127.0.0.1:8790", opencode: {} } as ToolContext["cfg"]), "http://127.0.0.1:8790");
  assert.equal(urlHttpDoHub({ hub: "wss://hub.exemplo/ws", opencode: { hubHttp: "https://hub.exemplo:9/" } } as ToolContext["cfg"]), "https://hub.exemplo:9");
});

test("criar fica queued, persiste e sobrevive a reabrir o banco", () => {
  const b = bancada();
  const r = b.fila.criar(pedido("ana", "bruno", { formatoEntrega: "uma frase", prazo: b.agora() + 60_000 }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.tarefa.status, "queued");
  assert.equal(r.tarefa.profundidade, 1);
  assert.equal(b.fila.obter(r.tarefa.id)?.formatoEntrega, "uma frase");
  assert.equal(b.eventos.some((e) => e.type === "colab.tarefa" && e.status === "queued"), true);
  assert.equal(b.audits.some((a) => a.acao === "criar"), true);
  b.db.close();

  const db2 = new Db(path.join(b.dir, "t.sqlite"));
  const fila2 = new FilaDeTarefas(db2, { online: () => false });
  const deNovo = fila2.obter(r.tarefa.id);
  assert.equal(deNovo?.status, "queued");
  assert.equal(deNovo?.objetivo, "Conferir o estoque");
  db2.close();
});

test("transições válidas e inválidas, com resultado redondo", () => {
  const b = bancada();
  const r = b.fila.criar(pedido("ana", "bruno"));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const id = r.tarefa.id;
  const ruim = b.fila.transicionar(id, "done", { resumo: "cedo demais" });
  assert.equal(ruim.ok, false);
  assert.equal(b.fila.obter(id)?.status, "queued");

  assert.equal(b.fila.transicionar(id, "running").ok, true);
  assert.equal(b.fila.transicionar(id, "waiting").ok, true);
  assert.equal(b.fila.transicionar(id, "running").ok, true);
  const fim = b.fila.transicionar(id, "done", { resumo: "12 monitores", arquivos: ["estoque.txt"] });
  assert.equal(fim.ok, true);
  if (!fim.ok) return;
  assert.deepEqual(fim.tarefa.resultado, { resumo: "12 monitores", arquivos: ["estoque.txt"] });
  assert.equal(b.fila.transicionar(id, "cancelled").ok, false);
  assert.equal(b.fila.obter(id)?.resultado?.arquivos?.[0], "estoque.txt");

  const deQueued = TRANSICOES_TAREFA.queued;
  assert.deepEqual([...deQueued], ["running", "failed", "cancelled"]);
  assert.equal(TRANSICOES_TAREFA.done.length, 0);
});

test("fila por bot: uma running por vez, a outra bot não espera", () => {
  const b = bancada();
  b.setOnline(true);
  const a = b.fila.criar(pedido("ana", "bruno", { objetivo: "primeira" }));
  const c = b.fila.criar(pedido("ana", "bruno", { objetivo: "segunda" }));
  const d = b.fila.criar(pedido("ana", "caio", { objetivo: "paralela" }));
  assert.equal(a.ok && c.ok && d.ok, true);
  if (!a.ok || !c.ok || !d.ok) return;
  assert.equal(b.fila.obter(a.tarefa.id)?.status, "running");
  assert.equal(b.fila.obter(c.tarefa.id)?.status, "queued");
  assert.equal(b.fila.obter(d.tarefa.id)?.status, "running");
  assert.equal(b.acordes.filter((x) => x.botId === "bruno").length, 1);

  b.fila.transicionar(a.tarefa.id, "done", { resumo: "feito" });
  assert.equal(b.fila.obter(c.tarefa.id)?.status, "running");
  assert.equal(b.acordes.filter((x) => x.botId === "ana" && x.texto.includes("feito")).length, 1);
});

test("prazo vencido vira failed com motivo e avisa quem pediu, inclusive depois de reabrir", () => {
  const b = bancada();
  b.setOnline(true);
  const prazo = b.agora() - 5_000;
  const r = b.fila.criar(pedido("ana", "bruno", { prazo }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const t = b.fila.obter(r.tarefa.id);
  assert.equal(t?.status, "failed");
  assert.equal(t?.resultado?.motivo, "prazo vencido");
  assert.equal(t?.resultado?.resumo.includes("venceu"), true);
  assert.equal(b.acordes.some((a) => a.botId === "ana" && a.texto.includes("prazo vencido")), true);
  assert.equal(b.acordes.some((a) => a.botId === "bruno"), false);
  assert.equal(b.eventos.some((e) => e.type === "colab.tarefa" && e.status === "failed"), true);

  const fresco = bancada();
  const futuro = fresco.agora() + 10_000;
  const criada = fresco.fila.criar(pedido("ana", "bruno", { prazo: futuro }));
  assert.equal(criada.ok, true);
  if (!criada.ok) return;
  fresco.db.close();
  const db2 = new Db(path.join(fresco.dir, "t.sqlite"));
  const avisos: string[] = [];
  const fila2 = new FilaDeTarefas(db2, {
    agora: () => futuro + 1,
    online: () => false,
    acordar: (p) => { avisos.push(p.texto); return true; },
  });
  const vencidas = fila2.vencerPrazos();
  assert.equal(vencidas.length, 1);
  assert.equal(vencidas[0].resultado?.motivo, "prazo vencido");
  assert.equal(avisos.length, 1);
  db2.close();
  b.db.close();
});

test("profundidade: humano 0, cada delegação soma 1, mãe vai para waiting e volta", () => {
  const b = bancada();
  b.setOnline(true);
  const vistas: number[] = [];
  const original = b.fila.checar;
  b.fila.checar = (p) => { vistas.push(p.profundidade); return original(p); };

  const raiz = b.fila.criar(pedido("humano", "ana", { chamadorHumano: true, objetivo: "raiz" }));
  assert.equal(raiz.ok, true);
  if (!raiz.ok) return;
  assert.equal(raiz.tarefa.profundidade, 0);
  assert.equal(b.fila.obter(raiz.tarefa.id)?.status, "running");

  const filha = b.fila.criar(pedido("ana", "bruno", { objetivo: "filha" }));
  assert.equal(filha.ok, true);
  if (!filha.ok) return;
  assert.equal(filha.tarefa.profundidade, 1);
  assert.equal(filha.tarefa.tarefaMaeId, raiz.tarefa.id);
  assert.equal(b.fila.obter(raiz.tarefa.id)?.status, "waiting");
  assert.equal(b.fila.obter(filha.tarefa.id)?.status, "running");

  const neta = b.fila.criar(pedido("bruno", "caio", { objetivo: "neta" }));
  assert.equal(neta.ok, true);
  if (!neta.ok) return;
  assert.equal(neta.tarefa.profundidade, 2);
  assert.equal(b.fila.obter(filha.tarefa.id)?.status, "waiting");
  assert.deepEqual(vistas, [0, 1, 2]);

  b.fila.transicionar(neta.tarefa.id, "done", { resumo: "caio entregou" });
  assert.equal(b.fila.obter(filha.tarefa.id)?.status, "running");
  assert.equal(b.acordes.some((a) => a.botId === "bruno" && a.texto.includes("caio entregou")), true);

  b.fila.aoResponder("bruno", conversaDaTarefa({ de: "ana", para: "bruno" }), "bruno entregou");
  assert.equal(b.fila.obter(filha.tarefa.id)?.status, "done");
  assert.equal(b.fila.obter(filha.tarefa.id)?.resultado?.resumo, "bruno entregou");
  assert.equal(b.fila.obter(raiz.tarefa.id)?.status, "running");
  b.db.close();
});

test("bloqueio não grava e emite colab.bloqueio", () => {
  const b = bancada();
  b.fila.checar = () => ({ ok: false, motivo: "empresa" });
  const r = b.fila.criar(pedido("ana", "bruno"));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "empresa");
  assert.equal(b.fila.listar().length, 0);
  assert.deepEqual(b.eventos[0], { type: "colab.bloqueio", motivo: "empresa", de: "ana", para: "bruno" });
  assert.equal(b.audits[0].acao, "bloqueio");
  b.db.close();
});

test("colab.parar cancela só queued/running/waiting do destinatário e avisa quem pediu", () => {
  const b = bancada();
  const ab = b.fila.criar(pedido("ana", "bruno"));
  const bc = b.fila.criar(pedido("bruno", "caio"));
  const feito = b.fila.criar(pedido("dino", "bruno", { objetivo: "já acabou" }));
  assert.equal(ab.ok && bc.ok && feito.ok, true);
  if (!ab.ok || !bc.ok || !feito.ok) return;
  assert.equal(b.fila.transicionar(feito.tarefa.id, "running").ok, true);
  assert.equal(b.fila.transicionar(feito.tarefa.id, "done", { resumo: "pronto" }).ok, true);

  assert.equal(b.fila.receberParar({ alvo: ["bruno"], por: "bot" }).length, 0);

  const canceladas = b.fila.receberParar({ alvo: ["bruno"], por: "humano" });
  assert.deepEqual(canceladas.map((t) => t.id).sort(), [ab.tarefa.id]);
  assert.equal(b.fila.obter(ab.tarefa.id)?.status, "cancelled");
  assert.equal(b.fila.obter(ab.tarefa.id)?.resultado?.motivo, "parado pelo humano");
  assert.equal(b.fila.obter(bc.tarefa.id)?.status, "queued");
  assert.equal(b.fila.obter(feito.tarefa.id)?.status, "done");
  assert.equal(b.eventos.some((e) => e.type === "colab.tarefa" && e.id === ab.tarefa.id && e.status === "cancelled"), true);
  assert.equal(b.acordes.some((a) => a.botId === "ana" && a.texto.includes("parado pelo humano")), true);

  const resto = b.fila.receberParar({ alvo: "todos", por: "humano" });
  assert.deepEqual(resto.map((t) => t.id), [bc.tarefa.id]);
  assert.equal(b.fila.obter(feito.tarefa.id)?.status, "done");
  b.db.close();
});

test("resposta vazia falha; resposta fora da conversa da tarefa não fecha", () => {
  const b = bancada();
  b.setOnline(true);
  const r = b.fila.criar(pedido("ana", "bruno"));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  b.fila.aoResponder("bruno", "dm:bruno", "não é a conversa da tarefa");
  assert.equal(b.fila.obter(r.tarefa.id)?.status, "running");
  b.fila.aoResponder("bruno", conversaDaTarefa(r.tarefa), "   ");
  assert.equal(b.fila.obter(r.tarefa.id)?.status, "failed");
  assert.equal(b.fila.obter(r.tarefa.id)?.resultado?.motivo, "resposta vazia");
  b.db.close();
});

test("um bot não delega para si e o destino humano é recusado", () => {
  const b = bancada();
  const si = b.fila.criar(pedido("ana", "ana"));
  const hum = b.fila.criar(pedido("ana", "humano"));
  assert.equal(si.ok, false);
  assert.equal(hum.ok, false);
  assert.equal(b.fila.listar().length, 0);
  b.db.close();
});

test("ciclo HTTP: tarefa de Ana para Bruno, resultado volta, parar e ferramentas", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-colab-http-"));
  const port = 18793;
  process.env.MYBOTS_HUB_PORT = String(port);
  process.env.MYBOTS_HUB_HOST = "127.0.0.1";
  process.env.MYBOTS_DB = path.join(dir, "hub.sqlite");
  process.env.MYBOTS_HUB_TOKEN = "token-de-teste";
  process.env.MYBOTS_BOTS_DIR = path.join(dir, "bots");
  process.env.MYBOTS_UI_DIST = path.join(dir, "sem-ui");
  process.env.MYBOTS_UI_PASSWORD = "";
  process.env.MYBOTS_NODE_TOKENS = "";

  const { Hub } = await import("../packages/hub/src/hub.ts");
  const { startServer } = await import("../packages/hub/src/server.ts");
  const { chamarColabLocal } = await import("../packages/hub/src/colab/cliente.ts");
  const wsMod = await import("ws");
  const WebSocket = wsMod.default ?? wsMod.WebSocket;

  const hub = new Hub(process.env.MYBOTS_DB);
  const app = await startServer(hub);
  const base = `http://127.0.0.1:${port}`;
  const sockets: Array<{ close: () => void }> = [];

  const esperar = async (pred: () => boolean, rotulo: string) => {
    const fim = Date.now() + 4_000;
    while (Date.now() < fim) {
      if (pred()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timeout esperando ${rotulo}`);
  };

  try {
    const conectar = (id: string, name: string) => new Promise<{ ws: any; recebidas: any[] }>((resolve, reject) => {
      const recebidas: any[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/node`);
      sockets.push(ws);
      const timer = setTimeout(() => reject(new Error(`hello de ${id} não chegou`)), 4_000);
      ws.on("message", (raw: Buffer) => {
        const m = JSON.parse(raw.toString());
        recebidas.push(m);
        if (m.type === "hello.ok") { clearTimeout(timer); resolve({ ws, recebidas }); }
      });
      ws.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "hello", protocol: 1, token: "token-de-teste",
          bot: { id, name, role: "Teste", avatar: "🤖" },
          engine: "direct", provider: "mock", model: "m", version: "0",
        }));
      });
    });

    const uiEventos: any[] = [];
    const ui = new WebSocket(`ws://127.0.0.1:${port}/ws/ui`);
    sockets.push(ui);
    await new Promise<void>((resolve, reject) => {
      ui.on("open", () => { ui.send(JSON.stringify({ type: "subscribe" })); resolve(); });
      ui.on("error", reject);
    });
    ui.on("message", (raw: Buffer) => { uiEventos.push(JSON.parse(raw.toString())); });

    const ana = await conectar("ana", "Ana");
    const bruno = await conectar("bruno", "Bruno");

    const ctx = {
      cfg: { hub: `ws://127.0.0.1:${port}`, token: "token-de-teste", bot: { id: "ana", name: "Ana", role: "Teste" }, opencode: {} },
      setStatus() {},
      signal: AbortSignal.timeout(8_000),
    } as ToolContext;
    const delegada = await runTool("delegate_task", {
      para: "bruno",
      objetivo: "Conferir o estoque de monitores",
      contexto: "A loja perguntou do Acer 27.",
      criterioSucesso: "quantidade por modelo",
      formatoEntrega: "uma frase",
    }, ctx);
    assert.equal(delegada.ok, true, delegada.output);
    const criada = JSON.parse(delegada.output) as { id: string; status: string };
    assert.equal(criada.status, "queued");

    await esperar(() => bruno.recebidas.some((m) => m.type === "message" && String(m.text).includes("Conferir o estoque de monitores")), "pedido no Bruno");
    const prompt = bruno.recebidas.find((m) => m.type === "message");
    assert.equal(prompt.conversationId, pairConversation("ana", "bruno"));
    assert.match(prompt.text, /Critério de sucesso/);

    const consulta = await runTool("check_task", { taskId: criada.id }, ctx);
    assert.equal(consulta.ok, true, consulta.output);
    const noMeio = JSON.parse(consulta.output) as TarefaColab;
    assert.equal(noMeio.status, "running");
    assert.equal(noMeio.profundidade, 1);
    assert.equal(noMeio.de, "ana");
    assert.equal(noMeio.para, "bruno");

    bruno.ws.send(JSON.stringify({
      type: "event",
      conversationId: prompt.conversationId,
      event: { kind: "text.done", messageId: "m-bruno-1", text: "Temos 12 monitores Acer no estoque." },
    }));

    await esperar(() => ana.recebidas.some((m) => m.type === "message" && String(m.text).includes("12 monitores")), "resultado na Ana");
    const volta = ana.recebidas.find((m) => m.type === "message" && String(m.text).includes("12 monitores"));
    assert.match(volta.text, /Resultado da tarefa/);
    assert.match(volta.text, /\(done\)/);

    const pronta = await fetch(`${base}/api/colab/tarefas/${criada.id}`);
    const tarefa = await pronta.json() as TarefaColab;
    assert.equal(tarefa.status, "done");
    assert.equal(tarefa.resultado?.resumo, "Temos 12 monitores Acer no estoque.");
    assert.equal(tarefa.resultado?.motivo, undefined);

    await esperar(() => uiEventos.some((e) => e.type === "colab.tarefa" && e.id === criada.id && e.status === "done"), "evento done");
    assert.equal(uiEventos.some((e) => e.type === "colab.ajudando" && e.bot === "bruno" && e.ajudando === true && e.tarefaId === criada.id), true);
    assert.equal(uiEventos.some((e) => e.type === "colab.ajudando" && e.bot === "bruno" && e.ajudando === false && e.tarefaId === null), true);

    const msgs = await (await fetch(`${base}/api/conversations/${encodeURIComponent(pairConversation("ana", "bruno"))}/messages`)).json() as Array<{ sender: { name: string }; text: string }>;
    assert.equal(msgs.some((m) => m.text.includes("Conferir o estoque de monitores")), true);
    assert.equal(msgs.some((m) => m.text.includes("12 monitores")), true);

    const arte = "/opt/cursor/artifacts/delegacao";
    fs.mkdirSync(arte, { recursive: true });
    fs.writeFileSync(path.join(arte, "fluxo.html"), paginaDoFluxo(msgs, uiEventos.filter((e) => e.type === "colab.tarefa" && e.id === criada.id)));

    const lista = await (await fetch(`${base}/api/colab/tarefas?bot=bruno&status=done`)).json() as TarefaColab[];
    assert.equal(lista.length, 1);
    assert.equal(lista[0].id, criada.id);
    const statusRuim = await fetch(`${base}/api/colab/tarefas?status=nope`);
    assert.equal(statusRuim.status, 400);

    const falso = await fetch(`${base}/api/colab/tarefas`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer token-errado", "x-mybots-bot": "ana" },
      body: JSON.stringify({ de: "ana", para: "bruno", objetivo: "x", contexto: "y", criterioSucesso: "z" }),
    });
    assert.equal(falso.status, 401);

    const peloMcp = await chamarColabLocal("ana", "POST", "/api/colab/tarefas", {
      de: "ana", para: "bruno", objetivo: "Segunda tarefa", contexto: "fila", criterioSucesso: "voltar",
    });
    assert.equal(peloMcp.status, 200);
    assert.equal(peloMcp.corpo.status, "queued");
    const id2 = peloMcp.corpo.id as string;
    await esperar(() => hub.tarefas.obter(id2)?.status === "running", "segunda running");

    const deBruno = await chamarColabLocal("bruno", "POST", "/api/colab/tarefas", {
      de: "bruno", para: "ana", objetivo: "Bruno pede para Ana", contexto: "não é fila do Bruno", criterioSucesso: "seguir",
    });
    assert.equal(deBruno.status, 200);
    const id3 = deBruno.corpo.id as string;
    assert.equal(hub.tarefas.obter(id2)?.status, "waiting");
    assert.equal(hub.tarefas.obter(id3)?.para, "ana");

    ui.send(JSON.stringify({ type: "colab.parar", alvo: ["bruno"], por: "humano" }));
    await esperar(() => hub.tarefas.obter(id2)?.status === "cancelled", "parar o bruno");
    assert.equal(hub.tarefas.obter(id2)?.resultado?.motivo, "parado pelo humano");
    assert.equal(hub.tarefas.obter(id3)?.status, "running");
    assert.equal(hub.tarefas.obter(criada.id)?.status, "done");
    await esperar(() => ana.recebidas.some((m) => m.type === "message" && String(m.text).includes(id2) && String(m.text).includes("parado pelo humano")), "Ana avisada do parar");

    const canceladaPeloTool = await runTool("cancel_task", { taskId: id3, motivo: "não precisa" }, {
      ...ctx,
      cfg: { ...ctx.cfg, bot: { id: "bruno", name: "Bruno", role: "Teste" } },
    } as ToolContext);
    assert.equal(canceladaPeloTool.ok, true, canceladaPeloTool.output);
    assert.equal(hub.tarefas.obter(id3)?.status, "cancelled");
    assert.equal(hub.tarefas.obter(id3)?.resultado?.motivo, "não precisa");

    const humana = await fetch(`${base}/api/colab/tarefas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ de: "humano", para: "ana", objetivo: "Pedido do chefe", contexto: "painel", criterioSucesso: "feito" }),
    });
    const corpoHumano = await humana.json() as { id: string; status: string };
    assert.equal(corpoHumano.status, "queued");
    assert.equal(hub.tarefas.obter(corpoHumano.id)?.profundidade, 0);

    hub.tarefas.checar = () => ({ ok: false, motivo: "taxa" });
    const antes = hub.tarefas.listar().length;
    uiEventos.length = 0;
    const bloqueio = await fetch(`${base}/api/colab/tarefas`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer token-de-teste", "x-mybots-bot": "ana" },
      body: JSON.stringify({ para: "bruno", objetivo: "não pode", contexto: "x", criterioSucesso: "y" }),
    });
    assert.equal(bloqueio.status, 403);
    const corpoBloqueio = await bloqueio.json() as { motivo: string };
    assert.equal(corpoBloqueio.motivo, "taxa");
    assert.equal(hub.tarefas.listar().length, antes);
    await esperar(() => uiEventos.some((e) => e.type === "colab.bloqueio" && e.motivo === "taxa" && e.de === "ana" && e.para === "bruno"), "evento de bloqueio");
  } finally {
    for (const s of sockets) { try { s.close(); } catch { /* já fechou */ } }
    // o "bot offline" grava auditoria no close do socket; espera isso antes de derrubar o servidor
    await new Promise((r) => setTimeout(r, 50));
    hub.encerrarTarefas();
    await app.close();
  }
});

function paginaDoFluxo(msgs: Array<{ sender: { name: string }; text: string }>, eventos: Array<{ status?: string; resultado?: { resumo?: string } }>): string {
  const bolhas = msgs.map((m) => {
    const dela = m.sender.name === "Ana";
    return `<article class="${dela ? "ana" : "bruno"}"><b>${escapeHtml(m.sender.name)}</b><p>${escapeHtml(m.text).replaceAll("\n", "<br>")}</p></article>`;
  }).join("");
  const linha = eventos.map((e) => `<li><code>${escapeHtml(String(e.status))}</code>${e.resultado?.resumo ? " — " + escapeHtml(e.resultado.resumo) : ""}</li>`).join("");
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Delegação Ana → Bruno</title>
<style>
  body { font: 16px/1.4 system-ui, sans-serif; background: #0f1419; color: #e7ecf1; margin: 0; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p.lead { color: #9fb0c0; margin: 0 0 24px; }
  article { border-radius: 16px; padding: 12px 16px; margin: 10px 0; max-width: 90%; }
  article.ana { background: #1d4e3a; margin-right: auto; }
  article.bruno { background: #243044; margin-left: auto; }
  b { display: block; font-size: 13px; opacity: .8; margin-bottom: 4px; }
  p { margin: 0; white-space: normal; }
  ol { padding-left: 18px; }
  code { color: #9ad7b0; }
</style>
<main>
  <h1>Tarefa de Ana para Bruno, resultado de volta</h1>
  <p class="lead">Ana delegou. Bruno recebeu o pedido, respondeu, e o Hub devolveu o resultado para Ana.</p>
  ${bolhas}
  <h2>Eventos colab.tarefa</h2>
  <ol>${linha}</ol>
</main></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;");
}
