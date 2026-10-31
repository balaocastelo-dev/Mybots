// Colaboração: prioridade, limites, auditoria e o portão de aprovação.
// Não sobe o teste de ponta a ponta da delegação (isso é de outro PR).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { PROTOCOL_VERSION } from "@mybots/shared";
import { Hub } from "../packages/hub/src/hub.ts";
import { config } from "../packages/hub/src/config.ts";
import { registrarRotasColab } from "../packages/hub/src/colab/rotas.ts";
import {
  PROFUNDIDADE_MAXIMA, TAXA_POR_PAR, checarColab, classificarAcaoSensivel,
  mensagemLiberaEnvioExterno, resetarContadoresColab,
} from "../packages/hub/src/colab/seguranca.ts";
import { registrarAoParar } from "../packages/hub/src/colab/parar.ts";
import { textoComRecadosDeBots } from "../packages/node/src/recados.ts";

function soquete() {
  const ouvintes = new Map<string, (raw: { toString(): string }) => void>();
  const enviados: any[] = [];
  const ws: any = {
    readyState: 1,
    OPEN: 1,
    send(s: string) { enviados.push(JSON.parse(s)); },
    on(ev: string, fn: (raw: { toString(): string }) => void) { ouvintes.set(ev, fn); },
    close() {},
  };
  return {
    ws, enviados,
    receber(msg: unknown) { ouvintes.get("message")?.({ toString: () => JSON.stringify(msg) }); },
  };
}

function conectar(hub: Hub, id: string, name: string) {
  const s = soquete();
  hub.handleNodeConnection(s.ws);
  s.receber({
    type: "hello", protocol: PROTOCOL_VERSION, token: config.hubToken || "dev",
    bot: { id, name, role: "teste" }, engine: "direct", provider: "mock", model: "m", version: "0",
  });
  return s;
}

