import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { config } from "./config.js";
import { cookieDe, googleOAuthAtivo, setSessionCookie, getUsuariosRepo } from "./authOnline.js";

const STATE_COOKIE = "mybots_oauth_state";
const VERIFIER_COOKIE = "mybots_oauth_pkce";
const OAUTH_TTL_S = 600;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function challengeS256(verifier: string): string {
  return b64url(crypto.createHash("sha256").update(verifier).digest());
}

function appendSetCookie(reply: FastifyReply, cookie: string) {
  const prev = reply.getHeader("set-cookie");
  if (!prev) {
    reply.header("set-cookie", cookie);
    return;
  }
  const arr = Array.isArray(prev) ? prev.map(String) : [String(prev)];
  arr.push(cookie);
  reply.header("set-cookie", arr);
}

function setTempCookieMulti(reply: FastifyReply, nome: string, valor: string) {
  appendSetCookie(
    reply,
    `${nome}=${encodeURIComponent(valor)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${OAUTH_TTL_S}`,
  );
}

function clearTempCookieMulti(reply: FastifyReply, nome: string) {
  appendSetCookie(reply, `${nome}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

export function registrarAuthGoogle(app: FastifyInstance) {
  app.get("/api/auth/google", async (_req, reply) => {
    if (!googleOAuthAtivo()) {
      return reply.code(400).send({ error: "Google OAuth nao configurado" });
    }
    const state = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = challengeS256(verifier);
    setTempCookieMulti(reply, STATE_COOKIE, state);
    setTempCookieMulti(reply, VERIFIER_COOKIE, verifier);
    const params = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: config.googleRedirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "online",
      prompt: "select_account",
    });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get("/api/auth/google/callback", async (req, reply) => {
    if (!googleOAuthAtivo()) {
      return reply.code(400).send({ error: "Google OAuth nao configurado" });
    }
    const q = req.query as { code?: string; state?: string; error?: string };
    if (q.error) {
      return reply.code(400).send({ error: `Google: ${q.error}` });
    }
    const stateCookie = cookieDe(req, STATE_COOKIE);
    const verifier = cookieDe(req, VERIFIER_COOKIE);
    clearTempCookieMulti(reply, STATE_COOKIE);
    clearTempCookieMulti(reply, VERIFIER_COOKIE);
    if (!q.code || !q.state || !stateCookie || q.state !== stateCookie || !verifier) {
      return reply.code(400).send({ error: "estado OAuth invalido; tente de novo" });
    }
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: q.code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: config.googleRedirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    const tokenJson = await tokenRes.json().catch(() => ({} as any));
    if (!tokenRes.ok || !tokenJson.access_token) {
      return reply.code(401).send({ error: "falha ao trocar codigo Google", detalhe: tokenJson?.error || tokenJson?.error_description });
    }
    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokenJson.access_token}` },
    });
    const info = await infoRes.json().catch(() => ({} as any));
    if (!infoRes.ok || !info.email || !info.sub) {
      return reply.code(401).send({ error: "nao foi possivel ler o perfil Google" });
    }
    if (info.email_verified === false) {
      return reply.code(403).send({ error: "e-mail Google nao verificado" });
    }
    const repo = getUsuariosRepo();
    if (!repo) return reply.code(500).send({ error: "usuarios nao inicializados" });
    const ownerEmail = (config.ownerEmail || config.usuarioOnline || "").toLowerCase();
    // Garante owner row antes (migracao de bots sem dono) se este login for o dono.
    if (ownerEmail && String(info.email).toLowerCase() === ownerEmail) {
      repo.ensureOwner(ownerEmail, info.name || info.email);
    }
    const user = repo.upsertGoogle({
      email: String(info.email),
      name: String(info.name || info.email),
      googleSub: String(info.sub),
      ownerEmail,
    });
    setSessionCookie(reply, { u: user.email, uid: user.id, role: user.role, m: "google" });
    return reply.redirect("/");
  });
}
