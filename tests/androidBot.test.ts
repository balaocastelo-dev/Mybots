// Celular Android por bot: aparelho real na rede, tela em /android/<id>/.
// O pareamento é exercitado com um adb falso. O Hub de teste não fala com aparelho nenhum.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import {
  aparelhosDe, ipDeAparelho, PareamentoAndroid, portaValida, semSegredo, validarPareamento,
  type AdbFn, type CadastroAndroid,
} from "../packages/hub/src/androidBot.ts";
import {
  argumentosDoServidorScrcpy, argumentosWhatsapp, avccDe, classificarCabecalho, descricaoDeH264,
  i16DoScroll, mensagemToque, URL_WHATSAPP,
} from "../packages/hub/src/androidScrcpy.ts";
import { argumentosDocker, avaliarFallback, nomeDoContainerAndroid } from "../packages/hub/src/androidFallback.ts";
import { avisarAndroid, limparProvedoresAndroid, listarProvedoresAndroid, registrarProvedorAndroid, relatoDoAndroid, resolverAlvoAndroid } from "../packages/hub/src/android.ts";
import { PRIORIDADE_APARELHO, PRIORIDADE_REDROID, provedorAparelho, provedorRedroid, type FonteDoProvedor } from "../packages/hub/src/androidProvedor.ts";
import { htmlDaTela } from "../packages/hub/src/androidPlayer.ts";
import { caminhoNoAndroid, idDoAndroid, portaAndroidPermitida } from "../packages/hub/src/ponteAndroid.ts";
import { TelasAndroid } from "../packages/hub/src/androidStream.ts";

test("o pedido de pareamento exige IP local, portas livres e código de 6 dígitos", () => {
  assert.equal(ipDeAparelho("192.168.15.20"), true);
  assert.equal(ipDeAparelho("10.0.0.4"), true);
  assert.equal(ipDeAparelho("127.0.0.1"), true);
  assert.equal(ipDeAparelho("8.8.8.8"), false);
  assert.equal(ipDeAparelho("192.168.15.999"), false);
  assert.equal(portaValida(8787).ok, false);
  assert.equal(portaValida(8791).ok, false);
  assert.equal(portaValida(37123).ok, true);

  const ruim = validarPareamento({ ip: "8.8.8.8", porta: 37123, codigo: "123456" });
  assert.equal(ruim.ok, false);
  const proibida = validarPareamento({ ip: "192.168.15.20", porta: 8787, codigo: "123456" });
  assert.equal(proibida.ok, false);
  if (!proibida.ok) assert.match(proibida.erro, /8787/);
  const outra = validarPareamento({ ip: "192.168.15.20", porta: 37123, codigo: "123456", portaConexao: 8791 });
  assert.equal(outra.ok, false);
  const curto = validarPareamento({ ip: "192.168.15.20", porta: 37123, codigo: "12345" });
  assert.equal(curto.ok, false);
  const ok = validarPareamento({ ip: "192.168.15.20", porta: "37123", codigo: "123 456", portaConexao: "42111" });
  assert.deepEqual(ok, { ok: true, ip: "192.168.15.20", porta: 37123, codigo: "123456", portaConexao: 42111 });
  assert.equal(semSegredo("Failed 654321", "654321").includes("654321"), false);
});

test("pair usa adb pair e adb connect, abre o WhatsApp Web e não guarda o código", async () => {
  const chamadas: string[][] = [];
  const guardado: CadastroAndroid[] = [];
  const adb: AdbFn = async (args) => {
    chamadas.push(args);
    if (args[0] === "pair") return { ok: true, saida: "Successfully paired to 192.168.15.20:37123" };
    if (args[0] === "connect") return { ok: true, saida: "connected to 192.168.15.20:42111" };
    if (args[0] === "devices") return { ok: true, saida: "List of devices attached\n192.168.15.20:42111 device\n" };
    if (args.includes("am")) return { ok: true, saida: "Starting: Intent { dat=https://web.whatsapp.com }" };
    return { ok: true, saida: "" };
  };
  const p = new PareamentoAndroid({
    adb,
    ler: () => guardado[0] ?? null,
    gravar: (_id, c) => { if (c) guardado[0] = c; },
    agora: () => 1000,
  });
  const r = await p.parear("bia", { ip: "192.168.15.20", porta: 37123, codigo: "654321", portaConexao: 42111 });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(chamadas[0], ["pair", "192.168.15.20:37123", "654321"]);
  assert.deepEqual(chamadas[1], ["connect", "192.168.15.20:42111"]);
  const chrome = chamadas.find((c) => c.includes("am"));
  assert.ok(chrome);
  assert.equal(chrome.includes(URL_WHATSAPP), true);
  assert.equal(chrome.includes("com.android.chrome/com.google.android.apps.chrome.Main"), true);
  assert.equal(JSON.stringify(guardado).includes("654321"), false);
  assert.equal(guardado[0].serial, "192.168.15.20:42111");
  assert.equal(guardado[0].modo, "aparelho");
  const st = await p.status("bia");
  assert.deepEqual(st, { conectado: true, cadastrado: true });
  assert.deepEqual(aparelhosDe("List of devices attached\n192.168.15.20:42111 offline\n"), [{ serial: "192.168.15.20:42111", estado: "offline" }]);
});