test("colaboração: prioridade, segurança, auditoria e parar", async () => {
  resetarContadoresColab();
  assert.equal(PROFUNDIDADE_MAXIMA, 3);
  assert.equal(mensagemLiberaEnvioExterno("humano"), true);
  assert.equal(mensagemLiberaEnvioExterno("user"), false);
  assert.equal(mensagemLiberaEnvioExterno("pixel"), false);
  assert.equal(mensagemLiberaEnvioExterno(undefined), false);
  assert.equal(classificarAcaoSensivel("whatsapp", { acao: "enviar" }, ""), "envio");
  assert.equal(classificarAcaoSensivel("whatsapp", { acao: "estado" }, ""), null);
  assert.equal(classificarAcaoSensivel("email", {}, "Enviar e-mail para ana"), "envio");
  assert.equal(classificarAcaoSensivel("gerenciar_bot", { acao: "excluir" }, ""), "exclusao");
  assert.equal(classificarAcaoSensivel("gerenciar_bot", { acao: "parar" }, ""), null);
  assert.equal(classificarAcaoSensivel("action", { action: "pagar o boleto" }, "pagar o boleto"), "pagamento");
  assert.equal(classificarAcaoSensivel("celular", { acao: "tocar", texto: "confirmar pagamento" }, "tocar confirmar pagamento"), "pagamento");

  assert.deepEqual(checarColab({ de: "a", para: "b", tipo: "mensagem", profundidade: 3 }), { ok: true });
  const fundo = checarColab({ de: "a", para: "b", tipo: "tarefa", profundidade: 4 });
  assert.equal(fundo.ok, false);
  if (!fundo.ok) assert.equal(fundo.motivo, "profundidade");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-colab-"));
  const hub = new Hub(path.join(dir, "hub.sqlite"));
  hub.db.ensureManagedTable();
  resetarContadoresColab();
  const pixel = conectar(hub, "pixel", "Pixel");
  const gerente = conectar(hub, "gerente", "Gerente");
  conectar(hub, "vendas", "Vendas");
  const ui = soquete();
  hub.handleUiConnection(ui.ws);
  ui.receber({ type: "subscribe" });

  hub.db.saveEmpresa({ id: "escola", nome: "Escola" });
  hub.db.saveEmpresa({ id: "loja", nome: "Loja" });
  hub.db.setEmpresaDoBot("pixel", "Pixel", "escola");
  hub.db.setEmpresaDoBot("gerente", "Gerente", "escola");
  hub.db.setEmpresaDoBot("vendas", "Vendas", "loja");

  const app = Fastify({ logger: false });
  registrarRotasColab(app, hub);

  const sem = await app.inject({
    method: "POST", url: "/api/colab/mensagens",
    payload: { de: "gerente", para: "pixel", texto: "fica para depois", prioridade: false },
  });
  assert.equal(sem.statusCode, 200);
  const idSem = (sem.json() as { id: string }).id;
  const adiada = pixel.enviados.filter((m) => m.type === "message" && m.adiada && m.messageId === idSem);
  assert.equal(adiada.length, 1, "sem prioridade não acorda: vai como recado adiado");
  assert.equal(adiada[0].from.kind, "bot");
  assert.equal(adiada[0].from.id, "gerente");
  assert.equal(adiada[0].silent, true);
  assert.equal(pixel.enviados.some((m) => m.type === "message" && m.messageId === idSem && !m.adiada), false);

  pixel.enviados.length = 0;
  const com = await app.inject({
    method: "POST", url: "/api/colab/mensagens",
    payload: { de: "gerente", para: "pixel", texto: "acorda agora", prioridade: true, contexto: "banner" },
  });
  assert.equal(com.statusCode, 200);
  const idCom = (com.json() as { id: string }).id;
  const acordou = pixel.enviados.find((m) => m.type === "message" && m.messageId === idCom);
  assert.ok(acordou, "com prioridade o destinatário recebe um turno");
  assert.equal(acordou.adiada, undefined);
  assert.equal(acordou.from.kind, "bot");
  assert.match(acordou.text, /acorda agora/);
  assert.match(acordou.text, /banner/);
  assert.equal(hub.colab.autorDe("pixel"), "gerente");

  const evento = ui.enviados.find((e) => e.type === "colab" && e.tipo === "colab.mensagem" && e.id === idCom);
  assert.ok(evento);
  assert.equal(evento.prioridade, true);
  assert.equal(evento.de, "gerente");
  assert.equal(evento.para, "pixel");

  const texto = textoComRecadosDeBots(
    { fromKind: "user", fromName: "humano", text: "manda ver" },
    [{ nome: "Gerente", texto: "fica para depois" }],
  );
  assert.match(texto, /\[Mensagem do Bot Gerente\]/);
  assert.doesNotMatch(texto, /\[Mensagem do humano\]|Você disse/);
  assert.match(texto, /manda ver/);

  const conversas = await app.inject({ method: "GET", url: "/api/colab/conversas?bot=pixel" });
  const lista = conversas.json() as Array<{ id: string; bots: string[]; ultimaEm: number }>;
  assert.ok(lista.some((c) => c.id === "pair:gerente:pixel" && c.bots.includes("pixel") && c.bots.includes("gerente")));
  const msgs = await app.inject({ method: "GET", url: "/api/colab/conversas/pair:gerente:pixel/mensagens" });
  const gravadas = msgs.json() as Array<{ autor: string; texto: string }>;
  assert.ok(gravadas.every((m) => m.autor === "gerente"));
  assert.equal(gravadas.some((m) => m.autor === "humano" || m.autor === "user"), false);

  const cruzado = await app.inject({
    method: "POST", url: "/api/colab/mensagens",
    payload: { de: "vendas", para: "pixel", texto: "arte da loja", prioridade: true },
  });
  assert.equal(cruzado.statusCode, 403);
  assert.equal((cruzado.json() as { motivo: string }).motivo, "empresa");
  const liberada = await app.inject({
    method: "PUT", url: "/api/colab/permissoes-empresa",
    payload: { de: "loja", para: "escola", liberado: true },
  });
  assert.equal(liberada.statusCode, 200);
  const deNovo = await app.inject({
    method: "POST", url: "/api/colab/mensagens",
    payload: { de: "vendas", para: "pixel", texto: "agora pode", prioridade: false },
  });
  assert.equal(deNovo.statusCode, 200);

  resetarContadoresColab();
  let taxa = 0;
  for (let i = 0; i < TAXA_POR_PAR + 1; i++) {
    const r = await app.inject({
      method: "POST", url: "/api/colab/mensagens",
      payload: { de: "gerente", para: "pixel", texto: "ping " + i, prioridade: false },
    });
    if (r.statusCode === 403) {
      taxa++;
      assert.equal((r.json() as { motivo: string }).motivo, "taxa");
    }
  }
  assert.equal(taxa, 1);

  const botPara = await app.inject({
    method: "POST", url: "/api/colab/parar",
    payload: { de: "pixel", alvo: "todos" },
  });
  assert.equal(botPara.statusCode, 403);
  assert.equal((botPara.json() as { motivo: string }).motivo, "aprovacao");
  assert.equal(ui.enviados.some((e) => e.type === "colab" && e.tipo === "colab.parar"), false);

  const paradas: string[] = [];
  const soltar = registrarAoParar((e) => { if (e.por === "humano") paradas.push(e.alvo === "todos" ? "todos" : e.alvo.join(",")); });
  pixel.enviados.length = 0;
  const humanoPara = await app.inject({
    method: "POST", url: "/api/colab/parar",
    payload: { de: "humano", alvo: ["pixel"] },
  });
  assert.equal(humanoPara.statusCode, 200);
  assert.equal(paradas[0], "pixel");
  soltar();
  assert.ok(ui.enviados.some((e) => e.type === "colab" && e.tipo === "colab.parar" && e.por === "humano"));
  assert.ok(pixel.enviados.some((m) => m.type === "colab.parar"));
  assert.ok(pixel.enviados.some((m) => m.type === "abort"));

  hub.db.insertApproval({
    id: "ap-email", botId: "pixel", conversationId: "dm:pixel", tool: "email",
    input: { para: "a@b.c" }, risk: "high", description: "Enviar e-mail", createdAt: Date.now(),
  });
  const recusa = hub.responderAprovacao("ap-email", true, false, "gerente");
  assert.equal(recusa.ok, false);
  if (!recusa.ok) assert.equal(recusa.motivo, "aprovacao");
  assert.equal(hub.db.pendingApprovals().some((a) => a.id === "ap-email"), true);
  assert.equal(hub.db.temAprovacaoHumana("pixel", "email"), false);
  const okHumano = hub.responderAprovacao("ap-email", true, false, undefined);
  assert.equal(okHumano.ok, true);
  assert.equal(hub.db.temAprovacaoHumana("pixel", "email"), true);

  hub.colab.anotarAutor("pixel", "gerente");
  const semHumano = hub.liberarAcaoSensivel("pixel", "email", {}, "Enviar e-mail para o cliente");
  assert.equal(semHumano.ok, false);
  hub.colab.anotarAutor("pixel", "humano");
  const comHumano = hub.liberarAcaoSensivel("pixel", "email", {}, "Enviar e-mail para o cliente");
  assert.equal(comHumano.ok, true);

  const aud = await app.inject({ method: "GET", url: "/api/colab/auditoria?bot=gerente" });
  const linhas = aud.json() as Array<{ action: string }>;
  assert.ok(linhas.some((l) => l.action === "colab.mensagem" || l.action === "colab.bloqueio"));

  await app.close();
});
