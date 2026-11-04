// Kit enxuto de ferramentas por especialidade.
// Modelos pequenos e APIs grátis quebram com 30+ schemas de uma vez.
// Cada bot recebe ~7 tools essenciais + as da especialidade; admin só quando precisa.

import type { ToolDef } from "./providers/types.js";

/** Ferramentas de admin / pesadas: só entram se a especialidade pedir. */
export const ADMIN_TOOLS = new Set(["criar_bot", "gerenciar_bot", "celular", "gravar_tela"]);

/** Núcleo mínimo — o bot consegue conversar, lembrar, ler e pedir ajuda. */
const NUCLEO = [
  "ask_user", "set_status", "notify_user",
  "search_knowledge", "recall", "remember",
  "read_file", "list_dir", "send_file", "minhas_capacidades",
];

/** Kits por palavra-chave no role/id/persona. */
const KITS: Array<{ match: RegExp; tools: string[]; teto: number }> = [
  { match: /gerente|diretor|coordenad|chefe de equipe/i, tools: ["criar_bot", "gerenciar_bot", "list_bots", "ask_bot", "send_to_bot", "anotar_empresa", "delegate_task", "check_task", "planejar", "atualizar_passo", "aguardar_decisao", "email", "whatsapp"], teto: 14 },
  { match: /rotina|agenda|secretár|assistente administrativo/i, tools: ["schedule", "list_routines", "cancel_routine", "email", "whatsapp", "agenda", "write_file"], teto: 10 },
  { match: /conect|integra|api|webhook/i, tools: ["fetch_url", "run_command", "write_file", "email", "navegador"], teto: 9 },
  { match: /naveg|browser|pesquisa|web/i, tools: ["navegador", "fetch_url", "screenshot", "pedir_na_tela", "write_file"], teto: 9 },
  { match: /cine|v[ií]deo|filme|edição|editor/i, tools: ["generate_video", "gerar_video_h3", "generate_image", "audio", "screenshot", "send_file"], teto: 9 },
  { match: /pixel|imagem|design|arte|comfy/i, tools: ["generate_image", "screenshot", "read_attachment", "send_file", "write_file"], teto: 8 },
  { match: /pdf|contrato|documento|or[cç]amento/i, tools: ["gerar_pdf", "read_file", "write_file", "send_file", "email", "catalogo_empresa"], teto: 9 },
  { match: /whats|atend|vend|cliente|comercial/i, tools: ["whatsapp", "agenda", "email", "catalogo_empresa", "gerar_pdf", "learn_knowledge"], teto: 10 },
  { match: /seo|aeo|marketing|conte[uú]do|social/i, tools: ["fetch_url", "navegador", "write_file", "email", "redes_sociais", "generate_image"], teto: 9 },
  { match: /celular|android|adb/i, tools: ["celular", "screenshot", "pedir_na_tela", "navegador"], teto: 8 },
];

const PADRAO_EXTRA = ["fetch_url", "write_file", "run_command", "email", "whatsapp", "gerar_pdf", "learn_knowledge"];
const TETO_PADRAO = Number(process.env.MYBOTS_KIT_MAX || 10);

export type KitInfo = { defs: ToolDef[]; incluidas: string[]; cortadas: string[]; especialidade: string };

/**
 * Filtra o catálogo completo para um kit enxuto.
 * Admin tools (criar_bot, gerenciar_bot, celular, gravar_tela) só entram se o kit da especialidade as listar
 * ou se MYBOTS_KIT_ADMIN=1.
 */
export function selecionarKitFerramentas(
  todas: ToolDef[],
  opts: { role?: string; botId?: string; persona?: string } = {},
): KitInfo {
  const texto = [opts.role, opts.botId, opts.persona].filter(Boolean).join("\n");
  const adminLivre = process.env.MYBOTS_KIT_ADMIN === "1";
  let especialidade = "geral";
  let extras = PADRAO_EXTRA;
  let teto = TETO_PADRAO;
  for (const k of KITS) {
    if (k.match.test(texto)) {
      especialidade = k.match.source.slice(0, 40);
      extras = k.tools;
      teto = k.teto;
      break;
    }
  }
  const envTeto = Number(process.env.MYBOTS_KIT_MAX);
  if (Number.isFinite(envTeto) && envTeto >= 5) teto = envTeto;

  const quer = new Set<string>([...NUCLEO, ...extras]);
  if (adminLivre) for (const a of ADMIN_TOOLS) quer.add(a);

  const incluidas: string[] = [];
  const defs: ToolDef[] = [];
  for (const d of todas) {
    const admin = ADMIN_TOOLS.has(d.name);
    if (admin && !quer.has(d.name) && !adminLivre) continue;
    if (!quer.has(d.name) && !NUCLEO.includes(d.name)) continue;
    if (incluidas.length >= teto && !NUCLEO.includes(d.name)) continue;
    incluidas.push(d.name);
    defs.push(d);
  }
  // Garante núcleo mesmo se teto apertado
  for (const d of todas) {
    if (NUCLEO.includes(d.name) && !incluidas.includes(d.name)) {
      incluidas.push(d.name);
      defs.push(d);
    }
  }
  const cortadas = todas.map((d) => d.name).filter((n) => !incluidas.includes(n));
  return { defs, incluidas, cortadas, especialidade };
}
