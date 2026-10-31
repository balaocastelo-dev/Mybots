// Servidor MCP (Streamable HTTP, sem estado) que dá aos Bots as ferramentas da equipe.
// Usado pelo engine "opencode" (configurado em opencode.json como MCP remoto) e por qualquer
// outro agente compatível com MCP. O engine "direct" usa as mesmas funções pelo WebSocket.
import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { tipoDeAprovacao } from "@mybots/shared";
import { botForToken, config, tokenAllows } from "./config.js";
import type { Hub } from "./hub.js";

export async function registerMcp(app: FastifyInstance, hub: Hub) {
  app.all("/mcp", async (req, reply) => {
    const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    const headerBot = String(req.headers["x-mybots-bot"] ?? "").trim();
    const botId = botForToken(token) ?? (headerBot && tokenAllows(headerBot, token) ? headerBot : null);
    if (!botId) {
      return reply.code(401).send({ error: "MCP: token inválido. Envie Authorization: Bearer <token> e X-MyBots-Bot: <id do bot>." });
    }
    const server = buildMcpServer(hub, botId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    reply.raw.on("close", () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export function buildMcpServer(hub: Hub, botId: string) {
  const server = new McpServer({ name: "mybots", version: config.version });

  server.registerTool("list_bots", {
    description: "Lista os Bots da equipe MyBots, com função e se estão online.",
    inputSchema: {},
  }, async () => text(JSON.stringify(hub.colegasDe(botId).map((b) => ({ id: b.id, name: b.name, role: b.role, online: b.online, status: b.status })), null, 2)));

  server.registerTool("send_to_bot", {
    description: "Envia uma mensagem a outro Bot da equipe sem esperar resposta.",
    inputSchema: { bot: z.string().describe("id ou nome do Bot"), text: z.string() },
  }, async ({ bot, text: t }) => {
    const r = await hub.askBotFromMcp(botId, bot, t, false);
    return text(String(r.data));
  });

  server.registerTool("ask_bot", {
    description: "Pergunta algo a outro Bot da equipe e espera a resposta dele (até alguns minutos).",
    inputSchema: { bot: z.string().describe("id ou nome do Bot"), question: z.string() },
  }, async ({ bot, question }) => {
    const r = await hub.askBotFromMcp(botId, bot, question, true);
    return text(r.ok ? String(r.data) : `Falhou: ${r.data}`);
  });

  server.registerTool("ask_user", {
    description: "Faz uma pergunta ao chefe (usuário) e espera a resposta. Use options para oferecer botões de resposta.",
    inputSchema: { question: z.string(), options: z.array(z.string()).optional() },
  }, async ({ question, options }) => text(await hub.askUserFromMcp(botId, question, options ?? [])));

  server.registerTool("request_approval", {
    description: "Pede aprovação do chefe antes de uma ação crítica (apagar, pagar, enviar, instalar, mexer fora do workspace). Retorna 'aprovado' ou 'negado'. Só execute a ação se for aprovado. Pagar e enviar pedem o chefe mesmo no modo deus.",
    inputSchema: { action: z.string().describe("o que você quer fazer, em uma frase"), detail: z.string().optional().describe("comando, destinatário, valor etc."), risk: z.enum(["low", "medium", "high"]).default("medium") },
  }, async ({ action, detail, risk }) => {
    const kind = tipoDeAprovacao(`${action} ${detail ?? ""}`);
    const ok = await hub.requestApprovalFromMcp(botId, "action", { action, detail }, risk, action, kind);
    return text(ok ? "aprovado" : "negado");
  });

  server.registerTool("fill_credential", {
    description: "Preenche um campo de login ou cartão no navegador deste bot, com uma credencial do cofre. Você NÃO recebe a senha, o número nem o cvv: a resposta é só ok ou erro. site = o endereço da página (ou o nome do cartão, se houver mais de um). campo = usuario, senha, notas, titular, numero, validade ou cvv. Não clica em pagar, enviar ou comprar — esse clique continua pedindo o OK do chefe. Sem permissão explícita do chefe para este bot neste item, a resposta é erro.",
    inputSchema: {
      site: z.string().describe("site da página, ex.: loja.exemplo. Para cartão, o site do checkout ou o nome do cartão"),
      campo: z.string().describe("usuario, senha, titular, numero, validade ou cvv"),
    },
  }, async ({ site, campo }) => {
    const texto = await hub.cofre.preencher({ botId, empresaId: hub.empresaDe(botId).id, site, campo });
    return text(texto === "ok" || texto.startsWith("erro") ? texto : "erro: não consegui preencher");
  });

  server.registerTool("set_status", {
    description: "Atualiza o status curto que aparece na lista de contatos (ex.: 'Lendo o o ERP', 'Gerando o vídeo').",
    inputSchema: { text: z.string().max(80), busy: z.boolean().default(true) },
  }, async ({ text: t, busy }) => { hub.setStatusFromMcp(botId, t, busy); return text("ok"); });

  server.registerTool("notify_user", {
    description: "Manda uma notificação ao chefe (algo terminou ou precisa de atenção), sem esperar resposta.",
    inputSchema: { text: z.string() },
  }, async ({ text: t }) => { hub.notifyFromMcp(botId, t); return text("ok"); });

  // A base comum tambem pelo MCP: sem isto, bot de engine "opencode" (ou qualquer
  // agente externo) ficava sem enxergar o conhecimento da casa que o engine direct ve.
  server.registerTool("search_knowledge", {
    description: "Busca na BASE DE CONHECIMENTO comum da casa (identidade, procedimentos, skills, ferramentas, historia, conhecimento). Ela e compartilhada por todos os bots. Passe query para procurar por assunto, ou id (e parte=2,3... ) para ler um documento inteiro em pedacos. Antes de dizer que nao sabe algo da casa, busque aqui.",
    inputSchema: {
      query: z.string().optional().describe("palavras-chave do que voce procura"),
      id: z.string().optional().describe("id do verbete, para ler o documento inteiro"),
      parte: z.number().optional().describe("qual pedaco do documento ler (1, 2, 3...)"),
      limit: z.number().optional(),
    },
  }, async ({ query, id, parte, limit }) => text(id ? hub.lerSaberTexto(botId, id, parte) : hub.buscarSaberTexto(botId, String(query ?? ""), limit)));

  server.registerTool("list_knowledge", {
    description: "Lista o indice da base comum: titulo, tipo e id de cada documento que a casa sabe. Use para descobrir o que existe antes de buscar.",
    inputSchema: { tipo: z.string().optional().describe("filtra por tipo: procedimento, ferramenta, skill, conhecimento, historia, identidade") },
  }, async ({ tipo }) => {
    const todos = hub.db.listSaberes().filter((v) => !tipo || v.tipo === tipo);
    return text(todos.length
      ? todos.map((v) => `[${v.tipo}] ${v.titulo} — ${v.resumo || "(sem resumo)"}  (id: ${v.id})`).join("\n")
      : "A base esta vazia.");
  });

  server.registerTool("learn_knowledge", {
    description: "Guarda algo novo na base comum. Toda a equipe passa a saber na hora, inclusive os bots que nascerem depois. Use para procedimento, licao aprendida, jeito certo de fazer.",
    inputSchema: {
      titulo: z.string(),
      resumo: z.string().optional().describe("uma linha: quando usar isto"),
      conteudo: z.string(),
      tipo: z.enum(["identidade", "historia", "skill", "conhecimento", "procedimento", "ferramenta", "contato", "produto"]).optional(),
      tags: z.array(z.string()).optional(),
    },
  }, async ({ titulo, resumo, conteudo, tipo, tags }) => text(hub.aprenderSaberTexto(botId, { titulo, resumo, conteudo, tipo, tags })));

  server.registerTool("remember", {
    description: "Guarda um fato na memória compartilhada da equipe (chave → valor).",
    inputSchema: { key: z.string(), value: z.string() },
  }, async ({ key, value }) => { hub.db.remember(botId, key, value, hub.empresaDe(botId).id ?? ""); return text("guardado"); });

  server.registerTool("recall", {
    description: "Lê a memória compartilhada. Use 'prefixo*' para listar várias chaves.",
    inputSchema: { key: z.string() },
  }, async ({ key }) => {
    const emp = hub.empresaDe(botId).id ?? "";
    const v = key.endsWith("*") ? hub.db.recallPrefix(key.slice(0, -1), emp) : hub.db.recall(key, emp);
    return text(v == null ? "(nada guardado)" : typeof v === "string" ? v : JSON.stringify(v, null, 2));
  });

  server.registerTool("schedule", {
    description: "Cria uma rotina para você mesmo: no horário (cron de 5 campos, fuso do Hub) o Hub manda o prompt para você executar. Ex.: '0 8 * * 1' = segundas às 8h.",
    inputSchema: { name: z.string(), cron: z.string(), prompt: z.string() },
  }, async ({ name, cron, prompt }) => {
    const r = hub.createRoutine(botId, name, cron, prompt);
    return text("error" in r ? `Falhou: ${r.error}` : `Rotina "${r.name}" criada (id ${r.id}); próxima execução ${new Date(r.nextRun!).toLocaleString("pt-BR")}`);
  });

  server.registerTool("generate_image", {
    description: "Gera uma imagem a partir de um texto (ComfyUI local grátis primeiro; depois Gemini; depois API paga), dentro da cota do dia. A imagem vai direto para o chefe no chat. ref_file_id = id de um anexo (de [anexo: … /api/files/<id>/…]) para usar como referência.",
    inputSchema: { prompt: z.string().describe("descrição detalhada, em inglês ou português"), ref_file_id: z.string().optional(), aspect: z.enum(["1:1", "9:16", "16:9"]).optional(), conversation_id: z.string().optional() },
  }, async ({ prompt, ref_file_id, aspect, conversation_id }) => {
    const r = await hub.generateMedia(botId, conversation_id ?? "", "image", prompt, { refFileId: ref_file_id, aspect });
    return text(r.ok ? `Imagem gerada por ${r.provider} e enviada ao chat: ${r.file.name} (${config.publicUrl}${r.file.url})${r.note ? ` — ${r.note}` : ""}` : `Falhou: ${r.error}`);
  });

  server.registerTool("generate_video", {
    description: "Gera um vídeo curto (2–15 s) a partir de um texto, com imagem de referência opcional. MiniMax H3 local grátis (fora do horário comercial) primeiro, depois Veo (Gemini), dentro da cota do dia. Pode levar vários minutos. O vídeo vai direto para o chefe no chat.",
    inputSchema: { prompt: z.string().describe("roteiro visual + fala em português"), seconds: z.number().min(2).max(15).default(5), ref_file_id: z.string().optional(), aspect: z.enum(["9:16", "16:9"]).optional(), conversation_id: z.string().optional() },
  }, async ({ prompt, seconds, ref_file_id, aspect, conversation_id }) => {
    const r = await hub.generateMedia(botId, conversation_id ?? "", "video", prompt, { refFileId: ref_file_id, seconds, aspect });
    return text(r.ok ? `Vídeo gerado por ${r.provider} e enviado ao chat: ${r.file.name} (${config.publicUrl}${r.file.url})${r.note ? ` — ${r.note}` : ""}` : `Falhou: ${r.error}`);
  });

  server.registerTool("list_routines", { description: "Lista suas rotinas agendadas.", inputSchema: {} }, async () => text(JSON.stringify(hub.db.listRoutines(botId), null, 2)));

  server.registerTool("cancel_routine", { description: "Cancela uma rotina sua pelo id.", inputSchema: { id: z.string() } }, async ({ id }) => {
    const r = hub.db.listRoutines(botId).find((x) => x.id === id);
    if (!r) return text("rotina não encontrada");
    hub.deleteRoutine(id);
    return text("rotina cancelada");
  });

  return server;
}
