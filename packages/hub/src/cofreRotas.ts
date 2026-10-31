// API REST do cofre. A tela de Configurações consome isto; o segredo não volta.
import type { FastifyInstance } from "fastify";
import type { Hub } from "./hub.js";
import type { Falha } from "./cofre.js";

function enviar(reply: any, r: Falha | object) {
  if (r && typeof r === "object" && "error" in r && "status" in r) {
    return reply.code((r as Falha).status).send({ error: (r as Falha).error });
  }
  return r;
}

export function registrarCofre(app: FastifyInstance, hub: Hub) {
  const cofre = hub.cofre;

  app.get("/api/cofre/status", async () => cofre.status());

  app.get("/api/cofre/itens", async (req, reply) => {
    const q = req.query as { busca?: string; tipo?: string };
    return enviar(reply, cofre.listar(String(q.busca ?? ""), String(q.tipo ?? "")));
  });

  app.post("/api/cofre/itens", async (req, reply) => enviar(reply, cofre.criar(req.body)));

  app.put("/api/cofre/itens/:id", async (req, reply) => {
    return enviar(reply, cofre.editar(String((req.params as any).id), req.body));
  });

  app.delete("/api/cofre/itens/:id", async (req, reply) => {
    return enviar(reply, cofre.apagar(String((req.params as any).id)));
  });

  app.get("/api/cofre/itens/:id/permissoes", async (req, reply) => {
    return enviar(reply, cofre.permissoes(String((req.params as any).id)));
  });

  app.put("/api/cofre/itens/:id/permissoes", async (req, reply) => {
    return enviar(reply, cofre.definirPermissoes(String((req.params as any).id), req.body));
  });

  app.get("/api/cofre/auditoria", async (req, reply) => {
    const q = req.query as { itemId?: string };
    return enviar(reply, cofre.auditoria(String(q.itemId ?? "")));
  });
}
