// Mídia: geração de imagens e vídeos pelos bots (dentro da cota) e preparo de vídeos que chegam
// (quadros + transcrição) para os modelos que não enxergam vídeo.
// Provedores em ordem de custo: Pollinations e Cloudflare (grátis, na nuvem, sem tocar na placa) →
// ComfyUI local (RTX 4090) → Gemini (imagem) / Veo (vídeo) → API compatível com OpenAI.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type Attachment, type MediaBudget, type MediaKind, type MediaLimits, type MediaProvider, type MediaResult, type MediaUsage,
  DEFAULT_MEDIA_BUDGET, MEDIA_PROVIDERS, isVideoMime, isAudioMime, withinLimit,
} from "@mybots/shared";
import type { Db } from "./db.js";
import { redigir } from "./redacao.js";
import { transcribe, voiceSettings } from "./voice.js";

const env = (k: string, d = "") => process.env[k] ?? d;

export const mediaSettings = {
  /** Pollinations: imagem de graça, sem chave e sem GPU nossa. O token é opcional (tira a marca d'água e o limite anônimo de 1 pedido a cada 15 s). */
  pollinationsUrl: env("MYBOTS_POLLINATIONS_URL", "https://image.pollinations.ai"),
  pollinationsModel: env("MYBOTS_POLLINATIONS_MODEL", "flux"),
  pollinationsToken: env("MYBOTS_POLLINATIONS_TOKEN"),
  /** Cloudflare Workers AI: camada grátis (~230 imagens/dia), precisa de conta — sem cartão. */
  cloudflareAccount: env("MYBOTS_CLOUDFLARE_ACCOUNT_ID"),
  cloudflareToken: env("MYBOTS_CLOUDFLARE_API_TOKEN"),
  cloudflareModel: env("MYBOTS_CLOUDFLARE_IMAGE_MODEL", "@cf/black-forest-labs/flux-1-schnell"),
  /** ComfyUI de imagem (SDXL etc.) */
  comfyUrl: env("MYBOTS_COMFY_URL", "http://127.0.0.1:8188"),
  comfyCheckpoint: env("MYBOTS_COMFY_CHECKPOINT"),          // vazio = primeiro da lista
  /** ComfyUI do MiniMax H3 (vídeo) */
  h3Url: env("MYBOTS_H3_URL", "http://127.0.0.1:8189"),
  h3StartScript: env("MYBOTS_H3_START_SCRIPT", "D:\\IA\\H3\\start8189.ps1"),
  /** 8h–18h a GPU é da Júlia (WhatsApp): só renderiza vídeo local fora do horário, salvo MYBOTS_H3_ANYTIME=1 */
  h3Anytime: env("MYBOTS_H3_ANYTIME") === "1",
  geminiKey: env("MYBOTS_GEMINI_API_KEY") || env("GEMINI_API_KEY") || env("GOOGLE_API_KEY"),
  geminiBase: env("MYBOTS_GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"),
  geminiImageModel: env("MYBOTS_GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image"),
  geminiVideoModel: env("MYBOTS_GEMINI_VIDEO_MODEL", "veo-3.1-fast-generate-preview"),
  openaiUrl: env("MYBOTS_IMAGE_API_URL"),                    // ex.: https://api.openai.com/v1
  openaiKey: env("MYBOTS_IMAGE_API_KEY") || env("OPENAI_API_KEY"),
  openaiModel: env("MYBOTS_IMAGE_MODEL", "gpt-image-1"),
  ffmpeg: env("MYBOTS_FFMPEG", "ffmpeg"),
  ffprobe: env("MYBOTS_FFPROBE", "ffprobe"),
  maxFrames: Number(env("MYBOTS_VIDEO_FRAMES", "8")),
};

type SaveFile = (botId: string, name: string, mime: string, data: Buffer) => { id: string; name: string; mime: string; size: number; url: string; path?: string };

export class MediaService {
  constructor(private db: Db, private saveFile: SaveFile, private fileById: (id: string) => { path: string; mime: string; name: string } | undefined) {}

  // ---------- cota ----------

  budget(): MediaBudget {
    const b = this.db.getSetting<Partial<MediaBudget>>("media.budget");
    return { global: b?.global ?? DEFAULT_MEDIA_BUDGET.global, perProvider: b?.perProvider ?? DEFAULT_MEDIA_BUDGET.perProvider, bots: b?.bots ?? {} };
  }

