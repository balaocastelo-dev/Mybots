// Rotas HTTP da delegação. As ferramentas delegate_task, check_task e cancel_task
// dos bots são clientes destas rotas. As rotas de mensagem (PR #15) ficam em registrarRotasColab, no fim deste arquivo.

import type { FastifyInstance } from "fastify";
import { STATUS_TAREFA, type StatusTarefa } from "@mybots/shared";
import type { Hub } from "../hub.js";
import { ehHumano } from "./fila.js";

type AutorizaNo = (req: any) => string | null;

function identidade(req: any, nodeAuthorized: AutorizaNo): { bot: string | null } | null {
  const alegou = String(req.headers["x-mybots-bot"] ?? "").trim();
  const bot = nodeAuthorized(req);
  // Header de bot sem token que combine: não vira pedido de humano.
  if (alegou && bot !== alegou) return null;
  return { bot };
}

export function registerColabRoutes(app: FastifyInstance, hub: Hub, nodeAuthorized: AutorizaNo) {
  app.post("/api/colab/tarefas", async (req, reply) => {
    const quem = identidade(req, nodeAuthorized);
    if (!quem) return reply.code(401).send({ error: "token do bot inválido" });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const para = typeof b.para === "string" ? b.para : "";
    let de = typeof b.de === "string" ? b.de : "";
    const chamadorHumano = !quem.bot;
    if (quem.bot) {
      if (de && de !== quem.bot) return reply.code(403).send({ error: "de não confere com o bot autenticado" });
      de = quem.bot;
    } else if (!de.trim()) {
      de = "humano";
    }
    if (typeof b.objetivo !== "string") return reply.code(400).send({ error: "objetivo é obrigatório" });
    if (typeof b.contexto !== "string") return reply.code(400).send({ error: "contexto é obrigatório" });
    if (typeof b.criterioSucesso !== "string") return reply.code(400).send({ error: "criterioSucesso é obrigatório" });
    if (b.objetivo.length > 2_000 || b.contexto.length > 20_000 || b.criterioSucesso.length > 2_000) {
      return reply.code(400).send({ error: "texto longo demais" });
    }
    const prazo = lerPrazo(b.prazo);
    if (prazo === "invalido") return reply.code(400).send({ error: "prazo inválido (use epoch em ms ou ISO 8601)" });
    let formatoEntrega: string | null = null;
    if (b.formatoEntrega != null) {
      if (typeof b.formatoEntrega !== "string") return reply.code(400).send({ error: "formatoEntrega deve ser texto" });
      if (b.formatoEntrega.length > 500) return reply.code(400).send({ error: "formatoEntrega longo demais" });
      formatoEntrega = b.formatoEntrega;
    }
    const r = hub.tarefas.criar({
      de, para,
      objetivo: b.objetivo,
      contexto: b.contexto,
      criterioSucesso: b.criterioSucesso,
      prazo,
      formatoEntrega,
      chamadorHumano,
    });
    if (!r.ok) return reply.code(r.status ?? 400).send({ error: r.erro, ...(r.motivo ? { motivo: r.motivo } : {}) });
    // O contrato devolve o estado da criação, que é sempre queued.
    return { id: r.tarefa.id, status: "queued" as const };
  });

  app.get("/api/colab/tarefas", async (req, reply) => {
    hub.tarefas.vencerPrazos();
    const q = req.query as { bot?: string; status?: string };
    const bot = q.bot?.trim() || undefined;
    let status: StatusTarefa | undefined;
    if (q.status?.trim()) {
      if (!(STATUS_TAREFA as readonly string[]).includes(q.status)) return reply.code(400).send({ error: "status inválido" });
      status = q.status as StatusTarefa;
    }
    return hub.tarefas.listar({ bot, status });
  });

  app.get("/api/colab/tarefas/:id", async (req, reply) => {
    hub.tarefas.vencerPrazos();
    const t = hub.tarefas.obter((req.params as { id: string }).id);
    if (!t) return reply.code(404).send({ error: "tarefa não encontrada" });
    return t;
  });

  app.post("/api/colab/tarefas/:id/cancelar", async (req, reply) => {
    const quem = identidade(req, nodeAuthorized);
    if (!quem) return reply.code(401).send({ error: "token do bot inválido" });
    const id = (req.params as { id: string }).id;
    const t = hub.tarefas.obter(id);
    if (!t) return reply.code(404).send({ error: "tarefa não encontrada" });
    // Humano (sem token de bot) cancela qualquer uma. Bot só cancela a que ele pediu.
    // Quem pode delegar para quem continua no checador; isto aqui só amarra o cancelamento ao solicitante.
    if (quem.bot && t.de !== quem.bot) {
      return reply.code(403).send({ error: "só quem pediu a tarefa pode cancelá-la" });
    }
    if (quem.bot && ehHumano(t.de)) {
      return reply.code(403).send({ error: "tarefa do humano: só o humano cancela" });
    }
    const motivo = typeof (req.body as { motivo?: unknown } | undefined)?.motivo === "string"
      ? String((req.body as { motivo: string }).motivo).slice(0, 500)
      : undefined;
    const r = hub.tarefas.cancelar(id, motivo);
    if (!r.ok) return reply.code(r.status ?? 409).send({ error: r.erro });
    return { id: r.tarefa.id, status: r.tarefa.status, resultado: r.tarefa.resultado };
  });
}

