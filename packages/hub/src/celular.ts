import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { raizDoProjeto } from "./config.js";
import { hostsParaVarredura, varrerPorta } from "./celularEmpresa.js";

/**
 * O CELULAR DA EMPRESA
 *
 * O aparelho da empresa, ligado por ADB (USB ou WiFi), aparece no painel e fica ao
 * alcance dos bots. Por que o aparelho de verdade e nao um emulador: e NELE que
 * mora o WhatsApp da empresa, a conta do banco, o app do fornecedor. Emulador
 * nenhum recebe essas contas sem fazer login de novo -- e e justamente o login que
 * a gente quer evitar repetir.
 *
 * O bot ve de dois jeitos, e usa os dois: a FOTO da tela (para o chefe assistir e
 * para modelos que enxergam) e a ARVORE da interface em texto, que diz onde cada
 * botao esta. Clicar por coordenada chutada quebra na primeira troca de tela; achar
 * pelo rotulo, nao.
 */

export type Aparelho = {
  serial: string;
  modelo: string;
  estado: string;       // device, offline, unauthorized
  viaWifi: boolean;
  largura?: number;
  altura?: number;
};

const TAMANHOS = new Map<string, { largura: number; altura: number }>();

function caminhoDoAdb(): string | null {
  const raiz = raizDoProjeto();
  const tentativas = [
    process.env.MYBOTS_ADB,
    path.join(raiz, "ferramentas", "scrcpy", "adb.exe"),
    path.join(raiz, "ferramentas", "scrcpy", "adb"),
    "C:\\android\\sdk\\platform-tools\\adb.exe",
    `${process.env.LOCALAPPDATA}\\Android\\Sdk\\platform-tools\\adb.exe`,
    `${process.env.USERPROFILE}\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe`,
    "adb",
  ].filter(Boolean) as string[];
  for (const p of tentativas) {
    if (p === "adb") return p;
    try { if (fs.existsSync(p)) return p; } catch { /* segue */ }
  }
  return null;
}

function adb(args: string[], msTeto = 20000, binario = false): Promise<{ ok: boolean; saida: string; bytes: Buffer }> {
  const exe = caminhoDoAdb();
  return new Promise((resolve) => {
    if (!exe) return resolve({ ok: false, saida: "adb nao encontrado nesta maquina", bytes: Buffer.alloc(0) });
    execFile(exe, args, { timeout: msTeto, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: binario ? "buffer" : "utf8" } as any,
      (e, out: any, err: any) => {
        const bytes = binario ? Buffer.from(out ?? []) : Buffer.alloc(0);
        const saida = binario ? String(err ?? "") : String(out ?? "") + String(err ?? "");
        resolve({ ok: !e, saida, bytes });
      });
  });
}

export function temAdb(): boolean { return caminhoDoAdb() !== null; }

export async function listar(): Promise<Aparelho[]> {
  const r = await adb(["devices", "-l"], 15000);
  if (!r.ok) return [];
  const linhas = r.saida.split(/\r?\n/).slice(1).filter((l) => l.trim() && !l.startsWith("*"));
  const fora: Aparelho[] = [];
  for (const l of linhas) {
    const m = l.match(/^(\S+)\s+(\S+)(.*)$/);
    if (!m) continue;
    const serial = m[1];
    const modelo = m[3].match(/model:(\S+)/)?.[1]?.replace(/_/g, " ") ?? serial;
    const tam = TAMANHOS.get(serial);
    fora.push({ serial, modelo, estado: m[2], viaWifi: /:\d+$/.test(serial), largura: tam?.largura, altura: tam?.altura });
  }
  return fora;
}

/** Guarda o tamanho da tela: o painel manda o toque em proporcao, nao em pixel. */
export async function tamanho(serial: string): Promise<{ largura: number; altura: number } | null> {
  const guardado = TAMANHOS.get(serial);
  if (guardado) return guardado;
  const r = await adb(["-s", serial, "shell", "wm", "size"], 15000);
  const m = r.saida.match(/(\d+)x(\d+)/);
  if (!m) return null;
  const t = { largura: parseInt(m[1], 10), altura: parseInt(m[2], 10) };
  TAMANHOS.set(serial, t);
  return t;
}

export async function tela(serial: string): Promise<Buffer | null> {
  const r = await adb(["-s", serial, "exec-out", "screencap", "-p"], 25000, true);
  if (!r.ok || r.bytes.length < 1000) return null;
  // PNG comeca com 89 50 4E 47; se nao comecar, veio texto de erro
  if (!(r.bytes[0] === 0x89 && r.bytes[1] === 0x50)) return null;
  return r.bytes;
}

/** x e y vem de 0 a 1: assim o painel nao precisa saber a resolucao do aparelho. */
export async function tocar(serial: string, x: number, y: number): Promise<boolean> {
  const t = await tamanho(serial);
  if (!t) return false;
  const px = Math.round(Math.min(1, Math.max(0, x)) * t.largura);
  const py = Math.round(Math.min(1, Math.max(0, y)) * t.altura);
  return (await adb(["-s", serial, "shell", "input", "tap", String(px), String(py)], 15000)).ok;
}

