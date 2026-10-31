// No Ollama o prefill cresce com o prompt. O Gerente leva um texto curto
// e o num_ctx acompanha o que realmente vai na chamada, não uma janela enorme.
import { emTokens } from "./orcamento.js";

const DEGRAUS = [2048, 4096, 8192, 16384, 32768];

export function ehGerenteBot(bot: { name: string; role: string }): boolean {
  return /gerente/i.test(`${bot.role} ${bot.name}`);
}

export function normalizarPrompt(s: string): string {
  return s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Sobe para o degrau do Ollama que cobre o texto, sem abrir 32k à toa. */
export function numCtxDe(partes: string[], saida = 1024): number {
  const tokens = partes.reduce((n, p) => n + emTokens(p), 0) + Math.max(256, saida);
  for (const d of DEGRAUS) if (d >= tokens) return d;
  return DEGRAUS[DEGRAUS.length - 1];
}

/** Tira repetição e parágrafo longo. Fica o título e as linhas curtas. */
export function enxugarPersona(persona: string, max = 1600): string {
  const vistas = new Set<string>();
  const linhas: string[] = [];
  for (const l of persona.split("\n")) {
    const t = l.trim();
    if (!t || vistas.has(t)) continue;
    if (!(t.startsWith("#") || t.length <= 160)) continue;
    vistas.add(t);
    linhas.push(t);
    if (linhas.join("\n").length >= max) break;
  }
  const texto = linhas.join("\n");
  return texto.length > max ? texto.slice(0, max) : texto;
}

export function promptGerenteNoOllama(o: { persona: string; nome: string; id: string; chefe: string; workspace: string }): string {
  return [
    enxugarPersona(o.persona),
    "",
    `Você é o Bot "${o.nome}" (id ${o.id}), gerente da equipe. O chefe é ${o.chefe}.`,
    `Workspace: ${o.workspace}. Trabalhe dentro dele.`,
    "Fale português, curto, começando pela frase que responde. Sem raciocínio visível.",
    "Delegue com ask_bot. Bot que falta: criar_bot, com o OK do chefe. Não invente preço, estoque ou fato da casa: busque antes.",
    "Não apague, envie, pague ou publique sem o OK. Nunca repita senha, token ou chave. A porta 8787 é de outro sistema: não mexa.",
    "Feche com o próximo passo, em uma frase.",
  ].join("\n");
}
