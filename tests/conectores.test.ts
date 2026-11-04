// Aplicativos MCP por conta: um tenant não vê o outro, e o token não sai na API.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { CONECTORES, lojaShopify } from "../packages/hub/src/conectoresCatalogo.ts";
import { Conectores, lerEstadoOAuth, novoEstadoOAuth, resolverContaDoBot } from "../packages/hub/src/conectores.ts";
import { registrarConectores } from "../packages/hub/src/conectoresRotas.ts";

const SEGREDO = "segredo-de-teste-oauth-conectores";
const CLIENT_ID = "id-publico-oauth-teste";
const CLIENT_SECRET = "sec_OAUTH_NAO_VAZAR_88";
const TOKEN_A = "tok_isolado_contaA_9f3e1c7ab";
const TOKEN_B = "tok_isolado_contaB_2ab8c44de";
const TOKEN_OAUTH = "tok_oauth_NAO_VAZAR_77";
const REFRESH = "ref_NAO_VAZAR_66";
const TOKEN_BW = "bw_segredo_NAO_VAZAR_55";
const PROIBIDOS = [CLIENT_SECRET, TOKEN_A, TOKEN_B, TOKEN_OAUTH, REFRESH, TOKEN_BW];

function semVazamento(texto: string, extra: string[] = []) {
  for (const s of [...PROIBIDOS, ...extra]) {
    assert.equal(texto.includes(s), false, `vazou: ${s.slice(0, 12)}…`);
  }
}

test("catálogo traz os aplicativos grátis e as abas pedidas", () => {
  const ids = CONECTORES.map((c) => c.id);
  for (const id of ["google-drive", "google-docs", "google-calendar", "gmail", "notion", "slack", "github", "vercel", "cloudflare", "figma", "stripe", "shopify", "bitwarden"]) {
    assert.ok(ids.includes(id), id);
  }
  const cats = new Set(CONECTORES.map((c) => c.categoria));
  for (const c of ["senhas", "produtividade", "comunicacao", "design", "codigo", "marketing", "financas"]) {
    assert.ok(cats.has(c as never), c);
  }
  assert.equal(lojaShopify("https://evil.com/admin"), null);
  assert.equal(lojaShopify("minha-loja"), "minha-loja.myshopify.com");
  assert.equal(CONECTORES.every((c) => !JSON.stringify(c).includes("sec_") && !("clientSecret" in c)), true);
});

test("bot sem dono não herda a conta de outro quando o login está ligado", () => {
  assert.equal(resolverContaDoBot("bot-a", () => "conta-a", true), "conta-a");
  assert.equal(resolverContaDoBot("bot-b", () => "conta-b", true), "conta-b");
  assert.equal(resolverContaDoBot("solto", () => null, true), null);
  assert.equal(resolverContaDoBot("solto", () => null, false), "local");
  assert.equal(resolverContaDoBot("bot-b", () => "conta-b", false), "conta-b");
});

