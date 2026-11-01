/**
 * Sobe o scrcpy-server no aparelho e lê o H.264. O controle (toque, tecla)
 * volta pelo segundo socket. Tudo fica em 127.0.0.1: o adb forward não publica na rede.
 */
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import {
  argumentosDoServidorScrcpy, avccDe, classificarCabecalho, CODEC_H264, descricaoDeH264,
} from "./androidScrcpy.js";
import type { AdbFn } from "./androidBot.js";

const DESTINO = "/data/local/tmp/scrcpy-server.jar";

class Leitor {
  private buf = Buffer.alloc(0);
  private espera: { n: number; resolve: (b: Buffer) => void; reject: (e: Error) => void; t: NodeJS.Timeout } | null = null;
  private morto = false;

  constructor(sock: net.Socket) {
    sock.on("data", (d) => {
      this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
      this.tentar();
    });
    sock.on("error", (e) => this.falhar(e));
    sock.on("close", () => this.falhar(new Error("a tela do aparelho fechou")));
  }

  ler(n: number, ms: number): Promise<Buffer> {
    if (this.morto) return Promise.reject(new Error("a tela do aparelho fechou"));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        if (this.espera) this.espera = null;
        reject(new Error("o aparelho não mandou a tela a tempo"));
      }, ms);
      this.espera = { n, resolve, reject, t };
      this.tentar();
    });
  }

  private tentar() {
    const e = this.espera;
    if (!e || this.buf.length < e.n) return;
    const out = this.buf.subarray(0, e.n);
    this.buf = this.buf.subarray(e.n);
    this.espera = null;
    clearTimeout(e.t);
    e.resolve(Buffer.from(out));
  }

  private falhar(err: Error) {
    if (this.morto) return;
    this.morto = true;
    const e = this.espera;
    if (!e) return;
    clearTimeout(e.t);
    this.espera = null;
    e.reject(err);
  }
}

function conectar(porta: number, ms: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: "127.0.0.1", port: porta });
    const t = setTimeout(() => { s.destroy(); reject(new Error("tempo")); }, ms);
    s.once("connect", () => { clearTimeout(t); resolve(s); });
    s.once("error", (e) => { clearTimeout(t); reject(e); });
  });
}

