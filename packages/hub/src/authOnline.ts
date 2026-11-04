import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import type { RoleUsuario, Usuario } from "./usuarios.js";
import type { UsuariosRepo } from "./usuarios.js";

export const SESSION_COOKIE = "mybots_session";
const MAX_TENTATIVAS = 8;
const JANELA_MS = 15 * 60 * 1000;
const BLOQUEIO_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SessaoOnline = {
  u: string;
  uid: string;
  role: RoleUsuario;
  exp: number;
  /** Metodo de login. Online so vale sessao Google ("google"). */
  m?: "google";
};

type Tentativa = { n: number; desde: number; bloqueadoAte: number };
const tentativas = new Map<string, Tentativa>();

/** Injetado em server.ts apos criar o Hub/DB. */
let usuariosRepo: UsuariosRepo | null = null;
export function setUsuariosRepo(repo: UsuariosRepo) {
  usuariosRepo = repo;
}
export function getUsuariosRepo(): UsuariosRepo | null {
  return usuariosRepo;
}

function ipDe(req: FastifyRequest): string {
  const xf = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return xf || req.ip || "local";
}

/** Auth online: senha (MYBOTS_USUARIO+HASH) e/ou Google OAuth. */
export function authOnlineAtivo(): boolean {
  return !!(config.usuarioOnline && config.senhaHash) || googleOAuthAtivo();
}

export function googleOAuthAtivo(): boolean {
  return !!(config.googleClientId && config.googleClientSecret && config.googleRedirectUri);
}

export function senhaOnlineAtiva(): boolean {
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

function lerSessao(token: string): SessaoOnline | null {
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const esperado = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessaoOnline> & { k?: string };
    if (data?.k === "ws") return null;
    if (!data?.u || !data?.exp || Date.now() > data.exp) return null;
    // Sessao legada (so u/exp): promove para owner se bater com MYBOTS_USUARIO.
    let uid = data.uid || "";
    let role: RoleUsuario = data.role === "owner" || data.role === "cliente" ? data.role : "cliente";
    if (!uid && config.usuarioOnline && data.u === config.usuarioOnline) {
      const owner = usuariosRepo?.ensureOwner(config.ownerEmail || config.usuarioOnline, config.usuarioOnline);
      if (owner) { uid = owner.id; role = "owner"; }
    }
    if (!uid) return null;
    // Online e so Google: sessoes antigas de senha deixam de valer.
    if (googleOAuthAtivo() && data.m !== "google") return null;
    return { u: String(data.u), uid, role, exp: Number(data.exp), m: data.m === "google" ? "google" : undefined };
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

export function emitirTicketWs(sessao: SessaoOnline): { ticket: string; expiresIn: number } {
  const exp = Date.now() + WS_TICKET_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ u: sessao.u, uid: sessao.uid, role: sessao.role, exp, k: "ws" }), "utf8").toString("base64url");
  return { ticket: assinar(payload), expiresIn: Math.floor(WS_TICKET_TTL_MS / 1000) };
}

export function lerTicketWs(ticket: string): SessaoOnline | null {
  if (!authOnlineAtivo() || !ticket) return null;
  const i = ticket.lastIndexOf(".");
  if (i < 0) return null;
  const payload = ticket.slice(0, i);
  const sig = ticket.slice(i + 1);
  const esperado = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  const aBuf = Buffer.from(sig);
  const bBuf = Buffer.from(esperado);
  if (aBuf.length !== bBuf.length || !crypto.timingSafeEqual(aBuf, bBuf)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessaoOnline & { k?: string };
    if (data?.k !== "ws") return null;
    if (!data?.u || !data?.uid || !data?.exp || Date.now() > data.exp) return null;
    return { u: data.u, uid: data.uid, role: data.role === "owner" ? "owner" : "cliente", exp: data.exp };
  } catch {
    return null;
  }
}

export function ticketWsValido(ticket: string): boolean {
  return !!lerTicketWs(ticket);
}

export function ticketWsDoReq(req: FastifyRequest): boolean {
  const q = (req.query as Record<string, unknown> | undefined)?.ticket;
  if (!q) return false;
  return ticketWsValido(String(q));
}

export function sessaoDoReq(req: FastifyRequest): SessaoOnline | null {
  if (!authOnlineAtivo()) return null;
  const tok = cookieDe(req, SESSION_COOKIE);
  if (!tok) return null;
  return lerSessao(tok);
}

export function sessaoValida(req: FastifyRequest): boolean {
  return !!sessaoDoReq(req);
}

