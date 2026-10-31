// Orcamento de prompt: fazer o pedido CABER no teto do provedor, em vez de descobrir
// que nao cabe pelo erro 413 no meio de uma conversa com cliente.
//
// POR QUE NAO DA PARA "DIVIDIR EM PEDACOS DE 7000": o modelo precisa do prompt inteiro
// numa requisicao so para responder. Fatiar daria varios pedidos incompletos — um sem
// as regras da casa, outro sem as ferramentas — e nenhum deles sabe responder. Quem se
// fatia e DOCUMENTO; o prompt de um agente, nao. Entao a saida e caber.
//
// CASO REAL (30/10/2026): a Groq gratis aceita 7.000 tokens de entrada por minuto e o
// prompt com as 32 ferramentas tem 12.200. Nenhuma mensagem cabia — nunca, nem com a
// cota zerada. Medido nos tres modelos que ela ainda oferece.

/** Teto de ENTRADA por chamada, por provedor. Conferido em 30/10/2026. */
const TETO: Record<string, number> = {
  groq: 6200, cerebras: 6200, cloudflare: 6200,
  nous: 12000, opencode: 24000, openrouter: 24000, mistral: 24000,
  gemini: 120000, anthropic: 120000, claude: 120000, zai: 120000,
  ollama: 16000, lmstudio: 16000,
};
const PADRAO = 16000;

export function tetoDoProvedor(kind: string): number {
  const env = Number(process.env.MYBOTS_PROMPT_MAX);
  if (Number.isFinite(env) && env > 500) return env;
  return TETO[kind] ?? PADRAO;
}

/** Estimativa de tokens: 4 caracteres por token erra pouco em portugues e custa nada. */
export const emTokens = (s: string) => Math.ceil((s ?? "").length / 4);

/** Ordem de corte. Quanto MENOR o numero, mais essencial: sem as de nivel 1 o bot nao
 *  consegue nem dizer o que esta fazendo nem pedir ajuda, e ai nao e um bot. */
const NIVEL: Record<string, number> = {
  ask_user: 1, set_status: 1, notify_user: 1, search_knowledge: 1, recall: 1, remember: 1,
  read_file: 2, list_dir: 2, write_file: 2, send_file: 2, fetch_url: 2, run_command: 2,
  request_approval: 2, minhas_capacidades: 2,
  // criar_bot e o trabalho principal do Gerente Geral: bot que falta e trabalho que
  // nao sai. anotar_empresa alimenta a base da empresa, que todos leem depois.
  criar_bot: 2, anotar_empresa: 3,
  whatsapp: 3, email: 3, gerar_pdf: 3, schedule: 3, ask_bot: 3, send_to_bot: 3, list_bots: 3,
  delegate_task: 3, check_task: 3, cancel_task: 3,
  navegador: 4, gravar_tela: 4, celular: 4, generate_image: 4, generate_video: 4, audio: 4, screenshot: 4,
  learn_knowledge: 4, list_routines: 4, cancel_routine: 4, gerenciar_bot: 4,
  system_resources: 5, pedir_na_tela: 5,
};

/** As ferramentas que cabem na sobra, da mais essencial para a menos. */
export function ferramentasQueCabem<T extends { name: string }>(defs: T[], sobra: number): { defs: T[]; cortadas: string[]; gasto: number } {
  const ordenadas = [...defs].sort((a, b) => (NIVEL[a.name] ?? 9) - (NIVEL[b.name] ?? 9));
  const dentro: T[] = [];
  const cortadas: string[] = [];
  let gasto = 0;
  for (const d of ordenadas) {
    const custo = emTokens(JSON.stringify(d));
    if (gasto + custo <= sobra || (NIVEL[d.name] ?? 9) === 1) { dentro.push(d); gasto += custo; }
    else cortadas.push(d.name);
  }
  return { defs: dentro, cortadas, gasto };
}

/** Teto de SAIDA por minuto. A Groq gratis recusa com 429 quando o max_tokens pedido
 *  passa de 1.000 — e o erro fala de "output tokens per minute", nao de cota gasta. */
const TETO_SAIDA: Record<string, number> = { groq: 900, cerebras: 900, cloudflare: 900 };
export function tetoSaidaDoProvedor(kind: string, pedido?: number): number {
  const teto = TETO_SAIDA[kind];
  const p = Number.isFinite(pedido as number) && (pedido as number) > 0 ? (pedido as number) : 4096;
  return teto ? Math.min(p, teto) : p;
}