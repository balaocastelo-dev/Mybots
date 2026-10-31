// Cofre: cifra, permissão negada por padrão, o modelo não recebe o valor, redação de chave.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { WebSocketServer } from "ws";
import { needsHumanApproval, redigirSegredos, textoExigeChefe, tipoDeAprovacao } from "@mybots/shared";
import { Db } from "../packages/hub/src/db.ts";
import { Cofre } from "../packages/hub/src/cofre.ts";
import { registrarCofre } from "../packages/hub/src/cofreRotas.ts";
import { expressaoDoCampo, preencherNoNavegador } from "../packages/hub/src/cofreCdp.ts";
import { chaveDeMaterial, cifrar, decifrar } from "../packages/hub/src/cofreCripto.ts";
import { motivoDaQueda } from "../packages/hub/src/diagnostico.ts";
import { redigir, registrarSegredo } from "../packages/hub/src/redacao.ts";
import { personaDoCofre } from "../packages/hub/src/botManager.ts";

const SENHA = "SuperSenha-Unica-9911";
const NUMERO = "4111111111114242";
const CVV = "7371";
const NOTAS = "anotacao-secreta-do-cofre-88";
const CHAVE_URL = "AIzaSyTESTE1234567890ABCDEF";

test("cifra e decifra com AES-256-GCM, e cifra adulterada não abre", () => {
  const chave = randomBytes(32);
  const blob = cifrar(chave, SENHA);
  assert.notEqual(blob, SENHA);
  assert.equal(decifrar(chave, blob), SENHA);
  assert.notEqual(cifrar(chave, SENHA), blob, "cada cifra tem IV novo");
  const outra = randomBytes(32);
  assert.throws(() => decifrar(outra, blob), /não consegui decifrar/);
  const cru = Buffer.from(blob.slice(3), "base64");
  cru[cru.length - 1] ^= 0x01;
  assert.throws(() => decifrar(chave, "v1:" + cru.toString("base64")), /não consegui decifrar/);
  assert.equal(chaveDeMaterial("curta"), null);
  const daFrase = chaveDeMaterial("frase-longa-do-cofre");
  assert.equal(daFrase?.length, 32);
  const hex = randomBytes(32).toString("hex");
  assert.equal(chaveDeMaterial(hex)?.equals(Buffer.from(hex, "hex")), true);
});

