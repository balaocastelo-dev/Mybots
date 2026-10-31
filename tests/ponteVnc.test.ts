// A ponte da tela: allowlist fechada e a mesma senha da interface.
// Sem a senha, /ws/vnc, /pc/ e /tela-vnc.html respondem 401.
// Com a senha, só "mac" e "empresa:<id>" passam — e a empresa é sempre
// 127.0.0.1 numa porta da faixa 7901–8100. A 8787 não entra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { alvoDaPonte, caminhoDaTela, caminhoNoContainer, idDaTela, portaDeEmpresaPermitida } from "../packages/hub/src/ponteVnc.ts";
import { abrirWsDaTela, quadroWs } from "../packages/hub/src/ponteTela.ts";

const MAC = { host: "192.168.15.9", porta: 5900 };

test("destino da ponte: mac fixo, empresa no loopback, resto fechado", () => {
  assert.deepEqual(alvoDaPonte("mac", { mac: MAC }), MAC);
  assert.deepEqual(alvoDaPonte("", { mac: MAC }), MAC);
  assert.deepEqual(
    alvoDaPonte("empresa:balao", { mac: MAC, portaDaEmpresa: () => 7904 }),
    { host: "127.0.0.1", porta: 7904 },
  );
  assert.equal(alvoDaPonte("empresa:balao", { mac: MAC, portaDaEmpresa: () => null }), null);
  assert.equal(alvoDaPonte("empresa:balao", { mac: MAC, portaDaEmpresa: () => 8787 }), null);
  assert.equal(alvoDaPonte("empresa:balao", { mac: MAC, portaDaEmpresa: () => 22 }), null);
  assert.equal(alvoDaPonte("empresa:balao", { mac: MAC, portaDaEmpresa: () => 443 }), null);
  assert.equal(alvoDaPonte("empresa:balao", { mac: MAC, portaDaEmpresa: () => 5900 }), null);
  assert.equal(portaDeEmpresaPermitida(7901), true);
  assert.equal(portaDeEmpresaPermitida(8100), true);
  assert.equal(portaDeEmpresaPermitida(8101), false);

  for (const ruim of [
    "127.0.0.1:5900",
    "192.168.15.9",
    "empresa:../etc",
    "empresa:balao/../../",
    "http://evil.example",
    "mac:1.2.3.4",
    "empresa:balao@evil",
    "empresa:com espaço",
    "empresa:",
  ]) {
    assert.equal(alvoDaPonte(ruim, { mac: MAC, portaDaEmpresa: () => 7901 }), null, ruim);
  }

  const alvo = alvoDaPonte("empresa:loja-1", { mac: MAC, portaDaEmpresa: (id) => (id === "loja-1" ? 7910 : 22) });
  assert.deepEqual(alvo, { host: "127.0.0.1", porta: 7910 });
});

test("caminho da tela: tira a senha e recusa saída da pasta", () => {
  assert.equal(idDaTela("/pc/balao/"), "balao");
  assert.equal(idDaTela("/pc/balao/api/websockets?k=segredo"), "balao");
  assert.equal(caminhoDaTela("/pc/balao/api/websockets?k=segredo&x=1"), "/pc/balao/api/websockets?x=1");
  assert.equal(caminhoNoContainer("/pc/balao/"), "/");
  assert.equal(caminhoNoContainer("/pc/balao"), "/");
  assert.equal(caminhoNoContainer("/pc/balao/api/websockets?k=segredo&x=1"), "/api/websockets?x=1");
  assert.equal(caminhoNoContainer("/pc/balao/assets/app.js"), "/assets/app.js");
  assert.equal(caminhoNoContainer("/pc/balao/../etc/passwd"), null);
  assert.equal(caminhoDaTela("/pc/balao/../etc/passwd"), null);
  assert.equal(idDaTela("/ws/vnc?destino=mac"), null);
  assert.equal(idDaTela("/pc/../mac"), null);
});

const PORT = 18791;
const SENHA = "senha-do-teste";
const raiz = path.resolve(import.meta.dirname, "..");

function redige(s: string) {
  return s.split(SENHA).join("***");
}

