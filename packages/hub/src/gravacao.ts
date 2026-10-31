/**
 * Gravação da tela do PC da empresa.
 *
 * O Chromium do container já abre a porta de depuração. A gravação pede os
 * quadros JPEG por ali (Page.startScreencast) e o ffmpeg do Hub junta em mp4.
 * Não se instala nada dentro do container, e o endereço do navegador nunca
 * vem do cliente: a porta é a que o Hub publicou, em 127.0.0.1.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

export const FAIXA_CDP = { min: 9301, max: 9500 };

export function portaCdpPermitida(porta: number): boolean {
  return Number.isInteger(porta) && porta >= FAIXA_CDP.min && porta <= FAIXA_CDP.max && porta !== 8787;
}

export function limitesDaGravacao(env: NodeJS.ProcessEnv = process.env) {
  const seg = Number(env.MYBOTS_GRAVACAO_MAX_SEG);
  const mb = Number(env.MYBOTS_GRAVACAO_MAX_MB);
  const maxSeg = Number.isFinite(seg) && seg > 0 ? Math.min(600, Math.max(5, Math.round(seg))) : 180;
  const maxMb = Number.isFinite(mb) && mb > 0 ? Math.min(80, Math.max(1, mb)) : 40;
  return { maxSeg, maxBytes: Math.round(maxMb * 1024 * 1024), fps: 8 };
}

/** Vídeo no chat exige a senha da interface. Foto e PDF continuam como já estavam. */
export function videoExigeSenha(mime: string): boolean {
  return String(mime ?? "").toLowerCase().startsWith("video/");
}

/** Dois momentos: um no começo do trabalho e o último quadro. */
export function quadrosChave(total: number): number[] {
  if (total <= 0) return [];
  if (total === 1) return [0];
  const meio = Math.min(total - 2, Math.max(0, Math.floor(total * 0.25)));
  const ultimo = total - 1;
  return meio === ultimo ? [ultimo] : [meio, ultimo];
}

/**
 * O JSON do Chrome traz um ws:// de dentro do container. Fica só o caminho
 * /devtools/..., e o host é sempre o loopback na porta que nós publicamos.
 */
export function enderecoDoDepurador(webSocketDebuggerUrl: string, porta: number): string | null {
  if (!portaCdpPermitida(porta)) return null;
  let u: URL;
  try { u = new URL(webSocketDebuggerUrl); } catch { return null; }
  if (u.protocol !== "ws:" && u.protocol !== "wss:") return null;
  if (!u.pathname.startsWith("/devtools/")) return null;
  if (u.pathname.includes("..")) return null;
  return `ws://127.0.0.1:${porta}${u.pathname}`;
}

export type Quadro = Buffer;

export type FonteDaTela = (
  empresaId: string,
  onFrame: (jpeg: Quadro) => boolean,
) => Promise<{ erro?: string; cortar?: () => void }>;

export type SessaoGravacao = {
  empresaId: string;
  por: string;
  nome: string;
  conversationId?: string;
  legenda?: string;
  desde: number;
  frames: Quadro[];
  bytes: number;
};

export type FimDaGravacao =
  | { ok: true; empresaId: string; por: string; nome: string; conversationId?: string; legenda?: string; desde: number; frames: Quadro[]; chaves: Quadro[]; segundos: number }
  | { ok: false; erro: string };

export class Gravacoes {
  private ativas = new Map<string, SessaoGravacao & { fechando: boolean; cortar: () => void; timer: NodeJS.Timeout }>();

  constructor(private opts: {
    limites?: { maxSeg: number; maxBytes: number; fps: number };
    agora?: () => number;
    ligarFonte: FonteDaTela;
    aoLimite?: (empresaId: string) => void;
  }) {}

  private limites() { return this.opts.limites ?? limitesDaGravacao(); }
  private agora() { return this.opts.agora?.() ?? Date.now(); }

  estado(empresaId: string): { gravando: boolean; desde?: number; por?: string; nome?: string; segundos?: number } {
    const s = this.ativas.get(empresaId);
    if (!s) return { gravando: false };
    return { gravando: true, desde: s.desde, por: s.por, nome: s.nome, segundos: Math.max(0, Math.round((this.agora() - s.desde) / 1000)) };
  }

