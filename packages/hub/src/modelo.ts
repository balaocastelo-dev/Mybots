// Perguntar a um modelo SEM depender de um fornecedor específico.
//
// POR QUE EXISTE: o primeiro passo da casa (ler o site e sugerir as regras) estava
// amarrado a uma única chave. Num produto isso é inaceitável: quem compra não tem
// conta na Anthropic, e um fornecedor só é um ponto único de falha. Aqui a pergunta
// entra na roleta de cotas grátis e sai por quem estiver disponível — e, se nenhuma
// nuvem estiver, pelo modelo desta máquina.
import { PROVEDORES, escolher, registrar, usoZerado, type Tarefa, type Uso } from "@mybots/shared";

const usos: Record<string, Uso> = {};

function chavesDoAmbiente(): Record<string, boolean> {
  const c: Record<string, boolean> = {};
  for (const p of PROVEDORES) {
    if (p.local) { c[p.id] = true; continue; }
    const v = p.envChave ? process.env[p.envChave] : "";
    if (v && v.trim()) c[p.id] = true;
  }
  return c;
}

const consentidos = (): Record<string, boolean> => ({
  mistral: /^(s|sim|1|true|yes)$/i.test(process.env.MISTRAL_CONSENTIMENTO_TREINO ?? ""),
});

async function chamar(p: (typeof PROVEDORES)[number], o: { sistema: string; usuario: string; maxTokens?: number }): Promise<{ texto?: string; tokens: number }> {
  let base = p.baseURL;
  if (base.includes("{conta}")) {
    const conta = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
    if (!conta) return { tokens: 0 };
    base = base.replace("{conta}", conta);
  }
  const chave = p.envChave ? process.env[p.envChave] ?? "" : "";
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(chave ? { authorization: `Bearer ${chave}` } : {}) },
      body: JSON.stringify({
        model: p.modeloPadrao,
        max_tokens: o.maxTokens ?? 2000,
        messages: [{ role: "system", content: o.sistema }, { role: "user", content: o.usuario }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) return { tokens: 0 };
    const j = await r.json() as any;
    const texto = String(j?.choices?.[0]?.message?.content ?? "").trim();
    return { texto: texto || undefined, tokens: Number(j?.usage?.total_tokens ?? 0) };
  } catch {
    return { tokens: 0 };
  }
}

/** Pergunta a quem estiver disponível. Tenta até quatro provedores antes de desistir. */
export async function perguntar(o: { sistema: string; usuario: string; tarefa?: Tarefa; maxTokens?: number; contextoK?: number }): Promise<{ texto: string; provedor: string } | { error: string }> {
  const chaves = chavesDoAmbiente();
  const tentados: string[] = [];
  for (let i = 0; i < 4; i++) {
    const e = escolher(o.tarefa ?? "contexto", usos, { chaves, consentidos: consentidos(), contextoK: o.contextoK });
    const p = e.provedor;
    if (tentados.includes(p.id)) break;
    tentados.push(p.id);
    const r = await chamar(p, o);
    usos[p.id] = registrar(usos[p.id] ?? usoZerado(), r.tokens);
    if (r.texto) return { texto: r.texto, provedor: p.nome };
    chaves[p.id] = false; // não respondeu: sai da roleta desta pergunta e tenta o próximo
  }
  return {
    error: tentados.length
      ? `Nenhum modelo respondeu (tentei ${tentados.join(", ")}). Ligue uma chave grátis no painel — Gemini, Groq ou Cerebras — ou deixe o Ollama rodando nesta máquina.`
      : "Nenhum provedor configurado. Ligue uma chave grátis no painel (Gemini, Groq, Cerebras…) ou deixe o Ollama rodando nesta máquina.",
  };
}