test("sem portaConexao o pareamento acha a porta de conexão no mdns, e código errado não vaza", async () => {
  const chamadas: string[][] = [];
  const adb: AdbFn = async (args) => {
    chamadas.push(args);
    if (args[0] === "pair") return { ok: true, saida: "Successfully paired" };
    if (args[0] === "mdns") return { ok: true, saida: "poco _adb-tls-connect._tcp 192.168.15.20:42111\npoco _adb-tls-pairing._tcp 192.168.15.20:37123\n" };
    if (args[0] === "connect") return { ok: true, saida: "connected to 192.168.15.20:42111" };
    return { ok: true, saida: "Starting: Intent" };
  };
  const p = new PareamentoAndroid({ adb, ler: () => null, gravar: () => {} });
  const r = await p.parear("bia", { ip: "192.168.15.20", porta: 37123, codigo: "654321" });
  assert.equal(r.ok, true);
  assert.deepEqual(chamadas[2], ["connect", "192.168.15.20:42111"]);

  const ruim = new PareamentoAndroid({
    adb: async () => ({ ok: false, saida: "Failed: 654321" }),
    ler: () => null,
    gravar: () => { throw new Error("não devia gravar"); },
  });
  const f = await ruim.parear("bia", { ip: "192.168.15.20", porta: 40000, codigo: "654321", portaConexao: 40001 });
  assert.equal(f.ok, false);
  if (!f.ok) assert.equal(f.erro.includes("654321"), false);

  const antes = chamadas.length;
  const porta = await new PareamentoAndroid({
    adb: async (args) => { chamadas.push(args); return { ok: false, saida: "não" }; },
    ler: () => null,
    gravar: () => {},
  }).parear("bia", { ip: "192.168.15.20", porta: 8787, codigo: "654321" });
  assert.equal(porta.ok, false);
  assert.equal(chamadas.length, antes);
});

test("o protocolo da tela é o scrcpy 5, H.264, sem áudio, e o toque tem 32 bytes", () => {
  const args = argumentosDoServidorScrcpy();
  assert.equal(args.includes("5.0.1"), true);
  assert.equal(args.includes("audio=false"), true);
  assert.equal(args.includes("tunnel_forward=true"), true);
  assert.equal(args.includes("video_codec=h264"), true);
  const w = argumentosWhatsapp("192.168.15.20:42111");
  assert.equal(w.includes(URL_WHATSAPP), true);
  assert.equal(w.some((a) => /login|send|wa\.me/i.test(a)), false);

  const toque = mensagemToque(0, 10, 20, 1080, 2400);
  assert.equal(toque.length, 32);
  assert.equal(toque[0], 2);
  assert.equal(toque[1], 0);
  assert.equal(toque.readBigInt64BE(2), -2n);
  assert.equal(toque.readInt32BE(10), 10);
  assert.equal(toque.readUInt16BE(22), 0xffff);
  assert.equal(i16DoScroll(1), 2048);

  const sessao = Buffer.alloc(12);
  sessao[0] = 0x80;
  sessao.writeUInt32BE(1080, 4);
  sessao.writeUInt32BE(2400, 8);
  assert.deepEqual(classificarCabecalho(sessao), { tipo: "sessao", largura: 1080, altura: 2400 });
  const quadro = Buffer.alloc(12);
  quadro.writeBigUInt64BE(1n << 62n, 0);
  quadro.writeUInt32BE(9, 8);
  const c = classificarCabecalho(quadro);
  assert.equal(c && c.tipo === "quadro" && c.config && c.tamanho === 9, true);

  const sps = Buffer.from([0x67, 0x42, 0x00, 0x1e, 0xaa]);
  const pps = Buffer.from([0x68, 0xce, 0x06, 0xe2]);
  const annex = Buffer.concat([Buffer.from([0, 0, 0, 1]), sps, Buffer.from([0, 0, 0, 1]), pps]);
  const desc = descricaoDeH264(annex);
  assert.ok(desc);
  assert.equal(desc.codec, "avc1.42001e");
  assert.equal(desc.avcC[0], 1);
  const frame = Buffer.concat([Buffer.from([0, 0, 0, 1]), Buffer.from([0x65, 0x88, 0x84])]);
  const avcc = avccDe(frame);
  assert.ok(avcc);
  assert.equal(avcc.readUInt32BE(0), 3);
  assert.equal(avcc[4], 0x65);
});