  async iniciar(p: { empresaId: string; por: string; nome: string; conversationId?: string }): Promise<{ ok: true; desde: number } | { ok: false; erro: string }> {
    if (!p.empresaId) return { ok: false, erro: "esta gravação precisa de uma empresa" };
    const ja = this.ativas.get(p.empresaId);
    if (ja && !ja.fechando) return { ok: false, erro: `já estou gravando esta tela (${ja.nome})` };
    const lim = this.limites();
    const desde = this.agora();
    const timer = setTimeout(() => this.dispararLimite(p.empresaId), lim.maxSeg * 1000);
    if (typeof timer.unref === "function") timer.unref();
    const sessao: SessaoGravacao & { fechando: boolean; cortar: () => void; timer: NodeJS.Timeout } = {
      empresaId: p.empresaId, por: p.por, nome: p.nome, conversationId: p.conversationId,
      desde, frames: [], bytes: 0, fechando: false, cortar: () => {}, timer,
    };
    this.ativas.set(p.empresaId, sessao);
    const onFrame = (jpeg: Quadro): boolean => {
      const s = this.ativas.get(p.empresaId);
      if (!s || s.fechando) return false;
      if (!Buffer.isBuffer(jpeg) || jpeg.length < 3 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return true;
      if (s.bytes + jpeg.length > lim.maxBytes) {
        if (s.frames.length) this.dispararLimite(p.empresaId);
        return false;
      }
      s.frames.push(jpeg);
      s.bytes += jpeg.length;
      return true;
    };
    const fonte = await this.opts.ligarFonte(p.empresaId, onFrame);
    if (fonte.erro || !fonte.cortar) {
      clearTimeout(timer);
      this.ativas.delete(p.empresaId);
      return { ok: false, erro: fonte.erro ?? "não consegui abrir a tela" };
    }
    sessao.cortar = fonte.cortar;
    return { ok: true, desde };
  }

  private dispararLimite(empresaId: string) {
    const s = this.ativas.get(empresaId);
    if (!s || s.fechando) return;
    this.opts.aoLimite?.(empresaId);
  }

  parar(empresaId: string, legenda?: string): FimDaGravacao {
    const s = this.ativas.get(empresaId);
    if (!s) return { ok: false, erro: "não há gravação nesta empresa" };
    if (s.fechando) return { ok: false, erro: "já estou fechando essa gravação" };
    s.fechando = true;
    clearTimeout(s.timer);
    this.ativas.delete(empresaId);
    try { s.cortar(); } catch { /* a fonte já caiu */ }
    if (!s.frames.length) return { ok: false, erro: "a gravação saiu sem imagem. O navegador do PC estava aberto?" };
    const chaves = quadrosChave(s.frames.length).map((i) => s.frames[i]).filter(Boolean);
    return {
      ok: true,
      empresaId: s.empresaId,
      por: s.por,
      nome: s.nome,
      conversationId: s.conversationId,
      legenda: (legenda ?? s.legenda ?? "").trim() || undefined,
      desde: s.desde,
      frames: s.frames,
      chaves,
      segundos: Math.max(1, Math.round((this.agora() - s.desde) / 1000)),
    };
  }
}

export function temFfmpeg(bin = process.env.MYBOTS_FFMPEG || "ffmpeg"): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, ["-version"], { timeout: 8000, windowsHide: true }, (e) => resolve(!e));
  });
}