function abrirWs(url: string, headers?: Record<string, string>): Promise<"aberta" | number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    let feito = false;
    const fim = (v: "aberta" | number) => {
      if (feito) return;
      feito = true;
      try { ws.close(); } catch { /* ok */ }
      resolve(v);
    };
    ws.on("open", () => fim("aberta"));
    ws.on("unexpected-response", (_req, res) => {
      const status = res.statusCode ?? 0;
      res.resume();
      fim(status);
    });
    ws.on("error", () => { /* o 401 também dispara error; o status vem de unexpected-response */ });
    setTimeout(() => fim(0), 4000);
  });
}

test("ponte e página da tela exigem a senha da interface", { timeout: 40_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-ponte-"));
  fs.mkdirSync(path.join(tmp, "bots"), { recursive: true });
  const hubDir = path.join(raiz, "packages/hub");
  let log = "";
  const hub: ChildProcess = spawn(process.execPath, ["--import", "tsx", path.join(hubDir, "src/index.ts")], {
    cwd: hubDir,
    env: {
      ...process.env,
      MYBOTS_HUB_HOST: "127.0.0.1",
      MYBOTS_HUB_PORT: String(PORT),
      MYBOTS_HUB_TOKEN: "token-teste-ponte",
      MYBOTS_UI_PASSWORD: SENHA,
      MYBOTS_DB: path.join(tmp, "hub.sqlite"),
      MYBOTS_BOTS_DIR: path.join(tmp, "bots"),
      MYBOTS_UI_DIST: path.join(tmp, "sem-ui"),
      MYBOTS_MAC_IP: "127.0.0.1",
      TELEGRAM_BOT_TOKEN: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  hub.stdout?.on("data", (d) => { log += d.toString(); });
  hub.stderr?.on("data", (d) => { log += d.toString(); });
  const base = `http://127.0.0.1:${PORT}`;
  const matar = () => { try { hub.kill("SIGTERM"); } catch { /* já saiu */ } };

  try {
    const fim = Date.now() + 20_000;
    let noAr = false;
    while (Date.now() < fim) {
      try {
        const r = await fetch(`${base}/api/health?k=${encodeURIComponent(SENHA)}`);
        if (r.ok) { noAr = true; break; }
      } catch { /* ainda subindo */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(noAr, true, "o hub de teste não subiu\n" + redige(log).slice(-800));

    const sem = await fetch(`${base}/api/health`);
    assert.equal(sem.status, 401);

    const vncSem = await abrirWs(`ws://127.0.0.1:${PORT}/ws/vnc?destino=mac`);
    assert.equal(vncSem, 401, "a ponte VNC abriu sem senha");

    const vncErrada = await abrirWs(`ws://127.0.0.1:${PORT}/ws/vnc?destino=mac&k=errada`);
    assert.equal(vncErrada, 401);

    const paginaSem = await fetch(`${base}/tela-vnc.html`);
    assert.equal(paginaSem.status, 401);
    const pcSem = await fetch(`${base}/pc/balao/`);
    assert.equal(pcSem.status, 401);

    const paginaCom = await fetch(`${base}/tela-vnc.html?k=${encodeURIComponent(SENHA)}`);
    assert.equal(paginaCom.status, 200);
    const cookie = paginaCom.headers.get("set-cookie") ?? "";
    assert.equal(cookie.startsWith("mybots_k="), true, "faltou o cookie da senha");
    assert.equal(cookie.includes("HttpOnly"), true, "o cookie da senha precisa ser HttpOnly");

    const vncCom = await abrirWs(`ws://127.0.0.1:${PORT}/ws/vnc?destino=mac&k=${encodeURIComponent(SENHA)}`);
    assert.equal(vncCom, "aberta", "a ponte com a senha certa devia aceitar o destino mac");

    const soCookie = cookie.split(";")[0];
    const vncCookie = await abrirWs(`ws://127.0.0.1:${PORT}/ws/vnc?destino=mac`, { cookie: soCookie });
    assert.equal(vncCookie, "aberta", "o cookie da interface devia valer na ponte");

    // Um destino no formato host:porta não pode virar conexão. O canário escuta
    // numa porta que só receberia byte se a ponte obedecesse ao navegador.
    const canario = await new Promise<{ porta: number; vezes: () => number; fechar: () => void }>((resolve) => {
      let n = 0;
      const srv = net.createServer(() => { n++; });
      srv.listen(0, "127.0.0.1", () => {
        const porta = (srv.address() as net.AddressInfo).port;
        resolve({ porta, vezes: () => n, fechar: () => srv.close() });
      });
    });
    try {
      await abrirWs(`ws://127.0.0.1:${PORT}/ws/vnc?destino=${encodeURIComponent(`127.0.0.1:${canario.porta}`)}&k=${encodeURIComponent(SENHA)}`);
      await abrirWs(`ws://127.0.0.1:${PORT}/ws/vnc?destino=mac&porta=${canario.porta}&k=${encodeURIComponent(SENHA)}`);
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(canario.vezes(), 0, "a ponte conectou num endereço que o navegador escolheu");
    } finally { canario.fechar(); }

    const pcCom = await fetch(`${base}/pc/balao/?k=${encodeURIComponent(SENHA)}`);
    assert.equal(pcCom.status, 503);
    const androidSem = await fetch(`${base}/android/bia/`);
    assert.equal(androidSem.status, 401);
    const androidCom = await fetch(`${base}/android/bia/?k=${encodeURIComponent(SENHA)}`);
    assert.equal(androidCom.status, 503);
    const corpoAndroid = await androidCom.json() as { error?: string; provedores?: unknown[]; botId?: string };
    assert.equal(corpoAndroid.botId, "bia");
    assert.deepEqual(corpoAndroid.provedores, [
      { id: "aparelho", prioridade: 10 },
      { id: "redroid", prioridade: 1 },
    ]);
    assert.match(corpoAndroid.error ?? "", /provedor/);
    const segue = await fetch(`${base}/api/health?k=${encodeURIComponent(SENHA)}`);
    assert.equal(segue.status, 200, "o proxy da tela derrubou o Hub");

    const fantasma = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/vnc?destino=${encodeURIComponent("empresa:fantasma")}&k=${encodeURIComponent(SENHA)}`);
      const t = setTimeout(() => { try { ws.close(); } catch { /* ok */ } resolve(false); }, 1500);
      ws.on("error", () => { /* queda esperada quando o destino não existe */ });
      ws.on("close", () => { clearTimeout(t); resolve(true); });
      ws.on("unexpected-response", (_q, res) => { res.resume(); clearTimeout(t); resolve(false); });
    });
    assert.equal(fantasma, true, "empresa sem PC ligado devia fechar a ponte, não ficar aberta");
  } finally {
    matar();
  }
});

test("a ponte da tela preserva texto e binário", async () => {
  const porta = 8099;
  const servidor = new WebSocketServer({ host: "127.0.0.1", port: porta });
  await new Promise<void>((resolve, reject) => {
    if (servidor.address()) resolve();
    else servidor.once("listening", () => resolve());
    servidor.once("error", reject);
  });
  const chegados: { bin: boolean; texto: string }[] = [];
  const pronto = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("o container de teste não recebeu os quadros")), 4000);
    servidor.on("connection", (ws) => {
      ws.on("message", (data, isBinary) => {
        chegados.push({ bin: isBinary, texto: isBinary ? "" : data.toString() });
        if (chegados.length === 1) {
          ws.send("MODE websockets");
          ws.send(Buffer.from([0, 1, 2, 9]));
        }
        if (chegados.length >= 3) { clearTimeout(t); resolve(); }
      });
    });
  });
  const voltaram: { bin: boolean; texto: string }[] = [];
  const ouvintes: Record<string, () => void> = {};
  const socket = {
    send(d: Buffer, opts?: { binary?: boolean }) {
      const bin = !!opts?.binary;
      voltaram.push({ bin, texto: bin ? "" : d.toString() });
    },
    close() {},
    on(ev: string, fn: () => void) { ouvintes[ev] = fn; },
  };
  try {
    const enviar = abrirWsDaTela(socket, porta, "/api/websockets", [
      quadroWs(Buffer.from("SETTINGS,{\"displayId\":\"primary\"}"), false),
    ]);
    enviar(quadroWs(Buffer.from([9, 8, 7]), true));
    enviar(quadroWs("START_VIDEO", false));
    await pronto;
    assert.deepEqual(chegados.map((q) => q.bin), [false, true, false]);
    assert.equal(chegados[0].texto.startsWith("SETTINGS,"), true);
    assert.equal(chegados[2].texto, "START_VIDEO");
    const fim = Date.now() + 2000;
    while (voltaram.length < 2 && Date.now() < fim) await new Promise((r) => setTimeout(r, 20));
    assert.equal(voltaram[0]?.bin, false);
    assert.equal(voltaram[0]?.texto, "MODE websockets");
    assert.equal(voltaram[1]?.bin, true);
  } finally {
    try { ouvintes.close?.(); } catch { /* ok */ }
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
});
