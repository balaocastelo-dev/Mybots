import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { isControlMode } from "@mybots/shared";
import { config, tokenAllows, botForToken } from "./config.js";
import { Hub } from "./hub.js";
import { registerMcp } from "./mcp.js";
import { sugerirEmpresa } from "./sugerirEmpresa.js";
import { DOCS_LEGAIS, VERSAO_LEGAL } from "./legal.js";
import { pixCopiaECola, custoMilesimos, DOLAR } from "./creditos.js";
import QRCode from "qrcode";
import { startScheduler } from "./scheduler.js";
import { pecaDaDemo } from "./demo.js";
import net from "node:net";
import { fileURLToPath } from "node:url";
// A tela do Mac vai por VNC. So estes destinos passam pela ponte, para o proxy
// nao virar um tunel para qualquer endereco da rede.
const VNC_PERMITIDOS: Record<string, { host: string; porta: number }> = {
  mac: { host: process.env.MYBOTS_MAC_IP || "192.168.15.9", porta: 5900 },
};
import { PROVEDORES } from "@mybots/shared";
import { readFile as lerArq, writeFile as gravarArq } from "node:fs/promises";
import { pickVoice, synthesize, transcribe, voiceConfig, EDGE_PT_BR_VOICES, VOZES_CLONADAS } from "./voice.js";
import { BotManager, PROVIDERS, PADRAO_DA_CASA } from "./botManager.js";
import { previaDe, enderecoDe, enderecoDoInsta } from "./previa.js";
import { estadoDa as estadoDaMaquina, ligar as ligarMaquina, desligar as desligarMaquina, apagar as apagarMaquina, imagemPronta } from "./maquinas.js";
import * as celular from "./celular.js";
import { lerMaquina } from "./maquina.js";
import { motivoDaQueda } from "./diagnostico.js";
import { registerPainel } from "./painel.js";
import { estadoDaChave } from "./chaves.js";