test("redroid e emulador não são o caminho do Windows nem deste kernel sem binder", () => {
  const win = avaliarFallback({ plataforma: "win32", wsl: true, docker: true, binder: false, ashmem: false, kvm: false });
  assert.equal(win.redroid.serve, false);
  assert.equal(win.emulador.serve, false);
  assert.match(win.redroid.motivo, /WSL2|binder/i);

  const linuxSem = avaliarFallback({ plataforma: "linux", wsl: false, docker: true, binder: false, ashmem: false, kvm: true });
  assert.equal(linuxSem.redroid.serve, false);
  assert.equal(linuxSem.emulador.serve, true);

  const redroidOk = avaliarFallback({ plataforma: "linux", wsl: false, docker: true, binder: true, ashmem: false, kvm: false });
  assert.equal(redroidOk.redroid.serve, true);
  assert.equal(redroidOk.emulador.serve, false);

  const semDocker = avaliarFallback({ plataforma: "linux", wsl: false, docker: false, binder: true, ashmem: true, kvm: true });
  assert.equal(semDocker.redroid.serve, false);
  assert.equal(semDocker.emulador.serve, false);

  assert.equal(nomeDoContainerAndroid("bia"), "mybots-android-bia");
  const run = argumentosDocker("redroid", "bia", 8501);
  assert.equal(run.includes("127.0.0.1:8501:5555"), true);
  assert.equal(run.includes("mybots-android-bia"), true);
  assert.equal(run.some((a) => a.includes("0.0.0.0")), false);
  assert.throws(() => argumentosDocker("emulador", "bia", 8787));
  assert.throws(() => argumentosDocker("redroid", "bia", 8791));
});

test("o caminho /android/<bot>/ tira a senha e não escolhe host", () => {
  assert.equal(idDoAndroid("/android/bia/"), "bia");
  assert.equal(idDoAndroid("/android/bia/ws?k=segredo"), "bia");
  assert.equal(caminhoNoAndroid("/android/bia/"), "/");
  assert.equal(caminhoNoAndroid("/android/bia/ws?k=segredo&x=1"), "/ws?x=1");
  assert.equal(caminhoNoAndroid("/android/bia/../etc/passwd"), null);
  assert.equal(idDoAndroid("/pc/bia/"), null);
  assert.equal(portaAndroidPermitida(8787), false);
  assert.equal(portaAndroidPermitida(8791), false);
  assert.equal(portaAndroidPermitida(8201), true);
  const html = htmlDaTela("bia");
  assert.match(html, /WhatsApp Web/);
  assert.match(html, /https:\/\/web\.whatsapp\.com/);
  assert.match(html, /data-stream="android"/);
  assert.equal(html.includes("654321"), false);
});

test("o aparelho registra prioridade acima do redroid e o registro chama aoLigarPc", async () => {
  limparProvedoresAndroid();
  const chamadas: string[] = [];
  const cadastro: CadastroAndroid = {
    modo: "aparelho", ip: "192.168.15.20", portaConexao: 42111, serial: "192.168.15.20:42111", pareadoEm: 50,
  };
  const fonte: FonteDoProvedor = {
    cadastro: () => cadastro,
    conectado: async () => false,
    uso: () => 50,
    reconectar: async () => { chamadas.push("reconectar"); },
    abrirWhatsapp: async () => { chamadas.push("whats"); },
    pararTela: () => { chamadas.push("parar"); },
    subirFallback: async () => { chamadas.push("fallback"); },
  };
  registrarProvedorAndroid(provedorRedroid(fonte));
  registrarProvedorAndroid(provedorAparelho(fonte));
  assert.deepEqual(listarProvedoresAndroid().map((p) => p.id), ["aparelho", "redroid"]);
  assert.ok(PRIORIDADE_APARELHO > PRIORIDADE_REDROID);
  const alvo = await resolverAlvoAndroid("bia");
  assert.equal(alvo?.tipo, "aparelho");
  if (alvo?.tipo === "aparelho") assert.equal(alvo.porta, 42111);
  const relato = await relatoDoAndroid("bia");
  assert.equal(relato.estado, "desligado");
  assert.equal(relato.porta, 42111);
  assert.equal(chamadas.includes("fallback"), false);
  await avisarAndroid("ligar", "bia");
  assert.deepEqual(chamadas, ["reconectar"]);
  await avisarAndroid("desligar", "bia");
  assert.equal(chamadas.at(-1), "parar");

  limparProvedoresAndroid();
  registrarProvedorAndroid({
    id: "aparelho",
    prioridade: PRIORIDADE_APARELHO,
    resolver: async () => ({ tipo: "aparelho", serial: "192.168.15.9:8787", host: "192.168.15.9", porta: 8787 }),
  });
  registrarProvedorAndroid({
    id: "redroid",
    prioridade: PRIORIDADE_REDROID,
    resolver: async () => ({ tipo: "container", nome: "mybots-android-bia", host: "127.0.0.1", porta: 5555 }),
    relatar: async () => ({ estado: "ligado", porta: 8787 }),
  });
  const pulou = await resolverAlvoAndroid("bia");
  assert.equal(pulou?.tipo, "container");
  const relatoPorta = await relatoDoAndroid("bia");
  assert.equal(relatoPorta.porta, null);
  limparProvedoresAndroid();
  assert.deepEqual(listarProvedoresAndroid(), []);
});

