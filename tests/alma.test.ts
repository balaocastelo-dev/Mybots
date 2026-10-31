import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chamarCorretor } from "../packages/soul-bank/src/adaptadores/corretorDoFuturo.ts";
import { tratar } from "../packages/soul-bank/src/adaptadores/stdio.ts";
import { auditar, carregarAlmas, itemPorId, textoProibido } from "../packages/soul-bank/src/catalogo.ts";
import { materializar, prepararNascimento } from "../packages/soul-bank/src/nascer.ts";
import { mcpsDaAlma, textoDaAlma } from "../packages/node/src/almaPrompt.ts";

test("o banco fecha: pin, checksum e nenhuma alma solta", () => {
  const erros = auditar();
  assert.deepEqual(erros, [], erros.join("\n"));
});

test("pins oficiais conferidos contra os repositórios", () => {
  assert.equal(itemPorId("github.mcp-server")?.commit, "b98d115bbb080e9555466a96656ec4df605aea21");
  assert.equal(itemPorId("github.mcp-server")?.versao, "2.0.3");
  assert.equal(itemPorId("github.mcp-server")?.checksums?.["linux-x64"], "f797c20fe02a755865d0e2d46184ab47e31bf1619b0855b8d89c531e45a651c2");
  assert.equal(itemPorId("microsoft.playwright-mcp")?.versao, "0.0.84");
  assert.equal(itemPorId("microsoft.playwright-mcp")?.integridade, "sha512-weqLrA7/D8MJzNV9/t3Hnjp100tS2sxFXKeb2gH6Nhktqmdfvx5qRA9AZ5Mhjnre1jY0wltsrRK5VZS5NBgcvw==");
  assert.equal(itemPorId("microsoft.playwright-mcp")?.commit, "be26c080edfae7c761db1e757c4aff9f6453b4d7");
  assert.equal(itemPorId("modelcontextprotocol.fetch")?.commit, "194cc86e3ae6400958555bd4116849d822d69263");
  assert.equal(itemPorId("modelcontextprotocol.fetch")?.versao, "2026.10.28");
  assert.equal(itemPorId("anthropics.mcp-builder")?.commit, "ca45fc496a3436251f191354091d557da31c15b5");
  assert.equal(itemPorId("vercel.react-best-practices")?.commit, "1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62");
  assert.equal(itemPorId("meta.whatsapp-business-tools")?.url, "https://mcp.facebook.com/whatsapp_business_tools");
  assert.equal(itemPorId("bling.mcp")?.url, "https://mcp.bling.com.br/mcp");
  assert.equal(itemPorId("bling.mcp")?.padrao, false);
});

test("financeiro não nasce no Bling e o atendente não nasce no WhatsApp Web", () => {
  const almas = carregarAlmas();
  const financeiro = almas.find((a) => a.id === "financeiro");
  assert.deepEqual(financeiro?.mcps, ["balao-sistema"]);
  assert.equal(almas.some((a) => a.mcps.includes("bling.mcp")), false);
  const atendente = almas.find((a) => a.id === "atendente-whatsapp");
  assert.ok(atendente?.mcps.includes("meta.whatsapp-business-tools"));
  assert.ok(textoProibido("npx @whiskeysockets/baileys"));
  assert.equal(textoProibido("somente-whiskeysockets"), "whiskeysockets");
  assert.equal(textoProibido("https://mcp.facebook.com/whatsapp_business_tools"), null);
});

test("ação destrutiva sem confirmação não nasce; professor de inglês nasce", () => {
  const sem = prepararNascimento({ almaId: "atendente-whatsapp" });
  assert.equal(sem.ok, false);
  if (!sem.ok) assert.match(sem.erro, /confirmarAlma/);
  const com = prepararNascimento({ almaId: "atendente-whatsapp", confirmar: true });
  assert.equal(com.ok, true);
  const aula = prepararNascimento({ almaId: "professor-ingles" });
  assert.equal(aula.ok, true);
  if (aula.ok && aula.plano) assert.match(aula.plano.persona, /professor de inglês/i);
  const bling = prepararNascimento({ almaId: "financeiro", opcionais: ["bling.mcp"] });
  assert.equal(bling.ok, false);
  const blingOk = prepararNascimento({ almaId: "financeiro", opcionais: ["bling.mcp"], confirmar: true });
  assert.equal(blingOk.ok, true);
  if (blingOk.ok && blingOk.plano) {
    assert.deepEqual(blingOk.plano.mcps.map((m) => m.id).sort(), ["balao-sistema", "bling.mcp"]);
  }
});

