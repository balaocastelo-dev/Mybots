/**
 * Quem está no PC da empresa.
 *
 * O PC é um por empresa. Cada bot dela, ao abrir o navegador ou fotografar a
 * tela, entra nesta lista. Quem fez a última ação é quem está usando agora.
 * O que foi digitado não fica guardado — o resumo diz o gesto, não o texto.
 */
import type { AcaoNaTela, UsoDoPc } from "@mybots/shared";

const HISTORICO_MAX = 8;

export function usoVazio(): UsoDoPc {
  return { usando: null, historico: [] };
}

/** `navegador`, `screenshot`, e o mesmo nome quando o motor prefixa (mybots-local_navegador). */
export function ferramentaDeTela(tool: string): "navegador" | "screenshot" | null {
  const t = String(tool ?? "").toLowerCase().trim();
  const nome = t.includes("/") ? t.slice(t.lastIndexOf("/") + 1) : t;
  const curto = nome.includes("_") ? nome.slice(nome.lastIndexOf("_") + 1) : nome;
  if (curto === "navegador") return "navegador";
  if (curto === "screenshot") return "screenshot";
  return null;
}

function corta(s: string, n = 80): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function campo(input: unknown, chave: string): string {
  if (!input || typeof input !== "object") return "";
  const v = (input as Record<string, unknown>)[chave];
  return typeof v === "string" ? v : "";
}

export function resumoDaAcao(tool: string, input: unknown): string {
  const qual = ferramentaDeTela(tool);
  if (qual === "screenshot") return "fotografou a tela";
  if (qual !== "navegador") return "usou a tela";
  const acao = campo(input, "acao");
  const url = campo(input, "url") || campo(input, "endereco");
  const alvo = campo(input, "texto") || campo(input, "rotulo") || campo(input, "seletor");
  switch (acao) {
    case "abrir": return url ? `abriu ${corta(url)}` : "abriu uma página";
    case "ler": return "leu a página";
    case "campos": return "olhou os campos da página";
    case "digitar": return "digitou num campo";
    case "clicar": return alvo ? `clicou em “${corta(alvo, 40)}”` : "clicou na página";
    case "print": return "fotografou a página";
    case "estado": return "conferiu o navegador";
    case "abas": return "viu as abas";
    default: return acao ? `navegador: ${corta(acao, 32)}` : "usou o navegador";
  }
}

export function registrarUso(historico: AcaoNaTela[], acao: AcaoNaTela, limite = HISTORICO_MAX): AcaoNaTela[] {
  return [acao, ...historico].slice(0, limite);
}

export function montarUso(historico: AcaoNaTela[]): UsoDoPc {
  return { usando: historico[0] ?? null, historico };
}

export class UsosDoPc {
  private porEmpresa = new Map<string, AcaoNaTela[]>();

  registrar(empresaId: string, acao: { botId: string; nome: string; ferramenta: string; input?: unknown; quando?: number }): UsoDoPc | null {
    const ferramenta = ferramentaDeTela(acao.ferramenta);
    if (!empresaId || !ferramenta) return null;
    const item: AcaoNaTela = {
      botId: acao.botId,
      nome: acao.nome || acao.botId,
      ferramenta,
      resumo: resumoDaAcao(acao.ferramenta, acao.input),
      quando: acao.quando ?? Date.now(),
    };
    const prox = registrarUso(this.porEmpresa.get(empresaId) ?? [], item);
    this.porEmpresa.set(empresaId, prox);
    return montarUso(prox);
  }

  ver(empresaId: string): UsoDoPc {
    return montarUso(this.porEmpresa.get(empresaId) ?? []);
  }
}
