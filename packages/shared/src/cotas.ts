// A roleta de cotas grátis: qual provedor atende esta tarefa agora, sem estourar
// nenhuma cota e sem desperdiçar a que expira hoje.
//
// POR QUE CONTAR EM VEZ DE TENTAR: cada provedor tem três cotas que contam separado
// (por minuto, por dia, por mês). Descobrir o limite tomando 429 deixa o bot parado no
// meio da frase e queima uma requisição que já era escassa. Aqui se conta ANTES.
//
// O piso é local: toda cota de nuvem acaba, a máquina do cliente não. Sem esse piso a
// roleta um dia gira no vazio e o produto fica mudo.

export type Tarefa = "curta" | "contexto" | "agente" | "volume";

/** `tokensMin` e a cota de tokens de ENTRADA por minuto (ITPM). Foi ela que derrubou
 *  o Gerente na Groq: 7.000 por minuto contra um prompt de 12.497 — e o erro nao e
 *  "acabou a cota", e 413 "pedido grande demais". Sem esta linha no catalogo, a roleta
 *  manda o trabalho para quem nao pode receber e so descobre pelo erro. */
export type Limites = { reqMin?: number; reqDia?: number; tokensMin?: number; tokensDia?: number; tokensMes?: number };

export type Provedor = {
  id: string;
  nome: string;
  baseURL: string;
  /** variável de ambiente onde a chave do cliente fica */
  envChave: string;
  /** o que ele faz bem, na ordem */
  tarefas: Tarefa[];
  /** o modelo que se usa por padrão nele */
  modeloPadrao: string;
  /** contexto máximo útil, em mil tokens */
  contextoK: number;
  limites: Limites;
  /** 1 = mais rápido. Desempata tarefa "curta". */
  latencia: number;
  /** true quando usar o grátis exige o dono aceitar algo (ex.: treinar com os dados) */
  exigeConsentimento?: boolean;
  aviso?: string;
  /** roda na máquina do cliente: sem cota, último da fila, nunca falta */
  local?: boolean;
};

/** Conferido em 30/10/2026. Cota grátis muda — o verificador de catálogo corrige. */
export const PROVEDORES: Provedor[] = [
  { id: "gemini", nome: "Google AI Studio (Gemini Flash)", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    envChave: "GEMINI_API_KEY", modeloPadrao: "gemini-3.8-flash", tarefas: ["contexto", "curta", "volume"], contextoK: 1000,
    limites: { reqDia: 1500 }, latencia: 3 },
  { id: "groq", nome: "Groq", baseURL: "https://api.groq.com/openai/v1",
    envChave: "GROQ_API_KEY", modeloPadrao: "qwen/qwen3.8-27b", tarefas: ["curta", "agente"], contextoK: 128,
    limites: { reqMin: 30, reqDia: 1000, tokensMin: 7000 }, latencia: 1 },
  { id: "cerebras", nome: "Cerebras", baseURL: "https://api.cerebras.ai/v1",
    envChave: "CEREBRAS_API_KEY", modeloPadrao: "llama-3.3-70b", tarefas: ["volume", "curta"], contextoK: 8,
    limites: { reqMin: 30, tokensMin: 60_000, tokensDia: 1_000_000 }, latencia: 1 },
  { id: "mistral", nome: "Mistral (Experiment)", baseURL: "https://api.mistral.ai/v1",
    envChave: "MISTRAL_API_KEY", modeloPadrao: "mistral-small-latest", tarefas: ["volume", "contexto"], contextoK: 128,
    limites: { tokensMes: 1_000_000_000 }, latencia: 4, exigeConsentimento: true,
    aviso: "O tier grátis da Mistral exige aceitar que os seus dados treinem o modelo. Conversa de cliente indo treinar modelo de terceiro é decisão do dono, com aviso na tela — nunca o padrão." },
  { id: "cloudflare", nome: "Cloudflare Workers AI", baseURL: "https://api.cloudflare.com/client/v4/accounts/{conta}/ai/v1",
    envChave: "CLOUDFLARE_API_TOKEN", modeloPadrao: "@cf/meta/llama-3.1-8b-instruct", tarefas: ["curta", "agente"], contextoK: 32,
    limites: { tokensDia: 10_000 }, latencia: 2,
    aviso: "Os 10.000 por dia são 'neurons', não requisições: imagem consome muito mais que texto." },
  { id: "openrouter", nome: "OpenRouter (modelos :free)", baseURL: "https://openrouter.ai/api/v1",
    envChave: "OPENROUTER_API_KEY", modeloPadrao: "meta-llama/llama-3.3-70b-instruct:free", tarefas: ["agente", "curta", "contexto"], contextoK: 128,
    limites: { reqDia: 1000 }, latencia: 3 },
  { id: "opencode", nome: "OpenCode Zen", baseURL: "https://opencode.ai/zen/v1",
    envChave: "OPENCODE_API_KEY", modeloPadrao: "opencode/big-pickle", tarefas: ["agente"], contextoK: 128,
    limites: { reqDia: 500 }, latencia: 3, aviso: "Declarado como grátis por tempo limitado." },
  { id: "nous", nome: "Nous Portal", baseURL: "https://inference-api.nousresearch.com/v1",
    envChave: "NOUS_API_KEY", modeloPadrao: "stepfun/step-3.7-flash:free", tarefas: ["agente"], contextoK: 64,
    limites: { reqDia: 200 }, latencia: 4 },
  { id: "zai", nome: "Z.ai (GLM-4.7-Flash)", baseURL: "https://api.z.ai/api/paas/v4",
    envChave: "ZAI_API_KEY", modeloPadrao: "glm-4.5-flash", tarefas: ["contexto", "agente", "curta", "volume"], contextoK: 200,
    limites: { reqDia: 1000 }, latencia: 3,
    aviso: "Gratis na tabela de precos, mas aceita UMA chamada por vez: com dois bots falando junto vira fila, nao erro." },
  { id: "ollama", nome: "Ollama nesta máquina", baseURL: "http://127.0.0.1:11434/v1",
    envChave: "", modeloPadrao: "qwen3:14b", tarefas: ["curta", "agente", "volume", "contexto"], contextoK: 32,
    limites: {}, latencia: 5, local: true },
];

