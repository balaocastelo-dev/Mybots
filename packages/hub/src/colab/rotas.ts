// Rotas deste PR. Tarefa e sala ficam com os outros PRs — não registrar aqui.
import type { FastifyInstance } from "fastify";
import type { Hub } from "../hub.js";

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
