/**
 * Como o MyBots abre o scrcpy (a tela do celular).
 *
 * No Android 14 de alguns aparelhos (POCO/Xiaomi) o encoder de áudio do scrcpy
 * morre com "Pending dequeue output buffer request cancelled" na thread
 * audio-in / AudioEncoder, e a sessão inteira cai. Sem áudio a tela sobe.
 * Se ainda assim a captura de vídeo falhar, uma segunda tentativa pede H.264.
 *
 * MYBOTS_SCRCPY_AUDIO=1 liga o áudio. MYBOTS_SCRCPY_VIDEO_CODEC=h264|h265|av1
 * escolhe o codec. MYBOTS_SCRCPY_FALLBACK=0 não tenta o H.264 sozinho.
 */

export type PedidoScrcpy = {
  serial?: string;
  titulo?: string;
  audio: boolean;
  codec?: string;
};

const CODECS = new Set(["h264", "h265", "av1"]);

export function audioLigado(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.MYBOTS_SCRCPY_AUDIO ?? "").trim().toLowerCase();
  return v === "1" || v === "sim" || v === "true" || v === "on" || v === "yes";
}

export function codecDoEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = String(env.MYBOTS_SCRCPY_VIDEO_CODEC ?? "").trim().toLowerCase();
  return CODECS.has(v) ? v : undefined;
}

export function fallbackLigado(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.MYBOTS_SCRCPY_FALLBACK ?? "h264").trim().toLowerCase();
  return v !== "0" && v !== "off" && v !== "nao" && v !== "não" && v !== "false";
}

/** Os flags, na ordem. Áudio desligado por padrão. */
export function argumentosScrcpy(p: PedidoScrcpy): string[] {
  const args: string[] = [];
  if (p.serial) args.push(`--serial=${p.serial}`);
  if (p.titulo) args.push(`--window-title=${p.titulo}`);
  args.push("--max-size=1080", "--video-bit-rate=8M", "--max-fps=60", "--stay-awake", "--turn-screen-off");
  if (!p.audio) args.push("--no-audio");
  if (p.codec && CODECS.has(p.codec)) args.push(`--video-codec=${p.codec}`);
  return args;
}

/** O texto que o scrcpy deixa quando o POCO derruba a sessão. */
export function falhaDeCaptura(saida: string): boolean {
  return /Pending dequeue output buffer request cancelled/i.test(saida)
    || /AudioEncoder/i.test(saida)
    || /audio-in/i.test(saida)
    || /Capture\/encoding error/i.test(saida);
}

/**
 * Uma segunda tentativa, ou null se não há o que mudar.
 * Áudio que quebrou sai. Captura que quebrou pede H.264, se ainda não era ele
 * e ninguém travou o codec no ambiente.
 */
export function proximaTentativa(
  atual: PedidoScrcpy,
  saida: string,
  opcoes: { fallback?: boolean; codecTravado?: boolean } = {},
): PedidoScrcpy | null {
  if (opcoes.fallback === false) return null;
  if (!falhaDeCaptura(saida)) return null;
  const audioQuebrou = /AudioEncoder|audio-in/i.test(saida);
  const videoQuebrou = /Capture\/encoding error|dequeue output buffer/i.test(saida);
  let audio = atual.audio;
  let codec = atual.codec;
  let mudou = false;
  if (audio && audioQuebrou) { audio = false; mudou = true; }
  if (videoQuebrou && !opcoes.codecTravado && codec !== "h264") { codec = "h264"; mudou = true; }
  if (!mudou) return null;
  return { ...atual, audio, codec };
}
