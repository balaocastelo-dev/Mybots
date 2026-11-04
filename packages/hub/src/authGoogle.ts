import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { config } from "./config.js";
import { cookieDe, googleOAuthAtivo, setSessionCookie, getUsuariosRepo } from "./authOnline.js";

const STATE_COOKIE = "mybots_oauth_state";
const VERIFIER_COOKIE = "mybots_oauth_pkce";
const OAUTH_TTL_S = 600;
/** Quantos logins pendentes o mesmo navegador pode ter ao mesmo tempo. */
const MAX_PENDENTES = 5;

// O state guardado num cookie UNICO quebrava quando o login era aberto duas vezes no
// mesmo navegador (duas abas, a janela do app instalado e o Chrome, clique duplo,
// voltar do Google e clicar de novo): o segundo inicio sobrescrevia o cookie e o
// retorno do primeiro dava "estado OAuth invalido". Agora o cookie guarda ate 5
// states pendentes e o verificador PKCE de cada um fica no servidor.
const pendentes = new Map<string, { verifier: string; exp: number }>();
function limparPendentes() {
  const agora = Date.now();
  for (const [k, v] of pendentes) if (v.exp < agora) pendentes.delete(k);
}
const lerStates = (raw: string) => raw.split(".").filter(Boolean).slice(-MAX_PENDENTES);

/** Base publica do app (ex.: "/app") tirada da redirect URI; "" quando roda na raiz. */
function basePublica(): string {
  try {
    const p = new URL(config.googleRedirectUri).pathname;
    const i = p.indexOf("/api/auth/google/callback");
    return i > 0 ? p.slice(0, i) : "";
  } catch { return ""; }
}

function paginaTenteDeNovo(reply: FastifyReply, motivo: string) {
  const base = basePublica();
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MyBots</title></head>
<body style="font-family:system-ui,sans-serif;background:#F4F4F1;color:#333;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="max-width:420px;text-align:center;padding:24px">
<h2 style="margin:0 0 12px">N\u00e3o deu para concluir o login</h2>
<p style="margin:0 0 20px;line-height:1.5">${motivo}</p>
<a href="${base}/api/auth/google" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#B00000;color:#fff;text-decoration:none">Entrar com Google de novo</a>
<p style="margin:16px 0 0"><a href="${base}/" style="color:#666">Voltar ao MyBots</a></p>
</div></body></html>`;
  return reply.code(400).type("text/html; charset=utf-8").send(html);
}

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

type AoEntrarGoogle = (user: { id: string; email: string; role: string }, novo: boolean) => Promise<void> | void;
let aoEntrar: AoEntrarGoogle | null = null;
/** Chamado apos cada login Google (novo=true no primeiro login da conta). */
export function definirAoEntrarGoogle(fn: AoEntrarGoogle) { aoEntrar = fn; }

export function registrarAuthGoogle(app: FastifyInstance) {
  app.get("/api/auth/google", async (_req, reply) => {
    if (!googleOAuthAtivo()) {
      return reply.code(400).send({ error: "Google OAuth nao configurado" });
    }
    const state = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = challengeS256(verifier);
    limparPendentes();
    pendentes.set(state, { verifier, exp: Date.now() + OAUTH_TTL_S * 1000 });
    const lista = [...lerStates(cookieDe(_req, STATE_COOKIE)), state].slice(-MAX_PENDENTES);
    setTempCookieMulti(reply, STATE_COOKIE, lista.join("."));
    // copia do verificador do ultimo inicio: cobre um reinicio do Hub no meio do login
    setTempCookieMulti(reply, VERIFIER_COOKIE, state + "." + verifier);
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
    const states = lerStates(cookieDe(req, STATE_COOKIE));
    const pk = cookieDe(req, VERIFIER_COOKIE);
    const estado = q.state ?? "";
    limparPendentes();
    const pendente = estado ? pendentes.get(estado) : undefined;
    if (estado) pendentes.delete(estado); // uso unico
    const verifier = pendente?.verifier ?? (pk.startsWith(estado + ".") ? pk.slice(estado.length + 1) : "");
    // tira so ESTE state da lista: os outros logins pendentes continuam validos
    const resto = states.filter((s) => s !== estado);
    if (resto.length) setTempCookieMulti(reply, STATE_COOKIE, resto.join("."));
    else clearTempCookieMulti(reply, STATE_COOKIE);
    if (pk.startsWith(estado + ".")) clearTempCookieMulti(reply, VERIFIER_COOKIE);
    // o state tem de ter nascido NESTE navegador (cookie): e isso que impede login forjado
    if (!q.code || !estado || !states.includes(estado) || !verifier) {
      console.warn(`[auth.google] estado OAuth invalido (pendentes no cookie: ${states.length}, no servidor: ${pendente ? "sim" : "nao"})`);
      return paginaTenteDeNovo(reply, "O pedido de login expirou ou j\u00e1 foi usado (por exemplo, a p\u00e1gina foi recarregada ou o login foi aberto em outra janela). Clique abaixo para entrar de novo.");
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
    const jaExistia = !!repo.getByEmail(String(info.email));
    const user = repo.upsertGoogle({
      email: String(info.email),
      name: String(info.name || info.email),
      googleSub: String(info.sub),
      ownerEmail,
    });
    if (aoEntrar) {
      try { await aoEntrar({ id: user.id, email: user.email, role: user.role }, !jaExistia); }
      catch (e) { console.error("[auth.google] equipe inicial: " + (e as Error).message); }
    }
    setSessionCookie(reply, { u: user.email, uid: user.id, role: user.role, m: "google" });
    return reply.redirect(basePublica() + "/");
  });
}