  setBudget(patch: Partial<MediaBudget>): MediaBudget {
    const cur = this.budget();
    const next: MediaBudget = {
      global: patch.global ? cleanLimits(patch.global) : cur.global,
      perProvider: patch.perProvider ? Object.fromEntries(Object.entries(patch.perProvider).map(([k, v]) => [k, cleanLimits(v ?? {})])) as MediaBudget["perProvider"] : cur.perProvider,
      bots: patch.bots ? Object.fromEntries(Object.entries(patch.bots).map(([k, v]) => [k, cleanLimits(v)])) : cur.bots,
    };
    this.db.setSetting("media.budget", next);
    this.db.audit(null, "media.budget", next);
    return next;
  }

  usage(day = today()): MediaUsage {
    const rows = this.db.mediaUsage(day);
    const u: MediaUsage = { day, total: { images: 0, videoSeconds: 0 }, perProvider: {}, perBot: {} };
    for (const r of rows) {
      const add = (t: { images: number; videoSeconds: number }) => { if (r.kind === "image") t.images += r.amount; else t.videoSeconds += r.amount; };
      add(u.total);
      add((u.perProvider[r.provider as MediaProvider] ??= { images: 0, videoSeconds: 0 }));
      add((u.perBot[r.bot_id] ??= { images: 0, videoSeconds: 0 }));
    }
    return u;
  }

  /** Cabe na cota do bot, do provedor e global? Devolve o motivo quando não cabe. */
  allowed(botId: string, provider: MediaProvider, kind: MediaKind, amount: number): string | null {
    const b = this.budget();
    const u = this.usage();
    const zero = { images: 0, videoSeconds: 0 };
    if (!withinLimit(b.perProvider[provider], kind, u.perProvider[provider] ?? zero, amount)) return `cota do dia do provedor ${provider} esgotada`;
    if (!withinLimit(b.bots[botId], kind, u.perBot[botId] ?? zero, amount)) return `cota do dia do bot ${botId} esgotada`;
    if (!withinLimit(b.global, kind, u.total, amount)) return "cota global do dia esgotada";
    return null;
  }

  // ---------- geração ----------

  async generate(botId: string, kind: MediaKind, prompt: string, opts: { refFileId?: string; seconds?: number; aspect?: string } = {}): Promise<MediaResult> {
    const tried: Array<{ provider: MediaProvider; reason: string }> = [];
    const seconds = kind === "video" ? clamp(Math.round(opts.seconds ?? 5), 2, 15) : 0;
    const amount = kind === "image" ? 1 : seconds;
    const ref = opts.refFileId ? this.fileById(opts.refFileId) : undefined;
    const refData = ref && fs.existsSync(ref.path) ? { mime: ref.mime, data: fs.readFileSync(ref.path) } : undefined;
    const order = (env("MYBOTS_MEDIA_ORDER") || MEDIA_PROVIDERS.join(",")).split(",").map((s) => s.trim()).filter((s): s is MediaProvider => (MEDIA_PROVIDERS as string[]).includes(s));
    for (const provider of order) {
      const over = this.allowed(botId, provider, kind, amount);
      if (over) { tried.push({ provider, reason: over }); continue; }
      try {
        const out = await this.generateWith(provider, kind, prompt, { ref: refData, seconds, aspect: opts.aspect });
        if (!out) { tried.push({ provider, reason: "não configurado/indisponível" }); continue; }
        const ext = out.mime.includes("png") ? "png" : out.mime.includes("jpeg") ? "jpg" : out.mime.includes("webp") ? "webp" : out.mime.includes("mp4") ? "mp4" : out.mime.includes("webm") ? "webm" : "bin";
        const name = `${kind === "image" ? "imagem" : "video"}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`;
        const file = this.saveFile(botId, name, out.mime, out.data);
        this.db.mediaUsageAdd(today(), botId, provider, kind, amount);
        this.db.audit(botId, "media.generated", { kind, provider, prompt: prompt.slice(0, 300), seconds: seconds || undefined, file: file.name, size: file.size });
        return { ok: true, provider, file: { id: file.id, name: file.name, mime: file.mime, url: file.url, size: file.size }, seconds: seconds || undefined, note: out.note };
      } catch (e) {
        tried.push({ provider, reason: (e as Error).message.slice(0, 300) });
      }
    }
    this.db.audit(botId, "media.failed", { kind, prompt: prompt.slice(0, 300), tried });
    const budgetOnly = tried.length > 0 && tried.every((t) => /cota/.test(t.reason));
    return { ok: false, error: budgetOnly ? `Cota de ${kind === "image" ? "imagens" : "vídeo"} do dia esgotada em todos os provedores. Peça ao chefe para aumentar em /api/media/budget ou tente amanhã.` : `Nenhum provedor conseguiu gerar: ${tried.map((t) => `${t.provider}: ${t.reason}`).join(" · ") || "nenhum configurado"}`, tried };
  }