export async function startServer(hub: Hub) {
  const app = Fastify({ logger: false, bodyLimit: 60 * 1024 * 1024 });
  await app.register(fastifyWebsocket, { options: { maxPayload: 60 * 1024 * 1024 } });
  // áudio e uploads chegam como binário cru
  // Corpo vazio com "content-type: application/json" é erro de cliente comum (DELETE e
  // POST sem dados). Recusar com 400 esconde a rota verdadeira; aqui vira objeto vazio.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const s = String(body ?? "").trim();
    if (!s) return done(null, {});
    try { done(null, JSON.parse(s)); } catch (e) { done(e as Error, undefined); }
  });
  app.addContentTypeParser(["audio/webm", "audio/ogg", "audio/wav", "audio/wave", "audio/x-wav", "audio/mpeg", "audio/mp4", "application/octet-stream", "image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime", "video/x-matroska"], { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  // --- senha opcional da interface ---
  const uiAuthorized = (req: any) => {
    if (!config.uiPassword) return true;
    const key = req.headers["x-mybots-key"] ?? (req.query as any)?.k;
    return key === config.uiPassword;
  };
  const nodeAuthorized = (req: any): string | null => {
    const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    const bot = String(req.headers["x-mybots-bot"] ?? "").trim();
    return botForToken(token) ?? (bot && tokenAllows(bot, token) ? bot : null);
  };
  app.addHook("onRequest", async (req, reply) => {
    const open = req.url.startsWith("/api/files/") || req.url.startsWith("/api/upload") || req.url.startsWith("/api/import") || req.url.startsWith("/api/channels/incoming");
    if ((req.url.startsWith("/api/") || req.url.startsWith("/ws/ui")) && !open && !uiAuthorized(req) && !nodeAuthorized(req)) {
      reply.code(401).send({ error: "senha da interface inválida" });
    }
  });

  // --- WebSockets ---
  app.get("/ws/node", { websocket: true }, (socket) => hub.handleNodeConnection(socket as any));
  app.get("/ws/ui", { websocket: true }, (socket) => hub.handleUiConnection(socket as any));
  // Ponte VNC: o navegador fala noVNC por este WebSocket e o Hub repassa, byte a
  // byte, para a porta 5900 do destino. O noVNC cuida do protocolo e da senha.
  app.get("/ws/vnc", { websocket: true }, (socket: any, req: any) => {
    const alvo = VNC_PERMITIDOS[String(req.query?.destino ?? "mac")];
    if (!alvo) { try { socket.close(); } catch { /* ja fechou */ } return; }
    const tcp = net.connect(alvo.porta, alvo.host);
    tcp.on("data", (d) => { try { socket.send(d); } catch { /* ws caiu */ } });
    socket.on("message", (m: any) => { try { tcp.write(Buffer.isBuffer(m) ? m : Buffer.from(m)); } catch { /* tcp caiu */ } });
    const fim = () => { try { tcp.destroy(); } catch { /* ok */ } try { socket.close(); } catch { /* ok */ } };
    tcp.on("error", fim); tcp.on("close", fim); socket.on("close", fim); socket.on("error", fim);
  });

  // --- API REST ---
  app.get("/api/health", async () => ({ ok: true, version: config.version, online: hub.onlineBots(), chaveDaCasa: estadoDaChave() }));
  // o painel mostra a reserva do sistema (percentual desta maquina): numero real, lido na hora
  app.get("/api/maquina", async () => ({ ...(await lerMaquina()), saberes: hub.db.contarSaberes() }));
  // Estado de saude de cada bot gerenciado, com a causa de quem nao subiu.
  app.get("/api/diagnostico", async () => {
    const online = new Set(hub.onlineBots());
    return manager.list().map((d: any) => {
      const caido = d.autoStart && !online.has(d.id);
      return {
        id: d.id, nome: d.name, online: online.has(d.id), deveriaSubir: !!d.autoStart,
        rodando: d.running, reinicios: d.restarts,
        queda: caido ? motivoDaQueda(path.join(manager.botsDir, d.id)) : null,
      };
    });
  });
  registerPainel(app, hub);
  app.get("/api/bots", async () => hub.summaries());
  app.get("/api/conversations", async () => hub.db.listConversations());
  app.get("/api/conversations/:id/messages", async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; before?: string };
    return hub.db.getMessages(id, Number(q.limit ?? 200), q.before ? Number(q.before) : undefined);
  });
  app.post("/api/conversations/:id/read", async (req) => {
    hub.db.markRead((req.params as any).id);
    return { ok: true };
  });
  app.post("/api/send", async (req, reply) => {
    const body = req.body as { conversationId?: string; text?: string; attachments?: Array<{ name: string; mime: string; dataBase64: string }> };
    if (!body?.conversationId) return reply.code(400).send({ error: "conversationId é obrigatório" });
    if (!body?.text?.trim() && !body?.attachments?.length) return reply.code(400).send({ error: "informe text ou attachments" });
    return hub.sendUserMessage(body.conversationId, (body.text ?? "").trim(), body.attachments?.length ? body.attachments : undefined);
  });
  // Registro de chamada de voz na conversa. Guarda a mensagem SEM mandar o bot
  // responder: um "Chamada de voz - 0:05" e um marcador, nao um pedido.
  // --- menu do chat (botão direito) ---
  app.post("/api/conversations/:id/rewind", async (req, reply) => {
    const id = (req.params as any).id as string;
    const b = req.body as { messageId?: string; include?: "this" | "after" };
    if (!b?.messageId) return reply.code(400).send({ error: "messageId é obrigatório" });
    const r = hub.rewind(id, b.messageId, b.include === "this" ? "this" : "after");
    if (!r.afetadas && !r.token) return reply.code(404).send({ error: "mensagem não encontrada" });
    return { ...r, messages: hub.db.getMessages(id) };
  });
  app.post("/api/conversations/:id/unrewind", async (req, reply) => {
    const id = (req.params as any).id as string;
    const token = Number((req.body as any)?.token);
    if (!token) return reply.code(400).send({ error: "token é obrigatório" });
    return { voltaram: hub.unrewind(id, token), messages: hub.db.getMessages(id) };
  });
  app.get("/api/conversations/:id/export", async (req, reply) => {
    const id = (req.params as any).id as string;
    const msgs = hub.db.getMessages(id, 1000);
    if ((req.query as any).format === "json") return msgs;
    const md = [`# ${id}`, "", ...msgs.map((m) => `**${m.sender.name}** · ${new Date(m.createdAt).toLocaleString("pt-BR")}\n\n${m.text}\n`)].join("\n");
    reply.header("content-type", "text/markdown; charset=utf-8");
    return md;
  });
  app.post("/api/messages/:id/edit", async (req, reply) => {
    const texto = String((req.body as any)?.text ?? "").trim();
    if (!texto) return reply.code(400).send({ error: "text é obrigatório" });
    const r = hub.editMessage((req.params as any).id, texto);
    return r ?? reply.code(404).send({ error: "mensagem não encontrada (ou não é um pedido seu)" });
  });
  app.post("/api/messages/:id/retry", async (req, reply) => {
    const r = hub.retryMessage((req.params as any).id);
    return r ?? reply.code(404).send({ error: "não achei o pedido que gerou essa resposta" });
  });
  app.post("/api/messages/:id/pin", async (req, reply) => {
    const r = hub.pinMessage((req.params as any).id, (req.body as any)?.pinned !== false);
    return r ?? reply.code(404).send({ error: "mensagem não encontrada" });
  });
  app.delete("/api/messages/:id", async (req, reply) => {
    const r = hub.deleteMessage((req.params as any).id);
    return r ? { ok: true } : reply.code(404).send({ error: "mensagem não encontrada" });
  });
  app.post("/api/messages/:id/remember", async (req, reply) => {
    const m = hub.db.getMessage((req.params as any).id);
    if (!m) return reply.code(404).send({ error: "mensagem não encontrada" });
    const titulo = String((req.body as any)?.titulo ?? m.text.slice(0, 60).replace(/\s+/g, " ")).trim() || "Trecho da conversa";
    const id = `chat-${m.id}`.toLowerCase().slice(0, 60);
    const v = hub.db.saveSaber({
      id, titulo, resumo: m.text.slice(0, 280), conteudo: m.text, tipo: "conhecimento", tags: ["chat"],
      origem: `conversa ${m.conversationId} · ${new Date(m.createdAt).toLocaleDateString("pt-BR")}`,
    });
    hub.broadcastKnowledge();
    hub.db.audit(m.sender.kind === "bot" ? m.sender.id : null, "chat.remember", { messageId: m.id, saber: id });
    return { ok: true, id: v.id, titulo: v.titulo };
  });

  app.post("/api/conversations/:id/marcador", async (req, reply) => {
    const texto = String((req.body as any)?.texto ?? "").trim();
    if (!texto) return reply.code(400).send({ error: "texto obrigatório" });
    const m = hub.marcador(String((req.params as any).id), texto, (req.body as any)?.meta);
    return m;
  });
  app.get("/api/approvals", async () => hub.db.pendingApprovals());
  app.post("/api/approvals/:id", async (req) => {
    const body = req.body as { allow: boolean; remember?: boolean };
    hub.resolveApproval((req.params as any).id, !!body.allow, body.remember);
    return { ok: true };
  });
  app.get("/api/questions", async () => hub.db.pendingQuestions());
  app.post("/api/questions/:id", async (req) => {
    const body = req.body as { answer: string };
    hub.answerQuestion((req.params as any).id, String(body.answer ?? ""));
    return { ok: true };
  });
  app.get("/api/audit", async (req) => hub.db.auditTail(Number((req.query as any).limit ?? 100)));

  // --- automode: nível de controle global (sobrescreve o de cada bot) ---
  app.get("/api/control", async () => ({ ...hub.control(), bots: Object.fromEntries(hub.summaries().filter((b) => b.online).map((b) => [b.id, hub.effectiveModeFor(b.id)])) }));
  app.put("/api/control", async (req, reply) => {
    const b = req.body as { global?: unknown; confirm?: string };
    const g = b?.global ?? null;
    if (g !== null && !isControlMode(g)) return reply.code(400).send({ error: "global deve ser supervisionado | autonomo | deus | null" });
    if (g === "deus" && b?.confirm !== "DEUS") return reply.code(400).send({ error: 'Para ligar o MODO DEUS EXTREMO envie confirm: "DEUS".' });
    return hub.setGlobalControl(g);
  });
  app.post("/api/control/panic", async () => hub.panic());

  // --- mídia: cota e consumo de imagens/vídeos gerados ---
  app.get("/api/media/budget", async () => ({ budget: hub.media.budget(), usage: hub.media.usage() }));
  app.put("/api/media/budget", async (req, reply) => {
    const b = req.body as any;
    if (!b || typeof b !== "object") return reply.code(400).send({ error: "corpo inválido" });
    return { budget: hub.media.setBudget(b), usage: hub.media.usage() };
  });
  app.get("/api/media/usage", async (req) => hub.media.usage((req.query as any).day));
  app.post("/api/media/generate", async (req, reply) => {
    const b = req.body as { botId?: string; conversationId?: string; kind?: string; prompt?: string; refFileId?: string; seconds?: number; aspect?: string };
    if (!b?.botId || !b?.prompt || (b.kind !== "image" && b.kind !== "video")) return reply.code(400).send({ error: "botId, kind (image|video) e prompt são obrigatórios" });
    return hub.generateMedia(b.botId, b.conversationId ?? "", b.kind, b.prompt, { refFileId: b.refFileId, seconds: b.seconds, aspect: b.aspect });
  });

  // --- bots criados pela interface (hospedados neste PC) ---
  const manager = new BotManager(hub);
  hub.managedIds = () => new Set(manager.list().map((b) => b.id));
  hub.protegidosIds = () => new Set(manager.list().filter((b) => b.protegido).map((b) => b.id));
  // mesma regra que o nó usa no prompt: a persona diz se o bot fala outro idioma
  const ENSINA_IDIOMAS = /poliglota|professor(a)? de idiomas|professor(a)? de (ingl[eê]s|espanhol|franc[eê]s|italiano|alem[aã]o)|language (tutor|teacher|coach)|tutor de idiomas/i;
  hub.falamOutroIdioma = () => new Set(manager.list().filter((b) => ENSINA_IDIOMAS.test(b.persona ?? "")).map((b) => b.id));
  hub.managesOf = (botId) => manager.get(botId)?.manages;
  hub.ehGerente = (botId) => !!manager.get(botId)?.gerente;
  {
    const ensinados = manager.ensinarGerentesAMontarEquipe();
    if (ensinados.length) console.log(`[hub] gerente(s) ensinados a montar equipe: ${ensinados.join(", ")}`);
  }
  hub.restartBot = (botId) => { if (!manager.get(botId)) return false; manager.restart(botId); return true; };
  // O caminho certo para um bot cuidar da equipe. Antes não existia: o Médico tentava
  // adivinhar a rota com curl, errava, e caía no PowerShell — matando processo e
  // escrevendo .removido na mão, o que nunca tirava o bot do banco do Hub.
  // O gerente monta a propria equipe. O bot nasce na empresa DELE, com o motor
  // padrao da casa, ja ligado e com ele como dono -- e nao no limbo sem empresa.
  hub.criarBot = async ({ nome, funcao, persona, empresaId, gerenteId }) => {
    const limpo = (nome ?? "").trim();
    if (!limpo) return { ok: false, msg: "Diga o nome do bot." };
    const r = manager.create({
      name: limpo,
      role: (funcao ?? "").trim() || undefined,
      persona: (persona ?? "").trim() || undefined,
      empresa: empresaId ?? undefined,
      autoStart: true,
      engine: PADRAO_DA_CASA.engine,
      provider: { kind: PADRAO_DA_CASA.provider, model: PADRAO_DA_CASA.model },
    } as any);
    if ("error" in r) return { ok: false, msg: r.error };
    const dono = manager.get(gerenteId);
    if (dono) manager.update(gerenteId, { manages: [...(dono.manages ?? []), r.id] } as any);
    manager.start(r.id);
    return { ok: true, msg: `Bot "${r.name}" criado (id ${r.id}) e subindo. Ele ja aparece no painel do chefe.` };
  };

  hub.manageBot = async (acao, botId, apagarArquivos) => {
    const d = manager.get(botId);
    if (!d) {
      const existem = manager.list().map((b) => `${b.id} (${b.name})`).join(", ") || "nenhum";
      return { ok: false, msg: `Não existe bot com id "${botId}" neste Hub. Os que existem: ${existem}. Confira o id antes de tentar de novo — e não tente pelo terminal.` };
    }
    if (acao === "excluir") {
      const r = await manager.remove(botId, apagarArquivos);
      if (r?.error) return { ok: false, msg: r.error };
      return { ok: true, msg: `Bot "${d.name}" (${botId}) excluído: processo encerrado, tirado do painel e do banco.${apagarArquivos ? " A pasta dele também foi apagada." : " A pasta com o workspace continua no disco."}` };
    }
    if (acao === "parar") { await manager.stop(botId); return { ok: true, msg: `Bot "${d.name}" desligado. Continua no painel; use ligar para subir de novo.` }; }
    if (acao === "ligar") return { ok: manager.start(botId), msg: `Bot "${d.name}" ligado.` };
    void manager.restart(botId);
    return { ok: true, msg: `Bot "${d.name}" reiniciando (uns 20 s).` };
  };
  // chaveDaCasa: o painel usa isto para nao pedir chave quando o Hub ja tem uma.
  app.get("/api/providers", async () => PROVIDERS.map((p) => ({ ...p, chaveDaCasa: !!(p.keyEnv && process.env[p.keyEnv]) })));
  // --- empresas: cada uma com seus bots, seus gerentes e suas regras ---
  // --- leis e consentimentos (LGPD) ---
  app.get("/api/legal", async () => ({ versao: VERSAO_LEGAL, docs: DOCS_LEGAIS }));
  app.get("/api/empresas/:id/consentimentos", async (req) => {
    const id = (req.params as any).id;
    return { versao: VERSAO_LEGAL, registros: hub.db.listConsentimentos(id), liberado: hub.podeFalarComCliente(id) };
  });
  app.post("/api/empresas/:id/consentimentos", async (req, reply) => {
    const id = (req.params as any).id;
    if (!hub.db.getEmpresa(id)) return reply.code(404).send({ error: "empresa não encontrada" });
    const b = (req.body ?? {}) as any;
    const itens: Array<{ doc: string; aceito: boolean }> = Array.isArray(b.itens) ? b.itens : [{ doc: b.doc, aceito: !!b.aceito }];
    for (const it of itens) {
      if (!DOCS_LEGAIS.some((d) => d.id === it.doc)) return reply.code(400).send({ error: `documento desconhecido: ${it.doc}` });
      hub.db.registrarConsentimento(id, it.doc, VERSAO_LEGAL, !!it.aceito, b.quem ?? hub.userName);
      hub.db.audit(null, it.aceito ? "legal.aceite" : "legal.recusa", { empresa: id, doc: it.doc, versao: VERSAO_LEGAL, quem: b.quem ?? hub.userName });
    }
    return { versao: VERSAO_LEGAL, registros: hub.db.listConsentimentos(id), liberado: hub.podeFalarComCliente(id) };
  });

  // --- créditos: plano, consumo e recarga por Pix ---
  /** Dados do recebedor do Pix (você). Ficam em settings, não no código. */
  const pixDaCasa = () => {
    const v = (k: string, d = "") => { try { return hub.db.getSetting?.(k) ?? d; } catch { return d; } };
    return { chave: String(v("pix.chave")), nome: String(v("pix.nome", hub.userName)), cidade: String(v("pix.cidade", "CAMPINAS")) };
  };
  app.get("/api/pix", async () => { const p = pixDaCasa(); return { ...p, configurado: !!p.chave }; });
  app.post("/api/pix", async (req) => {
    const b = (req.body ?? {}) as any;
    for (const k of ["chave", "nome", "cidade"]) if (b[k] !== undefined) hub.db.setSetting(`pix.${k}`, String(b[k]));
    hub.db.audit(null, "pix.config", { nome: b.nome, cidade: b.cidade });   // nunca a chave inteira no log
    return { ok: true, ...pixDaCasa(), configurado: !!pixDaCasa().chave };
  });

  app.get("/api/empresas/:id/creditos", async (req) => {
    const id = (req.params as any).id;
    const plano = hub.db.plano(id);
    const mes = hub.db.resumoConsumo(id, plano.cicloInicio ?? 0);
    const hoje = hub.db.resumoConsumo(id, Date.now() - 24 * 3600_000);
    return {
      plano, ciclo: mes, hoje, recargas: hub.db.listRecargas(id),
      pode: hub.podeTrabalhar(id), dolar: DOLAR,
      custoCicloCentavos: Math.round(mes.custoMilesimos / 1000),
    };
  });
  app.post("/api/empresas/:id/plano", async (req, reply) => {
    const id = (req.params as any).id;
    if (!hub.db.getEmpresa(id)) return reply.code(404).send({ error: "empresa não encontrada" });
    const b = (req.body ?? {}) as any;
    const p = hub.db.salvarPlano(id, {
      mensalidadeCentavos: b.mensalidadeCentavos, franquiaMensagens: b.franquiaMensagens,
      precoMensagemCentavos: b.precoMensagemCentavos, cobranca: b.cobranca,
    });
    hub.db.audit(null, "plano.salvo", { empresa: id, ...b });
    return p;
  });
  /** Carência: você concede a quem está em dia. Não é oferecida sozinha. */
  app.post("/api/empresas/:id/carencia", async (req) => {
    const id = (req.params as any).id;
    const horas = Number((req.body as any)?.horas ?? 0);
    const ate = horas > 0 ? Date.now() + horas * 3600_000 : null;
    hub.db.audit(null, horas > 0 ? "carencia.concedida" : "carencia.retirada", { empresa: id, horas });
    return hub.db.salvarPlano(id, { carenciaAte: ate });
  });
  app.post("/api/empresas/:id/ciclo", async (req) => { hub.db.novoCiclo((req.params as any).id); return hub.db.plano((req.params as any).id); });

  app.post("/api/empresas/:id/recarga", async (req, reply) => {
    const id = (req.params as any).id;
    const valor = Math.round(Number((req.body as any)?.valorCentavos ?? 0));
    if (!valor || valor < 100) return reply.code(400).send({ error: "valor mínimo de R$ 1,00" });
    const pix = pixDaCasa();
    if (!pix.chave) return reply.code(400).send({ error: "Falta cadastrar a sua chave Pix na tela de Créditos." });
    const rid = `R${Date.now().toString(36).toUpperCase()}`;
    const copiaECola = pixCopiaECola({ ...pix, valorCentavos: valor, txid: rid });
    hub.db.novaRecarga({ id: rid, empresaId: id, valorCentavos: valor, metodo: "pix-estatico", txid: rid });
    hub.db.audit(null, "recarga.pedida", { empresa: id, valor, id: rid });
    const qr = await QRCode.toDataURL(copiaECola, { margin: 1, width: 300 }).catch(() => undefined);
    return { id: rid, valorCentavos: valor, copiaECola, qr };
  });
  /** Hoje você confirma o Pix que caiu. Amanhã, um provedor chama esta mesma rota. */
  app.post("/api/recargas/:id/confirmar", async (req, reply) => {
    const r = hub.db.confirmarRecarga((req.params as any).id);
    if (!r.ok) return reply.code(400).send({ error: "recarga não encontrada ou já confirmada" });
    hub.db.audit(null, "recarga.confirmada", { id: (req.params as any).id, empresa: r.empresaId, valor: r.valor });
    return { ok: true, plano: hub.db.plano(r.empresaId!) };
  });

  app.get("/api/empresas", async () => hub.db.listEmpresas());
  /** Lê o site e as redes da empresa e SUGERE nome, resumo e regras. Não grava nada. */
  /** A demonstração do Gerente, gerada na hora com os dados do site da empresa.
   *  Um passo por chamada: é isso que dá o ritmo de "ele está montando agora"
   *  na tela, em vez de um silêncio longo e tudo aparecendo de uma vez. */
  /** ── Configuracao da casa: motor, contas e IA local ─────────────────────────
   *  Uma tela so para o que decide SE o sistema consegue pensar. Antes disto a
   *  unica forma de saber qual provedor estava ligado era ler o .env na mao. */
  const ARQ_PREF = "dados/preferencia.json";
  // Previa do endereco na tela de cadastro: o Hub abre a pagina de verdade pelo
  // Chrome, tira a cortina de cadastro (o Instagram poe uma por cima do perfil) e
  // devolve o print junto com as metas que o site publica de si.
  // O celular da empresa, por ADB. A tela vai como PNG cru: e loopback, entao o
  // peso do quadro nao custa rede -- e a foto fiel vale mais que um video espremido.
  app.get("/api/celulares", async () => ({ adb: celular.temAdb(), lista: await celular.listar() }));
  app.post("/api/celulares/conectar", async (req) => await celular.conectar(String((req.body as any)?.ip ?? "")));
  app.get("/api/celulares/:serial/tela", async (req, reply) => {
    const png = await celular.tela(decodeURIComponent((req.params as any).serial));
    if (!png) return reply.code(503).send({ error: "nao consegui ver a tela do aparelho" });
    return reply.header("content-type", "image/png").header("cache-control", "no-store").send(png);
  });
  app.get("/api/celulares/:serial/arvore", async (req, reply) => {
    const x = await celular.arvore(decodeURIComponent((req.params as any).serial));
    return x ? reply.header("content-type", "text/xml").send(x) : reply.code(503).send({ error: "nao consegui ler a interface" });
  });
  app.post("/api/celulares/:serial/tocar", async (req) => {
    const b = req.body as { x: number; y: number };
    return { ok: await celular.tocar(decodeURIComponent((req.params as any).serial), Number(b?.x), Number(b?.y)) };
  });
  app.post("/api/celulares/:serial/deslizar", async (req) => {
    const b = req.body as { x1: number; y1: number; x2: number; y2: number; ms?: number };
    return { ok: await celular.deslizar(decodeURIComponent((req.params as any).serial), Number(b?.x1), Number(b?.y1), Number(b?.x2), Number(b?.y2), Number(b?.ms) || 260) };
  });
  app.post("/api/celulares/:serial/digitar", async (req) => ({ ok: await celular.digitar(decodeURIComponent((req.params as any).serial), String((req.body as any)?.texto ?? "")) }));
  app.post("/api/celulares/:serial/tecla", async (req) => ({ ok: await celular.tecla(decodeURIComponent((req.params as any).serial), String((req.body as any)?.tecla ?? "")) }));
  app.post("/api/celulares/:serial/acordar", async (req) => ({ ok: await celular.acordar(decodeURIComponent((req.params as any).serial)) }));

  // O PC da empresa: um Linux so dela, em container, nesta mesma maquina. A tela
  // vai por noVNC, entao o chefe assiste o bot em vez de ler o que ele fez.
  app.get("/api/empresas/:id/maquina", async (req) => {
    const id = (req.params as any).id as string;
    const m = await estadoDaMaquina(id);
    return { ...m, imagem: await imagemPronta() };
  });
  app.post("/api/empresas/:id/maquina/ligar", async (req) => {
    const id = (req.params as any).id as string;
    const emp = hub.db.listEmpresas?.().find((e: any) => e.id === id);
    return await ligarMaquina(id, emp?.nome ?? "");
  });
  app.post("/api/empresas/:id/maquina/desligar", async (req) => await desligarMaquina((req.params as any).id as string));
  app.delete("/api/empresas/:id/maquina", async (req) => await apagarMaquina((req.params as any).id as string));

  app.get("/api/previa", async (req, reply) => {
    const q = req.query as { url?: string; insta?: string };
    const alvo = q.insta ? enderecoDoInsta(q.insta) : enderecoDe(q.url ?? "");
    if (!alvo) return reply.code(400).send({ ok: false, erro: "diga url ou insta" });
    try {
      return await previaDe(alvo, { print: true });
    } catch (e) {
      return reply.code(200).send({ ok: false, url: alvo, erro: (e as Error).message });
    }
  });

  app.get("/api/config/provedores", async (req, reply) => {
    if (!uiAuthorized(req)) return reply.code(401).send({ error: "nao autorizado" });
    return PROVEDORES.filter((p) => !p.local).map((p) => ({
      id: p.id, nome: p.nome, modelo: p.modeloPadrao, contextoK: p.contextoK,
      limites: p.limites, env: p.envChave, aviso: p.aviso ?? null,
      exigeConsentimento: !!p.exigeConsentimento,
      configurada: !!(p.envChave && String(process.env[p.envChave] ?? "").trim()),
    }));
  });

  /** Teste de ida e volta: chave "salva" nao e chave "funcionando". */
  app.post("/api/config/provedores/:id/testar", async (req, reply) => {
    if (!uiAuthorized(req)) return reply.code(401).send({ error: "nao autorizado" });
    const p = PROVEDORES.find((x) => x.id === (req.params as any).id);
    if (!p) return reply.code(404).send({ error: "provedor desconhecido" });
    const chave = p.envChave ? String(process.env[p.envChave] ?? "").trim() : "";
    if (!chave && !p.local) return { ok: false, erro: `Falta ${p.envChave} no .env do Hub.` };
    let base = p.baseURL;
    if (base.includes("{conta}")) {
      const conta = String(process.env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
      if (!conta) return { ok: false, erro: "Falta CLOUDFLARE_ACCOUNT_ID no .env." };
      base = base.replace("{conta}", conta);
    }
    const t0 = Date.now();
    try {
      const r = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(chave ? { authorization: `Bearer ${chave}` } : {}) },
        body: JSON.stringify({ model: p.modeloPadrao, max_tokens: 12, messages: [{ role: "user", content: "responda apenas: ok" }] }),
        signal: AbortSignal.timeout(25_000),
      });
      const corpo = await r.text();
      if (!r.ok) return { ok: false, erro: `HTTP ${r.status}: ${corpo.slice(0, 220)}` };
      const j = JSON.parse(corpo);
      const txt = String(j?.choices?.[0]?.message?.content ?? "").trim();
      return { ok: !!txt, ms: Date.now() - t0, resposta: txt.slice(0, 60) || "(vazio)" };
    } catch (e) {
      return { ok: false, erro: (e as Error).message };
    }
  });

  /** A maquina e o que ela consegue rodar sozinha. */
  app.get("/api/config/local", async (req, reply) => {
    if (!uiAuthorized(req)) return reply.code(401).send({ error: "nao autorizado" });
    const m = await lerMaquina();
    let ollama: { ok: boolean; modelos: string[]; erro?: string } = { ok: false, modelos: [] };
    try {
      const r = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(2500) });
      if (r.ok) {
        const j = await r.json() as any;
        ollama = { ok: true, modelos: (j?.models ?? []).map((x: any) => String(x?.name ?? "")).filter(Boolean) };
      } else ollama.erro = `HTTP ${r.status}`;
    } catch { ollama.erro = "Ollama nao respondeu em 127.0.0.1:11434"; }
    return { ram: m.ram, vram: m.vram, reserva: m.reserva, cpus: m.cpus, ollama };
  });

  app.get("/api/config/preferencia", async (req, reply) => {
    if (!uiAuthorized(req)) return reply.code(401).send({ error: "nao autorizado" });
    try { return JSON.parse(await lerArq(ARQ_PREF, "utf8")); } catch { return { ordem: "nuvem" }; }
  });
  app.put("/api/config/preferencia", async (req, reply) => {
    if (!uiAuthorized(req)) return reply.code(401).send({ error: "nao autorizado" });
    const o = String((req.body as any)?.ordem ?? "nuvem");
    const v = ["nuvem", "local", "so-local", "so-nuvem"].includes(o) ? o : "nuvem";
    try { await gravarArq(ARQ_PREF, JSON.stringify({ ordem: v }, null, 2), "utf8"); } catch { /* best effort */ }
    return { ordem: v };
  });

  /** Reset de fabrica: apaga empresas, bots e preferencias — a casa volta a tela de
   *  cadastro. Exige a frase por extenso porque isto NAO tem volta: nao ha lixeira, e
   *  os bots levam junto as conversas e os arquivos deles. */
  app.post("/api/config/reset", async (req, reply) => {
    if (!uiAuthorized(req)) return reply.code(401).send({ error: "nao autorizado" });
    const frase = String((req.body as any)?.confirmacao ?? "").trim().toUpperCase();
    if (frase !== "APAGAR TUDO") return reply.code(400).send({ error: "Digite APAGAR TUDO para confirmar." });
    const apagados: string[] = [];
    const erros: string[] = [];
    for (const b of manager.list()) {
      try { const r = await manager.remove(b.id, true); if (r?.error) erros.push(`${b.id}: ${r.error}`); else apagados.push(b.id); }
      catch (e) { erros.push(`${b.id}: ${(e as Error).message}`); }
    }
    const empresas = hub.db.listEmpresas();
    for (const e of empresas) {
      try { const r = hub.db.deleteEmpresa(e.id); if (!r.ok) erros.push(`${e.id}: ${r.motivo}`); }
      catch (err) { erros.push(`${e.id}: ${(err as Error).message}`); }
    }
    try { await gravarArq(ARQ_PREF, JSON.stringify({ ordem: "nuvem" }, null, 2), "utf8"); } catch { /* best effort */ }
    hub.db.audit(null, "sistema.reset", { bots: apagados.length, empresas: empresas.length, erros: erros.length });
    return { ok: erros.length === 0, bots: apagados.length, empresas: empresas.length, erros };
  });
  app.post("/api/empresas/demo", async (req, reply) => {
    if (!uiAuthorized(req)) return reply.code(401).send({ error: "não autorizado" });
    const b = (req.body ?? {}) as any;
    const passo = String(b.passo ?? "");
    if (!passo) return reply.code(400).send({ error: "diga o passo: imagem, pdf, video ou link" });
    const salvar = (nome: string, mime: string, data: Buffer) => {
      const f = hub.saveFile("user", nome, mime, data);
      return { url: f.url, name: f.name };
    };
    try {
      return await pecaDaDemo(passo, { nome: String(b.nome ?? "a empresa"), site: b.site, resumo: b.resumo, regras: b.regras }, salvar, b.imagem);
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });
  app.post("/api/empresas/sugerir", async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const r = await sugerirEmpresa({ nome: b.nome, site: b.site, instagram: b.instagram, facebook: b.facebook });
    return "error" in r ? reply.code(400).send(r) : r;
  });
  app.post("/api/empresas", async (req, reply) => {
    const b = req.body as any;
    if (!b?.nome?.trim()) return reply.code(400).send({ error: "nome é obrigatório" });
    const id = String(b.id ?? b.nome).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (!id) return reply.code(400).send({ error: "nome inválido" });
    const e = hub.db.saveEmpresa({ id, nome: b.nome.trim(), regras: b.regras ?? "", cor: b.cor, idioma: b.idioma ?? "pt" });
    hub.db.audit(null, "empresa.salva", { id });
    hub.broadcastKnowledge();
    // Empresa nasce com o WhatsApp dela subindo: o QR aparece no painel em segundos.
    void hub.whats.conectar(id).catch(() => {});
    // ...e com o Gerente Geral dela, que recebe o chefe e apresenta o sistema.
    if (b.comGerente === false || b.comMedico === false) return { ...e, gerente: null };
    const gerente = manager.criarGerenteDaEmpresa(id, e.nome);
    if ("error" in gerente) {
      hub.db.audit(null, "empresa.gerente.falhou", { id, erro: gerente.error });
      return { ...e, gerente: null, aviso: `empresa criada, mas o Gerente Geral não subiu: ${gerente.error}` };
    }
    hub.db.setEmpresaDoBot(gerente.id, `Gerente Geral — ${e.nome}`, id, false);
    hub.broadcastKnowledge();
    hub.apresentarEmpresa(gerente.id, e.nome);
    return { ...e, gerente: gerente.id };
  });
  app.patch("/api/empresas/:id", async (req, reply) => {
    const id = (req.params as any).id;
    const atual = hub.db.getEmpresa(id);
    if (!atual) return reply.code(404).send({ error: "empresa não encontrada" });
    const b = req.body as any;
    const e = hub.db.saveEmpresa({ id, nome: b.nome ?? atual.nome, regras: b.regras ?? atual.regras, cor: b.cor ?? atual.cor, idioma: b.idioma ?? atual.idioma });
    hub.db.audit(null, "empresa.salva", { id });
    hub.broadcastKnowledge();   // as regras da empresa vão no prompt: todo bot dela recebe agora
    return e;
  });
  app.delete("/api/empresas/:id", async (req, reply) => {
    const r = hub.db.deleteEmpresa((req.params as any).id);
    if (!r.ok) return reply.code(400).send({ error: r.motivo });
    hub.db.audit(null, "empresa.apagada", { id: (req.params as any).id });
    return { ok: true };
  });
  /** Move um bot de empresa (ou marca/desmarca como ponte). */
  app.post("/api/bots/:id/empresa", async (req, reply) => {
    const id = (req.params as any).id;
    const bot = hub.db.listBots().find((b) => b.id === id);
    if (!bot) return reply.code(404).send({ error: "bot não encontrado" });
    const b = req.body as any;
    hub.db.setEmpresaDoBot(id, bot.name, b.empresa ?? null, !!b.ponte);
    hub.db.audit(id, "bot.empresa", { empresa: b.empresa ?? null, ponte: !!b.ponte });
    hub.broadcastKnowledge();
    hub.botUpdate(id);
    return { ok: true };
  });

  // --- WhatsApp de cada empresa (conta propria, QR propria) ---
  app.get("/api/whatsapp", async () => hub.whats.todos());
  app.get("/api/empresas/:id/whatsapp", async (req) => hub.whats.estado((req.params as any).id));
  app.post("/api/empresas/:id/whatsapp/conectar", async (req, reply) => {
    const id = (req.params as any).id;
    if (!hub.db.getEmpresa(id)) return reply.code(404).send({ error: "empresa não encontrada" });
    hub.db.audit(null, "whatsapp.conectar", { empresa: id });
    return hub.whats.conectar(id);
  });
  app.post("/api/empresas/:id/whatsapp/desligar", async (req) => {
    const b = (req.body ?? {}) as any;
    await hub.whats.desligar((req.params as any).id, !!b.esquecer);
    return { ok: true };
  });
  /** Teste do chefe: manda uma mensagem pela conta da empresa. */
  app.post("/api/empresas/:id/whatsapp/enviar", async (req, reply) => {
    const b = (req.body ?? {}) as any;
    if (!b.para || !b.texto) return reply.code(400).send({ error: "para e texto são obrigatórios" });
    const liberado = hub.podeFalarComCliente((req.params as any).id);
    if (!liberado.ok) return reply.code(400).send({ error: `Esta empresa ainda não aceitou os termos de uso de dados (falta: ${liberado.falta.join(", ")}). Abra Leis e consentimentos.` });
    const r = await hub.whats.enviar((req.params as any).id, String(b.para), String(b.texto));
    return r.ok ? r : reply.code(400).send({ error: r.detalhe });
  });

  app.get("/api/managed", async () => manager.list());
  app.get("/api/managed/:id", async (req, reply) => manager.get((req.params as any).id) ?? reply.code(404).send({ error: "bot não encontrado" }));
  app.post("/api/managed", async (req, reply) => {
    const b = req.body as any;
    if (!b?.name?.trim()) return reply.code(400).send({ error: "name é obrigatório" });
    // U+FFFD é texto que já chegou quebrado (acento perdido no caminho). Barrar aqui
    // evita um bot que vai se chamar "Bal?o" para sempre, inclusive no id.
    if (/\uFFFD/.test(`${b.name}${b.role ?? ""}${b.persona ?? ""}`)) {
      return reply.code(400).send({ error: "O texto chegou com caracteres quebrados (acentuação perdida). Mande o nome e a função em UTF-8 — se você é um bot criando outro, use o painel em vez da linha de comando." });
    }
    // Todo bot tem dono: não existe bot sem empresa. Quem cria herda — bot criado por
    // outro bot nasce na empresa de quem o criou.
    const criador = nodeAuthorized(req);
    const empresa = (b.empresa || (criador ? hub.empresaDe(criador).id : null)) ?? null;
    if (!empresa) {
      const empresas = hub.db.listEmpresas();
      return reply.code(400).send({
        error: empresas.length
          ? "Diga de qual empresa é este bot: todo bot pertence a uma."
          : "Crie a primeira empresa antes: todo bot pertence a uma empresa.",
      });
    }
    if (!hub.db.getEmpresa(empresa)) return reply.code(400).send({ error: `Empresa "${empresa}" não existe.` });
    const r = manager.create(b);
    if ("error" in r) return reply.code(400).send(r);
    hub.db.setEmpresaDoBot(r.id, r.name, empresa ?? null, !!b.ponte);
    hub.broadcastKnowledge();
    return r;
  });
  app.patch("/api/managed/:id", async (req, reply) => {
    const r = manager.update((req.params as any).id, req.body as any);
    if (!r) return reply.code(404).send({ error: "bot não encontrado" });
    return "error" in r ? reply.code(400).send(r) : r;
  });
  app.post("/api/managed/:id/start", async (req) => ({ ok: manager.start((req.params as any).id) }));
  app.post("/api/managed/:id/stop", async (req) => ({ ok: true, ...(await manager.stop((req.params as any).id)) }));
  app.post("/api/managed/:id/restart", async (req) => { void manager.restart((req.params as any).id); return { ok: true }; });
  // PARAR TUDO: o ⏹ grande, o Esc e o fechar da janela chamam aqui. Cala todos os bots,
  // limpa os cartões pendentes e manda todas as janelas (e o celular) pararem também.
  app.post("/api/stop", async (req) => ({ ok: true, ...hub.pararTudo(String((req.body as any)?.reason ?? "⏹ no painel")) }));

  // Parar ESTE bot (só ele): interrompe o que ele está fazendo, sem desligar o processo
  // e sem tocar nos outros. Desligar o processo é /api/managed/:id/stop.
  app.post("/api/bots/:id/parar", async (req, reply) => {
    const id = String((req.params as any).id);
    if (!hub.db.listBots().some((b) => b.id === id)) return reply.code(404).send({ error: "bot não encontrado" });
    return { ok: true, ...hub.pararBot(id, "pedido pelo painel") };
  });
  app.get("/api/managed/:id/logs", async (req) => ({ log: manager.logs((req.params as any).id, Number((req.query as any).lines ?? 200)) }));
  app.delete("/api/managed/:id", async (req, reply) => {
    const r = await manager.remove((req.params as any).id, (req.query as any).purge === "1");
    return r?.error ? reply.code(400).send(r) : { ok: true };
  });
  app.get("/api/voice/voices", async () => [
    // as vozes clonadas do o chefe e do João vêm primeiro: são as da casa
    ...Object.entries(VOZES_CLONADAS).map(([chave, v]) => ({ valor: `clone:${chave}`, nome: v.nome, clonada: true })),
    ...EDGE_PT_BR_VOICES.map((v) => ({ valor: v, nome: v.replace(/^pt-BR-|Neural$/g, "").replace("Multilingual", " multilíngue"), clonada: false })),
  ]);

  // --- grupos ---
  app.get("/api/groups", async () => hub.db.listGroups());
  app.post("/api/groups", async (req, reply) => {
    const b = req.body as { name?: string; members?: string[] };
    if (!b?.members?.length) return reply.code(400).send({ error: "members é obrigatório" });
    return hub.createGroup(b.name ?? "Grupo", b.members);
  });
  app.patch("/api/groups/:id", async (req, reply) => {
    const g = hub.updateGroup((req.params as any).id, req.body as any);
    return g ?? reply.code(404).send({ error: "grupo não encontrado" });
  });
  app.delete("/api/groups/:id", async (req) => { hub.deleteGroup((req.params as any).id); return { ok: true }; });

  // --- sala: os bots conversando entre si ---
  app.get("/api/salas", async () => hub.sala.ativas());
  app.post("/api/salas", async (req, reply) => {
    const b = req.body as { groupId?: string; assunto?: string; voltas?: number; pausaSeg?: number; name?: string; members?: string[] };
    let groupId = b?.groupId;
    // Sem grupo pronto, cria um na hora com os membros informados — assim dá
    // para abrir uma sala numa linha, sem ter de montar o grupo antes.
    if (!groupId && b?.members?.length) groupId = hub.createGroup(b.name ?? b.assunto ?? "Sala", b.members).id;
    if (!groupId) return reply.code(400).send({ error: "informe groupId, ou members para eu criar o grupo" });
    const r = hub.sala.abrir(groupId, String(b?.assunto ?? ""), { voltas: b?.voltas, pausaSeg: b?.pausaSeg });
    return "error" in r ? reply.code(400).send(r) : r;
  });
  app.post("/api/salas/:id/parar", async (req, reply) => {
    const ok = hub.sala.parar(String((req.params as any).id));
    return ok ? { ok: true } : reply.code(404).send({ error: "essa sala não está aberta" });
  });

  // --- rotinas ---
  app.get("/api/routines", async (req) => hub.db.listRoutines((req.query as any).bot));
  app.post("/api/routines", async (req, reply) => {
    const b = req.body as { botId?: string; name?: string; cron?: string; prompt?: string };
    if (!b?.botId || !b?.cron || !b?.prompt) return reply.code(400).send({ error: "botId, cron e prompt são obrigatórios" });
    const r = hub.createRoutine(b.botId, b.name ?? "", b.cron, b.prompt);
    return "error" in r ? reply.code(400).send(r) : r;
  });
  app.patch("/api/routines/:id", async (req, reply) => {
    const r = hub.updateRoutine((req.params as any).id, req.body as any);
    if (!r) return reply.code(404).send({ error: "rotina não encontrada" });
    return "error" in r ? reply.code(400).send(r) : r;
  });
  app.post("/api/routines/:id/run", async (req, reply) => {
    const r = hub.db.listRoutines().find((x) => x.id === (req.params as any).id);
    if (!r) return reply.code(404).send({ error: "rotina não encontrada" });
    hub.fireRoutine(r, "manual");
    hub.db.updateRoutine(r.id, { lastRun: Date.now() });
    hub.broadcastRoutines();
    return { ok: true };
  });
  app.delete("/api/routines/:id", async (req) => { hub.deleteRoutine((req.params as any).id); return { ok: true }; });

  // --- arquivos ---
  app.get("/api/files/:id/:name?", async (req, reply) => {
    const f = hub.db.getFile((req.params as any).id);
    if (!f || !fs.existsSync(f.path)) return reply.code(404).send({ error: "arquivo não encontrado" });
    reply.header("content-type", f.mime).header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    return reply.send(fs.createReadStream(f.path));
  });
  /** Upload por um nó/bot (token do nó) ou pela interface: corpo binário + cabeçalhos X-File-Name / X-Conversation. */
  app.post("/api/upload", async (req, reply) => {
    const botId = nodeAuthorized(req) ?? (uiAuthorized(req) ? "user" : null);
    if (!botId) return reply.code(401).send({ error: "não autorizado" });
    const name = decodeURIComponent(String(req.headers["x-file-name"] ?? "arquivo"));
    const mime = String(req.headers["content-type"] ?? "application/octet-stream").split(";")[0];
    const conversationId = String(req.headers["x-conversation"] ?? "");
    const caption = req.headers["x-caption"] ? decodeURIComponent(String(req.headers["x-caption"])) : undefined;
    const data = Buffer.isBuffer(req.body) ? req.body : typeof req.body === "string" ? Buffer.from(req.body, "utf8") : Buffer.from(JSON.stringify(req.body ?? ""));
    const f = hub.saveFile(botId, name, mime, data);
    if (conversationId && botId !== "user") hub.storeMessage(conversationId, hub.botSender(botId), caption ?? `Enviou ${f.name}`, { files: [{ id: f.id, name: f.name, url: f.url, mime: f.mime }] });
    return { ...f, publicUrl: `${config.publicUrl}${f.url}` };
  });

  /** Arquivo largado no atalho da Área de Trabalho: entra por aqui e o painel pergunta a qual bot entregar. */
  app.post("/api/import", async (req, reply) => {
    if (!nodeAuthorized(req) && !uiAuthorized(req)) return reply.code(401).send({ error: "não autorizado" });
    const name = decodeURIComponent(String(req.headers["x-file-name"] ?? "arquivo"));
    const mime = String(req.headers["content-type"] ?? "application/octet-stream").split(";")[0];
    const data = Buffer.isBuffer(req.body) ? req.body : typeof req.body === "string" ? Buffer.from(req.body, "utf8") : Buffer.from(JSON.stringify(req.body ?? ""));
    if (!data.length) return reply.code(400).send({ error: "arquivo vazio" });
    if (data.length > 4 * 1024 * 1024) return reply.code(413).send({ error: "arquivo grande demais para importar pelo atalho; arraste direto para a janela do MyBots" });
    hub.requestImport(name, mime, data);
    return { ok: true, name, size: data.length };
  });

  app.post("/api/import/clear", async () => { hub.clearImport(); return { ok: true }; });

  // --- trabalhos feitos: tudo que os bots produziram, separado por tipo ---

  /** O tipo é decidido pelo mime e, quando ele é genérico demais, pela extensão. */
  function tipoDoArquivo(nome: string, mime: string): string {
    const ext = (nome.split(".").pop() ?? "").toLowerCase();
    if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(ext)) return "imagem";
    if (mime.startsWith("video/") || ["mp4", "mov", "webm", "avi", "mkv"].includes(ext)) return "video";
    if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "opus", "flac"].includes(ext)) return "audio";
    if (mime === "application/pdf" || ext === "pdf") return "pdf";
    if (["html", "htm"].includes(ext) || mime === "text/html") return "site";
    if (["md", "markdown", "txt", "rtf"].includes(ext)) return "texto";
    if (["csv", "xlsx", "xls", "ods", "tsv"].includes(ext)) return "planilha";
    if (["docx", "doc", "odt", "pptx", "ppt"].includes(ext)) return "documento";
    if (["zip", "7z", "rar", "tar", "gz"].includes(ext)) return "pacote";
    if (["json", "ts", "js", "py", "ps1", "sh", "css", "yml", "yaml", "sql"].includes(ext)) return "codigo";
    return "outro";
  }

  /** Lista o que os bots produziram. Filtra por tipo, por bot e por pedaço do nome. */
  app.get("/api/trabalhos", async (req) => {
    const q = String((req.query as any).q ?? "").trim().toLowerCase();
    const tipo = String((req.query as any).tipo ?? "").trim();
    const bot = String((req.query as any).bot ?? "").trim();
    const limite = Math.min(Number((req.query as any).limite ?? 400) || 400, 2000);
    const contagem: Record<string, number> = {};
    const itens = hub.db.listFiles(limite)
      .map((f) => ({
        id: f.id, nome: f.name, mime: f.mime, tamanho: f.size, botId: f.bot_id,
        quando: f.created_at, tipo: tipoDoArquivo(f.name, f.mime),
        url: `/api/files/${f.id}/${encodeURIComponent(f.name)}`,
        existe: fs.existsSync(f.path),
      }))
      .filter((f) => f.existe);
    for (const f of itens) contagem[f.tipo] = (contagem[f.tipo] ?? 0) + 1;
    const filtrados = itens.filter((f) =>
      (!tipo || f.tipo === tipo) && (!bot || f.botId === bot) && (!q || f.nome.toLowerCase().includes(q)));
    return { itens: filtrados, contagem, total: itens.length };
  });

  /**
   * Copia os trabalhos para uma pasta de verdade na Área de Trabalho, em subpastas
   * por tipo e com nome legível (no disco do Hub os arquivos têm o id no nome).
   * Depois abre a pasta, para ele pegar o que quiser sem passar pelo painel.
   */
  app.post("/api/trabalhos/pasta", async (req, reply) => {
    if (!uiAuthorized(req)) return reply.code(401).send({ error: "não autorizado" });
    const corpo = (req.body ?? {}) as { tipo?: string; ids?: string[]; abrir?: boolean };
    const os = await import("node:os");
    const raiz = path.join(os.homedir(), "Desktop", "MyBots - Trabalhos");
    const PASTA: Record<string, string> = {
      imagem: "Imagens", video: "Videos", audio: "Audios", pdf: "PDFs", site: "Sites HTML",
      texto: "Textos e MD", planilha: "Planilhas", documento: "Documentos", pacote: "Zips",
      codigo: "Codigo", outro: "Outros",
    };
    let copiados = 0, pulados = 0;
    for (const f of hub.db.listFiles(2000)) {
      const tipo = tipoDoArquivo(f.name, f.mime);
      if (corpo.tipo && tipo !== corpo.tipo) continue;
      if (corpo.ids?.length && !corpo.ids.includes(f.id)) continue;
      if (!fs.existsSync(f.path)) continue;
      const d = new Date(f.created_at);
      const quando = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`;
      const destinoDir = path.join(raiz, PASTA[tipo] ?? "Outros");
      fs.mkdirSync(destinoDir, { recursive: true });
      const limpo = (t: string) => t.replace(/[\\/:*?"<>|]/g, "_");
      const ext = path.extname(f.name);
      const base = path.basename(f.name, ext);
      let destino = path.join(destinoDir, limpo(`${quando} ${f.bot_id} ${f.name}`));
      // Dois arquivos diferentes podem ter o mesmo nome, do mesmo bot, no mesmo
      // minuto. Antes um apagava o outro em silêncio; agora o que já está lá só
      // é considerado "o mesmo" se tiver o tamanho igual — senão ganha sufixo.
      if (fs.existsSync(destino)) {
        if (fs.statSync(destino).size === f.size) { pulados++; continue; }
        destino = path.join(destinoDir, limpo(`${quando} ${f.bot_id} ${base} (${f.id.slice(-6)})${ext}`));
        if (fs.existsSync(destino) && fs.statSync(destino).size === f.size) { pulados++; continue; }
      }
      try { fs.copyFileSync(f.path, destino); copiados++; } catch { pulados++; }
    }
    if (corpo.abrir !== false) {
      try {
        const { spawn } = await import("node:child_process");
        if (process.platform === "win32") spawn("explorer.exe", [raiz], { detached: true, stdio: "ignore" }).unref();
        else spawn(process.platform === "darwin" ? "open" : "xdg-open", [raiz], { detached: true, stdio: "ignore" }).unref();
      } catch { /* abrir a pasta é conveniência; copiar é o que importa */ }
    }
    hub.db.audit(null, "trabalhos.pasta", { copiados, pulados, tipo: corpo.tipo ?? "todos" });
    return { pasta: raiz, copiados, pulados };
  });

  // --- base de conhecimento comum a todos os bots ---
  app.get("/api/knowledge", async (req) => {
    const q = String((req.query as any).q ?? "").trim();
    return q ? hub.db.searchSaberes(q, undefined, 30) : hub.db.listSaberesTodos();
  });
  /** O bloco de herança que um bot recebe. Serve para conferir o que ele realmente sabe de cabeça. */
  app.get("/api/knowledge/heranca/:botId", async (req) => ({ botId: (req.params as any).botId, bloco: hub.knowledgeIndex((req.params as any).botId) }));
  app.get("/api/knowledge/:id", async (req, reply) => hub.db.getSaber((req.params as any).id) ?? reply.code(404).send({ error: "não existe" }));
  app.post("/api/knowledge", async (req, reply) => {
    const b = req.body as any;
    if (!b?.titulo?.trim() || !b?.conteudo?.trim()) return reply.code(400).send({ error: "titulo e conteudo são obrigatórios" });
    const id = String(b.id ?? b.titulo).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const v = hub.db.saveSaber({ id, titulo: b.titulo.trim(), resumo: (b.resumo ?? "").trim(), conteudo: b.conteudo, tipo: b.tipo ?? "conhecimento", tags: b.tags ?? [], bots: undefined, origem: b.origem, empresaId: b.empresa ?? undefined } as any);  // bots: a base e comum, saber com dono nao existe mais
    hub.broadcastKnowledge();
    return v;
  });
  app.delete("/api/knowledge/:id", async (req) => { hub.db.deleteSaber((req.params as any).id); hub.broadcastKnowledge(); return { ok: true }; });

  // --- canais externos (WhatsApp via CRM, e-mail...) ---
  app.post("/api/channels/incoming", async (req, reply) => {
    const key = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    const expected = config.channelInboundKey || config.hubToken;
    if (expected && key !== expected) return reply.code(401).send({ error: "chave do canal inválida" });
    const b = req.body as { channel?: string; from?: string; botId?: string; text?: string };
    if (!b?.channel || !b?.from || !b?.botId || !b?.text) return reply.code(400).send({ error: "channel, from, botId e text são obrigatórios" });
    return hub.channelMessage(b.channel, b.from, b.botId, b.text);
  });

  // --- voz ---
  app.get("/api/voice/config", async () => voiceConfig());
  app.post("/api/stt", async (req, reply) => {
    try {
      const mime = String(req.headers["content-type"] ?? "audio/webm").split(";")[0];
      // Áudio curto demais é clique, tosse ou porta batendo. Mandar isso ao Whisper
      // não dá silêncio de volta: dá uma frase inventada, que vira pedido ao bot.
      if (!Buffer.isBuffer(req.body) || (req.body as Buffer).length < 2000) return { text: "" };
      const text = await transcribe(req.body as Buffer, mime, mime.includes("wav") ? "audio.wav" : mime.includes("mp4") ? "audio.m4a" : "audio.webm", String((req.query as any).lang ?? "pt"));
      return { text };
    } catch (e) {
      return reply.code(503).send({ error: (e as Error).message });
    }
  });
  app.post("/api/tts", async (req, reply) => {
    const b = req.body as { text?: string; botId?: string; voice?: string; vel?: number };
    if (!b?.text) return reply.code(400).send({ error: "text é obrigatório" });
    const bot = hub.summaries().find((x) => x.id === b.botId);
    try {
      const { audio, mime, vel } = await synthesize(b.text, b.voice ?? pickVoice(b.botId ?? "bot", bot?.voice), b.vel);
      reply.header("content-type", mime).header("cache-control", "no-store").header("x-fala-vel", String(vel));
      return reply.send(audio);
    } catch (e) {
      return reply.code(503).send({ error: (e as Error).message });
    }
  });


  // --- MCP (ferramentas para os Bots, usado pelo engine opencode) ---
  await registerMcp(app, hub);

  // --- interface estática ---
  // --- tela VNC (noVNC) ---
  {
    const novncDir = path.join(fileURLToPath(new URL("../../..", import.meta.url)), "node_modules", "@novnc", "novnc", "lib");
    if (fs.existsSync(novncDir)) {
      await app.register(fastifyStatic, { root: novncDir, prefix: "/novnc/", decorateReply: false });
    }
    const paginaVnc = fileURLToPath(new URL("../novnc-page.html", import.meta.url));
    app.get("/tela-vnc.html", async (_req, reply) => reply.type("text/html").send(fs.readFileSync(paginaVnc, "utf8")));
  }

  if (fs.existsSync(config.uiDist)) {
    await app.register(fastifyStatic, { root: config.uiDist, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/") || req.url.startsWith("/mcp")) return reply.code(404).send({ error: "não encontrado" });
      return reply.sendFile("index.html");
    });
  } else {
    app.get("/", async () => ({ ok: true, aviso: `Interface não compilada: rode "npm run build:ui". UI esperada em ${config.uiDist}` }));
  }

  await app.listen({ host: config.host, port: config.port });
  startScheduler(hub);
  manager.startAll();
  const shutdown = () => { void manager.stopAll().finally(() => process.exit(0)); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return app;
}
