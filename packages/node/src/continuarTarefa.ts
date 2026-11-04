/**
 * Continuacao automatica de tarefas: detecta quando o modelo encerra o turno
 * prometendo acao (sem tool calls) ou deixa passos abertos, e forca novas
 * rodadas ate concluir — com orcamento finito e sem furar a trava anti-loop.
 *
 * Persiste o estado em .mybots/tarefas-em-andamento.json para retomar depois
 * de erro/restart, e monta avisos curtos de andamento para o chat.
 */
import fs from "node:fs";
import path from "node:path";
import { baseDo8token, PADRAO_DA_CASA } from "@mybots/shared";

export const MAX_AUTO_CONTINUES = 6;
export const MAX_PROVIDER_RETRIES = 3;

export type TarefaEmAndamento = {
  conversationId: string;
  botId: string;
  objetivo: string;
  status: "em_andamento" | "concluido" | "erro" | "aguardando_aprovacao";
  continues: number;
  ultimoTexto: string;
  planoId?: string;
  atualizadoEm: number;
  erro?: string;
};

const PROMESSA =
  /\b(vou|irei|estou\s+(a\s+)?(fazer|processando|gerando|abrindo|criando|montando|verificando|procurando|baixando|enviando|ligando)|j[aá]\s+(come[cç]o|vou|mesmo)|agora\s+(mesmo\s+)?(vou|gero|abro|crio)|deixe[- ]me|em\s+seguida|aguarde|gerando|processando|trabalhando\s+(nisto|nisso|nele|nela)|continu(o|ando))\b/i;

const ENTREGUE =
  /\b(pronto|conclu[ií]do|feito\.|aqui est[aá]|segue(m)?\s+(o|a|os|as)\b|entregue|finalizei|terminei|n[aã]o\s+consegui|falhou|erro:)\b/i;

const PERGUNTA_DECISAO =
  /\b(quer que|posso|deseja|confirma|ok para|pode ser|o que (voc[eê]|o chefe) (prefere|acha))\b/i;

/** Texto do assistente parece prometer trabalho ainda nao feito. */
export function parecePromessaSemFerramenta(textoAssistente: string): boolean {
  const t = (textoAssistente || "").trim();
  if (!t || t === "(sem resposta)") return false;
  if (ENTREGUE.test(t) && !PROMESSA.test(t)) return false;
  // Pergunta ao chefe (decisao) nao e promessa de acao — para e espera.
  if (PERGUNTA_DECISAO.test(t) && t.includes("?")) return false;
  return PROMESSA.test(t);
}

export function pareceTarefaIncompleta(
  textoAssistente: string,
  _textoUsuario: string,
  toolCallsNestaRodada = 0,
): boolean {
  if (toolCallsNestaRodada > 0) return false;
  return parecePromessaSemFerramenta(textoAssistente);
}

export function montarAvisoContinuar(textoAssistente: string, n: number, max: number): string {
  return [
    "[sistema] Voce ENCERROU o turno prometendo uma acao, mas NAO chamou nenhuma ferramenta.",
    "Isso deixa o trabalho pela metade. CONTINUE AGORA: chame a(s) ferramenta(s) necessarias e execute de verdade.",
    "Nao diga de novo que 'vai fazer' — faca. Se precisar de aprovacao do chefe (enviar, pagar, apagar, publicar), peca com request_approval/ask_user e PARE ate ele responder.",
    "Atualize o andamento: use planejar/atualizar_passo quando for trabalho com varias etapas, e set_status com uma linha curta.",
    "Continuacao automatica " + n + "/" + max + ". Ultima fala sua: «" + textoAssistente.slice(0, 240).replace(/\s+/g, " ") + "»",
  ].join(" ");
}

export function montarAvisoLimiteRodadas(fezAlgo: boolean): string {
  return fezAlgo
    ? "[sistema] Limite de rodadas de ferramentas atingido. Resuma o que JA fez, o que FALTA, atualize atualizar_passo/set_status, e diga claramente se precisa do chefe para continuar."
    : "[sistema] Limite de rodadas atingido sem progresso util. Explique o bloqueio em portugues e o caminho pronto para o chefe destravar. Nao invente que terminou.";
}

export function isErroRetriavelProvedor(err: unknown): boolean {
  const m = String((err as Error)?.message ?? err ?? "").toLowerCase();
  if (!m) return false;
  if (m.includes("abort")) return false;
  return (
    m.includes("try again")
    || m.includes("did not complete")
    || m.includes("timeout")
    || m.includes("timed out")
    || m.includes("429")
    || m.includes("rate limit")
    || m.includes("503")
    || m.includes("502")
    || m.includes("504")
    || m.includes("econnreset")
    || m.includes("fetch failed")
    || m.includes("socket")
    || m.includes("temporar")
    || m.includes("overloaded")
    || m.includes("capacity")
  );
}

export async function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

export async function comRetryProvedor<T>(
  fn: () => Promise<T>,
  opts: { signal?: AbortSignal; max?: number; onRetry?: (n: number, err: unknown) => void } = {},
): Promise<T> {
  const max = opts.max ?? MAX_PROVIDER_RETRIES;
  let last: unknown;
  for (let i = 0; i < max; i++) {
    if (opts.signal?.aborted) throw new Error("aborted");
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (opts.signal?.aborted) throw e;
      if (!isErroRetriavelProvedor(e) || i === max - 1) throw e;
      opts.onRetry?.(i + 1, e);
      await sleepMs(600 * Math.pow(2, i), opts.signal);
    }
  }
  throw last;
}

