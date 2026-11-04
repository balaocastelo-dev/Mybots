import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  buscarPaginaBot,
  extrairFichaDoHtml,
  limparTituloOg,
  planoDeImportacao,
  receitaInicialPorNome,
  registrarRotaImportarLink,
  validarUrlBotX,
  type PlanoImportacao,
} from "../packages/hub/src/importarLink.ts";
import { filtrarBotsPorUsuario } from "../packages/hub/src/isolamento.ts";
import type { Usuario } from "../packages/hub/src/usuarios.ts";
import { acharLinkBotX } from "../packages/ui/src/linkBot.ts";

const HTML = `<!doctype html><html><head>
<meta property="og:title" content="Director by Balão"/>
<meta property="og:description" content="Seu diretor de vídeo: transforma briefings em anúncios, vídeos curtos, explicativos, clipes musicais e micro-dramas, do roteiro ao MP4 final."/>
<meta property="og:image" content="https://x.ai/bot/jSCXcQoyWa04Fgh3uTK-X/opengraph-image-bntnog?e81aaf2c58b21051"/>
</head><body>
<div style="--share-accent:#FF9800;--share-blob-0:#fff7eb">
<span style="--share-coat-light:#FFAF38;--share-coat-dark:#FF9800"></span>
</div></body></html>`;

const HTML_SEO = `<meta property="og:title" content="SEO &amp; AEO Desk by X"/>
<meta property="og:description" content="Descobre o que as pessoas pesquisam."/>
<meta property="og:image" content="https://x.ai/bot/seoExemplo/capa.png"/>
<style>:root{--share-accent:#2255aa;--share-coat-light:#ddeeff;--share-coat-dark:#112233}</style>`;

const EXEMPLO = "https://x.ai/bot/jSCXcQoyWa04Fgh3uTK-X";

function usuario(id: string, role: "owner" | "cliente"): Usuario {
  return { id, email: id + "@ex.com", name: id, role, googleSub: null, createdAt: 1, lastLoginAt: null };
}

test("limpa o sufixo by do título", () => {
  assert.equal(limparTituloOg("Director by Balão"), "Director");
  assert.equal(limparTituloOg("Director by X"), "Director");
  assert.equal(limparTituloOg("PROGRAMADOR"), "PROGRAMADOR");
  assert.equal(limparTituloOg("SEO & AEO Desk"), "SEO & AEO Desk");
  assert.equal(limparTituloOg("Director | by Balão"), "Director");
  assert.equal(limparTituloOg("Foo — por Bar"), "Foo");
});

test("parser lê og e as cores do HTML de exemplo", () => {
  const f = extrairFichaDoHtml(HTML);
  assert.ok(!("erro" in f));
  if ("erro" in f) return;
  assert.equal(f.nome, "Director");
  assert.match(f.descricao, /diretor de vídeo/);
  assert.equal(f.avatar, "https://x.ai/bot/jSCXcQoyWa04Fgh3uTK-X/opengraph-image-bntnog?e81aaf2c58b21051");
  assert.equal(f.cor, "#FF9800");
  assert.equal(f.cores.accent, "#FF9800");
  assert.equal(f.cores.coatLight, "#FFAF38");
  assert.equal(f.cores.coatDark, "#FF9800");
  assert.equal(f.receitaId, "director");
});