test("nascer grava skills e o manifesto sem segredo", () => {
  const r = prepararNascimento({ almaId: "financeiro", confirmar: true });
  assert.equal(r.ok, true);
  if (!r.ok || !r.plano) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alma-"));
  materializar(r.plano, dir);
  const manifesto = fs.readFileSync(path.join(dir, "alma.json"), "utf8");
  assert.match(manifesto, /balao\.sistema\.token/);
  assert.doesNotMatch(manifesto, /sk-|ghp_|Bearer [A-Za-z0-9]{20}/);
  assert.equal(fs.existsSync(path.join(dir, "workspace", "skills", "financeiro-balao", "SKILL.md")), true);
  const mcp = JSON.parse(fs.readFileSync(path.join(dir, "alma-mcp.json"), "utf8"));
  assert.equal(mcp["balao-sistema"].url, "{env:BALAO_SISTEMA_URL}");
  assert.equal(mcp["bling.mcp"], undefined);
  const texto = textoDaAlma(path.join(dir, "workspace"));
  assert.match(texto, /balao-sistema/);
  assert.match(texto, /Não use o Bling/);
});

test("o leitor de MCP da alma recusa latest e WhatsApp Web", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alma-mcp-"));
  fs.mkdirSync(path.join(dir, "workspace"));
  fs.writeFileSync(path.join(dir, "alma-mcp.json"), JSON.stringify({
    bom: { type: "remote", url: "https://mcp.facebook.com/whatsapp_business_tools", enabled: true },
    ruim: { type: "local", command: ["npx", "baileys@latest"] },
    mybots: { type: "remote", url: "http://roubado" },
  }));
  const mcp = mcpsDaAlma(path.join(dir, "workspace"));
  assert.ok(mcp.bom);
  assert.equal(mcp.ruim, undefined);
  assert.equal(mcp.mybots, undefined);
});

test("adaptador do corretor não grava sem confirmação e não vaza o token", async () => {
  let chamadas = 0;
  const seco = await chamarCorretor({
    baseUrl: "https://api.exemplo.test/raiz",
    token: "super-segredo-do-cofre",
    operacao: "lead",
    entrada: { nome: "Ana", telefone: "19999990000" },
    fetchImpl: async () => { chamadas++; return new Response("{}"); },
  });
  assert.equal(seco.ok, false);
  if (!seco.ok) assert.equal(seco.precisaConfirmacao, true);
  assert.equal(chamadas, 0);
  assert.doesNotMatch(JSON.stringify(seco), /super-segredo/);

  const urls: string[] = [];
  const busca = await chamarCorretor({
    baseUrl: "https://api.exemplo.test/raiz",
    token: "super-segredo-do-cofre",
    operacao: "buscar",
    entrada: { q: "cambuí", bairro: "Cambuí" },
    fetchImpl: async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ imoveis: [] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(busca.ok, true);
  assert.equal(urls[0]?.startsWith("https://api.exemplo.test/raiz/v1/imoveis?"), true);
  const ruim = await chamarCorretor({
    baseUrl: "https://api.exemplo.test",
    token: "t",
    operacao: "detalhe",
    entrada: { id: "../admin" },
    fetchImpl: async () => { throw new Error("não era para chamar"); },
  });
  assert.equal(ruim.ok, false);

  const antes = chamadas;
  const rpc = await tratar({
    jsonrpc: "2.0", id: 7, method: "tools/call",
    params: { name: "criar_lead", arguments: { nome: "Ana", telefone: "19999990000" } },
  }, { baseUrl: "https://api.exemplo.test", token: "super-segredo-do-cofre", fetchImpl: async () => { chamadas++; return new Response("{}"); } });
  assert.match(JSON.stringify(rpc), /confirma/);
  assert.doesNotMatch(JSON.stringify(rpc), /super-segredo/);
  assert.equal(chamadas, antes);
});
