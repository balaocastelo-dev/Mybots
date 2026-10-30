// Provedor Anthropic (Claude) — Messages API com ferramentas.
import { type ChatRequest, type ChatResponse, type Provider, parseArgs, postJson, postSSE, ProviderError } from "./types.js";

export class AnthropicProvider implements Provider {
  readonly kind = "anthropic";
  constructor(public readonly model: string, private apiKey: string, private baseURL = "https://api.anthropic.com") {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const messages: any[] = [];
    for (const m of req.messages) {
      if (m.role === "user") messages.push({
        role: "user",
        content: [
          { type: "text", text: m.content },
          ...(m.media ?? []).filter((x) => /^image\//i.test(x.mime)).map((x) => ({ type: "image", source: { type: "base64", media_type: x.mime, data: x.dataBase64 } })),
        ],
      });
      else if (m.role === "assistant") {
        const content: any[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const t of m.toolCalls ?? []) content.push({ type: "tool_use", id: t.id, name: t.name, input: t.args });
        if (content.length) messages.push({ role: "assistant", content });
      } else {
        // resultados de ferramentas vão como mensagem do usuário; agrupa consecutivos
        const last = messages[messages.length - 1];
        const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
        if (last?.role === "user" && last.content[0]?.type === "tool_result") last.content.push(block);
        else messages.push({ role: "user", content: [block] });
      }
    }
    const body: any = {
      model: this.model,
      max_tokens: req.maxTokens ?? 4096,
      // Prefixo fixo marcado como cacheável: a Anthropic guarda esse pedaço por
      // alguns minutos e cobra uma fração do preço nas próximas mensagens.
      system: req.systemFixo
        ? [
            { type: "text", text: req.systemFixo, cache_control: { type: "ephemeral" } },
            ...(req.system ? [{ type: "text", text: req.system }] : []),
          ]
        : req.system,
      messages,
      temperature: req.temperature ?? 0.3,
    };
    if (req.tools.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    const url = `${this.baseURL.replace(/\/$/, "")}/v1/messages`;
    const headers = { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" };

    // Em fluxo: o texto sai palavra a palavra (a voz da chamada começa na primeira frase).
    if (req.onText) {
      body.stream = true;
      let texto = "";
      const blocos = new Map<number, { tipo: string; id?: string; nome?: string; json: string }>();
      const usage: { input?: number; output?: number; cacheLido?: number; cacheGravado?: number } = {};
    let motivo = "";
      await postSSE(url, headers, body, req.signal, (ev) => {
        if (ev.type === "message_start") {
          usage.input = ev.message?.usage?.input_tokens;
          usage.cacheLido = ev.message?.usage?.cache_read_input_tokens;
          usage.cacheGravado = ev.message?.usage?.cache_creation_input_tokens;
        }
        else if (ev.type === "content_block_start") blocos.set(ev.index, { tipo: ev.content_block?.type, id: ev.content_block?.id, nome: ev.content_block?.name, json: "" });
        else if (ev.type === "content_block_delta") {
          if (ev.delta?.type === "text_delta" && ev.delta.text) { texto += ev.delta.text; req.onText!(ev.delta.text); }
          else if (ev.delta?.type === "input_json_delta") { const b = blocos.get(ev.index); if (b) b.json += ev.delta.partial_json ?? ""; }
        }
        else if (ev.type === "message_delta") { usage.output = ev.usage?.output_tokens ?? usage.output; if (ev.delta?.stop_reason) motivo = String(ev.delta.stop_reason); }
        else if (ev.type === "error") throw new ProviderError(`erro no fluxo: ${ev.error?.message ?? "sem detalhe"}`);
      });
      const chamadas = [...blocos.values()].filter((b) => b.tipo === "tool_use")
        .map((b, i) => ({ id: b.id ?? `call_${i}`, name: b.nome ?? "", args: parseArgs(b.json || "{}") }));
      return { text: texto.trim(), toolCalls: chamadas, usage, truncado: motivo === "max_tokens" };
    }

    const data = await postJson(url, headers, body, req.signal);
    const text = (data.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    const toolCalls = (data.content ?? []).filter((c: any) => c.type === "tool_use").map((c: any) => ({ id: c.id, name: c.name, args: c.input ?? {} }));
    return { text: text.trim(), toolCalls, truncado: data.stop_reason === "max_tokens", usage: { input: data.usage?.input_tokens, output: data.usage?.output_tokens, cacheLido: data.usage?.cache_read_input_tokens, cacheGravado: data.usage?.cache_creation_input_tokens }, raw: data };
  }
}