test("a página da tela sobe só em 127.0.0.1 e avisa quando não há aparelho", async () => {
  const telas = new TelasAndroid({
    ler: () => null,
    adb: async () => ({ ok: true, saida: "" }),
    adbBin: () => null,
    servidorScrcpy: () => null,
    abrirWhatsapp: async () => ({ ok: true, saida: "" }),
  });
  const porta = await telas.portaDe("bia");
  assert.ok(porta >= 8201 && porta <= 8400);
  assert.notEqual(porta, 8787);
  assert.notEqual(porta, 8791);
  try {
    const res = await fetch(`http://127.0.0.1:${porta}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /web\.whatsapp\.com/);
    const msg = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${porta}/ws`);
      const t = setTimeout(() => { ws.close(); reject(new Error("sem aviso")); }, 3000);
      ws.on("message", (d) => { clearTimeout(t); ws.close(); resolve(String(d)); });
      ws.on("error", (e) => { clearTimeout(t); reject(e); });
    });
    const j = JSON.parse(msg);
    assert.equal(j.tipo, "aviso");
    assert.match(j.texto, /paread/i);
  } finally {
    telas.pararTudo();
  }
});

const PORT = 18794;
const SENHA = "senha-android-teste";
const raiz = path.resolve(import.meta.dirname, "..");