/** Junta os JPEG num mp4 (H.264, faststart, para o player do chat conseguir dar play). */
export function codificarMp4(frames: Buffer[], fps = 8, bin = process.env.MYBOTS_FFMPEG || "ffmpeg"): Promise<{ ok: true; data: Buffer } | { ok: false; erro: string }> {
  if (!frames.length) return Promise.resolve({ ok: false, erro: "não há quadros para montar o vídeo" });
  // mp4 com faststart precisa de arquivo (o pipe não deixa reposicionar o moov).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-mp4-"));
  const saida = path.join(dir, "tela.mp4");
  return new Promise((resolve) => {
    const child = execFile(bin, [
      "-y", "-v", "error",
      "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", String(fps), "-i", "pipe:0",
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "28",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-movflags", "+faststart",
      saida,
    ], { timeout: 120_000, windowsHide: true }, (e) => {
      try {
        if (e || !fs.existsSync(saida)) {
          resolve({ ok: false, erro: e ? `ffmpeg: ${(e as Error).message}`.slice(0, 300) : "o ffmpeg não devolveu vídeo" });
          return;
        }
        const data = fs.readFileSync(saida);
        if (data.length < 32) { resolve({ ok: false, erro: "o ffmpeg devolveu um vídeo vazio" }); return; }
        resolve({ ok: true, data });
      } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp já foi */ }
      }
    });
    const stdin = child.stdin;
    if (!stdin) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp já foi */ }
      resolve({ ok: false, erro: "não consegui falar com o ffmpeg" });
      return;
    }
    for (const f of frames) stdin.write(f);
    stdin.end();
  });
}

type ControleCdp = { cortar: boolean; fechar: () => void };

/** Liga o screencast do Chrome na porta de depuração desta empresa. */
export async function ligarCdp(
  porta: number,
  onFrame: (jpeg: Buffer) => boolean,
  fps = 8,
): Promise<{ erro?: string; cortar: () => void }> {
  const cortarVazio = () => {};
  if (!portaCdpPermitida(porta)) return { erro: "a porta do navegador está fora da faixa deste Hub", cortar: cortarVazio };
  let lista: Array<{ type?: string; webSocketDebuggerUrl?: string }>;
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/json/list`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { erro: "o navegador do PC não respondeu", cortar: cortarVazio };
    lista = await r.json();
  } catch {
    return { erro: "não consegui falar com o navegador do PC da empresa. Ele está ligado?", cortar: cortarVazio };
  }
  const pagina = lista.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!pagina?.webSocketDebuggerUrl) return { erro: "o navegador da empresa não tem aba aberta", cortar: cortarVazio };
  const url = enderecoDoDepurador(pagina.webSocketDebuggerUrl, porta);
  if (!url) return { erro: "o endereço de depuração do navegador não é confiável", cortar: cortarVazio };

  const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 16 * 1024 * 1024, handshakeTimeout: 4000 });
  const ctrl: ControleCdp = { cortar: false, fechar: () => { try { ws.close(); } catch { /* ok */ } } };
  let seq = 0;
  const send = (method: string, params?: object) => {
    try { ws.send(JSON.stringify({ id: ++seq, method, params })); } catch { /* caiu */ }
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("o navegador não aceitou a gravação")), 4000);
      ws.once("open", () => { clearTimeout(t); resolve(); });
      ws.once("error", (e) => { clearTimeout(t); reject(e); });
    });
  } catch (e) {
    try { ws.close(); } catch { /* ok */ }
    return { erro: (e as Error).message || "não consegui abrir a tela para gravar", cortar: cortarVazio };
  }

  let ultimo = 0;
  const intervalo = Math.max(40, Math.round(1000 / fps));
  send("Page.enable");
  send("Page.startScreencast", { format: "jpeg", quality: 55, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  ws.on("message", (raw) => {
    if (ctrl.cortar) return;
    let msg: { method?: string; params?: { sessionId?: number; data?: string } };
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.method !== "Page.screencastFrame") return;
    if (msg.params?.sessionId != null) send("Page.screencastFrameAck", { sessionId: msg.params.sessionId });
    const agora = Date.now();
    if (agora - ultimo < intervalo) return;
    ultimo = agora;
    if (typeof msg.params?.data !== "string") return;
    const jpeg = Buffer.from(msg.params.data, "base64");
    const segue = onFrame(jpeg);
    if (!segue) ctrl.fechar();
  });
  ws.on("error", () => { /* o close encerra */ });
  ctrl.fechar = () => {
    if (ctrl.cortar) return;
    ctrl.cortar = true;
    try { send("Page.stopScreencast"); } catch { /* ok */ }
    try { ws.close(); } catch { /* ok */ }
  };
  return { cortar: () => ctrl.fechar() };
}