  private async generateWith(provider: MediaProvider, kind: MediaKind, prompt: string, o: { ref?: { mime: string; data: Buffer }; seconds: number; aspect?: string }): Promise<{ data: Buffer; mime: string; note?: string } | null> {
    switch (provider) {
      // Os dois de graça só fazem imagem, e só sem referência: quando o pedido traz uma
      // imagem de base, devolvem null e a vez passa a quem sabe fazer isso.
      case "pollinations": return kind === "image" && !o.ref ? pollinationsImage(prompt, o.aspect) : null;
      case "cloudflare": return kind === "image" && !o.ref ? cloudflareImage(prompt, o.aspect) : null;
      case "comfy": return kind === "image" ? comfyImage(prompt, o.ref, o.aspect) : comfyVideoH3(prompt, o.ref, o.seconds, o.aspect);
      case "gemini": return kind === "image" ? geminiImage(prompt, o.ref) : geminiVideo(prompt, o.ref, o.seconds, o.aspect);
      case "openai": return kind === "image" ? openaiImage(prompt, o.aspect) : null;
    }
  }

  // ---------- vídeos que chegam: quadros + transcrição ----------

  /** Para cada vídeo/áudio anexado, acrescenta quadros (jpeg) e transcrição. Nunca falha: sem ffmpeg, devolve só os originais. */
  async enrich(botId: string, attachments: Attachment[]): Promise<Attachment[]> {
    const out: Attachment[] = [];
    for (const a of attachments) {
      const f = this.fileById(a.id);
      if (!f || !fs.existsSync(f.path) || (!isVideoMime(a.mime) && !isAudioMime(a.mime))) { out.push(a); continue; }
      let transcript: string | undefined;
      const frames: Attachment[] = [];
      if (isVideoMime(a.mime) && (await hasFfmpeg())) {
        try {
          const dur = await probeDuration(f.path);
          const n = clamp(Math.round(dur / 2) || 1, 2, mediaSettings.maxFrames);
          for (let i = 0; i < n; i++) {
            const t = dur > 0 ? Math.max(0, Math.min(dur - 0.05, (dur * (i + 0.5)) / n)) : i;
            const jpg = await frameAt(f.path, t);
            if (!jpg) continue;
            const saved = this.saveFile(botId, `${path.parse(a.name).name}-quadro-${i + 1}.jpg`, "image/jpeg", jpg);
            frames.push({ id: saved.id, name: saved.name, mime: saved.mime, url: saved.url, size: saved.size, derivedFrom: a.id, atSecond: Math.round(t * 10) / 10 });
          }
        } catch (e) { console.error(`[media] quadros de ${a.name}: ${(e as Error).message}`); }
      }
      if (voiceSettings.sttUrl) {
        try {
          let audio: Buffer | null = null, mime = a.mime;
          if (isVideoMime(a.mime) && (await hasFfmpeg())) { audio = await extractAudio(f.path); mime = "audio/mpeg"; }
          else if (isAudioMime(a.mime)) audio = fs.readFileSync(f.path);
          if (audio?.length) transcript = (await transcribe(audio, mime, mime.includes("mpeg") ? "audio.mp3" : "audio.webm")).trim() || undefined;
        } catch (e) { console.error(`[media] transcrição de ${a.name}: ${(e as Error).message}`); }
      }
      out.push({ ...a, ...(transcript ? { transcript } : {}) }, ...frames);
    }
    return out;
  }
}

// ---------- utilidades ----------

const today = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD no fuso local
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
function cleanLimits(l: MediaLimits): MediaLimits {
  const out: MediaLimits = {};
  if (typeof l.imagesPerDay === "number" && l.imagesPerDay >= 0) out.imagesPerDay = Math.floor(l.imagesPerDay);
  if (typeof l.videoSecondsPerDay === "number" && l.videoSecondsPerDay >= 0) out.videoSecondsPerDay = Math.floor(l.videoSecondsPerDay);
  return out;
}