test("nome conhecido usa a receita da equipe inicial", () => {
  assert.equal(receitaInicialPorNome("Director"), "director");
  assert.equal(receitaInicialPorNome("PROGRAMADOR"), "programador-pro");
  assert.equal(receitaInicialPorNome("SEO & AEO Desk"), "seo-aeo-desk");
  assert.equal(receitaInicialPorNome("Recepcionista"), null);

  const diretor = extrairFichaDoHtml(HTML);
  assert.ok(!("erro" in diretor));
  if ("erro" in diretor) return;
  const plano = planoDeImportacao(diretor, {
    idExterno: "jSCXcQoyWa04Fgh3uTK-X",
    url: EXEMPLO,
    existe: () => false,
    empresaId: "casa",
  });
  assert.match(plano.persona, /diretor de vídeo/);
  assert.match(plano.persona, /Fluxo de produção/);
  assert.equal(plano.receitaId, "director");

  const outro = planoDeImportacao(
    { nome: "Recepcionista", descricao: "Atende o telefone.", avatar: null, cor: null, cores: { accent: null, coatLight: null, coatDark: null }, receitaId: null },
    { idExterno: "abc", url: "https://x.ai/bot/abc", existe: () => false, empresaId: "casa", receita: null },
  );
  assert.match(outro.persona, /Atende o telefone/);
  assert.doesNotMatch(outro.persona, /Fluxo de produção/);

  const seo = extrairFichaDoHtml(HTML_SEO);
  assert.ok(!("erro" in seo));
  if ("erro" in seo) return;
  assert.equal(seo.nome, "SEO & AEO Desk");
  assert.equal(seo.receitaId, "seo-aeo-desk");
  assert.equal(seo.cores.coatLight, "#ddeeff");
  const planoSeo = planoDeImportacao(seo, { idExterno: "seo", url: "https://x.ai/bot/seo", existe: () => false, empresaId: "casa" });
  assert.match(planoSeo.persona, /Briefing pro redator|primeiros passos/i);
});

test("validação de domínio só aceita https://x.ai/bot/<id>", () => {
  assert.equal(validarUrlBotX(EXEMPLO).ok, true);
  assert.equal(validarUrlBotX(EXEMPLO + "/").ok, true);
  if (validarUrlBotX(EXEMPLO).ok) assert.equal(validarUrlBotX(EXEMPLO).id, "jSCXcQoyWa04Fgh3uTK-X");
  const ruins = [
    "http://x.ai/bot/abc",
    "https://evil.com/bot/abc",
    "https://x.ai.evil.com/bot/abc",
    "https://x.ai/bot/abc/extra",
    "https://user:pass@x.ai/bot/abc",
    "https://x.ai/bot/abc?x=1",
    "https://x.ai/bot/abc#x",
    "https://169.254.169.254/bot/abc",
    "https://x.ai/bot/../admin",
    "https://x.ai/other/abc",
    "javascript:alert(1)",
    "https://x.ai/bot/",
    "https://x.ai/bot/id com espaço",
  ];
  for (const u of ruins) {
    const r = validarUrlBotX(u);
    assert.equal(r.ok, false, u);
  }
});

test("busca não segue redirect para outro domínio e recusa IP privado", async () => {
  let chamadas = 0;
  const redirect = await buscarPaginaBot(EXEMPLO, {
    resolver: async () => ["1.1.1.1"],
    fetchImpl: (async () => {
      chamadas += 1;
      return new Response(null, { status: 302, headers: { location: "https://evil.example/bot/abc" } });
    }) as typeof fetch,
  });
  assert.equal(redirect.ok, false);
  if (!redirect.ok) assert.match(redirect.erro, /redirect/);
  assert.equal(chamadas, 1);

  let foi = false;
  const privado = await buscarPaginaBot(EXEMPLO, {
    resolver: async () => ["127.0.0.1"],
    fetchImpl: (async () => { foi = true; return new Response("no"); }) as typeof fetch,
  });
  assert.equal(privado.ok, false);
  assert.equal(foi, false);

  const grande = await buscarPaginaBot(EXEMPLO, {
    resolver: async () => ["1.1.1.1"],
    fetchImpl: (async () => new Response("x", { status: 200, headers: { "content-type": "text/html", "content-length": "2000000" } })) as typeof fetch,
  });
  assert.equal(grande.ok, false);
  if (!grande.ok) assert.match(grande.erro, /1 MB/);
});

