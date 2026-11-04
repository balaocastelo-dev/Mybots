import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gmailConfirmado } from "../packages/hub/src/gmailTela.ts";
import { Nascimento, motivoLimpo, type EstadoNascimento, type DepsNascimento } from "../packages/hub/src/nascimento.ts";
import { WhatsAppDosBots, pastaDaSessao, type SockMinimo } from "../packages/hub/src/whatsappBot.ts";
import { classificarAcaoSensivel } from "../packages/hub/src/colab/seguranca.ts";

const SENHA = "S3nh@NaoPodeVazar";

function memoria() {
  const estados = new Map<string, EstadoNascimento>();
  const falas: string[] = [];
  let urls: string[] = [];
  let abrirOk = false;
  let conectado = false;
  let numero: string | undefined;
  let agora = 1_700_000_000_000;
  const deps: DepsNascimento = {
    falar: (_id, texto) => { falas.push(texto); },
    ler: (id) => estados.get(id),
    gravar: (e) => { estados.set(e.botId, structuredClone(e)); },
    listar: () => [...estados.values()],
    abrirGmail: async () => abrirOk
      ? { ok: true, motivo: "Login do Gmail aberto na tela do PC." }
      : { ok: false, motivo: "A tela do PC não respondeu." },
    urls: async () => urls,
    conectarWhats: async () => { conectado = conectado; },
    whatsConectado: () => conectado,
    numeroWhats: () => numero,
    agora: () => agora,
  };
  return {
    deps,
    falas,
    estados,
    setUrls: (u: string[]) => { urls = u; },
    setAbrir: (v: boolean) => { abrirOk = v; },
    setConectado: (v: boolean, n?: string) => { conectado = v; numero = n; },
    avancar: (ms: number) => { agora += ms; },
  };
}

test("Gmail só confirma a caixa de entrada", () => {
  assert.equal(gmailConfirmado("https://accounts.google.com/ServiceLogin?service=mail"), false);
  assert.equal(gmailConfirmado("https://accounts.google.com/signin/v2/challenge/pwd"), false);
  assert.equal(gmailConfirmado(`https://accounts.google.com/signin?password=${SENHA}`), false);
  assert.equal(gmailConfirmado(`https://mail.google.com/mail/u/0/?password=${SENHA}#inbox`), false);
  assert.equal(gmailConfirmado("https://mail.google.com/mail/u/0/#inbox"), true);
  assert.equal(gmailConfirmado("https://mail.google.com/"), false);
});

test("nascimento cumprimenta, pede o Gmail e não marca feito sem a caixa", async () => {
  const m = memoria();
  m.setAbrir(true);
  const n = new Nascimento(m.deps);
  const e = await n.nascer({ id: "ana", nome: "Ana", funcao: "atendimento" });
  assert.match(m.falas[0], /Obrigado por me criar/);
  assert.match(m.falas[0], /Ana/);
  assert.match(m.falas.join("\n"), /1\. Gmail/);
  assert.equal(e.gmail, "aberto");
  assert.equal(e.whatsapp, "pendente");
  assert.equal(m.falas.some((t) => /WhatsApp/.test(t) && /QR/.test(t)), false);

  m.setUrls([`https://accounts.google.com/signin/v2/challenge/pwd?secret=${SENHA}`]);
  await n.conferirGmail("ana");
  assert.equal(m.estados.get("ana")?.gmail, "aberto");
  assert.equal(JSON.stringify([...m.estados.values(), ...m.falas]).includes(SENHA), false);

  m.setUrls(["https://mail.google.com/mail/u/0/#inbox"]);
  const ok = await n.conferirGmail("ana");
  assert.equal(ok?.gmail, "ok");
  assert.equal(ok?.passo, "whatsapp");
  assert.match(m.falas.join("\n"), /Gmail confirmado/);
  assert.match(m.falas.join("\n"), /2\. WhatsApp/);
  assert.equal(ok?.whatsapp, "pendente");
  assert.equal(JSON.stringify([...m.estados.values(), ...m.falas]).includes(SENHA), false);
});

test("QR não conclui o WhatsApp; sessão aberta conclui, e só depois do Gmail", async () => {
  const m = memoria();
  m.setAbrir(false);
  const n = new Nascimento(m.deps);
  await n.nascer({ id: "bia", nome: "Bia" });
  n.aoWhats({ botId: "bia", estado: "qr" });
  n.aoWhats({ botId: "bia", estado: "conectado", numero: "5511999990000" });
  assert.equal(m.estados.get("bia")?.whatsapp, "pendente");
  assert.equal(m.estados.get("bia")?.gmail, "pendente");

  m.setUrls(["https://mail.google.com/mail/u/0/#inbox"]);
  m.setConectado(true, "5511999990000");
  const ok = await n.conferirGmail("bia");
  assert.equal(ok?.gmail, "ok");
  assert.equal(ok?.whatsapp, "ok");
  assert.equal(ok?.passo, "pronto");
  assert.match(m.falas.at(-1) ?? "", /WhatsApp conectado/);
  assert.match(m.falas.at(-1) ?? "", /14 dias/);
});

