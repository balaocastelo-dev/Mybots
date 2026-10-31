/**
 * Protocolo do scrcpy 5.0.1, o mesmo binário de ferramentas/scrcpy/scrcpy-server.
 * O navegador recebe H.264 pelo WebSocket (o papel do ws-scrcpy) e devolve toque.
 * Áudio fica de fora: em alguns Android 14 o encoder de áudio derruba a sessão.
 */

export const VERSAO_SCRCPY = "5.0.1";
export const URL_WHATSAPP = "https://web.whatsapp.com";
export const CODEC_H264 = 0x68323634;

const FLAG_CONFIG = 1n << 62n;
const FLAG_CHAVE = 1n << 61n;

/** Argumentos do `adb shell` que sobem o servidor no aparelho. O socket abstrato é "scrcpy" (scid padrão -1). */
export function argumentosDoServidorScrcpy(): string[] {
  return [
    "shell",
    "CLASSPATH=/data/local/tmp/scrcpy-server.jar",
    "app_process",
    "/",
    "com.genymobile.scrcpy.Server",
    VERSAO_SCRCPY,
    "audio=false",
    "tunnel_forward=true",
    "video_codec=h264",
    "max_size=1080",
    "max_fps=30",
    "video_bit_rate=8000000",
    "stay_awake=true",
    "power_on=true",
    "log_level=info",
  ];
}

/** Abre o Chrome em https://web.whatsapp.com. Sem login e sem enviar mensagem. */
export function argumentosWhatsapp(serial: string, comChrome = true): string[] {
  const args = ["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", URL_WHATSAPP];
  if (comChrome) args.push("-n", "com.android.chrome/com.google.android.apps.chrome.Main");
  return args;
}