function arquivoEstado(workspace: string): string {
  return path.join(workspace, ".mybots", "tarefas-em-andamento.json");
}

function lerTodos(workspace: string): Record<string, TarefaEmAndamento> {
  const f = arquivoEstado(workspace);
  try {
    if (!fs.existsSync(f)) return {};
    const raw = JSON.parse(fs.readFileSync(f, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function gravarTodos(workspace: string, todos: Record<string, TarefaEmAndamento>) {
  const f = arquivoEstado(workspace);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(todos, null, 2), "utf8");
}

export function carregarTarefa(workspace: string, conversationId: string): TarefaEmAndamento | null {
  return lerTodos(workspace)[conversationId] ?? null;
}

export function persistirTarefa(workspace: string, tarefa: TarefaEmAndamento): void {
  const todos = lerTodos(workspace);
  todos[tarefa.conversationId] = { ...tarefa, atualizadoEm: Date.now() };
  gravarTodos(workspace, todos);
}

export function marcarTarefa(
  workspace: string,
  conversationId: string,
  patch: Partial<TarefaEmAndamento>,
): TarefaEmAndamento | null {
  const todos = lerTodos(workspace);
  const cur = todos[conversationId];
  if (!cur) return null;
  const next = { ...cur, ...patch, atualizadoEm: Date.now() };
  todos[conversationId] = next;
  gravarTodos(workspace, todos);
  return next;
}

export function limparTarefa(workspace: string, conversationId: string): void {
  const todos = lerTodos(workspace);
  if (!todos[conversationId]) return;
  delete todos[conversationId];
  gravarTodos(workspace, todos);
}

export function textoProgresso(n: number, max: number, trecho: string): string {
  const curto = trecho.replace(/\s+/g, " ").trim().slice(0, 120);
  return "Andamento (" + n + "/" + max + "): ainda em execucao — " + (curto || "seguindo a tarefa") + ".";
}

export function textoConclusao(ok: boolean, detalhe?: string): string {
  if (ok) return detalhe?.trim() ? ("Concluido. " + detalhe.trim()) : "Concluido.";
  return detalhe?.trim()
    ? ("Nao consegui terminar: " + detalhe.trim())
    : "Nao consegui terminar esta tarefa.";
}

export function montarContextoRetomada(tarefa: TarefaEmAndamento): string {
  return [
    "[sistema] Ha uma tarefa EM ANDAMENTO nesta conversa que parou no meio (provavelmente o modelo so prometeu e nao chamou ferramenta, ou o provedor falhou).",
    "Objetivo: " + tarefa.objetivo,
    "Status: " + tarefa.status + "; continuacoes ja usadas: " + tarefa.continues + ".",
    tarefa.ultimoTexto
      ? ("Ultima fala do bot: «" + tarefa.ultimoTexto.slice(0, 300).replace(/\s+/g, " ") + "»")
      : "",
    "Retome AGORA com ferramentas. Nao peca de novo o que o chefe ja pediu. Se precisar de aprovacao, peca e pare.",
  ]
    .filter(Boolean)
    .join(" ");
}


/**
 * Troca do Vigia: se o provedor da vez (inclusive o 8Token) falhar, o próximo
 * da ordem assume. `exceto` é quem acabou de falhar — não tenta o mesmo de novo.
 * A ordem padrão continua zai, groq, ollama, então o 8Token cair não fica em loop.
 */
export function provedorFallback(
  env: NodeJS.ProcessEnv = process.env,
  opts: { exceto?: string } = {},
): { kind: string; model: string; baseURL: string; apiKey?: string } | null {
  const exceto = String(opts.exceto || "").toLowerCase();
  const ordem = String(env.MYBOTS_FALLBACK_ORDEM || "zai,groq,ollama")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const k of ordem) {
    if (k === exceto) continue;
    if (k === "8token" && env.EIGHTTOKEN_API_KEY) {
      return {
        kind: "8token",
        model: env.EIGHTTOKEN_MODEL || PADRAO_DA_CASA.model,
        baseURL: baseDo8token(env.EIGHTTOKEN_BASE_URL),
        apiKey: env.EIGHTTOKEN_API_KEY,
      };
    }
    if (k === "zai" && env.ZAI_API_KEY) {
      return {
        kind: "zai",
        model: env.MYBOTS_FALLBACK_MODEL || "glm-4.5-flash",
        baseURL: env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4",
        apiKey: env.ZAI_API_KEY,
      };
    }
    if (k === "groq" && env.GROQ_API_KEY) {
      return {
        kind: "groq",
        model: env.MYBOTS_FALLBACK_MODEL || "qwen/qwen3.8-27b",
        baseURL: env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
        apiKey: env.GROQ_API_KEY,
      };
    }
    if (k === "ollama") {
      return {
        kind: "ollama",
        model: env.MYBOTS_FALLBACK_MODEL || env.OLLAMA_MODEL || "qwen3:14b",
        baseURL: env.OLLAMA_HOST
          ? env.OLLAMA_HOST.replace(/\/?$/, "") + "/v1"
          : "http://127.0.0.1:11434/v1",
      };
    }
  }
  return null;
}