export function usuarioDoReq(req: FastifyRequest): Usuario | null {
  const s = sessaoDoReq(req);
  if (!s || !usuariosRepo) return null;
  return usuariosRepo.getById(s.uid) ?? null;
}

/** Bearer MYBOTS_HUB_TOKEN so para processos locais (key watcher). Recusa se veio pelo tunel. */
export function hubTokenLoopbackOk(req: FastifyRequest): boolean {
  if (!config.hubToken) return false;
  const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== config.hubToken) return false;
  if (req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.headers["x-real-ip"]) return false;
  const peer = String((req.raw as any)?.socket?.remoteAddress ?? req.socket?.remoteAddress ?? req.ip ?? "")
    .replace(/^::ffff:/i, "")
    .toLowerCase();
  return peer === "127.0.0.1" || peer === "::1" || peer === "localhost";
}

function appendSetCookie(reply: FastifyReply, cookie: string) {
  const prev = reply.getHeader("set-cookie");
  if (!prev) { reply.header("set-cookie", cookie); return; }
  const arr = Array.isArray(prev) ? prev.map(String) : [String(prev)];
  arr.push(cookie);
  reply.header("set-cookie", arr);
}

export function setSessionCookie(reply: FastifyReply, sessao: { u: string; uid: string; role: RoleUsuario; m?: "google" }) {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ u: sessao.u, uid: sessao.uid, role: sessao.role, m: sessao.m, exp }), "utf8").toString("base64url");
  const token = assinar(payload);
  appendSetCookie(
    reply,
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  );
}

function clearSessionCookie(reply: FastifyReply) {
  appendSetCookie(reply, `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
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

/** Rotas publicas mesmo com auth online ligado. */
export function rotaPublicaOnline(url: string): boolean {
  const caminho = url.split("?")[0];
  if (caminho === "/api/health") return true;
  if (caminho === "/api/login" || caminho === "/api/logout" || caminho === "/api/me") return true;
  if (caminho === "/api/auth/google" || caminho === "/api/auth/google/callback" || caminho === "/api/auth/logout") return true;
  if (caminho === "/api/channels/incoming") return true;
  if (caminho.startsWith("/pc/") || caminho.startsWith("/android/")) return false;
  if (caminho === "/" || caminho === "/index.html") return true;
  if (caminho.startsWith("/assets/") || caminho.startsWith("/amebas/") || caminho.startsWith("/icon") || caminho.endsWith(".svg") || caminho.endsWith(".png") || caminho.endsWith(".webmanifest") || caminho.endsWith(".css") || caminho.endsWith(".js") || caminho.endsWith(".map") || caminho.endsWith(".woff2")) return true;
  if (caminho.startsWith("/mybots/assets/") || caminho === "/mybots" || caminho === "/mybots/" || caminho === "/mybots/index.html") return true;
  if (caminho.startsWith("/app/assets/") || caminho === "/app" || caminho === "/app/" || caminho === "/app/index.html") return true;
  return false;
}

export function registrarAuthOnline(app: FastifyInstance) {
  app.post("/api/login", async (req, reply) => {
    if (googleOAuthAtivo()) {
      return reply.code(403).send({ error: "login online somente com Google" });
    }
    if (!senhaOnlineAtiva()) {
      return reply.code(400).send({ error: "login com senha nao configurado" });
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
    const ownerEmail = (config.ownerEmail || config.usuarioOnline).toLowerCase();
    const owner = usuariosRepo?.ensureOwner(ownerEmail, config.usuarioOnline);
    if (!owner) return reply.code(500).send({ error: "falha ao criar usuario owner" });
    usuariosRepo?.touchLogin(owner.id);
    setSessionCookie(reply, { u: owner.email, uid: owner.id, role: "owner" });
    return { ok: true, usuario: owner.email, uid: owner.id, role: "owner" as const };
  });

  const sair = async (_req: FastifyRequest, reply: FastifyReply) => {
    clearSessionCookie(reply);
    return { ok: true };
  };
  app.post("/api/logout", sair);
  app.post("/api/auth/logout", sair);

  app.get("/api/me", async (req) => {
    if (!authOnlineAtivo()) return { autenticado: true, modo: "local", google: false, senha: false };
    const s = sessaoDoReq(req);
    if (s) {
      const u = usuariosRepo?.getById(s.uid);
      return {
        autenticado: true,
        usuario: s.u,
        uid: s.uid,
        role: s.role,
        name: u?.name ?? s.u,
        google: googleOAuthAtivo(),
        senha: !googleOAuthAtivo() && senhaOnlineAtiva(),
      };
    }
    return { autenticado: false, google: googleOAuthAtivo(), senha: !googleOAuthAtivo() && senhaOnlineAtiva() };
  });
}
