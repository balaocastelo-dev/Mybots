// Provedor Google Gemini — generateContent com functionDeclarations.
import { type ChatRequest, type ChatResponse, type Provider, postJson } from "./types.js";

export class GeminiProvider implements Provider {
  readonly kind = "gemini";
  constructor(public readonly model: string, private apiKey: string, private baseURL = "https://generativelanguage.googleapis.com/v1beta") {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const contents: any[] = [];
    const callNames = new Map<string, string>();
    for (const m of req.messages) {
      if (m.role === "user") contents.push({
        role: "user",
        parts: [{ text: m.content }, ...(m.media ?? []).map((x) => ({ inlineData: { mimeType: x.mime, data: x.dataBase64 } }))],
      });
      else if (m.role === "assistant") {
        const parts: any[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const t of m.toolCalls ?? []) { callNames.set(t.id, t.name); parts.push({ functionCall: { name: t.name, args: t.args } }); }
        if (parts.length) contents.push({ role: "model", parts });
      } else {
        const part = { functionResponse: { name: m.name || callNames.get(m.toolCallId) || "tool", response: { result: m.content } } };
        const last = contents[contents.length - 1];
        if (last?.role === "user" && last.parts[0]?.functionResponse) last.parts.push(part);
        else contents.push({ role: "user", parts: [part] });
      }
    }
    const body: any = {
      // Gemini não tem cache de prefixo aqui: o fixo e o volátil vão juntos.
      systemInstruction: { parts: [{ text: [req.systemFixo, req.system].filter(Boolean).join("\n") }] },
      contents,
      generationConfig: { temperature: req.temperature ?? 0.3, ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}) },
    };
    if (req.tools.length) body.tools = [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: cleanSchema(t.parameters) })) }];
    const url = `${this.baseURL.replace(/\/$/, "")}/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const data = await postJson(url, {}, body, req.signal);
    const parts: any[] = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
    const toolCalls = parts.filter((p) => p.functionCall).map((p, i) => ({ id: p.functionCall.id ?? `gem_${Date.now()}_${i}`, name: p.functionCall.name, args: p.functionCall.args ?? {} }));
    return { text: text.trim(), toolCalls, truncado: data.candidates?.[0]?.finishReason === "MAX_TOKENS", usage: { input: data.usageMetadata?.promptTokenCount, output: data.usageMetadata?.candidatesTokenCount }, raw: data };
  }
}

/** O Gemini rejeita chaves fora do subconjunto OpenAPI que ele aceita. */
function cleanSchema(s: any): any {
  if (Array.isArray(s)) return s.map(cleanSchema);
  if (s && typeof s === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === "default" || k === "additionalProperties" || k === "$schema") continue;
      out[k] = k === "type" && typeof v === "string" ? v.toUpperCase() : cleanSchema(v);
    }
    return out;
  }
  return s;
}