test("tenant: o bot fica do usuário logado e o outro cliente não vê", async () => {
  const donoA = usuario("user-a", "cliente");
  const donoB = usuario("user-b", "cliente");
  const owner = usuario("owner", "owner");
  const criados: PlanoImportacao[] = [];
  const app = Fastify({ logger: false });
  registrarRotaImportarLink(app, {
    authOnlineAtivo: () => true,
    usuarioDoReq: (req) => {
      const id = String(req.headers["x-user"] || "");
      if (id === "user-a") return donoA;
      if (id === "user-b") return donoB;
      if (id === "owner") return owner;
      return null;
    },
    nodeAuthorized: () => null,
    existe: (id) => criados.some((c) => c.id === id),
    empresaDe: () => "casa",
    criar: async (plano) => {
      criados.push(plano);
      return { id: plano.id, name: plano.nome };
    },
    buscar: async () => ({ ok: true, html: HTML, url: EXEMPLO, id: "jSCXcQoyWa04Fgh3uTK-X" }),
  });

  const sem = await app.inject({ method: "POST", url: "/api/bots/importar-link", payload: { url: EXEMPLO, modo: "preview" } });
  assert.equal(sem.statusCode, 401);

  const previa = await app.inject({
    method: "POST",
    url: "/api/bots/importar-link",
    headers: { "x-user": "user-a" },
    payload: { url: EXEMPLO, modo: "preview", ownerUserId: "user-b" },
  });
  assert.equal(previa.statusCode, 200);
  assert.equal(previa.json().nome, "Director");
  assert.equal(previa.json().receitaConhecida, "director");
  assert.equal(criados.length, 0);

  const ruim = await app.inject({
    method: "POST",
    url: "/api/bots/importar-link",
    headers: { "x-user": "user-a" },
    payload: { url: "https://evil.example/bot/abc", modo: "confirmar" },
  });
  assert.equal(ruim.statusCode, 400);
  assert.equal(criados.length, 0);

  const okA = await app.inject({
    method: "POST",
    url: "/api/bots/importar-link",
    headers: { "x-user": "user-a" },
    payload: { url: EXEMPLO, modo: "confirmar", ownerUserId: "user-b" },
  });
  assert.equal(okA.statusCode, 200);
  assert.equal(okA.json().ownerUserId, "user-a");
  assert.equal(criados[0].ownerUserId, "user-a");
  assert.match(criados[0].persona, /Fluxo de produção/);

  const okB = await app.inject({
    method: "POST",
    url: "/api/bots/importar-link",
    headers: { "x-user": "user-b" },
    payload: { url: EXEMPLO, modo: "confirmar" },
  });
  assert.equal(okB.statusCode, 200);
  assert.equal(okB.json().ownerUserId, "user-b");
  assert.notEqual(okB.json().id, okA.json().id);

  const lista = criados.map((p) => ({ id: p.id, ownerUserId: p.ownerUserId }));
  const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id).sort();
  assert.deepEqual(ids(filtrarBotsPorUsuario(lista, donoA)), [okA.json().id]);
  assert.deepEqual(ids(filtrarBotsPorUsuario(lista, donoB)), [okB.json().id]);
  assert.deepEqual(ids(filtrarBotsPorUsuario(lista, owner, "meus")), []);
  assert.deepEqual(ids(filtrarBotsPorUsuario(lista, owner, "clientes")), ids(lista));
  await app.close();
});

test("cola de link no chat reconhece só x.ai/bot", () => {
  assert.equal(acharLinkBotX("https://x.ai/bot/jSCXcQoyWa04Fgh3uTK-X"), EXEMPLO);
  assert.equal(acharLinkBotX("  https://x.ai/bot/abc/  "), "https://x.ai/bot/abc");
  assert.equal(acharLinkBotX("olha https://evil.com/bot/abc"), null);
  assert.equal(acharLinkBotX("sem link"), null);
});