function sizeFor(aspect?: string, base = 1024): { w: number; h: number } {
  const a = (aspect ?? "").trim();
  if (a === "9:16" || a === "vertical") return { w: Math.round(base * 0.75), h: Math.round(base * 1.3125) }; // 768x1344
  if (a === "16:9" || a === "horizontal") return { w: Math.round(base * 1.3125), h: Math.round(base * 0.75) };
  return { w: base, h: base };
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 30_000): Promise<any> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const t = await r.text();
  if (!r.ok) throw new Error(redigir(`HTTP ${r.status} ${url}: ${t.slice(0, 300)}`));
  try { return JSON.parse(t); } catch { return t; }
}

// ---------- grátis, na nuvem (não usam a placa desta casa) ----------

/**
 * Pollinations: GET com o pedido na própria URL, devolve a imagem pronta. Sem chave, sem conta.
 * É o caminho que faz o bot ilustrar uma resposta às 15h sem disputar a 4090 com a Júlia.
 */
export async function pollinationsImage(prompt: string, aspect?: string): Promise<{ data: Buffer; mime: string; note?: string } | null> {
  if (!mediaSettings.pollinationsUrl) return null;
  const { w, h } = sizeFor(aspect);
  const q = new URLSearchParams({ width: String(w), height: String(h), model: mediaSettings.pollinationsModel, nologo: "true", seed: String(Math.floor(Math.random() * 1e9)) });
  const url = `${mediaSettings.pollinationsUrl.replace(/\/$/, "")}/prompt/${encodeURIComponent(prompt)}?${q}`;
  const headers: Record<string, string> = {};
  if (mediaSettings.pollinationsToken) headers.authorization = `Bearer ${mediaSettings.pollinationsToken}`;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`Pollinations HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const mime = (r.headers.get("content-type") ?? "image/jpeg").split(";")[0];
  if (!mime.startsWith("image/")) throw new Error(`Pollinations devolveu ${mime}, que não é uma imagem`);
  const data = Buffer.from(await r.arrayBuffer());
  if (data.length < 1024) throw new Error("Pollinations devolveu um arquivo vazio");
  return { data, mime, note: "Gerado de graça na nuvem (Pollinations/FLUX) — a RTX 4090 ficou livre." };
}

/**
 * Cloudflare Workers AI (FLUX.1 schnell). Grátis dentro da cota do dia, mas exige conta:
 * ID da conta + token. Sem os dois, a ferramenta simplesmente não existe (devolve null).
 * O flux-1-schnell responde JSON com a imagem em base64; outros modelos respondem o binário.
 */
export async function cloudflareImage(prompt: string, aspect?: string): Promise<{ data: Buffer; mime: string; note?: string } | null> {
  const { cloudflareAccount: acc, cloudflareToken: tok, cloudflareModel: model } = mediaSettings;
  if (!acc || !tok) return null;
  // FLUX schnell na Workers AI não aceita width/height (erro 400); o aspect vai só no prompt.
  const promptFinal = aspect && aspect !== "1:1" ? `${prompt} (aspect ${aspect})` : prompt;
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(acc)}/ai/run/${model}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
    body: JSON.stringify({ prompt: promptFinal, steps: 4 }),
    signal: AbortSignal.timeout(120_000),
  });
  const mime = (r.headers.get("content-type") ?? "").split(";")[0];
  if (!r.ok) throw new Error(`Cloudflare HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  if (mime.startsWith("image/")) return { data: Buffer.from(await r.arrayBuffer()), mime, note: "Gerado de graça na nuvem (Cloudflare Workers AI)." };
  const data = await r.json().catch(() => null) as any;
  const b64 = data?.result?.image;
  if (typeof b64 !== "string" || b64.length < 100) throw new Error(`Cloudflare não devolveu imagem: ${JSON.stringify(data?.errors ?? data).slice(0, 200)}`);
  return { data: Buffer.from(b64, "base64"), mime: "image/jpeg", note: "Gerado de graça na nuvem (Cloudflare Workers AI / FLUX schnell)." };
}

// ---------- ComfyUI ----------

async function comfyHealthy(base: string): Promise<boolean> {
  try { const r = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(3000) }); return r.ok; } catch { return false; }
}

