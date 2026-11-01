import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

export const SESSION_COOKIE = "mybots_session";
const MAX_TENTATIVAS = 8;
const JANELA_MS = 15 * 60 * 1000;
const BLOQUEIO_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Tentativa = { n: number; desde: number; bloqueadoAte: number };
const tentativas = new Map<string, Tentativa>();

function ipDe(req: FastifyRequest): string {
  const xf = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return xf || req.ip || "local";
}

export function authOnlineAtivo(): boolean {
  return !!(config.usuarioOnline && config.senhaHash);
}

export function verificarSenha(plain: string, encoded: string): boolean {
  try {
    const parts = encoded.split("$");
    if (parts[0] !== "scrypt" || parts.length !== 6) return false;
    const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
    const salt = Buffer.from(parts[4], "base64url");
    const esperado = Buffer.from(parts[5], "base64url");
    const got = crypto.scryptSync(plain, salt, esperado.length, { N, r, p });
    return crypto.timingSafeEqual(got, esperado);
  } catch {
    return false;
  }
}

function assinar(payload: string): string {
  const sig = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function lerSessao(token: string): { u: string; exp: number } | null {
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const esperado = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u: string; exp: number };
    if (!data?.u || !data?.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function cookieDe(req: FastifyRequest, nome: string): string {
  const raw = String(req.headers?.cookie ?? "");
  for (const parte of raw.split(";")) {
    const j = parte.indexOf("=");
    if (j < 0) continue;
    if (parte.slice(0, j).trim() !== nome) continue;
    const v = parte.slice(j + 1).trim();
    try { return decodeURIComponent(v); } catch { return v; }
  }
  return "";
}


const WS_TICKET_TTL_MS = 90_000;

/** Ticket curto para abrir /ws/ui cross-origin (cookie nao cruza o tunel). Nunca e o Bearer do hub. */
export function emitirTicketWs(usuario: string): { ticket: string; expiresIn: number } {
  const exp = Date.now() + WS_TICKET_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ u: usuario, exp, k: "ws" }), "utf8").toString("base64url");
  return { ticket: assinar(payload), expiresIn: Math.floor(WS_TICKET_TTL_MS / 1000) };
}

export function ticketWsValido(ticket: string): boolean {
  if (!authOnlineAtivo() || !ticket) return false;
  const i = ticket.lastIndexOf(".");
  if (i < 0) return false;
  const payload = ticket.slice(0, i);
  const sig = ticket.slice(i + 1);
  const esperado = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  const aBuf = Buffer.from(sig);
  const bBuf = Buffer.from(esperado);
  if (aBuf.length !== bBuf.length || !crypto.timingSafeEqual(aBuf, bBuf)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u: string; exp: number; k?: string };
    if (data?.k !== "ws") return false;
    if (!data?.u || !data?.exp || Date.now() > data.exp) return false;
    return data.u === config.usuarioOnline;
  } catch {
    return false;
  }
}

export function ticketWsDoReq(req: FastifyRequest): boolean {
  const q = (req.query as Record<string, unknown> | undefined)?.ticket;
  if (!q) return false;
  return ticketWsValido(String(q));
}

export function sessaoValida(req: FastifyRequest): boolean {
  if (!authOnlineAtivo()) return false;
  const tok = cookieDe(req, SESSION_COOKIE);
  if (!tok) return false;
  const s = lerSessao(tok);
  return !!s && s.u === config.usuarioOnline;
}

/** Bearer MYBOTS_HUB_TOKEN so para processos locais (key watcher). Recusa se veio pelo tunel. */
export function hubTokenLoopbackOk(req: FastifyRequest): boolean {
  if (!config.hubToken) return false;
  const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== config.hubToken) return false;
  // Pedido pelo tunel/proxy: nunca aceitar o token do hub remotamente
  if (req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.headers["x-real-ip"]) return false;
  const peer = String((req.raw as any)?.socket?.remoteAddress ?? req.socket?.remoteAddress ?? req.ip ?? "")
    .replace(/^::ffff:/i, "")
    .toLowerCase();
  return peer === "127.0.0.1" || peer === "::1" || peer === "localhost";
}

