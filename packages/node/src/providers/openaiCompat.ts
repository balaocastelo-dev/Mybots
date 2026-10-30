// Provedor compatível com a API de chat da OpenAI: Nous Portal, Ollama, OpenRouter, OpenCode Zen (pago), Groq, LM Studio...
import { type ChatRequest, type ChatResponse, type Provider, parseArgs, postJson, postSSE } from "./types.js";

export class OpenAICompatProvider implements Provider {
  constructor(public readonly kind: string, public readonly model: string, private baseURL: string, private apiKey?: string, private extraHeaders: Record<string, string> = {}) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const messages: any[] = [{ role: "system", content: [req.systemFixo, req.system].filter(Boolean).join("\n") }];
    for (const m of req.messages) {
      if (m.role === "user") {
        // imagem anexada: o formato multimodal da OpenAI (vale para Ollama, OpenRouter, Groq…)
        messages.push(m.media?.length
          ? { role: "user", content: [{ type: "text", text: m.content }, ...m.media.filter((x) => /^image\//i.test(x.mime)).map((x) => ({ type: "image_url", image_url: { url: `data:${x.mime};base64,${x.dataBase64}` } }))] }
          : { role: "user", content: m.content });
      }
      else if (m.role === "assistant") {
        const msg: any = { role: "assistant", content: m.content || null };
        if (m.toolCalls?.length) msg.tool_calls = m.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) } }));
        messages.push(msg);
      } else messages.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    }
    const body: any = { model: this.model, messages, temperature: req.temperature ?? 0.3 };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.tools.length) {
      body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = "auto";
    }
    const headers: Record<string, string> = { ...this.extraHeaders };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const url = `${this.baseURL.replace(/\/$/, "")}/chat/completions`;

    // Em fluxo: o texto sai aos poucos (a voz da chamada começa na primeira frase).
    if (req.onText) {
      body.stream = true;
      let bruto = "";
      const chamadas = new Map<number, { id?: string; nome: string; args: string }>();
      const usage: { input?: number; output?: number } = {};
    let motivo = "";
      await postSSE(url, headers, body, req.signal, (ev) => {
        if (ev.usage) { usage.input = ev.usage.prompt_tokens ?? usage.input; usage.output = ev.usage.completion_tokens ?? usage.output; }
      if (ev.choices?.[0]?.finish_reason) motivo = String(ev.choices[0].finish_reason);
        const d = ev.choices?.[0]?.delta;
        if (!d) return;
        if (typeof d.content === "string" && d.content) { bruto += d.content; req.onText!(d.content); }
        for (const tc of d.tool_calls ?? []) {
          const i = tc.index ?? 0;
          const cur = chamadas.get(i) ?? { nome: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.nome += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          chamadas.set(i, cur);
        }
      });
      const toolCallsFluxo = [...chamadas.entries()].map(([i, c]) => ({ id: c.id ?? `call_${i}`, name: c.nome, args: parseArgs(c.args || "{}") }));
      return { text: bruto.replace(/<think>[\s\S]*?<\/think>/g, "").trim(), toolCalls: toolCallsFluxo, usage, truncado: motivo === "length" };
    }

    const data = await postJson(url, headers, body, req.signal);
    const choice = data.choices?.[0];
    const msg = choice?.message ?? {};
    const toolCalls = (msg.tool_calls ?? []).map((t: any, i: number) => ({ id: t.id ?? `call_${i}`, name: t.function?.name ?? t.name, args: parseArgs(t.function?.arguments ?? t.arguments) }));
    let text: string = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.map((c: any) => c.text ?? "").join("") : "";
    // Modelos com "raciocínio" às vezes devolvem <think>...</think>; escondemos.
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return { text, toolCalls, usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens }, truncado: data.choices?.[0]?.finish_reason === "length", raw: data };
  }
}
