// Voz no Hub: transcrição (STT) e fala (TTS) com backends trocáveis.
//   STT: qualquer servidor compatível com a API da OpenAI (/v1/audio/transcriptions):
//        faster-whisper-server / Speaches na RTX 4090, whisper.cpp server, Groq, OpenAI...
//   TTS: "edge" (vozes neurais da Microsoft, grátis, sem chave — padrão),
//        "piper" (servidor local http: POST text → wav), "openai" (/v1/audio/speech) ou "none".
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { VoiceConfig } from "@mybots/shared";
import { cleanForSpeech as cleanSharedForSpeech } from "@mybots/shared";

const env = (k: string, d = "") => process.env[k] ?? d;

export const voiceSettings = {
  sttUrl: env("MYBOTS_STT_URL"),                      // ex.: http://192.168.0.50:8000/v1
  sttModel: env("MYBOTS_STT_MODEL", "whisper-1"),
  sttKey: env("MYBOTS_STT_KEY"),
  tts: env("MYBOTS_TTS", "edge") as "edge" | "piper" | "openai" | "none",
  ttsUrl: env("MYBOTS_TTS_URL"),                      // piper: http://127.0.0.1:5000 · openai: https://api.openai.com/v1
  ttsModel: env("MYBOTS_TTS_MODEL", "tts-1"),
  ttsKey: env("MYBOTS_TTS_KEY"),
  /** servidor da voz clonada do o chefe (voz_clone.py, OmniVoice na 4090) */
  cloneUrl: env("MYBOTS_VOZ_CLONE_URL", "http://127.0.0.1:8770"),
  clonePassos: Number(env("MYBOTS_VOZ_CLONE_PASSOS", "16")),
};

/**
 * Vozes clonadas cadastradas no VoiceStudio (tabela voice_profiles).
 * Para usar numa voz de bot: "clone:chefe", "clone:joao" ou "clone:<id do perfil>".
 */
export const VOZES_CLONADAS: Record<string, { id: string; nome: string }> = {
  chefe: { id: "SEU_PERFIL_DE_VOZ", nome: "o chefe (voz clonada)" },
  "chefe-2": { id: "SEU_PERFIL_DE_VOZ_2", nome: "o chefe 2 (voz clonada)" },
  "chefe-3": { id: "SEU_PERFIL_DE_VOZ_3", nome: "o chefe 3 (voz clonada)" },
  joao: { id: "SEU_PERFIL_DE_VOZ_4", nome: "João (voz clonada)" },
};

/** "clone:joao" -> perfil SEU_PERFIL_DE_VOZ_4. Também aceita o id direto. */
export function perfilClonado(voice: string): string | null {
  const m = /^clone:(.+)$/i.exec((voice ?? "").trim());
  if (!m) return null;
  const chave = m[1].trim().toLowerCase();
  return VOZES_CLONADAS[chave]?.id ?? chave;
}

/** O voz_clone devolve PCM cru; o navegador e o Telegram querem um arquivo. */
function wavDe(pcm: Buffer, taxa = 8000, canais = 1, bits = 16): Buffer {
  const cab = Buffer.alloc(44);
  const bytesPorAmostra = (bits / 8) * canais;
  cab.write("RIFF", 0);
  cab.writeUInt32LE(36 + pcm.length, 4);
  cab.write("WAVE", 8);
  cab.write("fmt ", 12);
  cab.writeUInt32LE(16, 16);
  cab.writeUInt16LE(1, 20);                       // PCM
  cab.writeUInt16LE(canais, 22);
  cab.writeUInt32LE(taxa, 24);
  cab.writeUInt32LE(taxa * bytesPorAmostra, 28);
  cab.writeUInt16LE(bytesPorAmostra, 32);
  cab.writeUInt16LE(bits, 34);
  cab.write("data", 36);
  cab.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([cab, pcm]);
}