export function argumentosAcordar(serial: string): string[] {
  return ["-s", serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP"];
}

/** Toque. action: 0 desce, 1 sobe, 2 move. 32 bytes, big-endian, como o scrcpy 5. */
export function mensagemToque(acao: 0 | 1 | 2, x: number, y: number, largura: number, altura: number): Buffer {
  const b = Buffer.alloc(32);
  const w = Math.max(1, Math.min(65535, Math.round(largura)));
  const h = Math.max(1, Math.min(65535, Math.round(altura)));
  const px = Math.max(0, Math.min(w - 1, Math.round(x)));
  const py = Math.max(0, Math.min(h - 1, Math.round(y)));
  b[0] = 2;
  b[1] = acao;
  b.writeBigInt64BE(-2n, 2); // dedo, não mouse (o fio é o complemento de dois)
  b.writeInt32BE(px, 10);
  b.writeInt32BE(py, 14);
  b.writeUInt16BE(w, 18);
  b.writeUInt16BE(h, 20);
  b.writeUInt16BE(acao === 1 ? 0 : 0xffff, 22);
  b.writeInt32BE(0, 24);
  b.writeInt32BE(0, 28);
  return b;
}

/** Um degrau da roda. unidades positivas sobem o conteúdo, no mesmo sinal do scrcpy. */
export function mensagemRolar(x: number, y: number, largura: number, altura: number, unidades: number): Buffer {
  const b = Buffer.alloc(21);
  const w = Math.max(1, Math.min(65535, Math.round(largura)));
  const h = Math.max(1, Math.min(65535, Math.round(altura)));
  b[0] = 3;
  b.writeInt32BE(Math.max(0, Math.min(w - 1, Math.round(x))), 1);
  b.writeInt32BE(Math.max(0, Math.min(h - 1, Math.round(y))), 5);
  b.writeUInt16BE(w, 9);
  b.writeUInt16BE(h, 11);
  b.writeInt16BE(0, 13);
  b.writeInt16BE(i16DoScroll(unidades), 15);
  b.writeInt32BE(0, 17);
  return b;
}

export function i16DoScroll(unidades: number): number {
  const norm = Math.max(-1, Math.min(1, unidades / 16));
  let i = Math.round(norm * 0x8000);
  if (i > 0x7fff) i = 0x7fff;
  if (i < -0x8000) i = -0x8000;
  return i;
}

/** Voltar (tipo 4). action 0 desce, 1 sobe. */
export function mensagemVoltar(acao: 0 | 1): Buffer {
  const b = Buffer.alloc(2);
  b[0] = 4;
  b[1] = acao;
  return b;
}

/** Tecla Android. KEYCODE_HOME = 3. */
export function mensagemTecla(keycode: number, acao: 0 | 1): Buffer {
  const b = Buffer.alloc(14);
  b[0] = 0;
  b[1] = acao;
  b.writeInt32BE(keycode, 2);
  b.writeInt32BE(0, 6);
  b.writeInt32BE(0, 10);
  return b;
}

export function mensagemTexto(texto: string): Buffer {
  const t = Buffer.from(String(texto ?? "").slice(0, 300), "utf8");
  const b = Buffer.alloc(5 + t.length);
  b[0] = 1;
  b.writeUInt32BE(t.length, 1);
  t.copy(b, 5);
  return b;
}

export type Cabecalho =
  | { tipo: "sessao"; largura: number; altura: number }
  | { tipo: "quadro"; tamanho: number; config: boolean; chave: boolean };

/** Os 12 bytes no começo de cada pacote de vídeo do scrcpy 5. */
export function classificarCabecalho(h: Buffer): Cabecalho | null {
  if (h.length < 12) return null;
  if (h[0] & 0x80) {
    return { tipo: "sessao", largura: h.readUInt32BE(4), altura: h.readUInt32BE(8) };
  }
  const flags = h.readBigUInt64BE(0);
  return {
    tipo: "quadro",
    tamanho: h.readUInt32BE(8),
    config: (flags & FLAG_CONFIG) !== 0n,
    chave: (flags & FLAG_CHAVE) !== 0n,
  };
}

function iniciosDeStartCode(dados: Buffer): number[] {
  const s: number[] = [];
  for (let i = 0; i + 3 < dados.length; i++) {
    if (dados[i] !== 0 || dados[i + 1] !== 0) continue;
    if (dados[i + 2] === 1) { s.push(i); i += 2; continue; }
    if (i + 3 < dados.length && dados[i + 2] === 0 && dados[i + 3] === 1) { s.push(i); i += 3; }
  }
  return s;
}

export function nalusDe(dados: Buffer): Buffer[] {
  const s = iniciosDeStartCode(dados);
  if (!s.length) return dados.length ? [dados] : [];
  const fora: Buffer[] = [];
  for (let i = 0; i < s.length; i++) {
    const codigo = dados[s[i] + 2] === 1 ? 3 : 4;
    const ini = s[i] + codigo;
    const fim = i + 1 < s.length ? s[i + 1] : dados.length;
    if (fim > ini) fora.push(dados.subarray(ini, fim));
  }
  return fora;
}

/** AVCDecoderConfigurationRecord a partir do pacote de config (Annex-B com SPS e PPS). */
export function descricaoDeH264(annexb: Buffer): { codec: string; avcC: Buffer } | null {
  const nalus = nalusDe(annexb);
  const sps = nalus.find((n) => (n[0] & 0x1f) === 7);
  const pps = nalus.find((n) => (n[0] & 0x1f) === 8);
  if (!sps || !pps || sps.length < 4) return null;
  const avcC = Buffer.alloc(11 + sps.length + pps.length);
  let o = 0;
  avcC[o++] = 1;
  avcC[o++] = sps[1];
  avcC[o++] = sps[2];
  avcC[o++] = sps[3];
  avcC[o++] = 0xff;
  avcC[o++] = 0xe1;
  avcC.writeUInt16BE(sps.length, o); o += 2;
  sps.copy(avcC, o); o += sps.length;
  avcC[o++] = 1;
  avcC.writeUInt16BE(pps.length, o); o += 2;
  pps.copy(avcC, o);
  const hex = (b: number) => b.toString(16).padStart(2, "0");
  return { codec: `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`, avcC };
}

/** Um quadro Annex-B vira AVCC (tamanho de 4 bytes + NAL). SPS/PPS/AUD saem: a descrição já foi. */
export function avccDe(dados: Buffer): Buffer | null {
  const temStart = iniciosDeStartCode(dados).length > 0;
  const nalus = (temStart ? nalusDe(dados) : [dados]).filter((n) => {
    const t = n[0] & 0x1f;
    return n.length > 0 && t !== 7 && t !== 8 && t !== 9;
  });
  if (!nalus.length) return null;
  return Buffer.concat(nalus.map((n) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(n.length, 0);
    return Buffer.concat([l, n]);
  }));
}
