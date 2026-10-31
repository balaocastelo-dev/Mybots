// Resposta repetida do mesmo bot para o mesmo pedido. Não guarda senha,
// ação com efeito nem nada que tenha passado por ferramenta.
import { normalizarPrompt } from "./promptEnxuto.js";
import { podeCachear } from "./roteamento.js";

type Item = { texto: string; expira: number };

export class CacheResposta {
  private map = new Map<string, Item>();
  constructor(
    private ttl = Number(process.env.MYBOTS_CACHE_TTL_MS ?? 10 * 60_000),
    private max = 200,
  ) {
    if (!Number.isFinite(this.ttl) || this.ttl < 1) this.ttl = 10 * 60_000;
  }

  ler(botId: string, prompt: string, agora = Date.now()): string | null {
    if (process.env.MYBOTS_CACHE === "0") return null;
    const k = chave(botId, prompt);
    const e = this.map.get(k);
    if (!e) return null;
    if (e.expira <= agora) { this.map.delete(k); return null; }
    return e.texto;
  }

  guardar(botId: string, prompt: string, texto: string, teveFerramenta = false, agora = Date.now()) {
    if (process.env.MYBOTS_CACHE === "0") return;
    if (!podeCachear(prompt, texto, teveFerramenta)) return;
    const k = chave(botId, prompt);
    this.map.set(k, { texto, expira: agora + this.ttl });
    while (this.map.size > this.max) {
      const primeiro = this.map.keys().next().value;
      if (primeiro === undefined) break;
      this.map.delete(primeiro);
    }
  }
}

function chave(botId: string, prompt: string) {
  return `${botId}\0${normalizarPrompt(prompt)}`;
}

/** Entrega o texto em pedaços, para a bolha ir enchendo mesmo quando veio do cache. */
export async function emitirEmPedacos(texto: string, onText: (d: string) => void) {
  const pedacos = texto.match(/[\s\S]{1,24}/g) ?? [texto];
  for (const p of pedacos) {
    onText(p);
    await new Promise((r) => setImmediate(r));
  }
}