/** Fala com a voz clonada do o chefe (ou do João), no servidor local da 4090. */
async function falaClonada(texto: string, perfil: string, velocidade = 1.0): Promise<{ audio: Buffer; mime: string }> {
  const url = voiceSettings.cloneUrl.replace(/\/$/, "") + "/tts";
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ texto, perfil, velocidade, passos: voiceSettings.clonePassos }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`voz clonada HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const pcm = Buffer.from(await res.arrayBuffer());
  if (pcm.length < 1000) throw new Error("a voz clonada devolveu áudio vazio");
  return { audio: wavDe(pcm, 8000), mime: "audio/wav" };
}

/** Vozes pt-BR do Edge: cada bot ganha uma diferente (ou a configurada em bot.voice). */
export const EDGE_PT_BR_VOICES = ["pt-BR-AntonioNeural", "pt-BR-FranciscaNeural", "pt-BR-ThalitaNeural", "pt-BR-ThalitaMultilingualNeural", "pt-BR-MacerioMultilingualNeural"];

export function voiceConfig(): VoiceConfig {
  return {
    stt: !!voiceSettings.sttUrl,
    tts: voiceSettings.tts !== "none" && (voiceSettings.tts === "edge" || !!voiceSettings.ttsUrl),
    ttsEngine: voiceSettings.tts,
    sttEngine: voiceSettings.sttUrl ? "openai-compatible" : "browser",
  };
}

export function pickVoice(botId: string, preferred?: string): string {
  if (preferred) return preferred;
  let h = 0;
  for (const c of botId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return EDGE_PT_BR_VOICES[h % EDGE_PT_BR_VOICES.length];
}

/** Transcreve um áudio (webm/opus, wav, mp3...) usando o servidor STT configurado. */
export async function transcribe(audio: Buffer, mime: string, filename = "audio.webm", language = "pt"): Promise<string> {
  if (!voiceSettings.sttUrl) throw new Error("STT não configurado (MYBOTS_STT_URL)");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), filename);
  form.append("model", voiceSettings.sttModel);
  form.append("language", language);
  form.append("response_format", "json");
  const headers: Record<string, string> = {};
  if (voiceSettings.sttKey) headers.authorization = `Bearer ${voiceSettings.sttKey}`;
  // aceita tanto a base ("…/v1") quanto a URL completa ("…/v1/audio/transcriptions")
  const base = voiceSettings.sttUrl.replace(/\/$/, "");
  const url = /\/audio\/transcriptions$/.test(base) ? base : `${base}/audio/transcriptions`;
  const res = await fetch(url, { method: "POST", headers, body: form, signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`STT HTTP ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text).text ?? ""; } catch { return text; }
}

// mesma limpeza da interface (markdown, bullets, emojis, hashtags, URLs) — segurança caso alguém chame /api/tts com texto cru
const cleanForSpeech = (t: string) => cleanSharedForSpeech(t).slice(0, 2500);

/** Sintetiza fala. Devolve o áudio e o mime. */
// 1,4x: a fala em velocidade normal faz a pessoa desligar o som. Aplicamos no SSML do
// motor (nao no playbackRate do navegador) para a voz acelerar sem ficar fina.
export const VELOCIDADE_FALA = 1.4;

export async function synthesize(text: string, voice: string, velPedida?: number): Promise<{ audio: Buffer; mime: string; vel: number }> {
  // Quem chama pode pedir a cadencia (a narracao da abertura e mais lenta que a
  // fala do dia a dia). Sem isto, o cliente tentava corrigir no playbackRate e
  // acabava multiplicando a velocidade do SSML -- a voz saia quase no dobro.
  const VEL = Math.min(2, Math.max(0.5, Number.isFinite(velPedida as number) && (velPedida as number) > 0 ? (velPedida as number) : VELOCIDADE_FALA));
  const clean = cleanForSpeech(text);
  if (!clean) throw new Error("texto vazio");

  // voz clonada do o chefe/João: roda no servidor local da 4090 (voz_clone.py).
  // Se ele estiver desligado, não deixamos o bot mudo: cai para o Edge.
  const perfil = perfilClonado(voice);
  if (perfil) {
    try {
      return { ...(await falaClonada(clean, perfil, VEL)), vel: VEL };
    } catch (e) {
      console.error(`[voz] voz clonada falhou (${(e as Error).message}); usando a voz padrão`);
      voice = EDGE_PT_BR_VOICES[0];
    }
  }

  switch (voiceSettings.tts) {
    case "edge": {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(clean, { rate: VEL });
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        audioStream.on("data", (d) => chunks.push(Buffer.from(d)));
        audioStream.on("end", () => resolve());
        audioStream.on("error", reject);
      });
      tts.close();
      return { audio: Buffer.concat(chunks), mime: "audio/mpeg", vel: VEL };
    }
    case "piper": {
      const res = await fetch(voiceSettings.ttsUrl.replace(/\/$/, "") + "/", { method: "POST", headers: { "content-type": "text/plain" }, body: clean, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`Piper HTTP ${res.status}`);
      return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/wav", vel: 1 };
    }
    case "openai": {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (voiceSettings.ttsKey) headers.authorization = `Bearer ${voiceSettings.ttsKey}`;
      const res = await fetch(`${voiceSettings.ttsUrl.replace(/\/$/, "")}/audio/speech`, { method: "POST", headers, body: JSON.stringify({ model: voiceSettings.ttsModel, voice, input: clean, response_format: "mp3", speed: VEL }), signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg", vel: VEL };
    }
    default:
      throw new Error("TTS desativado (MYBOTS_TTS=none)");
  }
}
