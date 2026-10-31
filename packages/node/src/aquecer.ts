// Chat aberto mantém o modelo residente (keep_alive do Ollama) e a conexão
// já feita. Sem conversa ativa, o modelo esfria.
import { OPENAI_COMPAT_PRESETS } from "./config.js";

export type AlvoModelo = { kind: string; model: string; baseURL?: string; apiKey?: string };

export function ociosoMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MYBOTS_WARM_IDLE_MS ?? 10 * 60_000);
  return Number.isFinite(n) && n >= 5_000 ? n : 10 * 60_000;
}

export function keepAlivePadrao(env: NodeJS.ProcessEnv = process.env): string {
  return env.MYBOTS_OLLAMA_KEEP_ALIVE || "15m";
}

export function modeloLocal(kind: string): boolean {
  return kind === "ollama" || kind === "lmstudio";
}

/** Pré-carrega o Ollama ou abre a conexão do provedor. Erro não derruba o chat. */
export async function preaquecer(alvo: AlvoModelo, ativo: boolean, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const base = alvo.baseURL ?? OPENAI_COMPAT_PRESETS[alvo.kind]?.baseURL;
  if (!base) return;
  if (modeloLocal(alvo.kind)) {
    let origin: string;
    try { origin = new URL(base).origin; } catch { return; }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (alvo.apiKey) headers.authorization = `Bearer ${alvo.apiKey}`;
    await fetch(`${origin}/api/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify(ativo
        ? { model: alvo.model, keep_alive: keepAlivePadrao(env) }
        : { model: alvo.model, keep_alive: 0 }),
      signal: AbortSignal.timeout(8_000),
    });
    return;
  }
  if (!ativo) return;
  await fetch(base, { method: "GET", signal: AbortSignal.timeout(2_500) });
}

export class Aquecedor {
  private ativos = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private quente = false;

  constructor(private ping: (ativo: boolean) => Promise<void>, private ocioso = ociosoMs()) {}

  definir(conversationId: string, ativo: boolean) {
    if (ativo) {
      this.ativos.set(conversationId, Date.now());
      void this.ligar();
      return;
    }
    this.ativos.delete(conversationId);
    if (!this.ativos.size) void this.desligar();
  }

  /** Mensagem no chat: mantém o keep_alive, sem disparar outra carga em paralelo. */
  tocar(conversationId: string) {
    this.ativos.set(conversationId, Date.now());
    this.agendar();
  }

  /** Valor de keep_alive enquanto houver chat ativo. */
  keepAlive(agora = Date.now()): string | undefined {
    this.varrer(agora);
    return this.ativos.size ? keepAlivePadrao() : undefined;
  }

  private varrer(agora = Date.now()) {
    const limite = agora - this.ocioso;
    for (const [k, t] of this.ativos) if (t < limite) this.ativos.delete(k);
    if (!this.ativos.size && this.quente) void this.desligar();
  }

  private agendar() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.varrer(), this.ocioso);
    this.timer.unref?.();
  }

  private async ligar() {
    this.agendar();
    if (this.quente) return;
    this.quente = true;
    try { await this.ping(true); } catch { /* o modelo local pode estar desligado */ }
  }

  private async desligar() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.quente) return;
    this.quente = false;
    try { await this.ping(false); } catch { /* idem */ }
  }
}