test("redação tira chave da URL, Bearer, cofre e variável do .env", () => {
  const url = `HTTP 401 de https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?key=${CHAVE_URL}: {"error":"API key not valid"}`;
  const limpo = redigirSegredos(url + " Authorization: Bearer sk-ant-api03-testeSecreto123456 gsk_testeSegredoGroq123456 xai-testeSegredoXai123456");
  assert.doesNotMatch(limpo, /AIzaSy/);
  assert.doesNotMatch(limpo, /sk-ant-/);
  assert.doesNotMatch(limpo, /gsk_teste/);
  assert.doesNotMatch(limpo, /xai-teste/);
  assert.match(limpo, /key=\*\*\*/);
  assert.match(limpo, /Bearer \*\*\*/);

  process.env.MYBOTS_TESTE_TOKEN_COFRE = "valor-secreto-do-env-123456";
  registrarSegredo(SENHA);
  registrarSegredo(NUMERO);
  registrarSegredo(CVV);
  try {
    const texto = redigir(`falhou ${SENHA} e valor-secreto-do-env-123456 e ${CHAVE_URL}`);
    assert.doesNotMatch(texto, /SuperSenha/);
    assert.doesNotMatch(texto, /valor-secreto-do-env/);
    assert.doesNotMatch(texto, /AIzaSy/);
  } finally {
    delete process.env.MYBOTS_TESTE_TOKEN_COFRE;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-queda-"));
  fs.writeFileSync(path.join(dir, "node.log"), url + "\n");
  const queda = motivoDaQueda(dir);
  assert.equal(queda.classe, "chave-recusada");
  assert.doesNotMatch(queda.trecho, /AIzaSy/);
  assert.doesNotMatch(JSON.stringify(queda), new RegExp(CHAVE_URL));
});

test("pagar e enviar continuam pedindo o chefe, até no modo deus", () => {
  assert.equal(needsHumanApproval("deus", "pagamento", "low"), true);
  assert.equal(needsHumanApproval("deus", "publicacao", "low"), true);
  assert.equal(needsHumanApproval("deus", "action", "high"), false);
  assert.equal(tipoDeAprovacao("pagar o boleto de 200"), "pagamento");
  assert.equal(tipoDeAprovacao("enviar o e-mail ao cliente"), "pagamento");
  assert.equal(textoExigeChefe("preencher o cartão no checkout"), false);
  assert.match(personaDoCofre("Loja"), /fill_credential/);
  assert.match(personaDoCofre("Loja"), /não clica|NÃO é/i);
});

test("API, permissão negada e o modelo nunca recebe o valor", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-cofre-"));
  const arquivo = path.join(dir, "cofre.sqlite");
  const banco = new Db(arquivo);
  const cofre = new Cofre(banco.sqlite, { chave: randomBytes(32) });
  const app = Fastify({ logger: false });
  registrarCofre(app, { cofre } as any);

  const status = await app.inject({ method: "GET", url: "/api/cofre/status" });
  assert.equal(status.json().ativo, true);

  const criado = await app.inject({
    method: "POST", url: "/api/cofre/itens",
    payload: { tipo: "login", nome: "Loja", site: "https://loja.exemplo/login", usuario: "ana", senha: SENHA, notas: NOTAS },
  });
  assert.equal(criado.statusCode, 200);
  const login = criado.json();
  assert.equal(login.tipo, "login");
  assert.equal(login.usuario, "ana");
  assert.equal(login.senhaMascarada, "••••••••");
  assert.equal(JSON.stringify(login).includes(SENHA), false);
  assert.equal(JSON.stringify(login).includes(NOTAS), false);
  assert.equal("senha" in login, false);
  assert.equal("notas" in login, false);

  const cartao = (await app.inject({
    method: "POST", url: "/api/cofre/itens",
    payload: { tipo: "cartao", nome: "Visa da loja", titular: "Ana Silva", numero: NUMERO, validade: "12/30", cvv: CVV },
  })).json();
  assert.equal(cartao.tipo, "cartao");
  assert.equal(cartao.finalNumero, "4242");
  assert.equal(cartao.validade, "12/30");
  assert.equal(cartao.titular, "Ana Silva");
  assert.equal(JSON.stringify(cartao).includes(NUMERO), false);
  assert.equal(JSON.stringify(cartao).includes(CVV), false);

  const cru = fs.readFileSync(arquivo);
  assert.equal(cru.includes(SENHA), false, "a senha apareceu no banco");
  assert.equal(cru.includes(NUMERO), false, "o número apareceu no banco");
  assert.equal(cru.includes(CVV), false, "o cvv apareceu no banco");

  const lista = (await app.inject({ method: "GET", url: "/api/cofre/itens?busca=loja&tipo=login" })).json();
  assert.equal(lista.length, 1);
  assert.equal(JSON.stringify(lista).includes(SENHA), false);

  const perm0 = (await app.inject({ method: "GET", url: `/api/cofre/itens/${login.id}/permissoes` })).json();
  assert.deepEqual(perm0, { botIds: [] });

  let digitou = false;
  const negado = await cofre.preencher({
    botId: "atendente", empresaId: "loja", site: "loja.exemplo", campo: "senha",
    portaDe: async () => ({ porta: 9401 }),
    digitar: async () => { digitou = true; return { ok: true }; },
  });
  assert.equal(negado, "erro: sem permissão");
  assert.equal(digitou, false, "sem permissão não pode chegar no navegador");
  assert.equal(negado.includes(SENHA), false);

  const editado = (await app.inject({
    method: "PUT", url: `/api/cofre/itens/${login.id}`,
    payload: { nome: "Loja nova" },
  })).json();
  assert.equal(editado.nome, "Loja nova");
  assert.equal(editado.senhaMascarada, "••••••••");
  assert.equal(JSON.stringify(editado).includes(SENHA), false);

  await app.inject({
    method: "PUT", url: `/api/cofre/itens/${login.id}/permissoes`,
    payload: { botIds: ["atendente"] },
  });
  let recebido = "";
  const ok = await cofre.preencher({
    botId: "atendente", empresaId: "loja", site: "https://www.loja.exemplo/conta", campo: "senha",
    portaDe: async () => ({ porta: 9401 }),
    digitar: async (p) => { recebido = p.valor; return { ok: true }; },
  });
  assert.equal(ok, "ok");
  assert.equal(recebido, SENHA, "o navegador recebe o valor");
  assert.equal(ok.includes(SENHA), false, "o modelo não recebe o valor");

  recebido = "";
  const estourou = await cofre.preencher({
    botId: "atendente", empresaId: "loja", site: "loja.exemplo", campo: "senha",
    portaDe: async () => ({ porta: 9401 }),
    digitar: async (p) => { throw new Error(`o campo rejeitou ${p.valor}`); },
  });
  assert.match(estourou, /^erro:/);
  assert.equal(estourou.includes(SENHA), false, "erro do navegador não devolve a senha");

  let cartaoDigitado = "";
  await app.inject({
    method: "PUT", url: `/api/cofre/itens/${cartao.id}/permissoes`,
    payload: { botIds: ["atendente"] },
  });
  const okCartao = await cofre.preencher({
    botId: "atendente", empresaId: "loja", site: "checkout.outra.com", campo: "numero",
    portaDe: async () => ({ porta: 9401 }),
    digitar: async (p) => { cartaoDigitado = p.valor; return { ok: true }; },
  });
  assert.equal(okCartao, "ok");
  assert.equal(cartaoDigitado, NUMERO);
  assert.equal(okCartao.includes(NUMERO), false);

  const aud = (await app.inject({ method: "GET", url: `/api/cofre/auditoria?itemId=${login.id}` })).json() as any[];
  assert.ok(aud.some((l) => l.resultado === "negado" && l.quem === "atendente"));
  assert.ok(aud.some((l) => l.acao === "preencher" && l.resultado === "ok"));
  assert.equal(JSON.stringify(aud).includes(SENHA), false);
  assert.equal(JSON.stringify(aud).includes(NOTAS), false);

  const apagou = await app.inject({ method: "DELETE", url: `/api/cofre/itens/${login.id}` });
  assert.equal(apagou.json().ok, true);

  const log = [
    "=== COFRE demonstração ===",
    "status: ativo",
    `login criado: ${login.senhaMascarada} usuario=${login.usuario} site=${login.site}`,
    `cartão criado: final ${cartao.finalNumero} validade ${cartao.validade} titular ${cartao.titular}`,
    "bot atendente, sem permissão: erro: sem permissão",
    "navegador chamado sem permissão: não",
    "depois de liberar, resposta ao modelo: ok",
    `erro quando o navegador falha: ${estourou}`,
    "auditoria (sem valor):",
    ...aud.map((l) => `- ${new Date(l.quando).toISOString()} quem=${l.quem} acao=${l.acao} resultado=${l.resultado} detalhe=${l.detalhe ?? ""}`),
    `redação da chave que vazava na URL: ${redigirSegredos("HTTP 401 de https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=" + CHAVE_URL)}`,
    "=== fim ===",
  ].join("\n");
  assert.equal(log.includes(SENHA), false);
  assert.equal(log.includes(NUMERO), false);
  assert.equal(log.includes(CVV), false);
  assert.equal(log.includes(CHAVE_URL), false);
  console.log("\n" + log + "\n");
  fs.writeFileSync("/tmp/cofre-demo.log", log + "\n");

  await app.close();
});

