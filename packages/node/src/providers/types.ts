export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

/** Imagem (ou vídeo pequeno, só para quem aceita) anexada a uma mensagem do usuário. */
export type MediaPart = { mime: string; dataBase64: string; name?: string };

export type ChatMessage =
  | { role: "user"; content: string; media?: MediaPart[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type JsonSchema = {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: string[]; items?: { type: string }; default?: unknown }>;
  required?: string[];
};

export type ToolDef = { name: string; description: string; parameters: JsonSchema };

export type ChatRequest = {
  /**
   * A parte VOLÁTIL do system (data/hora, tipo da conversa). Fica depois do
   * prefixo fixo, para não estragar o cache dele.
   */
  system: string;
  /**
   * A parte FIXA: persona, base de conhecimento, regras. É igual em toda
   * mensagem, então vai marcada como cacheável — é o que corta a maior parte
   * do custo de entrada.
   */
  systemFixo?: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /**
   * Chamada de voz: cada pedacinho de texto, assim que o modelo escreve.
   * Quem passa isto pede ao provedor a resposta em fluxo (stream) — é o que deixa
   * o bot começar a falar na primeira frase em vez de depois do texto inteiro.
   */
  onText?: (delta: string) => void;
};

export type ChatResponse = {
  text: string;
  toolCalls: ToolCall[];
  /**
   * O modelo parou por ter batido no teto de tamanho, nao por ter terminado.
   * Sem isto a resposta cortada no meio da frase chegava como se estivesse
   * completa -- e o chefe via o bot "parar sem concluir".
   */
  truncado?: boolean;
  usage?: { input?: number; output?: number; cacheLido?: number; cacheGravado?: number };
  raw?: unknown;
};

export interface Provider {
  readonly kind: string;
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export class ProviderError extends Error {
  constructor(message: string, public status?: number, public body?: string) {
    super(message);
  }
}

export async function postJson(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
  const text = await res.text();
  if (!res.ok) throw new ProviderError(`HTTP ${res.status} de ${url}: ${text.slice(0, 500)}`, res.status, text);
  try { return JSON.parse(text); } catch { throw new ProviderError(`Resposta não-JSON de ${url}: ${text.slice(0, 300)}`); }
}

export function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  try { return JSON.parse(String(raw)); } catch { return { _raw: String(raw) }; }
}

/**
 * POST que lê a resposta em fluxo (Server-Sent Events) e entrega evento por evento.
 * Um pedaço inválido no meio não derruba o turno: é ignorado.
 */
export async function postSSE(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal | undefined,
  onEvent: (ev: any) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new ProviderError(`HTTP ${res.status} de ${url}: ${t.slice(0, 500)}`, res.status, t);
  }
  const reader = (res.body as any).getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let corte: number;
    while ((corte = buf.indexOf("\n\n")) >= 0) {
      const bloco = buf.slice(0, corte);
      buf = buf.slice(corte + 2);
      const dados = bloco.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
      const d = dados.join("\n");
      if (!d || d === "[DONE]") continue;
      let ev: any;
      try { ev = JSON.parse(d); } catch { continue; }
      onEvent(ev);
    }
  }
}