function setSessionCookie(reply: FastifyReply, usuario: string) {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ u: usuario, exp }), "utf8").toString("base64url");
  const token = assinar(payload);
  const secure = true;
  reply.header(
    "set-cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  );
}

function clearSessionCookie(reply: FastifyReply) {
  reply.header("set-cookie", `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

function rateLimitOk(ip: string): { ok: true } | { ok: false; retryAfter: number } {
  const agora = Date.now();
  const t = tentativas.get(ip);
  if (!t) return { ok: true };
  if (t.bloqueadoAte > agora) return { ok: false, retryAfter: Math.ceil((t.bloqueadoAte - agora) / 1000) };
  if (agora - t.desde > JANELA_MS) {
    tentativas.delete(ip);
    return { ok: true };
  }
  if (t.n >= MAX_TENTATIVAS) {
    t.bloqueadoAte = agora + BLOQUEIO_MS;
    return { ok: false, retryAfter: Math.ceil(BLOQUEIO_MS / 1000) };
  }
  return { ok: true };
}

function registrarFalha(ip: string) {
  const agora = Date.now();
  const t = tentativas.get(ip);
  if (!t || agora - t.desde > JANELA_MS) {
    tentativas.set(ip, { n: 1, desde: agora, bloqueadoAte: 0 });
    return;
  }
  t.n += 1;
  if (t.n >= MAX_TENTATIVAS) t.bloqueadoAte = agora + BLOQUEIO_MS;
}

function limparFalhas(ip: string) {
  tentativas.delete(ip);
}

/** Rotas públicas mesmo com auth online ligado. */
export function rotaPublicaOnline(url: string): boolean {
  const caminho = url.split("?")[0];
  if (caminho === "/api/health") return true;
  if (caminho === "/api/login" || caminho === "/api/logout" || caminho === "/api/me") return true;
  if (caminho === "/api/channels/incoming") return true;
  // static assets of the UI
  if (caminho === "/" || caminho === "/index.html") return true;
  if (caminho.startsWith("/assets/") || caminho.startsWith("/amebas/") || caminho.startsWith("/icon") || caminho.endsWith(".svg") || caminho.endsWith(".png") || caminho.endsWith(".webmanifest") || caminho.endsWith(".css") || caminho.endsWith(".js") || caminho.endsWith(".map") || caminho.endsWith(".woff2")) return true;
  if (caminho.startsWith("/mybots/assets/") || caminho === "/mybots" || caminho === "/mybots/" || caminho === "/mybots/index.html") return true;
  return false;
}

export function registrarAuthOnline(app: FastifyInstance) {
  app.post("/api/login", async (req, reply) => {
    if (!authOnlineAtivo()) {
      return reply.code(400).send({ error: "login online nao configurado" });
    }
    const ip = ipDe(req);
    const lim = rateLimitOk(ip);
    if (!lim.ok) {
      reply.header("retry-after", String(lim.retryAfter));
      return reply.code(429).send({ error: "muitas tentativas; espere um pouco" });
    }
    const body = (req.body ?? {}) as { usuario?: string; senha?: string };
    const usuario = String(body.usuario ?? "").trim().toLowerCase();
    const senha = String(body.senha ?? "");
    const esperadoUser = config.usuarioOnline.toLowerCase();
    const okUser = usuario === esperadoUser;
    const okPass = okUser && verificarSenha(senha, config.senhaHash);
    if (!okPass) {
      registrarFalha(ip);
      return reply.code(401).send({ error: "usuario ou senha invalidos" });
    }
    limparFalhas(ip);
    setSessionCookie(reply, config.usuarioOnline);
    return { ok: true, usuario: config.usuarioOnline };
  });

  app.post("/api/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/me", async (req) => {
    if (!authOnlineAtivo()) return { autenticado: true, modo: "local" };
    if (sessaoValida(req)) return { autenticado: true, usuario: config.usuarioOnline };
    return { autenticado: false };
  });
}

