// Camada esperta: o bot continua no provedor dele (rapido/gratis) e so chama o
// Claude da 8Token nos turnos dificeis -- orquestrar ferramentas ou pedido longo.
// Se a 8Token falhar (rede, 401, IP nao autorizado, 429...), cai de volta no
// provedor do bot sem o usuario perceber. Liga com MYBOTS_SMART_TIER=8token e
// EIGHTTOKEN_API_KEY no .env do Hub. Desligado por padrao: a 8Token e mais lenta.
import { AnthropicProvider } from "./anthropic.js";
import type { ChatRequest, ChatResponse, Provider } from "./types.js";

const LIMITE_TEXTO = 600;

export function turnoDificil(req: ChatRequest): boolean {
  const ultima = req.messages[req.messages.length - 1];
  if (!ultima) return false;
  // meio de uma cadeia de ferramentas: decidir o proximo passo e o que mais erra
  if (ultima.role === "tool" && req.tools.length > 0) return true;
  if (ultima.role === "user" && ultima.content.length >= LIMITE_TEXTO) return true;
  return false;
}

export class SmartTierProvider implements Provider {
  private pausadoAte = 0;
  constructor(private base: Provider, private esperto: Provider) {}
  get kind() { return this.base.kind; }
  get model() { return this.base.model; }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (Date.now() >= this.pausadoAte && turnoDificil(req) && !req.onText) {
      try {
        return await this.esperto.chat(req);
      } catch (e) {
        if (req.signal?.aborted) throw e;
        // 2 minutos sem tentar de novo, para nao pagar a espera em todo turno
        this.pausadoAte = Date.now() + 120_000;
        console.warn(`[node] 8Token falhou, voltando para ${this.base.kind}: ${(e as Error).message.slice(0, 200)}`);
      }
    }
    return this.base.chat(req);
  }
}

export function comCamadaEsperta(base: Provider, env: NodeJS.ProcessEnv = process.env): Provider {
  const chave = env.EIGHTTOKEN_API_KEY;
  if (String(env.MYBOTS_SMART_TIER ?? "").toLowerCase() !== "8token" || !chave) return base;
  if (base.kind === "8token" || /^claude-/.test(base.model)) return base;
  const modelo = env.EIGHTTOKEN_MODEL || "claude-sonnet-5";
  const url = env.EIGHTTOKEN_BASE_URL || "https://8token.tech";
  return new SmartTierProvider(base, new AnthropicProvider(modelo, chave, url));
}