/** Número >= 1e11 é epoch em ms. Abaixo disso, e ainda acima de 1e9, é epoch em segundos. String pode ser ISO. */
export function lerPrazo(v: unknown): number | null | "invalido" {
  if (v == null || v === "") return null;
  if (typeof v === "number") return numeroPrazo(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return numeroPrazo(Number(s));
    const t = Date.parse(s);
    if (Number.isNaN(t)) return "invalido";
    return t;
  }
  return "invalido";
}

function numeroPrazo(n: number): number | "invalido" {
  if (!Number.isFinite(n) || n <= 0) return "invalido";
  if (n >= 1e11) return Math.round(n);
  if (n >= 1e9) return Math.round(n * 1000);
  return "invalido";
}

export function registrarRotasColab(app: FastifyInstance, hub: Hub) {
  app.post("/api/colab/mensagens", async (req, reply) => {
    const b = req.body as { de?: string; para?: string; texto?: string; prioridade?: boolean; contexto?: string; profundidade?: number };
    const de = String(b?.de ?? "").trim();
    const para = String(b?.para ?? "").trim();
    const texto = String(b?.texto ?? "").trim();
    if (!de || !para || !texto) return reply.code(400).send({ error: "de, para e texto são obrigatórios" });
    if (b.prioridade !== undefined && typeof b.prioridade !== "boolean") {
      return reply.code(400).send({ error: "prioridade é true ou false" });
    }
    const r = hub.colab.enviar({
      de, para, texto,
      prioridade: b.prioridade === true,
      profundidade: Number.isFinite(b.profundidade) ? Number(b.profundidade) : 0,
      contexto: b.contexto ? String(b.contexto) : undefined,
    });
    if (!r.ok) {
      if (r.motivo) return reply.code(403).send({ ok: false, motivo: r.motivo, error: r.erro });
      return reply.code(404).send({ error: r.erro });
    }
    return { id: r.id };
  });

  app.get("/api/colab/conversas", async (req) => {
    const bot = String((req.query as { bot?: string }).bot ?? "");
    return hub.colab.conversas(bot || undefined);
  });

  app.get("/api/colab/conversas/:id/mensagens", async (req, reply) => {
    const id = decodeURIComponent(String((req.params as { id: string }).id));
    const lista = hub.colab.mensagens(id);
    if (!lista) return reply.code(404).send({ error: "conversa não é pair:<a>:<b>" });
    return lista;
  });

  app.get("/api/colab/auditoria", async (req) => {
    const q = req.query as { bot?: string; desde?: string };
    const desde = q.desde ? Number(q.desde) : undefined;
    return hub.colab.auditoria({ bot: q.bot, desde: Number.isFinite(desde) ? desde : undefined });
  });

  app.get("/api/colab/permissoes-empresa", async () => hub.colab.permissoes());

  app.put("/api/colab/permissoes-empresa", async (req, reply) => {
    const b = req.body as { de?: string; para?: string; liberado?: boolean };
    const de = String(b?.de ?? "").trim();
    const para = String(b?.para ?? "").trim();
    if (!de || !para) return reply.code(400).send({ error: "de e para são as empresas" });
    const r = hub.colab.definirPermissao(de, para, b.liberado !== false);
    if ("erro" in r) return reply.code(400).send({ error: r.erro });
    return r;
  });

  app.post("/api/colab/parar", async (req, reply) => {
    const b = req.body as { de?: string; alvo?: "todos" | string[] };
    const de = String(b?.de ?? "").trim();
    const alvo = b?.alvo;
    if (alvo !== "todos" && !Array.isArray(alvo)) {
      return reply.code(400).send({ error: "alvo é \"todos\" ou uma lista de ids" });
    }
    const r = hub.colab.parar(de, alvo);
    if (!r.ok) return reply.code(403).send({ ok: false, motivo: r.motivo, error: r.erro });
    return { ok: true, alvo: r.alvo };
  });
}