export type Uso = {
  minuto: number; reqMin: number; tokensMin: number;
  dia: string; reqDia: number; tokensDia: number;
  mes: string; tokensMes: number;
};

export const usoZerado = (agora = Date.now()): Uso => ({
  minuto: Math.floor(agora / 60_000), reqMin: 0, tokensMin: 0,
  dia: diaDe(agora), reqDia: 0, tokensDia: 0,
  mes: diaDe(agora).slice(0, 7), tokensMes: 0,
});

/** AAAA-MM-DD em UTC: o provedor zera no fuso dele, e UTC erra menos que o nosso. */
export function diaDe(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }

/** Zera as janelas que viraram. Chamar antes de ler ou gravar. */
export function virar(uso: Uso, agora = Date.now()): Uso {
  const minuto = Math.floor(agora / 60_000), dia = diaDe(agora), mes = dia.slice(0, 7);
  return {
    minuto, reqMin: uso.minuto === minuto ? uso.reqMin : 0, tokensMin: uso.minuto === minuto ? uso.tokensMin : 0,
    dia, reqDia: uso.dia === dia ? uso.reqDia : 0, tokensDia: uso.dia === dia ? uso.tokensDia : 0,
    mes, tokensMes: uso.mes === mes ? uso.tokensMes : 0,
  };
}

export function registrar(uso: Uso, tokens: number, agora = Date.now()): Uso {
  const u = virar(uso, agora);
  const t = Math.max(0, Math.round(tokens));
  return { ...u, reqMin: u.reqMin + 1, tokensMin: u.tokensMin + t, reqDia: u.reqDia + 1, tokensDia: u.tokensDia + t, tokensMes: u.tokensMes + t };
}

export type Veredito = { cabe: boolean; motivo: string };

/** Cabe mais uma chamada deste tamanho agora? */
export function cabe(p: Provedor, uso: Uso, tokens = 0, agora = Date.now()): Veredito {
  if (p.local) return { cabe: true, motivo: "local, sem cota" };
  const u = virar(uso, agora), L = p.limites;
  if (L.reqMin !== undefined && u.reqMin >= L.reqMin) return { cabe: false, motivo: `${p.nome}: ${L.reqMin} por minuto, cheio — volta em menos de 1 min` };
  if (L.reqDia !== undefined && u.reqDia >= L.reqDia) return { cabe: false, motivo: `${p.nome}: ${L.reqDia} por dia, cheio — volta amanhã` };
  // o pedido INTEIRO precisa caber no minuto, nao so somar ao que ja passou
  if (L.tokensMin !== undefined && tokens > L.tokensMin) return { cabe: false, motivo: `${p.nome}: aceita ${L.tokensMin} tokens por minuto e este pedido tem ${tokens} — grande demais para ele` };
  if (L.tokensMin !== undefined && u.tokensMin + tokens > L.tokensMin) return { cabe: false, motivo: `${p.nome}: cota de tokens do minuto no fim — volta em menos de 1 min` };
  if (L.tokensDia !== undefined && u.tokensDia + tokens > L.tokensDia) return { cabe: false, motivo: `${p.nome}: cota de tokens do dia no fim` };
  if (L.tokensMes !== undefined && u.tokensMes + tokens > L.tokensMes) return { cabe: false, motivo: `${p.nome}: cota do mês no fim` };
  return { cabe: true, motivo: "cabe" };
}