async function comfyUpload(base: string, data: Buffer, mime: string): Promise<string> {
  const form = new FormData();
  const name = `mybots-ref-${Date.now()}.${mime.includes("png") ? "png" : "jpg"}`;
  form.append("image", new Blob([new Uint8Array(data)], { type: mime }), name);
  form.append("overwrite", "true");
  const r = await fetchJson(`${base}/upload/image`, { method: "POST", body: form });
  return r.name ?? name;
}

/** Envia o grafo, espera no /history e baixa o primeiro arquivo de saída. */
async function comfyRun(base: string, graph: Record<string, unknown>, timeoutMs: number, kinds: string[]): Promise<{ data: Buffer; mime: string }> {
  const r = await fetchJson(`${base}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: graph, client_id: "mybots" }) });
  const id = r.prompt_id;
  if (!id) throw new Error(`ComfyUI não devolveu prompt_id: ${JSON.stringify(r).slice(0, 300)}`);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await new Promise((res) => setTimeout(res, 1500));
    const h = await fetchJson(`${base}/history/${id}`).catch(() => ({}));
    const entry = h?.[id];
    if (!entry) continue;
    if (entry.status?.status_str === "error") throw new Error(`ComfyUI: ${JSON.stringify(entry.status?.messages ?? "").slice(0, 300)}`);
    for (const node of Object.values(entry.outputs ?? {}) as any[]) {
      for (const k of kinds) {
        const f = node?.[k]?.[0];
        if (f?.filename) {
          const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? "", type: f.type ?? "output" });
          const res = await fetch(`${base}/view?${q}`, { signal: AbortSignal.timeout(120_000) });
          if (!res.ok) throw new Error(`ComfyUI /view HTTP ${res.status}`);
          const mime = res.headers.get("content-type")?.split(";")[0] || (k === "images" ? "image/png" : "video/mp4");
          return { data: Buffer.from(await res.arrayBuffer()), mime: mime === "application/octet-stream" ? (k === "images" ? "image/png" : "video/mp4") : mime };
        }
      }
    }
    if (entry.status?.completed) throw new Error("ComfyUI terminou sem arquivo de saída");
  }
  throw new Error("ComfyUI: tempo esgotado");
}

async function comfyImage(prompt: string, ref?: { mime: string; data: Buffer }, aspect?: string) {
  const base = mediaSettings.comfyUrl.replace(/\/$/, "");
  if (!(await comfyHealthy(base))) return null;
  let ckpt = mediaSettings.comfyCheckpoint;
  if (!ckpt) {
    const info = await fetchJson(`${base}/object_info/CheckpointLoaderSimple`);
    ckpt = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]?.[0];
    if (!ckpt) throw new Error("ComfyUI sem checkpoint de imagem");
  }
  const { w, h } = sizeFor(aspect);
  const g: Record<string, unknown> = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ckpt } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: "text, watermark, logo, blurry, low quality, deformed", clip: ["1", 1] } },
    "5": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], seed: Math.floor(Math.random() * 2 ** 48), steps: 25, cfg: 6, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: ref ? 0.65 : 1 } },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "mybots/imagem" } },
  };
  if (ref) {
    const name = await comfyUpload(base, ref.data, ref.mime);
    g["8"] = { class_type: "LoadImage", inputs: { image: name } };
    g["4"] = { class_type: "VAEEncode", inputs: { pixels: ["8", 0], vae: ["1", 2] } };
  } else {
    g["4"] = { class_type: "EmptyLatentImage", inputs: { width: w, height: h, batch_size: 1 } };
  }
  return comfyRun(base, g, 10 * 60_000, ["images"]);
}

/** MiniMax H3 no ComfyUI da porta 8189 (grafo de D:\IA\H3\run_h3.py). Fora do horário comercial, salvo MYBOTS_H3_ANYTIME=1. */
async function comfyVideoH3(prompt: string, ref: { mime: string; data: Buffer } | undefined, seconds: number, aspect?: string) {
  const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }));
  if (!mediaSettings.h3Anytime && hour >= 8 && hour < 18) throw new Error("H3 local só renderiza fora do horário comercial (8h–18h a GPU é da Júlia); defina MYBOTS_H3_ANYTIME=1 para liberar");
  const base = mediaSettings.h3Url.replace(/\/$/, "");
  if (!(await comfyHealthy(base))) {
    if (!mediaSettings.h3StartScript || os.platform() !== "win32" || !fs.existsSync(mediaSettings.h3StartScript)) return null;
    // sobe o ComfyUI do H3 e espera até 3 min
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", mediaSettings.h3StartScript], { windowsHide: true }, () => {});
    const end = Date.now() + 180_000;
    while (Date.now() < end && !(await comfyHealthy(base))) await new Promise((r) => setTimeout(r, 3000));
    if (!(await comfyHealthy(base))) throw new Error("ComfyUI do H3 (8189) não subiu");
  }
  const free = os.freemem() / 1e9;
  if (free < 18) throw new Error(`RAM livre insuficiente para o H3 (${free.toFixed(0)} GB; precisa ~20 GB)`);
  // frames na grade 17k+5, 24 fps: 5 s ≈ 124
  const frames = clamp(Math.round((seconds * 24 - 5) / 17) * 17 + 5, 39, 362);
  const vertical = !aspect || aspect === "9:16" || aspect === "vertical";
  const W = vertical ? 768 : 1344, H = vertical ? 1344 : 768;
  const fullPrompt = `${prompt}\n\nSpeech in Brazilian Portuguese. No on-screen text, no subtitles, no logos, no watermarks.`;
  const g: Record<string, unknown> = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "minimax_h3_fl2va_pruned_int8_convrot.safetensors", weight_dtype: "default" } },
    "2": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors", strength_model: 1.0 } },
    "3": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" } },
    "4": { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_video_vae_int8_convrot.safetensors" } },
    "5": { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" } },
    "6": { class_type: "MiniMaxH3ImageToVideo", inputs: { clip: ["3", 0], vae: ["4", 0], prompt: fullPrompt, width: W, height: H, length: frames } },
    "7": { class_type: "RandomNoise", inputs: { noise_seed: Math.floor(Math.random() * 2 ** 48) } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" } },
    "9": { class_type: "BasicScheduler", inputs: { model: ["2", 0], scheduler: "simple", steps: 4, denoise: 1.0 } },
    "10": { class_type: "BasicGuider", inputs: { model: ["2", 0], conditioning: ["6", 0] } },
    "11": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["7", 0], guider: ["10", 0], sampler: ["8", 0], sigmas: ["9", 0], latent_image: ["6", 1] } },
    "12": { class_type: "VAEDecode", inputs: { samples: ["11", 0], vae: ["4", 0] } },
    "13": { class_type: "VAEDecodeAudio", inputs: { samples: ["11", 0], vae: ["5", 0] } },
    "14": { class_type: "CreateVideo", inputs: { images: ["12", 0], audio: ["13", 0], fps: 24.0 } },
    "15": { class_type: "SaveVideo", inputs: { video: ["14", 0], filename_prefix: "mybots/video", format: "auto", codec: "auto" } },
  };
  if (ref) {
    const name = await comfyUpload(base, ref.data, ref.mime);
    g["16"] = { class_type: "LoadImage", inputs: { image: name } };
    (g["6"] as any).inputs.start_image = ["16", 0];
  }
  const out = await comfyRun(base, g, 25 * 60_000, ["videos", "gifs", "images"]);
  fetch(`${base}/free`, { method: "POST", body: JSON.stringify({ unload_models: true, free_memory: true }), headers: { "content-type": "application/json" } }).catch(() => {});
  return { ...out, note: "Gerado localmente com MiniMax H3 (atribuição: MiniMax H3)." };
}

// ---------- Gemini / Veo ----------

async function geminiImage(prompt: string, ref?: { mime: string; data: Buffer }) {
  if (!mediaSettings.geminiKey) return null;
  const parts: any[] = [{ text: prompt }];
  if (ref) parts.push({ inlineData: { mimeType: ref.mime, data: ref.data.toString("base64") } });
  const url = `${mediaSettings.geminiBase.replace(/\/$/, "")}/models/${mediaSettings.geminiImageModel}:generateContent?key=${encodeURIComponent(mediaSettings.geminiKey)}`;
  const data = await fetchJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } }) }, 120_000);
  const img = (data.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData?.data);
  if (!img) throw new Error("Gemini não devolveu imagem");
  return { data: Buffer.from(img.inlineData.data, "base64"), mime: img.inlineData.mimeType ?? "image/png" };
}

async function geminiVideo(prompt: string, ref: { mime: string; data: Buffer } | undefined, seconds: number, aspect?: string) {
  if (!mediaSettings.geminiKey) return null;
  const base = mediaSettings.geminiBase.replace(/\/$/, "");
  const key = encodeURIComponent(mediaSettings.geminiKey);
  const instance: any = { prompt };
  if (ref) instance.image = { bytesBase64Encoded: ref.data.toString("base64"), mimeType: ref.mime };
  const op = await fetchJson(`${base}/models/${mediaSettings.geminiVideoModel}:predictLongRunning?key=${key}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ instances: [instance], parameters: { aspectRatio: aspect === "16:9" || aspect === "horizontal" ? "16:9" : "9:16", durationSeconds: clamp(seconds, 4, 8) } }),
  }, 120_000);
  if (!op.name) throw new Error("Veo não devolveu operação");
  const end = Date.now() + 10 * 60_000;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 8000));
    const st = await fetchJson(`${base}/${op.name}?key=${key}`);
    if (st.error) throw new Error(redigir(`Veo: ${st.error.message ?? JSON.stringify(st.error).slice(0, 200)}`));
    if (st.done) {
      const uri = st.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ?? st.response?.generatedVideos?.[0]?.video?.uri;
      if (!uri) throw new Error("Veo terminou sem vídeo");
      const r = await fetch(`${uri}${uri.includes("?") ? "&" : "?"}key=${key}`, { signal: AbortSignal.timeout(180_000) });
      if (!r.ok) throw new Error(`Veo download HTTP ${r.status}`);
      return { data: Buffer.from(await r.arrayBuffer()), mime: "video/mp4" };
    }
  }
  throw new Error("Veo: tempo esgotado");
}

