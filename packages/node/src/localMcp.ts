// Servidor MCP local (stdio) que o OpenCode inicia no PC do bot.
// Dá ao agente as ferramentas que precisam estar na máquina: enviar arquivo e foto da tela.
// Variáveis: MYBOTS_HUB_HTTP, MYBOTS_NODE_TOKEN, MYBOTS_BOT_ID, MYBOTS_WORKSPACE
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { captureScreen, mimeOf } from "./screenshot.js";

const hub = (process.env.MYBOTS_HUB_HTTP ?? "http://127.0.0.1:8790").replace(/\/$/, "");
const token = process.env.MYBOTS_NODE_TOKEN ?? "";
const botId = process.env.MYBOTS_BOT_ID ?? "bot";
const workspace = process.env.MYBOTS_WORKSPACE ?? process.cwd();
const conversation = process.env.MYBOTS_CONVERSATION ?? `dm:${botId}`;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

async function upload(file: string, caption?: string): Promise<string> {
  const abs = path.resolve(workspace, file);
  if (!fs.existsSync(abs)) return `Arquivo não existe: ${abs}`;
  const st = fs.statSync(abs);
  if (st.size > 40 * 1024 * 1024) return `Arquivo grande demais (${Math.round(st.size / 1e6)} MB; limite 40 MB).`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "x-mybots-bot": botId,
    "content-type": mimeOf(abs),
    "x-file-name": encodeURIComponent(path.basename(abs)),
    "x-conversation": conversation,
  };
  if (caption) headers["x-caption"] = encodeURIComponent(caption);
  const res = await fetch(`${hub}/api/upload`, { method: "POST", headers, body: new Uint8Array(fs.readFileSync(abs)), signal: AbortSignal.timeout(120_000) });
  const body = await res.text();
  if (!res.ok) return `Falha ao enviar (${res.status}): ${body.slice(0, 200)}`;
  const j = JSON.parse(body);
  return `Arquivo enviado ao chefe: ${j.name} (${j.publicUrl})`;
}

const server = new McpServer({ name: "mybots-local", version: "0.1.0" });

server.registerTool("send_file", {
  description: "Envia um arquivo do workspace para o chefe no chat (imagem, planilha, PDF, vídeo curto; até 40 MB).",
  inputSchema: { path: z.string(), caption: z.string().optional() },
}, async ({ path: p, caption }) => text(await upload(p, caption)));

server.registerTool("screenshot", {
  description: "Tira uma foto da tela deste PC e envia ao chefe no chat.",
  inputSchema: { caption: z.string().optional() },
}, async ({ caption }) => {
  try {
    const file = await captureScreen(path.join(workspace, ".mybots", "capturas"));
    return text(await upload(file, caption ?? "Foto da tela"));
  } catch (e) {
    return text(`Falha na captura: ${(e as Error).message}`);
  }
});

await server.connect(new StdioServerTransport());