export async function deslizar(serial: string, x1: number, y1: number, x2: number, y2: number, ms = 260): Promise<boolean> {
  const t = await tamanho(serial);
  if (!t) return false;
  const p = (v: number, total: number) => String(Math.round(Math.min(1, Math.max(0, v)) * total));
  return (await adb(["-s", serial, "shell", "input", "swipe",
    p(x1, t.largura), p(y1, t.altura), p(x2, t.largura), p(y2, t.altura), String(ms)], 20000)).ok;
}

export async function digitar(serial: string, texto: string): Promise<boolean> {
  // input text nao aceita espaco cru nem acento; vai pedaco a pedaco
  const limpo = (texto ?? "").slice(0, 500);
  if (!limpo) return false;
  const escapado = limpo.replace(/ /g, "%s").replace(/(["'`$&|;<>()])/g, "\\$1");
  return (await adb(["-s", serial, "shell", "input", "text", escapado], 20000)).ok;
}

const TECLAS: Record<string, string> = {
  voltar: "KEYCODE_BACK", inicio: "KEYCODE_HOME", recentes: "KEYCODE_APP_SWITCH",
  enter: "KEYCODE_ENTER", apagar: "KEYCODE_DEL", ligar: "KEYCODE_POWER",
  cima: "KEYCODE_DPAD_UP", baixo: "KEYCODE_DPAD_DOWN",
};
export async function tecla(serial: string, qual: string): Promise<boolean> {
  const k = TECLAS[qual];
  if (!k) return false;
  return (await adb(["-s", serial, "shell", "input", "keyevent", k], 15000)).ok;
}

/** A interface em texto: e assim que o bot acha o botao pelo rotulo. */
export async function arvore(serial: string): Promise<string | null> {
  const d = await adb(["-s", serial, "shell", "uiautomator", "dump", "/sdcard/mybots-ui.xml"], 30000);
  if (!d.ok) return null;
  const x = await adb(["-s", serial, "shell", "cat", "/sdcard/mybots-ui.xml"], 20000);
  void adb(["-s", serial, "shell", "rm", "-f", "/sdcard/mybots-ui.xml"], 10000);
  return x.ok ? x.saida : null;
}

/** Liga pelo WiFi: o aparelho precisa ter sido pareado antes. */
export async function conectar(ipPorta: string): Promise<{ ok: boolean; msg: string }> {
  const alvo = /:\d+$/.test(ipPorta) ? ipPorta : ipPorta + ":5555";
  const r = await adb(["connect", alvo], 25000);
  return { ok: r.ok && /connected/i.test(r.saida), msg: r.saida.trim().slice(0, 200) };
}

export async function mdns(): Promise<string> {
  const r = await adb(["mdns", "services"], 8000);
  return r.saida;
}

/** Código de 6 dígitos do Android. O código não fica guardado. */
export async function parear(host: string, porta: number, codigo: string): Promise<{ ok: boolean; msg: string }> {
  if (!/^\d{6}$/.test(codigo) || porta === 8787 || porta < 1 || porta > 65535) return { ok: false, msg: "código ou porta inválidos" };
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { ok: false, msg: "endereço inválido" };
  const r = await adb(["pair", `${host}:${porta}`, codigo], 20000);
  const ok = r.ok && /successfully paired/i.test(r.saida);
  return { ok, msg: r.saida.replace(codigo, "******").trim().slice(0, 240) || (ok ? "pareado" : "não pareou") };
}

export async function abrirApp(serial: string, pacote: string): Promise<boolean> {
  const r = await adb(["-s", serial, "shell", "monkey", "-p", pacote, "-c", "android.intent.category.LAUNCHER", "1"], 20000);
  return r.ok && !/error|Exception/i.test(r.saida);
}

export async function modeloDe(serial: string): Promise<string> {
  const r = await adb(["-s", serial, "shell", "getprop", "ro.product.model"], 8000);
  return r.ok ? r.saida.trim().slice(0, 80) : "";
}

/** TCP curto na 5555. Porta 8787 nem chega a ser aberta. */
export function portaAberta(host: string, porta: number, ms = 180): Promise<boolean> {
  if (porta !== 5555 || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const s = net.connect({ host, port: porta, family: 4 });
    let acabou = false;
    const fim = (ok: boolean) => { if (acabou) return; acabou = true; s.destroy(); resolve(ok); };
    s.setTimeout(ms);
    s.once("connect", () => fim(true));
    s.once("timeout", () => fim(false));
    s.once("error", () => fim(false));
  });
}

/** Aparelhos com adb tcpip na rede local. MYBOTS_CELULAR_VARREDURA=0 desliga. */
export async function varrerRedeLocal(): Promise<string[]> {
  if (/^(0|nao|não|false|off|no)$/i.test(String(process.env.MYBOTS_CELULAR_VARREDURA ?? ""))) return [];
  const locais: string[] = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista ?? []) {
      if (i.family === "IPv4" && !i.internal) locais.push(i.address);
    }
  }
  return varrerPorta(hostsParaVarredura(locais), 5555, portaAberta);
}

export async function acordar(serial: string): Promise<boolean> {
  const r = await adb(["-s", serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP"], 15000);
  return r.ok;
}