test("o Hub publica o contrato e a tela em /android/<botId>/", { timeout: 40_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-android-"));
  fs.mkdirSync(path.join(tmp, "bots"), { recursive: true });
  const hubDir = path.join(raiz, "packages/hub");
  let log = "";
  const hub: ChildProcess = spawn(process.execPath, ["--import", "tsx", path.join(hubDir, "src/index.ts")], {
    cwd: hubDir,
    env: {
      ...process.env,
      MYBOTS_HUB_HOST: "127.0.0.1",
      MYBOTS_HUB_PORT: String(PORT),
      MYBOTS_HUB_TOKEN: "token-teste-android",
      MYBOTS_UI_PASSWORD: SENHA,
      MYBOTS_DB: path.join(tmp, "hub.sqlite"),
      MYBOTS_BOTS_DIR: path.join(tmp, "bots"),
      MYBOTS_UI_DIST: path.join(tmp, "sem-ui"),
      TELEGRAM_BOT_TOKEN: "",
      MYBOTS_ANDROID_FALLBACK: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  hub.stdout?.on("data", (d) => { log += d.toString(); });
  hub.stderr?.on("data", (d) => { log += d.toString(); });
  const base = `http://127.0.0.1:${PORT}`;
  const matar = () => { try { hub.kill("SIGTERM"); } catch { /* já saiu */ } };
  const chave = `?k=${encodeURIComponent(SENHA)}`;

  try {
    const fim = Date.now() + 20_000;
    let noAr = false;
    while (Date.now() < fim) {
      try {
        const r = await fetch(`${base}/api/health${chave}`);
        if (r.ok) { noAr = true; break; }
      } catch { /* ainda subindo */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(noAr, true, "o hub de teste não subiu\n" + log.split(SENHA).join("***").slice(-800));

    const semSenha = await fetch(`${base}/api/bots/bia/android/status`);
    assert.equal(semSenha.status, 401);
    const telaSem = await fetch(`${base}/android/bia/`);
    assert.equal(telaSem.status, 401);

    const require = createRequire(path.join(hubDir, "package.json"));
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(path.join(tmp, "hub.sqlite"));
    const def = { id: "bia", name: "Bia", role: "teste", autoStart: false, createdAt: Date.now(), engine: "direct", provider: { kind: "ollama", model: "qwen3:14b" } };
    db.prepare(`INSERT INTO managed_bots (id, def, created_at) VALUES (?, ?, ?)`).run("bia", JSON.stringify(def), def.createdAt);
    db.close();

    const sumiu = await fetch(`${base}/api/bots/nao-existe/android/status${chave}`);
    assert.equal(sumiu.status, 404);
    const corpoSumiu = await sumiu.json() as { ok: boolean; erro?: string };
    assert.equal(corpoSumiu.ok, false);

    const st = await fetch(`${base}/api/bots/bia/android/status${chave}`);
    assert.equal(st.status, 200);
    assert.deepEqual(await st.json(), { conectado: false, cadastrado: false });

    const par = await fetch(`${base}/api/bots/bia/android/pair${chave}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ip: "192.168.15.20", porta: 8787, codigo: "654321", portaConexao: 42111 }),
    });
    assert.equal(par.status, 200);
    const corpoPar = await par.json() as { ok: boolean; erro?: string };
    assert.equal(corpoPar.ok, false);
    assert.match(corpoPar.erro ?? "", /8787/);
    assert.equal(JSON.stringify(corpoPar).includes("654321"), false);

    const semProvedor = await fetch(`${base}/android/bia/${chave}`);
    assert.equal(semProvedor.status, 503);
    const corpoSem = await semProvedor.json() as { error?: string };
    assert.match(corpoSem.error ?? "", /provedor/);

    const dbTela = new Database(path.join(tmp, "hub.sqlite"));
    dbTela.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(
      "android.bot.bia",
      JSON.stringify({ modo: "aparelho", ip: "192.168.15.20", portaConexao: 42111, serial: "192.168.15.20:42111", pareadoEm: 1 }),
      Date.now(),
    );
    dbTela.close();

    const pagina = await fetch(`${base}/android/bia/${chave}`);
    const html = await pagina.text();
    if (pagina.status !== 200) {
      throw new Error(`tela ${pagina.status} corpo=${JSON.stringify(html).slice(0, 600)} tipo=${pagina.headers.get("content-type")}`);
    }
    assert.match(html, /data-stream="android"/);
    assert.match(html, /https:\/\/web\.whatsapp\.com/);
    assert.equal(html.toLowerCase().includes("welcome to nginx"), false);

    const aviso = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/android/bia/ws${chave}`);
      const t = setTimeout(() => { try { ws.close(); } catch { /* ok */ } reject(new Error("a tela não falou")); }, 4000);
      ws.on("message", (d) => { clearTimeout(t); try { ws.close(); } catch { /* ok */ } resolve(String(d)); });
      ws.on("error", () => { /* o status vem em unexpected-response */ });
      ws.on("unexpected-response", (_q, res) => { clearTimeout(t); res.resume(); reject(new Error("ws " + res.statusCode)); });
    });
    const j = JSON.parse(aviso);
    assert.equal(j.tipo, "aviso");
    assert.match(j.texto, /192\.168\.15\.20:42111|paread|Depuração/i);
  } finally {
    matar();
  }
});


test("usarConectado grava aparelho ja listado no adb", async () => {
  const gravados: any[] = [];
  const adb = async (args: string[]) => {
    if (args[0] === "devices") {
      return { ok: true, saida: "List of devices attached\n192.168.15.5:5555 device product:mondrian model:23013PC75G\n", codigo: 0 };
    }
    return { ok: true, saida: "", codigo: 0 };
  };
  const p = new PareamentoAndroid({
    adb,
    ler: () => null,
    gravar: (_id, c) => { gravados.push(c); },
  });
  const r = await p.usarConectado("salada", "192.168.15.5:5555");
  assert.equal(r.ok, true);
  assert.equal(gravados[0].serial, "192.168.15.5:5555");
  assert.equal(gravados[0].ip, "192.168.15.5");
  assert.equal(gravados[0].portaConexao, 5555);
  assert.equal(gravados[0].modo, "aparelho");
});

test("usarConectado recusa serial ausente do adb", async () => {
  const p = new PareamentoAndroid({
    adb: async () => ({ ok: true, saida: "List of devices attached\n", codigo: 0 }),
    ler: () => null,
    gravar: () => {},
  });
  const r = await p.usarConectado("salada", "192.168.0.9:5555");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /não está conectado/i);
});