test("outras ferramentas só entram quando pedidas e não ficam feitas", async () => {
  const m = memoria();
  const n = new Nascimento(m.deps);
  await n.nascer({ id: "caio", nome: "Caio" });
  assert.equal(m.falas.some((t) => /telegram/i.test(t)), false);
  const r = await n.pedir("caio", "telegram", `avisar o cliente. senha: ${SENHA}`);
  assert.equal(r.ok, false);
  assert.equal(m.falas.some((t) => t.includes(SENHA)), false);
  const bom = await n.pedir("caio", "telegram", "avisar o cliente que o pedido chegou");
  assert.equal(bom.ok, true);
  assert.match(m.falas.at(-1) ?? "", /telegram/);
  assert.equal(m.estados.get("caio")?.gmail, "pendente");
  assert.equal(m.estados.get("caio")?.whatsapp, "pendente");
  assert.equal(JSON.stringify(m.estados.get("caio")).includes(SENHA), false);
  assert.equal(motivoLimpo(`conta@gmail.com ${SENHA}`).includes(SENHA), false);
});

test("sessão do WhatsApp fica na pasta do bot e ler/enviar usam essa sessão", async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "wa-bot-"));
  const enviados: Array<{ jid: string; texto: string }> = [];
  const handlers = new Map<string, Array<(u: any) => void>>();
  const sock = (): SockMinimo => ({
    ev: { on: (ev, fn) => { const l = handlers.get(ev) ?? []; l.push(fn); handlers.set(ev, l); } },
    user: { id: "5511988887777:1@s.whatsapp.net" },
    end: () => {},
    logout: async () => {},
    sendMessage: async (jid, msg) => { enviados.push({ jid, texto: msg.text }); },
    onWhatsApp: async (n) => [{ exists: true, jid: `${n}@s.whatsapp.net` }],
  });
  const eventos: string[] = [];
  const wa = new WhatsAppDosBots(raiz, (e) => eventos.push(e.estado), { fabrica: async (pasta) => {
    assert.equal(pasta, pastaDaSessao(raiz, "lia"));
    fs.writeFileSync(path.join(pasta, "creds.json"), "{}\n");
    return sock();
  } });
  assert.equal(pastaDaSessao(raiz, "lia"), path.join(raiz, "lia", "whatsapp"));
  assert.notEqual(pastaDaSessao(raiz, "lia"), pastaDaSessao(raiz, "teo"));

  await wa.conectar("lia");
  assert.equal(wa.estado("lia").estado, "conectando");
  await handlers.get("connection.update")?.[0]?.({ qr: "qr-de-teste" });
  assert.equal(wa.estado("lia").estado, "qr");
  assert.equal(wa.estado("lia").estado === "conectado", false);
  await handlers.get("connection.update")?.[0]?.({ connection: "open" });
  assert.equal(wa.estado("lia").estado, "conectado");
  assert.equal(wa.estado("lia").numero, "5511988887777");

  handlers.get("messages.upsert")?.[0]?.({ messages: [{ key: { id: "1", remoteJid: "5511977776666@s.whatsapp.net", fromMe: false }, message: { conversation: "tem peça?" }, messageTimestamp: 10 }] });
  const lidos = wa.ler("lia", 5);
  assert.equal(lidos.length, 1);
  assert.match(lidos[0].texto, /peça/);
  assert.equal(JSON.stringify(wa.estado("lia")).includes("peça"), false);

  const envio = await wa.enviar("lia", "11977776666", "tem sim");
  assert.equal(envio.ok, true);
  assert.equal(enviados[0].jid, "5511977776666@s.whatsapp.net");
  assert.equal(wa.salvas().includes("lia"), true);

  await wa.desligar("lia", true);
  assert.equal(wa.estado("lia").estado, "desligado");
  assert.equal(fs.existsSync(pastaDaSessao(raiz, "lia")), false);
  assert.equal(eventos.includes("conectado"), true);
});

test("enviar e ler do WhatsApp do bot passam no gate certo", () => {
  assert.equal(classificarAcaoSensivel("whatsapp_proprio", { acao: "enviar" }, ""), "envio");
  assert.equal(classificarAcaoSensivel("whatsapp_proprio", { acao: "ler" }, ""), null);
  assert.equal(classificarAcaoSensivel("whatsapp_proprio", { acao: "estado" }, ""), null);
  assert.equal(classificarAcaoSensivel("pedir_conexao", { ferramenta: "telegram" }, ""), null);
});
