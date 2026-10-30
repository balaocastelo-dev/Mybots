// Olhos do bot: transforma anexos (imagem, e quadros de vídeo que o Hub extraiu) em algo
// que o modelo entenda.
//  - Modelo que já enxerga (Gemini, Claude, GPT-4o, qwen2.5vl…): manda a imagem direto.
//  - Modelo só de texto (qwen3, gpt-oss, llama…): um modelo de visão descreve a imagem
//    e a descrição entra como texto. Assim o bot "vê" sem trocar o cérebro dele.
import type { Attachment } from "@mybots/shared";
import { isImageMime } from "@mybots/shared";
import type { NodeConfig } from "./config.js";
import type { MediaPart } from "./providers/types.js";

/** Famílias que já leem imagem sozinhas. */
const MODELO_ENXERGA = /vl\b|vision|llava|gemma3|minicpm-v|moondream|gpt-4o|gpt-4\.1|o4|claude|gemini|pixtral|internvl/i;

export type VisionPlan =
  | { modo: "nativo" }
  | { modo: "descrever"; model: string; baseURL: string }
  | { modo: "sem-visao" };

export function visionPlan(cfg: NodeConfig): VisionPlan {
  const forcado = (process.env.MYBOTS_VISION_MODEL ?? cfg.provider.visionModel ?? "").trim();
  const nativo = MODELO_ENXERGA.test(cfg.provider.model) || ["gemini", "anthropic"].includes(cfg.provider.kind);
  if (nativo && !forcado) return { modo: "nativo" };
  const base = (cfg.provider.visionBaseURL ?? (cfg.provider.kind === "ollama" ? cfg.provider.baseURL : undefined) ?? "http://127.0.0.1:11434/v1").replace(/\/$/, "");
  const model = forcado || (cfg.provider.kind === "ollama" ? "qwen2.5vl:7b" : "");
  if (!model) return nativo ? { modo: "nativo" } : { modo: "sem-visao" };
  return { modo: "descrever", model, baseURL: base };
}

/** Baixa os anexos de imagem do Hub. Vídeo já chega como quadros (derivedFrom). */
export async function baixarImagens(atts: Attachment[], hubHttp: string, token: string, max = 8): Promise<Array<MediaPart & { origem?: string; segundo?: number }>> {
  const imagens = atts.filter((a) => isImageMime(a.mime)).slice(0, max);
  const out: Array<MediaPart & { origem?: string; segundo?: number }> = [];
  for (const a of imagens) {
    try {
      const url = /^https?:/i.test(a.url) ? a.url : `${hubHttp.replace(/\/$/, "")}${a.url}`;
      const r = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 12 * 1024 * 1024) continue; // imagem absurda: pula
      out.push({ mime: a.mime, dataBase64: buf.toString("base64"), name: a.name, origem: a.derivedFrom, segundo: a.atSecond });
    } catch { /* anexo que não baixou não derruba o turno */ }
  }
  return out;
}

/** Pede a um modelo de visão que descreva as imagens. Devolve texto para injetar no prompt. */
export async function descrever(
  partes: Array<MediaPart & { origem?: string; segundo?: number }>,
  plano: Extract<VisionPlan, { modo: "descrever" }>,
  pergunta: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!partes.length) return "";
  const linhas: string[] = [];
  for (const p of partes) {
    const rotulo = p.segundo !== undefined ? `quadro do vídeo aos ${p.segundo}s` : p.name || "imagem";
    try {
      const corpo = {
        model: plano.model,
        stream: false,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: `Descreva esta imagem em português, com detalhe suficiente para alguém que não a viu responder a: "${pergunta.slice(0, 300)}". Diga o que aparece, textos legíveis, números, cores e o que parece estar acontecendo. Seja objetivo, até 120 palavras.` },
            { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.dataBase64}` } },
          ],
        }],
      };
      const r = await fetch(`${plano.baseURL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
        signal: signal ?? AbortSignal.timeout(120_000),
      });
      const j = (await r.json()) as any;
      const txt = j?.choices?.[0]?.message?.content?.trim?.() ?? "";
      linhas.push(txt ? `[${rotulo}] ${txt}` : `[${rotulo}] (não consegui enxergar)`);
    } catch (e) {
      linhas.push(`[${rotulo}] (falha ao olhar: ${(e as Error).message})`);
    }
  }
  return linhas.join("\n");
}
