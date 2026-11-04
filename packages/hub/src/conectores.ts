// Conexões MCP por conta. O token fica cifrado com a mesma chave do cofre.
// A API e o bot recebem só o catálogo e o estado "conectado".
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { authOnlineAtivo, getUsuariosRepo } from "./authOnline.js";
import { carregarChaveMestra, cifrar, decifrar } from "./cofreCripto.js";
import { registrarSegredo, semSegredo, textoSeguro } from "./redacao.js";
import {
  CONECTORES,
  conectorPorId,
  lojaShopify,
  oauthConfigurado,
  urlComLoja,
  type ConectorDef,
  type EstiloOAuth,
} from "./conectoresCatalogo.js";

export type FalhaConector = { error: string; status: number; faltando?: string[] };

export type ConectorPublico = {
  id: string;
  nome: string;
  categoria: ConectorDef["categoria"];
  descricao: string;
  gratis: true;
  auth: ConectorDef["auth"];
  oauthConfigurado: boolean;
  faltandoOauth: string[];
  campos: Array<{ id: string; rotulo: string; segredo: boolean; obrigatorio: boolean }>;
  conectado: boolean;
  rotulo: string | null;
  atualizadoEm: number | null;
};

type SegredoGuardado = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  chave?: string;
};

type Linha = {
  conta_id: string;
  conector_id: string;
  modo: string;
  rotulo: string | null;
  publico: string | null;
  segredo: string;
  atualizado_em: number;
};

const CAMPOS_OK = new Set(["chave", "loja"]);

export function resolverContaDoBot(botId: string, dono: (id: string) => string | null, authOn: boolean): string | null {
  const id = String(dono(botId) ?? "").trim();
  if (authOn) return id || null;
  return id || "local";
}

/** Conta dos bots desta instalação. Com login online, bot sem dono não herda outra conta. */
export function contaDoBot(botId: string): string | null {
  return resolverContaDoBot(botId, (id) => getUsuariosRepo()?.ownerUserIdDoBot(id) ?? null, authOnlineAtivo());
}

