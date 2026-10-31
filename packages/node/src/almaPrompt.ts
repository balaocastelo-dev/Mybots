// Lê a alma gravada na pasta do bot. Não resolve segredo: o cofre, se existir, injeta a variável.
import fs from "node:fs";
import path from "node:path";

function ler(workspace: string, nome: string): unknown {
  const arquivo = path.join(path.dirname(workspace), nome);
  try {
    if (!fs.existsSync(arquivo)) return null;
    return JSON.parse(fs.readFileSync(arquivo, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

const PROIBIDO = /baileys|whatsapp-web|wwebjs|whiskeysockets|lharries\/whatsapp-mcp|@open-wa\b/i;

export function mcpsDaAlma(workspace: string): Record<string, unknown> {
  const json = ler(workspace, "alma-mcp.json");
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(json)) {
    if (chave === "mybots" || chave === "mybots-local") continue;
    const texto = JSON.stringify(valor);
    if (/(^|[^a-z])latest([^a-z]|$)/i.test(texto) || PROIBIDO.test(texto)) continue;
    saida[chave] = valor;
  }
  return saida;
}

const ROTULO: Record<string, string> = {
  enviarMensagens: "enviar mensagens",
  gravarDados: "gravar dados",
  gastarDinheiro: "gastar dinheiro",
  apagar: "apagar",
  publicar: "publicar",
};

export function textoDaAlma(workspace: string): string {
  const alma = ler(workspace, "alma.json") as {
    id?: string; nome?: string;
    skills?: Array<{ id?: string }>;
    mcps?: Array<{ id?: string }>;
    permissoes?: Record<string, string>;
    segredos?: Array<{ cofreId?: string }>;
  } | null;
  if (!alma) return "";
  const linhas = [`## Alma`, `- Você nasceu com a alma ${alma.nome ?? alma.id ?? "da casa"}.`];
  const skills = (alma.skills ?? []).map((s) => s.id).filter(Boolean);
  if (skills.length) linhas.push(`- Skills pré-carregadas em skills/: ${skills.join(", ")}. Leia o SKILL.md antes de usar.`);
  const mcps = (alma.mcps ?? []).map((m) => m.id).filter(Boolean) as string[];
  if (mcps.length) linhas.push(`- MCPs pinados: ${mcps.join(", ")}.`);
  const confirma = Object.entries(ROTULO).filter(([k]) => alma.permissoes?.[k] === "confirma").map(([, r]) => r);
  if (confirma.length) linhas.push(`- Antes de ${confirma.join(", ")}, peça confirmação ao chefe. Sem o ok, não faça.`);
  const cofres = (alma.segredos ?? []).map((s) => s.cofreId).filter(Boolean);
  if (cofres.length) linhas.push(`- Segredos só pelo cofre: ${cofres.join(", ")}. Não peça o valor no chat e não grave em arquivo.`);
  if (mcps.includes("meta.whatsapp-business-tools")) {
    linhas.push("- WhatsApp de cliente: use o MCP oficial da Meta. Não instale nem ligue WhatsApp Web, Baileys ou whatsapp-web.js.");
  }
  if (mcps.includes("balao-sistema") && !mcps.includes("bling.mcp")) {
    linhas.push("- Financeiro e cadastro da loja: MCP balao-sistema. Não use o Bling.");
  }
  return linhas.join("\n");
}