// ---------- API compatível com OpenAI ----------

async function openaiImage(prompt: string, aspect?: string) {
  if (!mediaSettings.openaiUrl) return null;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (mediaSettings.openaiKey) headers.authorization = `Bearer ${mediaSettings.openaiKey}`;
  const size = aspect === "9:16" || aspect === "vertical" ? "1024x1536" : aspect === "16:9" || aspect === "horizontal" ? "1536x1024" : "1024x1024";
  const data = await fetchJson(`${mediaSettings.openaiUrl.replace(/\/$/, "")}/images/generations`, { method: "POST", headers, body: JSON.stringify({ model: mediaSettings.openaiModel, prompt, n: 1, size, response_format: "b64_json" }) }, 180_000);
  const d = data.data?.[0];
  if (d?.b64_json) return { data: Buffer.from(d.b64_json, "base64"), mime: "image/png" };
  if (d?.url) { const r = await fetch(d.url, { signal: AbortSignal.timeout(60_000) }); return { data: Buffer.from(await r.arrayBuffer()), mime: r.headers.get("content-type")?.split(";")[0] || "image/png" }; }
  throw new Error("API de imagem não devolveu dados");
}

// ---------- ffmpeg ----------

let ffmpegOk: boolean | null = null;
export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegOk !== null) return ffmpegOk;
  ffmpegOk = await new Promise<boolean>((res) => execFile(mediaSettings.ffmpeg, ["-version"], { windowsHide: true, timeout: 10_000 }, (e) => res(!e)));
  if (!ffmpegOk) console.warn("[media] ffmpeg não encontrado: vídeos recebidos não terão quadros extraídos (instale com: winget install ffmpeg)");
  return ffmpegOk;
}

function run(bin: string, args: string[], timeout = 120_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" }, (e, stdout, stderr) => {
      if (e) return reject(new Error(`${path.basename(bin)}: ${String(stderr ?? "").slice(-300) || e.message}`));
      resolve(stdout as unknown as Buffer);
    });
  });
}

async function probeDuration(file: string): Promise<number> {
  try {
    const out = await run(mediaSettings.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], 20_000);
    return Number(out.toString().trim()) || 0;
  } catch { return 0; }
}

async function frameAt(file: string, second: number): Promise<Buffer | null> {
  try { return await run(mediaSettings.ffmpeg, ["-v", "error", "-ss", second.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=768:-2", "-q:v", "4", "-f", "image2", "-vcodec", "mjpeg", "pipe:1"], 30_000); }
  catch { return null; }
}

async function extractAudio(file: string): Promise<Buffer | null> {
  try { return await run(mediaSettings.ffmpeg, ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", "-f", "mp3", "pipe:1"], 120_000); }
  catch { return null; }
}
