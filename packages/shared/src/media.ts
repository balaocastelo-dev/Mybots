// Imagens e vídeos: anexos que entram (para os modelos verem) e mídia gerada pelos bots (dentro da cota).

export type MediaKind = "image" | "video";

/** Anexo de uma mensagem, já salvo no Hub. Para vídeos, o Hub acrescenta quadros (image/jpeg) com `derivedFrom` e a `transcript`. */
export type Attachment = {
  id: string;
  name: string;
  mime: string;
  /** caminho relativo no Hub: /api/files/<id>/<nome> */
  url: string;
  size?: number;
  /** quadro extraído deste vídeo (id do anexo original) */
  derivedFrom?: string;
  /** transcrição do áudio (vídeos/áudios), quando o STT do Hub está configurado */
  transcript?: string;
  /** segundo do vídeo de onde o quadro foi tirado */
  atSecond?: number;
};

export const isImageMime = (m: string) => /^image\//i.test(m);
export const isVideoMime = (m: string) => /^video\//i.test(m);
export const isAudioMime = (m: string) => /^audio\//i.test(m);

/**
 * Provedores de geração, em ordem de custo. Os dois primeiros são de graça e rodam
 * FORA desta máquina: nenhum bot precisa esperar a RTX 4090 (que é da Júlia das 8h às 18h)
 * só para ilustrar uma resposta. A placa continua existindo, mas como último recurso.
 */
export type MediaProvider = "pollinations" | "cloudflare" | "comfy" | "gemini" | "openai";
export const MEDIA_PROVIDERS: MediaProvider[] = ["pollinations", "cloudflare", "comfy", "gemini", "openai"];
export const MEDIA_PROVIDER_LABELS: Record<MediaProvider, string> = {
  pollinations: "Pollinations (FLUX, grátis, sem chave)",
  cloudflare: "Cloudflare Workers AI (FLUX schnell, grátis com conta)",
  comfy: "ComfyUI local (RTX 4090)",
  gemini: "Google Gemini / Veo",
  openai: "API compatível com OpenAI",
};

/** Limites por dia. `undefined`/ausente = sem limite. 0 = bloqueado. */
export type MediaLimits = {
  imagesPerDay?: number;
  videoSecondsPerDay?: number;
};

export type MediaBudget = {
  /** vale para todos os bots somados */
  global: MediaLimits;
  /** por provedor (todos os bots somados) */
  perProvider: Partial<Record<MediaProvider, MediaLimits>>;
  /** por bot (todos os provedores somados) */
  bots: Record<string, MediaLimits>;
};

export const DEFAULT_MEDIA_BUDGET: MediaBudget = {
  global: { imagesPerDay: 60, videoSecondsPerDay: 300 },
  perProvider: {
    pollinations: {},                            // grátis e sem chave: sem limite nosso
    cloudflare: { imagesPerDay: 200 },           // camada grátis da Cloudflare: ~230 imagens/dia
    comfy: {},                                   // local: sem limite
    gemini: { imagesPerDay: 20, videoSecondsPerDay: 60 },
    openai: { imagesPerDay: 10, videoSecondsPerDay: 0 },
  },
  bots: {},
};

/** Consumo do dia: imagens e segundos de vídeo, por bot e por provedor. */
export type MediaUsage = {
  day: string; // AAAA-MM-DD
  total: { images: number; videoSeconds: number };
  perProvider: Partial<Record<MediaProvider, { images: number; videoSeconds: number }>>;
  perBot: Record<string, { images: number; videoSeconds: number }>;
};

export type MediaResult =
  | { ok: true; provider: MediaProvider; file: { id: string; name: string; mime: string; url: string; size: number }; seconds?: number; note?: string }
  | { ok: false; error: string; tried: Array<{ provider: MediaProvider; reason: string }> };

/** Dentro do limite? (amount = 1 imagem ou N segundos de vídeo) */
export function withinLimit(limits: MediaLimits | undefined, kind: MediaKind, used: { images: number; videoSeconds: number }, amount: number): boolean {
  if (!limits) return true;
  if (kind === "image") return limits.imagesPerDay === undefined || used.images + amount <= limits.imagesPerDay;
  return limits.videoSecondsPerDay === undefined || used.videoSeconds + amount <= limits.videoSecondsPerDay;
}
