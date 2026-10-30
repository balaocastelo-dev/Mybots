// A chave da casa (Claude), conferida uma vez por boot.
// Todo bot nasce no Claude: se a chave não presta, isso tem que aparecer aqui, no log e
// no /api/health — e não depois, num bot mudo. Nunca imprime a chave, só o veredito.
export type EstadoChave = "ok" | "faltando" | "invalida" | "sem-rede" | "nao-checada";

let estado: EstadoChave = "nao-checada";
let quando = 0;
let detalhe = "";

/** O que se sabe agora sobre a chave da casa (não faz chamada nenhuma). */
export function estadoDaChave(): { estado: EstadoChave; quando: number; detalhe: string } {
  return { estado, quando, detalhe };
}

/** Pergunta à Anthropic se a chave ainda vale. Barato: um pedido de 1 token. */
export async function checarChaveDaCasa(): Promise<EstadoChave> {
  if (process.env.MYBOTS_SEM_CHECAR_CHAVE === "1") return estado;
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  quando = Date.now();
  if (!key) {
    estado = "faltando";
    detalhe = "ANTHROPIC_API_KEY não está no .env do Hub";
    return estado;
  }
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 1, messages: [{ role: "user", content: "oi" }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (r.ok || r.status === 429) { estado = "ok"; detalhe = r.status === 429 ? "chave boa, mas a conta está em limite agora" : ""; }
    else if (r.status === 401 || r.status === 403) { estado = "invalida"; detalhe = `a Anthropic recusou a chave (HTTP ${r.status})`; }
    else { estado = "sem-rede"; detalhe = `HTTP ${r.status} ao falar com a Anthropic`; }
  } catch (e) {
    estado = "sem-rede";
    detalhe = (e as Error).message;
  }
  return estado;
}