/** Fração da cota já gasta (0 a 1). Serve para gastar primeiro quem está mais vazio. */
export function gasto(p: Provedor, uso: Uso, agora = Date.now()): number {
  if (p.local) return 0; // local não tem cota: a ordenação já o deixa por último
  const u = virar(uso, agora), L = p.limites, fr: number[] = [];
  if (L.reqDia) fr.push(u.reqDia / L.reqDia);
  if (L.tokensDia) fr.push(u.tokensDia / L.tokensDia);
  if (L.tokensMes) fr.push(u.tokensMes / L.tokensMes);
  return fr.length ? Math.max(...fr) : 0;
}

/** Cota que vira pó hoje vale mais do que cota do mês: gasta-se a diária primeiro. */
const expiraHoje = (p: Provedor) => (p.limites.reqDia || p.limites.tokensDia ? 0 : 1);

export type Escolha = { provedor: Provedor; motivo: string; recusados: string[] };

export function escolher(
  tarefa: Tarefa,
  usos: Record<string, Uso>,
  opcoes: { chaves: Record<string, boolean>; consentidos?: Record<string, boolean>; contextoK?: number; tokens?: number; agora?: number; catalogo?: Provedor[] },
): Escolha {
  const agora = opcoes.agora ?? Date.now();
  const recusados: string[] = [];
  const aptos = (opcoes.catalogo ?? PROVEDORES).filter((p) => {
    if (!p.local && !opcoes.chaves[p.id]) { recusados.push(`${p.nome}: sem chave configurada`); return false; }
    if (p.exigeConsentimento && !opcoes.consentidos?.[p.id]) { recusados.push(`${p.nome}: o dono ainda não aceitou os termos do tier grátis`); return false; }
    if (!p.tarefas.includes(tarefa)) { recusados.push(`${p.nome}: não é o forte dele para "${tarefa}"`); return false; }
    if (opcoes.contextoK !== undefined && p.contextoK < opcoes.contextoK) { recusados.push(`${p.nome}: contexto de ${p.contextoK}K não comporta ${opcoes.contextoK}K`); return false; }
    const v = cabe(p, usos[p.id] ?? usoZerado(agora), opcoes.tokens ?? 0, agora);
    if (!v.cabe) { recusados.push(v.motivo); return false; }
    return true;
  });
  if (!aptos.length) {
    const local = (opcoes.catalogo ?? PROVEDORES).find((p) => p.local);
    if (!local) throw new Error("sem provedor e sem piso local: o catálogo está errado");
    return { provedor: local, motivo: "toda a cota de nuvem está no fim — caiu no modelo desta máquina", recusados };
  }
  aptos.sort((a, b) => {
    if (a.local !== b.local) return a.local ? 1 : -1;            // local é o último recurso
    const e = expiraHoje(a) - expiraHoje(b); if (e) return e;      // gasta o que expira hoje
    if (tarefa === "curta") { const l = a.latencia - b.latencia; if (l) return l; }
    if (tarefa === "contexto") { const c = b.contextoK - a.contextoK; if (c) return c; }
    const g = gasto(a, usos[a.id] ?? usoZerado(agora), agora) - gasto(b, usos[b.id] ?? usoZerado(agora), agora);
    if (Math.abs(g) > 0.01) return g;                              // o mais vazio primeiro
    return a.latencia - b.latencia;
  });
  const p = aptos[0];
  if (p.local) return { provedor: p, motivo: "sem cota de nuvem disponível agora — usando o modelo desta máquina", recusados };
  const pct = Math.round(gasto(p, usos[p.id] ?? usoZerado(agora), agora) * 100);
  return { provedor: p, motivo: `${p.nome} — ${pct}% da cota usada`, recusados };
}