async function conectarVarias(porta: number): Promise<net.Socket> {
  let ultimo: unknown;
  for (let i = 0; i < 25; i++) {
    try { return await conectar(porta, 800); } catch (e) { ultimo = e; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw ultimo instanceof Error ? ultimo : new Error("não conectei na tela");
}

export type SessaoAndroid = {
  controle: (b: Buffer) => void;
  fechar: () => void;
};

export async function abrirSessao(opts: {
  adbBin: string;
  adb: AdbFn;
  serial: string;
  servidor: string;
  onAviso: (texto: string) => void;
  onMeta: (m: { largura: number; altura: number; nome: string }) => void;
  onConfig: (m: { codec: string; description: string }) => void;
  onQuadro: (q: { chave: boolean; dados: Buffer }) => void;
}): Promise<SessaoAndroid> {
  let fechado = false;
  let video: net.Socket | null = null;
  let controleSock: net.Socket | null = null;
  let child: ChildProcess | null = null;
  let portaForward = 0;
  const fechar = () => {
    if (fechado) return;
    fechado = true;
    try { video?.destroy(); } catch { /* ok */ }
    try { controleSock?.destroy(); } catch { /* ok */ }
    try { child?.kill(); } catch { /* ok */ }
    if (portaForward) void opts.adb(["-s", opts.serial, "forward", "--remove", `tcp:${portaForward}`], 5000);
  };
  const falhar = (texto: string) => {
    opts.onAviso(texto);
    fechar();
  };

  const empurrar = await opts.adb(["-s", opts.serial, "push", opts.servidor, DESTINO], 60000);
  if (!empurrar.ok) {
    const msg = "Não consegui enviar o scrcpy para o aparelho. Confira se ele está em Depuração sem fio e se o adb conectou.";
    falhar(msg);
    throw new Error(msg);
  }
  await opts.adb(["-s", opts.serial, "shell", "pkill", "-f", "com.genymobile.scrcpy.Server"], 5000);
  // Forwards velhos no mesmo localabstract:scrcpy roubam o slot de video/controle.
  await opts.adb(["-s", opts.serial, "forward", "--remove-all"], 5000);

  portaForward = await portaLivre();
  const fwd = await opts.adb(["-s", opts.serial, "forward", `tcp:${portaForward}`, "localabstract:scrcpy"], 10000);
  if (!fwd.ok) {
    const msg = "O adb não abriu a ponte da tela neste PC.";
    falhar(msg);
    throw new Error(msg);
  }

  let log = "";
  child = spawn(opts.adbBin, ["-s", opts.serial, ...argumentosDoServidorScrcpy()], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const anotar = (d: Buffer) => {
    log = (log + d.toString()).slice(-2000);
    if (/does not match|ERROR:/i.test(log) && /match the client|Exception/i.test(log)) {
      falhar("O scrcpy do aparelho não combinou com o deste PC. " + log.replace(/\s+/g, " ").trim().slice(0, 180));
    }
  };
  child.stdout?.on("data", anotar);
  child.stderr?.on("data", anotar);
  child.on("exit", () => { if (!fechado) falhar("O servidor de tela do aparelho encerrou."); });

  const viuDispositivo = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 8000);
    const ver = () => {
      if (/Device:/.test(log)) { clearTimeout(t); resolve(true); }
    };
    child?.stdout?.on("data", ver);
    child?.stderr?.on("data", ver);
    ver();
  });
  if (fechado) throw new Error("sessão android cancelada");
  if (!viuDispositivo && child.exitCode != null) {
    falhar("O servidor de tela saiu antes de mostrar o aparelho.");
    throw new Error("O servidor de tela saiu antes de mostrar o aparelho.");
  }
  // O abstract socket sobe junto do Device:; um pequeno atraso evita connect prematuro no Windows.
  await new Promise((r) => setTimeout(r, 250));

  try {
    video = await conectarVarias(portaForward);
  } catch {
    const msg = "O aparelho não aceitou a tela. Veja se a depuração sem fio ainda está ligada. " + log.replace(/\s+/g, " ").trim().slice(0, 160);
    falhar(msg);
    throw new Error(msg);
  }
  const leitor = new Leitor(video);
  try {
    await leitor.ler(1, 5000);
    controleSock = await conectarVarias(portaForward);
    controleSock.on("error", () => { /* o fechar trata */ });
    controleSock.resume();
    const nomeBruto = await leitor.ler(64, 5000);
    const nome = nomeBruto.toString("utf8").replace(/\0/g, "").trim();
    const codecBruto = await leitor.ler(4, 5000);
    const codec = codecBruto.readUInt32BE(0);
    if (codec !== CODEC_H264) {
      const msg = "O aparelho não ofereceu H.264. Sem isso o painel não desenha a tela.";
      falhar(msg);
      throw new Error(msg);
    }
    let largura = 0;
    let altura = 0;
    let viuConfig = false;
    const loop = async () => {
      try {
        while (!fechado) {
          const header = await leitor.ler(12, 20000);
          const c = classificarCabecalho(header);
          if (!c) break;
          if (c.tipo === "sessao") {
            largura = c.largura;
            altura = c.altura;
            opts.onMeta({ largura, altura, nome });
            continue;
          }
          if (!c.tamanho || c.tamanho > 8_000_000) break;
          const pacote = await leitor.ler(c.tamanho, 20000);
          if (c.config || !viuConfig) {
            const desc = descricaoDeH264(pacote);
            if (desc) {
              viuConfig = true;
              opts.onConfig({ codec: desc.codec, description: desc.avcC.toString("base64") });
            }
            if (c.config) continue;
          }
          const avcc = avccDe(pacote);
          if (avcc) opts.onQuadro({ chave: c.chave || !viuConfig, dados: avcc });
        }
      } catch (e) {
        if (!fechado) falhar((e as Error).message || "a tela caiu");
      }
    };
    void loop();
  } catch (e) {
    const msg = (e as Error).message || "não li o começo da tela";
    falhar(msg);
    throw new Error(msg);
  }

  return {
    controle: (b) => { try { controleSock?.write(b); } catch { /* caiu */ } },
    fechar,
  };
}

function portaLivre(): Promise<number> {
  const proibidas = new Set([8787, 8791, 8790]);
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => {
        if (proibidas.has(p)) { portaLivre().then(resolve, reject); return; }
        resolve(p);
      });
    });
  });
}
