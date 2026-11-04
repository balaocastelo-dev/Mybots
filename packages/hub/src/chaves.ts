import { EIGHTTOKEN_BASE_URL, EIGHTTOKEN_KEY_ENV } from "@mybots/shared";
import { redigir } from "./redacao.js";

// A chave da casa (8Token), conferida uma vez por boot.
// Todo bot nasce no 8Token: se a chave não presta, isso tem que aparecer aqui, no log e
// no /api/health — e não depois, num bot mudo. Nunca imprime a chave, só o veredito.
export type EstadoChave = "ok" | "faltando" | "invalida" | "sem-rede" | "nao-checada";

let estado: EstadoChave = "nao-checada";
let quando = 0;
let detalhe = "";

/** O que se sabe agora sobre a chave da casa (não faz chamada nenhuma). */
export function estadoDaChave(): { estado: EstadoChave; quando: number; detalhe: string } {
  return { estado, quando, detalhe };
}

/** Pergunta ao 8Token se a chave ainda vale. GET /v1/models, sem imprimir a chave. */
export async function checarChaveDaCasa(): Promise<EstadoChave> {
  if (process.env.MYBOTS_SEM_CHECAR_CHAVE === "1") return estado;
  const key = process.env[EIGHTTOKEN_KEY_ENV] ?? "";
  quando = Date.now();
  if (!key) {
    estado = "faltando";
    detalhe = `${EIGHTTOKEN_KEY_ENV} não está no .env do Hub`;
    return estado;
  }
  const base = (process.env.EIGHTTOKEN_BASE_URL || EIGHTTOKEN_BASE_URL).replace(/\/+$/, "");
  try {
    const r = await fetch(`${base}/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (r.ok || r.status === 429) { estado = "ok"; detalhe = r.status === 429 ? "chave boa, mas a conta está em limite agora" : ""; }
    else if (r.status === 401 || r.status === 403) { estado = "invalida"; detalhe = `o 8Token recusou a chave (HTTP ${r.status})`; }
    else { estado = "sem-rede"; detalhe = `HTTP ${r.status} ao falar com o 8Token`; }
  } catch (e) {
    estado = "sem-rede";
    detalhe = redigir((e as Error).message);
  }
  return estado;
}
