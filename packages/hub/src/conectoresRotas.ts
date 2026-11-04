// API dos aplicativos conectados. A conta sai da sessão, nunca do corpo.
// O token não volta: a resposta é catálogo, "conectado" e o nome público.
import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { cookieDe } from "./authOnline.js";
import { Conectores, lerEstadoOAuth, novoEstadoOAuth, type FalhaConector } from "./conectores.js";
import { lojaShopify } from "./conectoresCatalogo.js";

const NONCE_COOKIE = "mybots_conector_nonce";
const NONCE_TTL_S = 600;

export type OpcoesRotasConectores = {
  conectores: Conectores;
  /** null = não autenticado. O id da conta não vem do cliente. */
  contaDe: (req: FastifyRequest) => string | null;
  segredoEstado?: string;
  redirectUri?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Para onde o navegador volta depois do OAuth. */
  volta?: string;
};

function enviar(reply: FastifyReply, r: unknown) {
  if (r && typeof r === "object" && "error" in r && "status" in r) {
    const f = r as FalhaConector;
    const corpo: { error: string; faltando?: string[] } = { error: f.error };
    if (f.faltando?.length) corpo.faltando = f.faltando;
    return reply.code(f.status).send(corpo);
  }
  return r;
}

function cookieNonce(reply: FastifyReply, valor: string) {
  reply.header("set-cookie", `${NONCE_COOKIE}=${encodeURIComponent(valor)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${NONCE_TTL_S}`);
}

function limparNonce(reply: FastifyReply) {
  reply.header("set-cookie", `${NONCE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

function nonceConfere(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

export function registrarConectores(app: FastifyInstance, opts: OpcoesRotasConectores) {
  const env = () => opts.env ?? process.env;
  const segredo = () => opts.segredoEstado || config.sessionSecret;
  const redirectUri = () => opts.redirectUri || `${config.publicUrl}/api/conectores/oauth/callback`;
  const volta = (q: string) => {
    const base = opts.volta || "/";
    return `${base}${base.includes("?") ? "&" : "?"}conectores=${q}`;
  };

  const conta = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const id = opts.contaDe(req);
    if (!id) {
      reply.code(401).send({ error: "nao autenticado" });
      return null;
    }
    return id;
  };

  app.get("/api/conectores", async (req, reply) => {
    const id = conta(req, reply);
    if (!id) return;
    return opts.conectores.listar(id, env());
  });

  app.post("/api/conectores/:id/chave", async (req, reply) => {
    const id = conta(req, reply);
    if (!id) return;
    return enviar(reply, opts.conectores.guardarChave(id, String((req.params as { id: string }).id), req.body, env()));
  });

  app.delete("/api/conectores/:id", async (req, reply) => {
    const id = conta(req, reply);
    if (!id) return;
    return enviar(reply, opts.conectores.desconectar(id, String((req.params as { id: string }).id)));
  });

  app.get("/api/conectores/:id/oauth/iniciar", async (req, reply) => {
    const idConta = conta(req, reply);
    if (!idConta) return;
    const conectorId = String((req.params as { id: string }).id);
    const q = req.query as { loja?: string };
    const loja = q.loja ? lojaShopify(q.loja) ?? undefined : undefined;
    if (q.loja && !loja) return reply.code(400).send({ error: "loja Shopify inválida" });
    const { state, nonce } = novoEstadoOAuth(idConta, conectorId, loja, segredo());
    const url = opts.conectores.urlDeAutorizacao(conectorId, state, redirectUri(), loja, env());
    if ("error" in url) return enviar(reply, url);
    cookieNonce(reply, nonce);
    return reply.redirect(url.url);
  });

  app.get("/api/conectores/oauth/callback", async (req, reply) => {
    const idConta = conta(req, reply);
    if (!idConta) return;
    const q = req.query as { code?: string; state?: string; error?: string };
    limparNonce(reply);
    if (q.error) return reply.redirect(volta("negado"));
    if (!q.code || !q.state) return reply.redirect(volta("erro"));
    const estado = lerEstadoOAuth(q.state, segredo());
    const nonce = cookieDe(req, NONCE_COOKIE);
    if (!estado || !nonceConfere(nonce, estado.nonce)) return reply.redirect(volta("erro"));
    if (estado.contaId !== idConta) return reply.code(403).send({ error: "esta conexão é de outra conta" });
    const r = await opts.conectores.concluirOAuth({
      contaId: idConta,
      conectorId: estado.conectorId,
      code: q.code,
      loja: estado.loja,
      redirectUri: redirectUri(),
      env: env(),
      fetchImpl: opts.fetchImpl,
    });
    if ("error" in r) return enviar(reply, r);
    return reply.redirect(volta("ok"));
  });
}