test("sem chave o cofre fica desativado e a API diz o motivo", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-cofre-off-"));
  const banco = new Db(path.join(dir, "off.sqlite"));
  const cofre = new Cofre(banco.sqlite, { chave: null });
  const app = Fastify({ logger: false });
  registrarCofre(app, { cofre } as any);
  const st = (await app.inject({ method: "GET", url: "/api/cofre/status" })).json();
  assert.equal(st.ativo, false);
  assert.match(st.motivo, /desativado|chave/i);
  const lista = await app.inject({ method: "GET", url: "/api/cofre/itens" });
  assert.equal(lista.statusCode, 503);
  assert.match(lista.json().error, /desativado|chave/i);
  const resposta = await cofre.preencher({ botId: "a", empresaId: null, site: "x", campo: "senha" });
  assert.match(resposta, /^erro:/);
  assert.equal(resposta.includes(SENHA), false);
  await app.close();
});

test("CDP preenche o campo e não devolve o valor, nem clica em pagar", async () => {
  assert.equal((await preencherNoNavegador(8787, "loja.exemplo", "senha", SENHA)).ok, false);
  assert.equal((await preencherNoNavegador(8791, "loja.exemplo", "senha", SENHA)).ok, false);
  assert.doesNotMatch(expressaoDoCampo("senha"), new RegExp(SENHA));
  new Function("return " + expressaoDoCampo("senha"));

  const porta = await portaNaFaixa();
  const metodos: string[] = [];
  const expressoes: string[] = [];
  let valor = "";
  const server = http.createServer((req, res) => {
    if ((req.url ?? "").startsWith("/json/list")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([{
        type: "page",
        url: "https://loja.exemplo/login",
        webSocketDebuggerUrl: `ws://127.0.0.1:${porta}/devtools/page/ABC`,
      }]));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      metodos.push(String(m.method));
      if (m.method === "Runtime.evaluate") {
        const expr = String(m.params?.expression ?? "");
        expressoes.push(expr);
        if (expr.includes("const campo")) {
          ws.send(JSON.stringify({ id: m.id, result: { result: { type: "boolean", value: true } } }));
        } else if (expr.includes("querySelector(")) {
          ws.send(JSON.stringify({ id: m.id, result: { result: { type: "object", objectId: "el1" } } }));
        } else {
          ws.send(JSON.stringify({ id: m.id, result: { result: { value: true } } }));
        }
        return;
      }
      if (m.method === "Runtime.callFunctionOn") {
        valor = String(m.params?.arguments?.[0]?.value ?? "");
        ws.send(JSON.stringify({ id: m.id, result: { result: { type: "object", value: { ok: true, vazou: valor } } } }));
        return;
      }
      ws.send(JSON.stringify({ id: m.id, result: {} }));
    });
  });
  await new Promise<void>((ok) => server.listen(porta, "127.0.0.1", () => ok()));
  try {
    const r = await preencherNoNavegador(porta, "loja.exemplo", "senha", SENHA);
    assert.deepEqual(r, { ok: true });
    assert.equal(JSON.stringify(r).includes(SENHA), false);
    assert.equal(valor, SENHA);
    assert.ok(metodos.every((m) => m === "Runtime.evaluate" || m === "Runtime.callFunctionOn"), `clicou ou navegou: ${metodos.join(",")}`);
    assert.ok(expressoes.every((e) => !e.includes(SENHA)), "a expressão do CDP carregou a senha");
  } finally {
    await new Promise((ok) => server.close(() => ok(null)));
    wss.close();
  }
});

function portaNaFaixa(): Promise<number> {
  return new Promise((resolve, reject) => {
    const tentar = (p: number) => {
      if (p > 9490) return reject(new Error("sem porta livre na faixa do navegador"));
      if (p === 8787 || p === 8791) return tentar(p + 1);
      const s = net.createServer();
      s.once("error", () => tentar(p + 1));
      s.listen(p, "127.0.0.1", () => s.close(() => resolve(p)));
    };
    tentar(9401);
  });
}