function texto(v: unknown, max: number): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export class Conectores {
  private chave: Buffer | null = null;
  private motivo = "";

  constructor(private db: Database.Database, opts?: { chave?: Buffer | null }) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conectores_conta (
        conta_id TEXT NOT NULL,
        conector_id TEXT NOT NULL,
        modo TEXT NOT NULL,
        rotulo TEXT,
        publico TEXT,
        segredo TEXT NOT NULL,
        criado_em INTEGER NOT NULL,
        atualizado_em INTEGER NOT NULL,
        PRIMARY KEY (conta_id, conector_id)
      );
    `);
    if (opts && "chave" in opts) {
      this.chave = opts.chave ?? null;
      this.motivo = this.chave ? "" : "Cofre desativado: sem chave mestra, nenhum aplicativo é guardado.";
    } else {
      const m = carregarChaveMestra();
      if (m.ativo) this.chave = m.chave;
      else this.motivo = m.motivo;
    }
  }

  get ativo(): boolean {
    return !!this.chave;
  }

  listar(contaId: string, env: NodeJS.ProcessEnv = process.env): { cofreAtivo: boolean; aviso?: string; conectores: ConectorPublico[] } {
    const linhas = new Map<string, Linha>();
    if (contaId) {
      const rows = this.db.prepare(`SELECT conta_id, conector_id, modo, rotulo, publico, segredo, atualizado_em FROM conectores_conta WHERE conta_id=?`).all(contaId) as Linha[];
      for (const r of rows) linhas.set(r.conector_id, r);
    }
    const conectores = CONECTORES.map((def) => this.vista(def, linhas.get(def.id) ?? null, env));
    return this.ativo
      ? { cofreAtivo: true, conectores }
      : { cofreAtivo: false, aviso: this.motivo, conectores };
  }

  guardarChave(contaId: string, id: string, body: unknown, env: NodeJS.ProcessEnv = process.env): { ok: true } | FalhaConector {
    const off = this.exigir();
    if (off) return off;
    const def = conectorPorId(id);
    if (!def) return { error: "aplicativo desconhecido", status: 404 };
    if (def.auth === "oauth") return { error: "este aplicativo entra só por OAuth", status: 400 };
    const campos = lerCampos(body);
    const segredos: SegredoGuardado = {};
    const publico: Record<string, string> = {};
    for (const campo of def.campos) {
      const valor = campos[campo.id] ?? "";
      if (campo.obrigatorio && !valor) return { error: `falta ${campo.rotulo}`, status: 400 };
      if (!valor) continue;
      if (campo.segredo) {
        if (valor.length < 8 || valor.length > 4000) return { error: "a chave não serve", status: 400 };
        segredos.chave = valor;
        segredos.accessToken = valor;
        registrarSegredo(valor);
      } else if (campo.id === "loja") {
        const loja = lojaShopify(valor);
        if (!loja) return { error: "loja Shopify inválida", status: 400 };
        publico.loja = loja;
      }
    }
    if (!segredos.accessToken) return { error: "falta a chave", status: 400 };
    const rotulo = publico.loja ?? null;
    this.gravar(contaId, def.id, "chave", rotulo, publico, segredos);
    return { ok: true };
  }

  desconectar(contaId: string, id: string): { ok: true } | FalhaConector {
    if (!conectorPorId(id)) return { error: "aplicativo desconhecido", status: 404 };
    const linha = this.linha(contaId, id);
    if (linha) {
      const aberto = this.abrir(linha);
      if (aberto?.accessToken) registrarSegredo(aberto.accessToken);
      if (aberto?.refreshToken) registrarSegredo(aberto.refreshToken);
      if (aberto?.chave) registrarSegredo(aberto.chave);
    }
    this.db.prepare(`DELETE FROM conectores_conta WHERE conta_id=? AND conector_id=?`).run(contaId, id);
    return { ok: true };
  }

  /** URL do provedor. O client secret não entra na URL. */
  urlDeAutorizacao(id: string, state: string, redirectUri: string, loja: string | undefined, env: NodeJS.ProcessEnv): { url: string } | FalhaConector {
    const def = conectorPorId(id);
    if (!def?.oauth) return { error: "este aplicativo não usa OAuth", status: 400 };
    const cfg = oauthConfigurado(def, env);
    if (!cfg.ok) return { error: "OAuth deste aplicativo ainda não está configurado no servidor", status: 400, faltando: cfg.faltando };
    const clientId = String(env[def.oauth.clientIdEnv] ?? "").trim();
    let authUrl = def.oauth.authUrl;
    let lojaOk: string | undefined;
    if (authUrl.includes("{loja}") || def.campos.some((c) => c.id === "loja")) {
      lojaOk = lojaShopify(loja ?? "") ?? undefined;
      if (!lojaOk) return { error: "informe a loja Shopify", status: 400 };
      const trocada = urlComLoja(authUrl, lojaOk);
      if (!trocada) return { error: "loja Shopify inválida", status: 400 };
      authUrl = trocada;
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      response_type: "code",
    });
    if (def.oauth.scopes.length) {
      params.set("scope", def.oauth.estilo === "slack" || def.oauth.estilo === "shopify" ? def.oauth.scopes.join(",") : def.oauth.scopes.join(" "));
    }
    if (def.oauth.estilo === "google") {
      params.set("access_type", "offline");
      params.set("prompt", "consent");
      params.set("include_granted_scopes", "true");
    }
    if (def.oauth.estilo === "notion") params.set("owner", "user");
    const url = `${authUrl}?${params.toString()}`;
    if (url.includes("client_secret") || url.includes(String(env[def.oauth.clientSecretEnv] ?? "___nunca___"))) {
      return { error: "não consegui montar a autorização", status: 500 };
    }
    return { url };
  }

  async concluirOAuth(o: {
    contaId: string;
    conectorId: string;
    code: string;
    loja?: string;
    redirectUri: string;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  }): Promise<{ ok: true; rotulo: string | null } | FalhaConector> {
    const off = this.exigir();
    if (off) return off;
    const def = conectorPorId(o.conectorId);
    if (!def?.oauth) return { error: "aplicativo desconhecido", status: 404 };
    const env = o.env ?? process.env;
    const cfg = oauthConfigurado(def, env);
    if (!cfg.ok) return { error: "OAuth deste aplicativo ainda não está configurado no servidor", status: 400, faltando: cfg.faltando };
    const loja = o.loja ? lojaShopify(o.loja) ?? undefined : undefined;
    if (def.oauth.estilo === "shopify" && !loja) return { error: "loja Shopify inválida", status: 400 };
    const trocado = await trocarCodigo(def, o.code, o.redirectUri, loja, env, o.fetchImpl ?? fetch);
    if ("erro" in trocado) return { error: trocado.erro, status: 502 };
    registrarSegredo(trocado.accessToken);
    if (trocado.refreshToken) registrarSegredo(trocado.refreshToken);
    const publico: Record<string, string> = {};
    if (loja) publico.loja = loja;
    this.gravar(o.contaId, def.id, "oauth", trocado.rotulo ?? loja ?? null, publico, {
      accessToken: trocado.accessToken,
      refreshToken: trocado.refreshToken,
      expiresAt: trocado.expiresAt,
    });
    return { ok: true, rotulo: trocado.rotulo ?? loja ?? null };
  }

  async chamar(o: {
    contaId: string;
    aplicativo: string;
    ferramenta: string;
    argumentos?: Record<string, unknown>;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  }): Promise<{ ok: true; texto: string } | { ok: false; erro: string }> {
    const def = conectorPorId(o.aplicativo);
    if (!def) return { ok: false, erro: "aplicativo desconhecido" };
    if (!def.entregaSegredo) {
      return { ok: false, erro: "Gerenciador de senha não entrega o segredo ao bot. A conexão fica no cofre da conta." };
    }
    if (!this.chave) return { ok: false, erro: "cofre desativado" };
    const linha = this.linha(o.contaId, def.id);
    if (!linha) return { ok: false, erro: "este aplicativo não está conectado nesta conta" };
    const segredo = this.abrir(linha);
    if (!segredo?.accessToken) return { ok: false, erro: "não consegui abrir a conexão" };
    const env = o.env ?? process.env;
    const token = await this.tokenValido(def, linha, segredo, env, o.fetchImpl ?? fetch);
    if (!token) return { ok: false, erro: "a conexão expirou; conecte de novo" };
    const publico = lerPublico(linha.publico);
    const url = urlComLoja(def.mcpUrl, publico.loja);
    if (!url) return { ok: false, erro: "este aplicativo não tem endereço MCP para esta conta" };
    const ferramenta = String(o.ferramenta ?? "").trim();
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(ferramenta)) return { ok: false, erro: "ferramenta inválida" };
    registrarSegredo(token);
    try {
      const res = await (o.fetchImpl ?? fetch)(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          ...(def.id === "shopify" ? { "x-shopify-access-token": token } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: ferramenta, arguments: o.argumentos ?? {} },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const cru = await res.text();
      if (res.status === 401 || res.status === 403) return { ok: false, erro: "a conexão expirou; conecte de novo" };
      const texto = semSegredo(extrairTextoMcp(cru)).slice(0, 8000);
      if (!res.ok) return { ok: false, erro: texto || "o aplicativo recusou a chamada" };
      return { ok: true, texto: texto || "ok" };
    } catch (e) {
      return { ok: false, erro: textoSeguro(e) || "não consegui falar com o aplicativo" };
    }
  }

  private vista(def: ConectorDef, linha: Linha | null, env: NodeJS.ProcessEnv): ConectorPublico {
    const oauth = def.oauth ? oauthConfigurado(def, env) : { ok: false, faltando: [] as string[] };
    return {
      id: def.id,
      nome: def.nome,
      categoria: def.categoria,
      descricao: def.descricao,
      gratis: true,
      auth: def.auth,
      oauthConfigurado: oauth.ok,
      faltandoOauth: def.auth === "chave" ? [] : oauth.faltando,
      campos: def.campos.map((c) => ({ id: c.id, rotulo: c.rotulo, segredo: c.segredo, obrigatorio: c.obrigatorio })),
      conectado: !!linha,
      rotulo: linha?.rotulo ? texto(linha.rotulo, 120) : null,
      atualizadoEm: linha ? Number(linha.atualizado_em) : null,
    };
  }

  private exigir(): FalhaConector | null {
    if (!this.chave) return { error: this.motivo || "cofre desativado", status: 503 };
    return null;
  }

  private linha(contaId: string, id: string): Linha | undefined {
    return this.db.prepare(`SELECT conta_id, conector_id, modo, rotulo, publico, segredo, atualizado_em FROM conectores_conta WHERE conta_id=? AND conector_id=?`).get(contaId, id) as Linha | undefined;
  }

  private abrir(linha: Linha): SegredoGuardado | null {
    if (!this.chave) return null;
    try {
      const j = JSON.parse(decifrar(this.chave, linha.segredo)) as SegredoGuardado;
      return j && typeof j === "object" ? j : null;
    } catch {
      return null;
    }
  }

  private gravar(contaId: string, id: string, modo: string, rotulo: string | null, publico: Record<string, string>, segredo: SegredoGuardado) {
    if (!this.chave) return;
    const blob = cifrar(this.chave, JSON.stringify(segredo));
    const agora = Date.now();
    this.db.prepare(`
      INSERT INTO conectores_conta (conta_id, conector_id, modo, rotulo, publico, segredo, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conta_id, conector_id) DO UPDATE SET
        modo=excluded.modo, rotulo=excluded.rotulo, publico=excluded.publico,
        segredo=excluded.segredo, atualizado_em=excluded.atualizado_em
    `).run(contaId, id, modo, rotulo, JSON.stringify(publico), blob, agora, agora);
  }

  private async tokenValido(def: ConectorDef, linha: Linha, segredo: SegredoGuardado, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch): Promise<string | null> {
    const access = String(segredo.accessToken ?? "");
    if (!access) return null;
    if (!segredo.expiresAt || segredo.expiresAt > Date.now() + 30_000 || !segredo.refreshToken || !def.oauth) return access;
    const cfg = oauthConfigurado(def, env);
    if (!cfg.ok) return null;
    const publico = lerPublico(linha.publico);
    const renovado = await renovarToken(def, segredo.refreshToken, publico.loja, env, fetchImpl);
    if (!renovado) return null;
    registrarSegredo(renovado.accessToken);
    if (renovado.refreshToken) registrarSegredo(renovado.refreshToken);
    this.gravar(linha.conta_id, def.id, linha.modo, linha.rotulo, publico, {
      ...segredo,
      accessToken: renovado.accessToken,
      refreshToken: renovado.refreshToken ?? segredo.refreshToken,
      expiresAt: renovado.expiresAt,
    });
    return renovado.accessToken;
  }
}

function lerCampos(body: unknown): Record<string, string> {
  const b = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const fonte = b.campos && typeof b.campos === "object" ? b.campos as Record<string, unknown> : b;
  const out: Record<string, string> = {};
  for (const id of CAMPOS_OK) {
    if (fonte[id] != null) out[id] = texto(fonte[id], 4000);
  }
  return out;
}

function lerPublico(bruto: string | null): Record<string, string> {
  try {
    const j = JSON.parse(String(bruto ?? "{}")) as Record<string, unknown>;
    const out: Record<string, string> = {};
    if (typeof j.loja === "string") {
      const loja = lojaShopify(j.loja);
      if (loja) out.loja = loja;
    }
    return out;
  } catch {
    return {};
  }
}

function extrairTextoMcp(cru: string): string {
  const t = cru.trim();
  if (!t) return "";
  const jsons: string[] = [];
  if (t.startsWith("{") || t.startsWith("[")) jsons.push(t);
  else {
    for (const linha of t.split(/\r?\n/)) {
      const m = /^data:\s*(.+)$/.exec(linha.trim());
      if (m && m[1] !== "[DONE]") jsons.push(m[1]);
    }
  }
  const ultimo = jsons.at(-1);
  if (!ultimo) return t.slice(0, 500);
  try {
    const j = JSON.parse(ultimo) as any;
    const conteudo = j?.result?.content;
    if (Array.isArray(conteudo)) {
      const textos = conteudo.map((c) => (typeof c?.text === "string" ? c.text : "")).filter(Boolean);
      if (textos.length) return textos.join("\n");
    }
    if (typeof j?.error?.message === "string") return j.error.message;
    if (typeof j?.result === "string") return j.result;
  } catch { /* texto cru */ }
  return t.slice(0, 500);
}

type TokenNovo = { accessToken: string; refreshToken?: string; expiresAt?: number; rotulo?: string };

async function trocarCodigo(def: ConectorDef, code: string, redirectUri: string, loja: string | undefined, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch): Promise<TokenNovo | { erro: string }> {
  const oauth = def.oauth;
  if (!oauth) return { erro: "este aplicativo não usa OAuth" };
  const clientId = String(env[oauth.clientIdEnv] ?? "").trim();
  const clientSecret = String(env[oauth.clientSecretEnv] ?? "").trim();
  const tokenUrl = urlComLoja(oauth.tokenUrl, loja);
  if (!tokenUrl || !clientId || !clientSecret || !code) return { erro: "não consegui trocar o código" };
  try {
    const res = await pedirToken(oauth.estilo, tokenUrl, clientId, clientSecret, code, redirectUri, fetchImpl);
    const j = await res.json().catch(() => ({} as any));
    if (!res.ok) return { erro: "o provedor recusou a conexão" };
    return lerToken(oauth.estilo, j);
  } catch {
    return { erro: "não consegui falar com o provedor" };
  }
}

async function renovarToken(def: ConectorDef, refresh: string, loja: string | undefined, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch): Promise<TokenNovo | null> {
  const oauth = def.oauth;
  if (!oauth) return null;
  const clientId = String(env[oauth.clientIdEnv] ?? "").trim();
  const clientSecret = String(env[oauth.clientSecretEnv] ?? "").trim();
  const tokenUrl = urlComLoja(oauth.tokenUrl, loja);
  if (!tokenUrl || !clientId || !clientSecret) return null;
  try {
    const corpo = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: corpo,
      signal: AbortSignal.timeout(20_000),
    });
    const j = await res.json().catch(() => ({} as any));
    if (!res.ok) return null;
    const lido = lerToken(oauth.estilo, j);
    return "erro" in lido ? null : lido;
  } catch {
    return null;
  }
}

async function pedirToken(estilo: EstiloOAuth, tokenUrl: string, clientId: string, clientSecret: string, code: string, redirectUri: string, fetchImpl: typeof fetch): Promise<Response> {
  if (estilo === "notion") {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    return fetchImpl(tokenUrl, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      signal: AbortSignal.timeout(20_000),
    });
  }
  if (estilo === "shopify") {
    return fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      signal: AbortSignal.timeout(20_000),
    });
  }
  const corpo = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  return fetchImpl(tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: corpo,
    signal: AbortSignal.timeout(20_000),
  });
}

function lerToken(estilo: EstiloOAuth, j: any): TokenNovo | { erro: string } {
  if (estilo === "slack") {
    if (j?.ok === false) return { erro: "o provedor recusou a conexão" };
    const access = String(j?.access_token ?? "");
    if (!access) return { erro: "o provedor não devolveu acesso" };
    const rotulo = typeof j?.team?.name === "string" ? j.team.name : undefined;
    return { accessToken: access, rotulo };
  }
  const access = String(j?.access_token ?? "");
  if (!access) return { erro: "o provedor não devolveu acesso" };
  const expiresIn = Number(j?.expires_in);
  const rotulo = typeof j?.workspace_name === "string" ? j.workspace_name
    : typeof j?.team?.name === "string" ? j.team.name
    : undefined;
  return {
    accessToken: access,
    refreshToken: typeof j?.refresh_token === "string" ? j.refresh_token : undefined,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
    rotulo,
  };
}

export type EstadoOAuth = {
  contaId: string;
  conectorId: string;
  nonce: string;
  loja?: string;
  exp: number;
};

export function novoEstadoOAuth(contaId: string, conectorId: string, loja: string | undefined, segredo: string): { state: string; nonce: string } {
  const nonce = crypto.randomBytes(24).toString("base64url");
  const payload: EstadoOAuth = { contaId, conectorId, nonce, exp: Date.now() + 10 * 60 * 1000 };
  if (loja) payload.loja = loja;
  const cru = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { state: assinar(cru, segredo), nonce };
}

export function lerEstadoOAuth(state: string, segredo: string): EstadoOAuth | null {
  const i = state.lastIndexOf(".");
  if (i < 0) return null;
  const cru = state.slice(0, i);
  const sig = state.slice(i + 1);
  const esperado = crypto.createHmac("sha256", segredo).update(cru).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(cru, "base64url").toString("utf8")) as EstadoOAuth;
    if (!data?.contaId || !data?.conectorId || !data?.nonce || !data?.exp) return null;
    if (Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function assinar(payload: string, segredo: string): string {
  const sig = crypto.createHmac("sha256", segredo).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
