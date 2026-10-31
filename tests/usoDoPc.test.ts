// Quem está no PC da empresa: um PC só, compartilhado. A última ação de
// navegador ou de tela é o selo. O que foi digitado não entra no histórico.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hub } from "../packages/hub/src/hub.ts";
import { UsosDoPc, ferramentaDeTela, resumoDaAcao } from "../packages/hub/src/usoDoPc.ts";

test("ferramenta de tela: navegador e screenshot, com ou sem prefixo do motor", () => {
  assert.equal(ferramentaDeTela("navegador"), "navegador");
  assert.equal(ferramentaDeTela("screenshot"), "screenshot");
  assert.equal(ferramentaDeTela("mybots-local_navegador"), "navegador");
  assert.equal(ferramentaDeTela("mybots-local_screenshot"), "screenshot");
  assert.equal(ferramentaDeTela("ask_bot"), null);
  assert.equal(ferramentaDeTela("whatsapp"), null);
  assert.equal(ferramentaDeTela("mybots_ask_bot"), null);
});

test("resumo não guarda o texto digitado", () => {
  const r = resumoDaAcao("navegador", { acao: "digitar", texto: "senha-super-secreta", campo: "login" });
  assert.equal(r, "digitou num campo");
  assert.equal(JSON.stringify(r).includes("senha-super-secreta"), false);
  assert.match(resumoDaAcao("navegador", { acao: "abrir", url: "https://exemplo.com/portal" }), /abriu https:\/\/exemplo.com\/portal/);
  assert.equal(resumoDaAcao("screenshot", { caption: "a loja" }), "fotografou a tela");
});

test("um PC por empresa: o último bot é quem está usando, o outro histórico não mistura", () => {
  const usos = new UsosDoPc();
  const t0 = 1_700_000_000_000;
  assert.equal(usos.registrar("balao", { botId: "ana", nome: "Ana", ferramenta: "ask_bot", input: {}, quando: t0 }), null);

  const a = usos.registrar("balao", { botId: "ana", nome: "Ana", ferramenta: "navegador", input: { acao: "abrir", url: "https://fornecedor.exemplo" }, quando: t0 });
  assert.equal(a?.usando?.botId, "ana");
  assert.equal(a?.usando?.resumo, "abriu https://fornecedor.exemplo");

  const b = usos.registrar("balao", { botId: "bia", nome: "Bia", ferramenta: "screenshot", input: {}, quando: t0 + 1000 });
  assert.equal(b?.usando?.botId, "bia");
  assert.equal(b?.usando?.nome, "Bia");
  assert.equal(b?.historico.length, 2);
  assert.equal(b?.historico[0].botId, "bia");
  assert.equal(b?.historico[1].botId, "ana");

  const outra = usos.registrar("outra", { botId: "carla", nome: "Carla", ferramenta: "navegador", input: { acao: "ler" }, quando: t0 + 2000 });
  assert.equal(outra?.usando?.botId, "carla");
  assert.equal(usos.ver("balao").usando?.botId, "bia");
  assert.equal(usos.ver("balao").historico.some((x) => x.botId === "carla"), false);
  assert.equal(usos.ver("sem-ninguem").usando, null);
});

test("o histórico guarda no máximo as oito últimas", () => {
  const usos = new UsosDoPc();
  for (let i = 0; i < 10; i++) {
    usos.registrar("balao", { botId: "ana", nome: "Ana", ferramenta: "navegador", input: { acao: "ler" }, quando: 1000 + i });
  }
  const u = usos.ver("balao");
  assert.equal(u.historico.length, 8);
  assert.equal(u.historico[0].quando, 1009);
  assert.equal(u.historico.at(-1)?.quando, 1002);
});

test("no Hub, o selo segue a empresa do bot e o segredo digitado não vaza", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-uso-"));
  const hub = new Hub(path.join(dir, "hub.sqlite"));
  hub.db.ensureManagedTable();
  hub.db.saveEmpresa({ id: "balao", nome: "Balão" });
  hub.db.saveEmpresa({ id: "outra", nome: "Outra" });
  hub.db.setEmpresaDoBot("ana", "Ana", "balao");
  hub.db.setEmpresaDoBot("bia", "Bia", "balao");
  hub.db.setEmpresaDoBot("carla", "Carla", "outra");
  hub.db.setEmpresaDoBot("sistema", "Sistema", null);

  assert.equal(hub.anotarTela("ana", "ask_bot", { texto: "oi" }), null);
  assert.equal(hub.anotarTela("sistema", "navegador", { acao: "abrir", url: "https://exemplo.com" }), null);

  const a = hub.anotarTela("ana", "navegador", { acao: "abrir", url: "https://exemplo.com/pedido" });
  assert.equal(a?.usando?.botId, "ana");
  assert.equal(a?.usando?.nome, "Ana");

  const b = hub.anotarTela("bia", "mybots-local_screenshot", {});
  assert.equal(b?.usando?.botId, "bia");
  assert.equal(hub.usoDoPc("balao").historico.map((x) => x.botId).join(","), "bia,ana");

  hub.anotarTela("carla", "navegador", { acao: "ler" });
  assert.equal(hub.usoDoPc("balao").usando?.botId, "bia");
  assert.equal(hub.usoDoPc("outra").usando?.botId, "carla");

  const secreto = "senha-super-secreta";
  const d = hub.anotarTela("ana", "navegador", { acao: "digitar", texto: secreto });
  assert.equal(JSON.stringify(d).includes(secreto), false);
  assert.equal(JSON.stringify(hub.usoDoPc("balao")).includes(secreto), false);
  assert.equal(d?.usando?.botId, "ana");
  assert.match(d?.usando?.resumo ?? "", /digitou/);
});