test("isolamento de conta e o token não volta na API nem no arquivo", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-conectores-"));
  const arquivo = path.join(dir, "c.sqlite");
  const db = new Database(arquivo);
  const conectores = new Conectores(db, { chave: randomBytes(32) });
  let conta = "conta-a";
  const app = Fastify({ logger: false });
  const env = {
    MYBOTS_OAUTH_GITHUB_CLIENT_ID: CLIENT_ID,
    MYBOTS_OAUTH_GITHUB_CLIENT_SECRET: CLIENT_SECRET,
  } as NodeJS.ProcessEnv;
  let fetchChamadas = 0;
  registrarConectores(app, {
    conectores,
    contaDe: () => conta,
    segredoEstado: SEGREDO,
    redirectUri: "http://127.0.0.1:9/api/conectores/oauth/callback",
    env,
    volta: "/",
    fetchImpl: async () => {
      fetchChamadas += 1;
      return new Response(JSON.stringify({ access_token: TOKEN_OAUTH, refresh_token: REFRESH, expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const semOauth = await app.inject({ method: "GET", url: "/api/conectores/gmail/oauth/iniciar" });
  assert.equal(semOauth.statusCode, 400);
  assert.deepEqual(semOauth.json().faltando, ["MYBOTS_OAUTH_GOOGLE_CLIENT_ID", "MYBOTS_OAUTH_GOOGLE_CLIENT_SECRET"]);
  semVazamento(semOauth.body);

  const lojaRuim = await app.inject({ method: "GET", url: "/api/conectores/shopify/oauth/iniciar?loja=https://evil.com&chave=" + TOKEN_A });
  assert.equal(lojaRuim.statusCode, 400);
  semVazamento(lojaRuim.body + String(lojaRuim.headers.location ?? ""));

  const iniciar = await app.inject({ method: "GET", url: "/api/conectores/github/oauth/iniciar?chave=" + TOKEN_A });
  assert.equal(iniciar.statusCode, 302);
  const location = String(iniciar.headers.location);
  assert.match(location, /github\.com\/login\/oauth\/authorize/);
  assert.match(location, new RegExp(`client_id=${CLIENT_ID}`));
  assert.equal(location.includes("client_secret"), false);
  semVazamento(location + iniciar.body);

  const gravado = await app.inject({
    method: "POST",
    url: "/api/conectores/github/chave",
    headers: { "content-type": "application/json" },
    payload: { chave: TOKEN_A, contaId: "conta-b", accessToken: TOKEN_A },
  });
  assert.equal(gravado.statusCode, 200);
  assert.deepEqual(gravado.json(), { ok: true });
  semVazamento(gravado.body);

  const listaA = await app.inject({ method: "GET", url: "/api/conectores" });
  assert.equal(listaA.statusCode, 200);
  const jsonA = listaA.json();
  assert.equal(jsonA.conectores.find((c: { id: string }) => c.id === "github").conectado, true);
  assert.equal(jsonA.conectores.find((c: { id: string }) => c.id === "gmail").conectado, false);
  semVazamento(listaA.body);
  assert.equal(JSON.stringify(jsonA).includes(CLIENT_ID), false);

  conta = "conta-b";
  const listaB = await app.inject({ method: "GET", url: "/api/conectores" });
  assert.equal(listaB.json().conectores.find((c: { id: string }) => c.id === "github").conectado, false);
  semVazamento(listaB.body);

  const apagaB = await app.inject({ method: "DELETE", url: "/api/conectores/github" });
  assert.equal(apagaB.statusCode, 200);
  conta = "conta-a";
  const aindaA = await app.inject({ method: "GET", url: "/api/conectores" });
  assert.equal(aindaA.json().conectores.find((c: { id: string }) => c.id === "github").conectado, true);

  const { state, nonce } = novoEstadoOAuth("conta-b", "github", undefined, SEGREDO);
  const cruzado = await app.inject({
    method: "GET",
    url: `/api/conectores/oauth/callback?code=codigo-falso&state=${encodeURIComponent(state)}`,
    headers: { cookie: `mybots_conector_nonce=${encodeURIComponent(nonce)}` },
  });
  assert.equal(cruzado.statusCode, 403);
  semVazamento(cruzado.body);
  assert.equal(fetchChamadas, 0);

  const estado = lerEstadoOAuth(state, SEGREDO);
  assert.ok(estado);
  const { state: stateA, nonce: nonceA } = novoEstadoOAuth("conta-a", "github", undefined, SEGREDO);
  const ok = await app.inject({
    method: "GET",
    url: `/api/conectores/oauth/callback?code=codigo-falso&state=${encodeURIComponent(stateA)}`,
    headers: { cookie: `mybots_conector_nonce=${encodeURIComponent(nonceA)}` },
  });
  assert.equal(ok.statusCode, 302);
  const locOk = String(ok.headers.location);
  assert.match(locOk, /conectores=ok/);
  semVazamento(locOk + ok.body);
  assert.equal(fetchChamadas, 1);

  conta = "conta-b";
  await app.inject({
    method: "POST",
    url: "/api/conectores/github/chave",
    headers: { "content-type": "application/json" },
    payload: { chave: TOKEN_B },
  });
  await app.inject({
    method: "POST",
    url: "/api/conectores/bitwarden/chave",
    headers: { "content-type": "application/json" },
    payload: { chave: TOKEN_BW },
  });

  const auths: string[] = [];
  const deB = await conectores.chamar({
    contaId: "conta-b",
    aplicativo: "github",
    ferramenta: "search",
    fetchImpl: async (_url, init) => {
      auths.push(String((init?.headers as Record<string, string>).authorization));
      return new Response(JSON.stringify({ result: { content: [{ type: "text", text: `eco ${TOKEN_B}` }] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(deB.ok, true);
  if (deB.ok) semVazamento(deB.texto);
  assert.deepEqual(auths, [`Bearer ${TOKEN_B}`]);

  const semFetch = await conectores.chamar({
    contaId: "conta-a",
    aplicativo: "bitwarden",
    ferramenta: "list",
    fetchImpl: async () => { throw new Error("nao devia sair o " + TOKEN_BW); },
  });
  assert.equal(semFetch.ok, false);
  if (!semFetch.ok) semVazamento(semFetch.erro);

  const outro = await conectores.chamar({
    contaId: "conta-b",
    aplicativo: "gmail",
    ferramenta: "list",
    fetchImpl: async () => { throw new Error("gmail de A " + TOKEN_A); },
  });
  assert.equal(outro.ok, false);
  if (!outro.ok) semVazamento(outro.erro);

  db.close();
  const disco = fs.readFileSync(arquivo);
  semVazamento(disco.toString("utf8"));
  semVazamento(disco.toString("latin1"));
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
