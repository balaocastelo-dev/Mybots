// Tarefa curta, sem ferramenta e sem efeito, pode ir para um modelo rápido
// (Groq, depois Z.ai) quando a chave existir. Sem chave, fica no provedor do bot.
import { OPENAI_COMPAT_PRESETS } from "./config.js";

export type AlvoRapido = { kind: string; model: string; baseURL: string; apiKey: string };

const EFEITO = /\b(apagar|apague|excluir|exclua|deletar|delete|enviar|envie|mandar|mande|publicar|publique|pagar|pague|comprar|compre|agendar|agende|rodar|rode|executar|execute|instalar|instale|transferir|transfira|criar|crie|escrever|escreva|salvar|salve|gravar|grave|matar|mate|kill|formatar)\b/i;
const FERRAMENTA = /\b(pre[cç]o|estoque|arquivo|pasta|comando|site|cliente|whatsapp|e-?mail|c[aâ]mera|agenda|cpf|cnpj|planilha|pdf|screenshot|fornecedor|documento)\b/i;
const SENSIVEL = /(senha|password|\btoken\b|api[_ -]?key|\bsecret\b|\bchaves?\b|bearer|\bcpf\b|\bcnpj\b|cart[aã]o|\bcvv\b)/i;

export function tarefaSimples(texto: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const t = texto.trim();
  const max = Number(env.MYBOTS_ROTA_MAX_CHARS ?? 240);
  const teto = Number.isFinite(max) && max >= 40 ? max : 240;
  if (!t || t.length > teto) return false;
  if ((t.match(/\n/g) ?? []).length > 2) return false;
  if (SENSIVEL.test(t) || EFEITO.test(t) || FERRAMENTA.test(t)) return false;
  return true;
}

export function sensivel(texto: string): boolean {
  return SENSIVEL.test(texto);
}

/** Pode ir para o cache: simples, sem efeito, sem dado sensível, sem ferramenta. */
export function podeCachear(pedido: string, resposta: string, teveFerramenta: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  if (teveFerramenta) return false;
  if (!resposta.trim() || resposta.trim() === "(sem resposta)") return false;
  if (!tarefaSimples(pedido, env)) return false;
  if (sensivel(pedido) || sensivel(resposta)) return false;
  return true;
}

/**
 * Groq primeiro, Z.ai se não houver chave da Groq. `MYBOTS_ROTA_RAPIDA=0` desliga.
 * `MYBOTS_ROTA_ORDEM` troca a ordem (ex.: "zai,groq").
 * A base pode ser trocada no benchmark (`MYBOTS_ROTA_GROQ_BASE`); em produção fica a oficial.
 */
export function rotaRapida(atualKind: string, texto: string, temAnexo: boolean, env: NodeJS.ProcessEnv = process.env): AlvoRapido | null {
  if (env.MYBOTS_ROTA_RAPIDA === "0") return null;
  if (temAnexo) return null;
  if (atualKind === "groq" || atualKind === "zai") return null;
  if (!tarefaSimples(texto, env)) return null;
  const ordem = (env.MYBOTS_ROTA_ORDEM ?? "groq,zai").split(",").map((s) => s.trim()).filter(Boolean);
  for (const k of ordem) {
    if (k === "groq" && env.GROQ_API_KEY) {
      return {
        kind: "groq",
        model: env.MYBOTS_ROTA_GROQ_MODEL ?? "qwen/qwen3.8-27b",
        baseURL: env.MYBOTS_ROTA_GROQ_BASE || OPENAI_COMPAT_PRESETS.groq.baseURL,
        apiKey: env.GROQ_API_KEY,
      };
    }
    if (k === "zai" && env.ZAI_API_KEY) {
      return {
        kind: "zai",
        model: env.MYBOTS_ROTA_ZAI_MODEL ?? "glm-4.5-flash",
        baseURL: env.MYBOTS_ROTA_ZAI_BASE || OPENAI_COMPAT_PRESETS.zai.baseURL,
        apiKey: env.ZAI_API_KEY,
      };
    }
  }
  return null;
}

/** Prompt curto da rota rápida: cabe no teto da Groq e não pede ferramenta. */
export function promptCurto(nome: string, id: string, persona: string): string {
  const p = persona.trim().slice(0, 500);
  return [
    p,
    "",
    `Você é o Bot "${nome}" (id ${id}).`,
    "Responda em português, em uma ou duas frases, sem raciocínio visível.",
    "Se a pergunta precisar de ferramenta, dado ao vivo, arquivo ou ação, diga isso em uma linha em vez de inventar.",
  ].join("\n");
}
