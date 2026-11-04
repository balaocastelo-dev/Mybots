import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { botOfConversation, isControlMode } from "@mybots/shared";
import { config, tokenAllows, botForToken, raizDoProjeto } from "./config.js";
import { Hub } from "./hub.js";
import type { FichaEmpresa } from "./db.js";
import { registerMcp } from "./mcp.js";
import { sugerirEmpresa } from "./sugerirEmpresa.js";
import { DOCS_LEGAIS, VERSAO_LEGAL } from "./legal.js";
import { pixCopiaECola, custoMilesimos, DOLAR } from "./creditos.js";
import QRCode from "qrcode";
import { startScheduler } from "./scheduler.js";
import { pecaDaDemo } from "./demo.js";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { alvoDaPonte, caminhoDaTela, caminhoNoContainer, idDaTela, idSeguro, portaDeEmpresaPermitida } from "./ponteVnc.js";
import { videoExigeSenha } from "./gravacao.js";
import { abrirWsDaTela, encaminharHttp, quadroWs, type QuadroWs } from "./ponteTela.js";
import { idDoAndroid, listarProvedoresAndroid, resolverAlvoAndroid, tratadorAndroid } from "./android.js";
import { acordarPc, acordarPcsSempreLigados, acessoAberto, atualizarEmpresaDoPc, botPadraoDaEmpresa, classificarRotaPc, definirAcessoPc, abrirTela, fecharTela, iniciarVarreduraOciosa, lerRegistro, ligarPc, listarMaquinas, marcarSempreLigado, pararPc, registrarPc, type BotParaPc } from "./pcs.js";
// O Mac continua num host fixo (variável do Hub, nunca o que o navegador pedir).
const MAC_VNC = { host: process.env.MYBOTS_MAC_IP || "192.168.15.9", porta: 5900 };
import { PROVEDORES } from "@mybots/shared";
import { readFile as lerArq, writeFile as gravarArq } from "node:fs/promises";
import { pickVoice, synthesize, transcribe, voiceConfig, EDGE_PT_BR_VOICES, VOZES_CLONADAS } from "./voice.js";
import { BotManager, PROVIDERS, PADRAO_DA_CASA, soulBlock } from "./botManager.js";
import { listarEspecialidades, detectarEspecialidade, porId, montarPersonaComEspecialidade, idPadrao, categoriasDoCatalogo, resumoParaUi, carregarSkillsDaEspecialidade, recarregarEspecialidades } from "./especialidades.js";
import { carregarReceita, listarReceitas, listarIdsReceitas, aplicarReceitaNoNascimento, exportarBotComoReceita, saudacaoDeReceita, gerarTodasReceitasDoCatalogo } from "./receitas.js";
import { dmConversation, newId } from "@mybots/shared";
import { previaDe, enderecoDe, enderecoDoInsta } from "./previa.js";
import { estadoDa as estadoDaMaquina, ligar as ligarMaquina, desligar as desligarMaquina, apagar as apagarMaquina, recriar as recriarMaquina, garantirDesktopNaRaiz, imagemPronta } from "./maquinas.js";
import { registrarGuia } from "./guiaRota.js";
import { ServicoAndroid, lojaDoHub } from "./androidServico.js";
import { idDeBotValido } from "./androidBot.js";
import * as celular from "./celular.js";
import { lerMaquina } from "./maquina.js";
import { motivoDaQueda } from "./diagnostico.js";
import { registerPainel } from "./painel.js";
import { estadoDaChave } from "./chaves.js";
import { registerColabRoutes, registrarRotasColab } from "./colab/rotas.js";
import { registrarCofre } from "./cofreRotas.js";
import { instalarRedacao, redigir } from "./redacao.js";
import { authOnlineAtivo, cookieDe, emitirTicketWs, hubTokenLoopbackOk, registrarAuthOnline, rotaPublicaOnline, sessaoValida, SESSION_COOKIE, ticketWsDoReq } from "./authOnline.js";

export async function startServer(hub: Hub) {
  instalarRedacao();
  const app = Fastify({
    logger: false,
    bodyLimit: 60 * 1024 * 1024,
    trustProxy: true,
    // /mybots e /mybots/* (Vercel + acesso direto no tunel) viram / e /* antes do roteamento.
    rewriteUrl: (req) => {
      const bruto = req.url || "/";
      const q = bruto.indexOf("?");
      const caminho = q >= 0 ? bruto.slice(0, q) : bruto;
      const query = q >= 0 ? bruto.slice(q) : "";
      if (caminho === "/mybots" || caminho === "/mybots/") return "/" + query.replace(/^\?/, "?");
      if (caminho.startsWith("/mybots/")) return caminho.slice("/mybots".length) + query;
      return bruto;
    },
  });
  let atenderAndroidHttp: ((req: any, reply: any) => Promise<void>) | null = null;
  let atenderAndroidWs: ((socket: any, req: any) => void) | null = null;
  app.addHook("onSend", async (_req, reply, payload) => {
    if (reply.statusCode < 400 || typeof payload !== "string") return payload;
    return redigir(payload);
  });
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
  // A tela (ponte VNC, proxy do PC e a página noVNC) passa pelo MESMO hook.
  // Sem MYBOTS_UI_PASSWORD a interface inteira segue aberta, como o resto do painel.
  const SENHA_COOKIE = "mybots_k";
      const uiAuthorized = (req: any) => {
    if (authOnlineAtivo()) {
      if (sessaoValida(req)) return true;
      // Ticket curto so para /ws/ui cross-origin: cookie do www.balao.info nao cruza o tunel.
      // Nunca aceitar Bearer MYBOTS_HUB_TOKEN por aqui (hubTokenLoopbackOk ja barra tunel).
      const caminho = String(req.url ?? "").split("?")[0];
      if (caminho === "/ws/ui" || caminho.endsWith("/ws/ui")) return ticketWsDoReq(req);
      return false;
    }
    if (!config.uiPassword) return true;
    const key = req.headers["x-mybots-key"] ?? (req.query as any)?.k ?? cookieDe(req, SENHA_COOKIE);
    return key === config.uiPassword;
  };

  const nodeAuthorized = (req: any): string | null => {
    const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    const bot = String(req.headers["x-mybots-bot"] ?? "").trim();
    return botForToken(token) ?? (bot && tokenAllows(bot, token) ? bot : null);
  };
  const rotaComSenha = (url: string) => {
    const caminho = url.split("?")[0];
    return caminho.startsWith("/api/") || caminho.startsWith("/ws/ui") || caminho.startsWith("/ws/vnc")
      || caminho.startsWith("/pc/") || caminho.startsWith("/android/") || caminho === "/tela-vnc.html";
  };
  // A GUI do container entra por /pc/<botId>/ (e /pc/<empresa>/ continua, apontando
  // para o bot padrão ou para o container antigo). O upstream é sempre 127.0.0.1
  // na porta da nossa faixa — o caminho não escolhe host. HTTP passa neste hook
  // (o WebSocket da mesma URL fica na rota, senão o Fastify recusa a rota duplicada).
  const cacheTela = new Map<string, { em: number; porta: number | null; naRaiz: boolean; botId?: string }>();
  const botsParaPc = (): BotParaPc[] => {
    const managed = new Map(hub.db.listManaged().map((d: { id: string; name?: string; gerente?: boolean; createdAt?: number }) => [d.id, d]));
    return hub.db.listBots().map((b) => ({
      id: b.id,
      nome: managed.get(b.id)?.name ?? b.name,
      empresaId: b.empresaId ?? null,
      gerente: !!managed.get(b.id)?.gerente,
      createdAt: managed.get(b.id)?.createdAt ?? 0,
    }));
  };
  const telaBloqueada = (id: string): boolean => {
    if (!idSeguro(id)) return false;
    const classe = classificarRotaPc(id, !!hub.db.getEmpresa(id), !!lerRegistro(id));
    if (classe === "bot") return !acessoAberto(id);
    if (classe === "empresa") {
      const padrao = botPadraoDaEmpresa(id, botsParaPc());
      return !!padrao && !acessoAberto(padrao);
    }
    return false;
  };
  const portaDaTela = async (id: string): Promise<{ porta: number; naRaiz: boolean; botId?: string } | { bloqueada: true } | null> => {
    if (!idSeguro(id)) return null;
    if (telaBloqueada(id)) return { bloqueada: true };
    const c = cacheTela.get(id);
    if (c && Date.now() - c.em < 2000) return c.porta == null ? null : { porta: c.porta, naRaiz: c.naRaiz, botId: c.botId };
    const classe = classificarRotaPc(id, !!hub.db.getEmpresa(id), !!lerRegistro(id));
    const guardar = (porta: number | null, naRaiz: boolean, botId?: string) => {
      cacheTela.set(id, { em: Date.now(), porta, naRaiz, botId });
      return porta == null ? null : { porta, naRaiz, botId };
    };
    if (classe === "nenhum") return guardar(null, true);
    if (classe === "bot") {
      const m = await acordarPc(id);
      const porta = m && m.estado === "ligada" && portaDeEmpresaPermitida(m.portaTela) ? m.portaTela : null;
      return guardar(porta, true, id);
    }
    const padrao = botPadraoDaEmpresa(id, botsParaPc());
    if (padrao) {
      const m = await acordarPc(padrao);
      const porta = m && m.estado === "ligada" && portaDeEmpresaPermitida(m.portaTela) ? m.portaTela : null;
      return guardar(porta, true, padrao);
    }
    const m = await estadoDaMaquina(id);
    const porta = m.estado === "ligada" && portaDeEmpresaPermitida(m.portaTela) ? m.portaTela : null;
    return guardar(porta, !m.subpastaAntiga);
  };
  // O celular não assume container. Sem provedor, 503. Ninguém liga Android aqui.
  const responderAndroid = async (req: any, reply: any, id: string) => {
    const alvo = await resolverAlvoAndroid(id);
    const provedores = listarProvedoresAndroid();
    const fn = tratadorAndroid();
    if (fn && alvo) {
      const r = await fn({ botId: id, alvo });
      if (r && typeof r === "object" && "status" in r) return reply.code(r.status).send(r.corpo);
    }
    if (!alvo) return reply.code(503).send({ error: "nenhum provedor de celular resolveu este bot", botId: id, provedores });
    if (!atenderAndroidHttp) return reply.code(503).send({ ok: false, erro: "tela do Android ainda não subiu" });
    await atenderAndroidHttp(req, reply);
  };
  iniciarVarreduraOciosa({
    ocupado: (botId) => hub.estaOcupado(botId),
    aoParar: () => cacheTela.clear(),
  });
  const caminhoUpstream = (url: string, naRaiz: boolean) => naRaiz ? caminhoNoContainer(url) : caminhoDaTela(url);
  const proxyDaTela = async (req: any, reply: any) => {
    const url = String(req.raw?.url || req.url || "");
    const id = idDaTela(url);
    if (!id) return reply.code(404).send({ error: "tela indisponível" });
    const alvo = await portaDaTela(id);
    if (alvo && "bloqueada" in alvo) return reply.code(403).send({ error: "o acesso a esta tela está fechado" });
    const caminho = alvo ? caminhoUpstream(url, alvo.naRaiz) : null;
    if (!caminho || !alvo) return reply.code(alvo ? 404 : 503).send({ error: alvo ? "tela indisponível" : "o PC desta empresa está desligado" });
    encaminharHttp(req, reply, alvo.porta, caminho);
  };
  app.addHook("onRequest", async (req, reply) => {
    const open = req.url.startsWith("/api/files/") || req.url.startsWith("/api/upload") || req.url.startsWith("/api/import") || req.url.startsWith("/api/channels/incoming");
    if (authOnlineAtivo()) {
      if (rotaPublicaOnline(req.url) || open) return;
      if (rotaComSenha(req.url) || req.url.split("?")[0].startsWith("/api/") || req.url.split("?")[0].startsWith("/ws/")) {
        if (!(uiAuthorized(req) || nodeAuthorized(req) || hubTokenLoopbackOk(req))) {
          reply.code(401).send({ error: "nao autenticado" });
          return;
        }
      }
    } else {
      if (!rotaComSenha(req.url) || open) return;
      if (!(uiAuthorized(req) || nodeAuthorized(req))) {
        reply.code(401).send({ error: "senha da interface invalida" });
        return;
      }
    }
    const apresentou = req.headers["x-mybots-key"] === config.uiPassword || (req.query as any)?.k === config.uiPassword;
    if (config.uiPassword && apresentou) {
      reply.header("set-cookie", `${SENHA_COOKIE}=${encodeURIComponent(config.uiPassword)}; HttpOnly; SameSite=Strict; Path=/`);
    }
    const caminho = req.url.split("?")[0];
    const upgrade = String(req.headers.upgrade ?? "").toLowerCase() === "websocket";
    if (caminho.startsWith("/android/")) {
      if (upgrade) return;
      const url = String(req.raw?.url || req.url || "");
      const idAndroid = idDoAndroid(url);
      if (idAndroid && caminho === `/android/${idAndroid}`) {
        const busca = url.includes("?") ? url.slice(url.indexOf("?")) : "";
        reply.redirect(`/android/${idAndroid}/${busca}`);
        return;
      }
      if (idAndroid) {
        await responderAndroid(req, reply, idAndroid);
        return;
      }
    }
    if (caminho.startsWith("/pc/")) {
      const idPc = idDaTela(req.url);
      if (idPc && telaBloqueada(idPc)) {
        reply.code(403).send({ error: "o acesso a esta tela está fechado" });
        return;
      }
    }
    if (!caminho.startsWith("/pc/") || upgrade) return;
    const id = idDaTela(req.url);
    if (id && caminho === `/pc/${id}`) {
      reply.redirect(`/pc/${id}/`);
      return;
    }
    await proxyDaTela(req, reply);
  });

  // --- WebSockets ---
  app.get("/ws/node", { websocket: true }, (socket) => hub.handleNodeConnection(socket as any));
  app.get("/ws/ui", { websocket: true }, (socket) => hub.handleUiConnection(socket as any));
  // Ponte VNC: o navegador fala noVNC por este WebSocket e o Hub repassa os bytes.
  // Destinos: "mac" (host fixo) ou "empresa:<id>" (127.0.0.1 na porta que o Hub
  // publicou). Qualquer outro destino fecha. A senha da interface já passou no hook.
  app.get("/ws/vnc", { websocket: true }, (socket: any, req: any) => {
    const destino = String(req.query?.destino ?? "mac");
    const fila: Buffer[] = [];
    let tcp: net.Socket | null = null;
    let morto = false;
    const fim = () => {
      if (morto) return;
      morto = true;
      try { tcp?.destroy(); } catch { /* ok */ }
      try { socket.close(); } catch { /* ok */ }
    };
    socket.on("message", (m: any) => {
      const b = Buffer.isBuffer(m) ? m : Buffer.from(m);
      if (tcp) { try { tcp.write(b); } catch { /* tcp caiu */ } }
      else fila.push(b);
    });
    socket.on("close", fim);
    socket.on("error", fim);
    const ligar = (alvo: { host: string; porta: number }) => {
      if (morto) return;
      tcp = net.connect({ port: alvo.porta, host: alvo.host });
      for (const b of fila) { try { tcp.write(b); } catch { /* caiu */ } }
      fila.length = 0;
      tcp.on("data", (d) => { try { socket.send(d); } catch { /* ws caiu */ } });
      tcp.on("error", fim);
      tcp.on("close", fim);
    };
    void (async () => {
      let porta: number | null = null;
      if (destino.startsWith("empresa:")) {
        const tela = await portaDaTela(destino.slice("empresa:".length));
        porta = tela && "porta" in tela ? tela.porta : null;
      }
      if (morto) return;
      const alvo = alvoDaPonte(destino, { mac: MAC_VNC, portaDaEmpresa: () => porta });
      if (!alvo) return fim();
      ligar(alvo);
    })();
  });

  // WebSocket da tela do Android (/android/<bot>/ws). O HTTP da mesma URL sai no hook acima.
  app.get("/android/:id/*", { websocket: true }, (socket: any, req: any) => {
    if (!atenderAndroidWs) { try { socket.close(); } catch { /* ok */ } return; }
    atenderAndroidWs(socket, req);
  });

  // WebSocket da GUI (/pc/<empresa>/api/...). O HTTP da mesma URL sai no hook acima.
  app.get("/pc/:id/*", { websocket: true }, (socket: any, req: any) => {
    const fila: QuadroWs[] = [];
    let enviar: ((q: QuadroWs) => void) | null = null;
    let morto = false;
    let botDaTela: string | null = null;
    let contou = false;
    const soltarOlho = () => {
      if (!contou || !botDaTela) return;
      contou = false;
      fecharTela(botDaTela);
    };
    // O segundo argumento é o tipo do quadro. Sem ele, SETTINGS vira binário
    // e o Selkies 2.1 não registra o display — a tela fica preta.
    socket.on("message", (m: unknown, isBinary: boolean) => {
      if (morto) return;
      const q = quadroWs(m, isBinary);
      if (enviar) enviar(q);
      else fila.push(q);
    });
    socket.on("close", () => { morto = true; soltarOlho(); });
    socket.on("error", () => { morto = true; soltarOlho(); });
    void (async () => {
      const url = String(req.raw?.url || req.url || "");
      const id = idDaTela(url);
      const caminho = caminhoDaTela(url);
      if (morto) return;
      if (!id || !caminho || telaBloqueada(id)) { try { socket.close(); } catch { /* ok */ } return; }
      const alvo = await portaDaTela(id);
      if (alvo && "bloqueada" in alvo) { try { socket.close(); } catch { /* ok */ } return; }
      const upstream = alvo ? caminhoUpstream(url, alvo.naRaiz) : null;
      if (morto) return;
      if (!alvo || !upstream) { try { socket.close(); } catch { /* ok */ } return; }
      if (alvo.botId && !contou) {
        botDaTela = alvo.botId;
        contou = true;
        abrirTela(alvo.botId);
      }
      const prot = String(req.headers["sec-websocket-protocol"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      enviar = abrirWsDaTela(socket, alvo.porta, upstream, fila, prot);
    })();
  });

  // --- API REST ---
  registrarAuthOnline(app);
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

  // Snapshot HTTP: lista + aprovacoes quando o WS nao sobe (rewrite Vercel nao faz upgrade).
  app.get("/api/ui/snapshot", async () => ({
    type: "snapshot" as const,
    bots: hub.summaries(),
    approvals: hub.db.pendingApprovals(),
    questions: hub.db.pendingQuestions(),
    groups: hub.db.listGroups(),
    routines: hub.db.listRoutines(),
    voice: voiceConfig(),
    control: hub.control(),
  }));

  // Origem do tunel para a UI abrir WS direto (cookie nao sobe; use ticket).
  app.get("/api/ui/ws-url", async () => {
    const base = (config.tunnelUrl || config.publicUrl || "").replace(/\/$/, "");
    if (!base) return { wsUrl: null as string | null, httpOrigin: null as string | null };
    let u: URL;
    try { u = new URL(base); } catch { return { wsUrl: null, httpOrigin: null }; }
    const proto = u.protocol === "https:" ? "wss:" : "ws:";
    return { wsUrl: `${proto}//${u.host}/ws/ui`, httpOrigin: `${u.protocol}//${u.host}` };
  });

  // Ticket de sessao curto (90s). Exige cookie mybots_session no mesmo host (via rewrite).
  app.post("/api/ui/ws-ticket", async (req, reply) => {
    if (authOnlineAtivo()) {
      if (!sessaoValida(req)) return reply.code(401).send({ error: "nao autenticado" });
      return emitirTicketWs(config.usuarioOnline);
    }
    return { ticket: "", expiresIn: 0 };
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
  /** Salva uma correção do chefe como regra aprendida do bot da conversa. */
  app.post("/api/messages/:id/aprender-regra", async (req, reply) => {
    const m = hub.db.getMessage((req.params as any).id);
    if (!m) return reply.code(404).send({ error: "mensagem não encontrada" });
    const body = (req.body as any) || {};
    let botId = String(body.botId || "").trim();
    if (!botId) botId = botOfConversation(m.conversationId) || "";
    if (!botId && m.sender.kind === "bot") botId = m.sender.id;
    if (!botId && m.conversationId.startsWith("channel:")) {
      const parts = m.conversationId.split(":");
      botId = parts[parts.length - 1] || "";
    }
    if (!botId) return reply.code(400).send({ error: "não achei o bot desta conversa" });
    const regra = String(body.regra || body.text || m.text || "").replace(/\s+/g, " ").trim();
    if (!regra) return reply.code(400).send({ error: "regra vazia" });
    const id = newId("fato");
    const emp = hub.empresaDe(botId).id ?? "";
    hub.db.inserirFato({ id, botId, text: regra.slice(0, 500), tipo: "regra", learnedAt: Date.now(), empresaId: emp, promovido: false });
    hub.db.regenerarResumoBot(botId, emp);
    hub.db.audit(botId, "regra.aprendida", { id, messageId: m.id, text: regra.slice(0, 120) });
    try { hub.sendNode(botId, { type: "knowledge", knowledge: hub.knowledgeIndex(botId) }); } catch {}
    hub.broadcastUi({ type: "notify", botId, text: "Regra aprendida salva" });
    return { ok: true, id, botId, regra: regra.slice(0, 500) };
  });

  app.get("/api/bots/:id/planos", async (req, reply) => {
    const botId = String((req.params as any).id || "");
    if (!botId) return reply.code(400).send({ error: "bot id obrigatorio" });
    return hub.planos.listar(botId);
  });
  app.get("/api/planos/:id", async (req, reply) => {
    const id = String((req.params as any).id || "");
    const plano = hub.planos.obter(id);
    if (!plano) return reply.code(404).send({ error: "plano nao encontrado" });
    return plano;
  });
  app.get("/api/colab/tarefas/:id/plano", async (req, reply) => {
    const id = String((req.params as any).id || "");
    const plano = hub.planos.porTarefa(id);
    if (!plano) return reply.code(404).send({ error: "plano nao encontrado" });
    return plano;
  });
  app.post("/api/planos/:id/decidir", async (req, reply) => {
    const id = String((req.params as any).id || "");
    const b = (req.body ?? {}) as Record<string, unknown>;
    const resposta = String(b.resposta ?? b.answer ?? b.texto ?? "").trim();
    const r = hub.planos.decidir({
      planoId: id,
      passoId: b.passoId ? String(b.passoId) : undefined,
      resposta,
    });
    if (!r.ok) return reply.code(400).send({ error: r.erro });
    hub.emitirUi({ type: "notify", botId: r.plano.botId, text: "Decisao registrada no plano" });
    return { ok: true, plano: r.plano };
  });
  app.post("/api/colab/tarefas/:id/decidir", async (req, reply) => {
    const id = String((req.params as any).id || "");
    const b = (req.body ?? {}) as Record<string, unknown>;
    const resposta = String(b.resposta ?? b.answer ?? b.texto ?? "pode seguir").trim();
    const r = hub.planos.decidir({
      tarefaId: id,
      passoId: b.passoId ? String(b.passoId) : undefined,
      resposta,
    });
    if (!r.ok) {
      // fallback: so retoma a tarefa waiting mesmo sem plano
      const t = hub.tarefas.obter(id);
      if (t?.status === "waiting") {
        const tr = hub.tarefas.transicionar(id, "running", { resumo: "Chefe decidiu: " + resposta.slice(0, 200) });
        if (tr.ok) return { ok: true, tarefa: tr.tarefa };
      }
      return reply.code(400).send({ error: r.erro });
    }
    hub.emitirUi({ type: "notify", botId: r.plano.botId, text: "Decisao registrada no quadro" });
    return { ok: true, plano: r.plano };
  });

  app.post("/api/conversations/:id/marcador", async (req, reply) => {
    const texto = String((req.body as any)?.texto ?? "").trim();
    if (!texto) return reply.code(400).send({ error: "texto obrigatório" });
    const m = hub.marcador(String((req.params as any).id), texto, (req.body as any)?.meta);
    return m;
  });
  app.get("/api/approvals", async () => hub.db.pendingApprovals());
  app.post("/api/approvals/:id", async (req, reply) => {
    const body = req.body as { allow: boolean; remember?: boolean; de?: string };
    const r = hub.responderAprovacao((req.params as any).id, !!body.allow, body.remember, body.de);
    if (!r.ok) return reply.code(403).send(r);
    return { ok: true };
  });
  registrarRotasColab(app, hub);
  app.get("/api/questions", async () => hub.db.pendingQuestions());
  app.post("/api/questions/:id", async (req) => {
    const body = req.body as { answer: string };
    hub.answerQuestion((req.params as any).id, String(body.answer ?? ""));
    return { ok: true };
  });
  app.get("/api/audit", async (req) => hub.db.auditTail(Number((req.query as any).limit ?? 100)));

  registerColabRoutes(app, hub, nodeAuthorized);

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
  const botConhecido = (id: string) => !!hub.db.getManaged(id) || hub.db.listBots().some((b) => b.id === id);
  const android = new ServicoAndroid({
    loja: lojaDoHub((k) => hub.db.getSetting(k), (k, v) => hub.db.setSetting(k, v)),
    botExiste: botConhecido,
  });
  android.registrar();
  atenderAndroidHttp = (req, reply) => android.http(req, reply);
  atenderAndroidWs = (socket, req) => android.ws(socket, req);
  app.post("/api/bots/:id/android/pair", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    if (!idDeBotValido(id)) return reply.code(400).send({ ok: false, erro: "id inválido" });
    if (!botConhecido(id)) return reply.code(404).send({ ok: false, erro: "bot não encontrado" });
    return android.parear(id, (req.body ?? {}) as any);
  });
  app.post("/api/bots/:id/android/usar", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    if (!idDeBotValido(id)) return reply.code(400).send({ ok: false, erro: "id inválido" });
    if (!botConhecido(id)) return reply.code(404).send({ ok: false, erro: "bot não encontrado" });
    const serial = String(((req.body ?? {}) as any).serial ?? "");
    return android.usar(id, serial);
  });
  app.get("/api/bots/:id/android/status", async (req, reply) => {
    const id = String((req.params as any).id ?? "");
    if (!idDeBotValido(id)) return reply.code(400).send({ ok: false, erro: "id inválido" });
    if (!botConhecido(id)) return reply.code(404).send({ ok: false, erro: "bot não encontrado" });
    return android.status(id);
  });
  {
    const ensinados = manager.ensinarGerentesAMontarEquipe();
    if (ensinados.length) console.log(`[hub] gerente(s) ensinados a montar equipe: ${ensinados.join(", ")}`);
    const cofres = manager.garantirCofres();
    if (cofres.length) console.log(`[hub] cofre das empresas: ${cofres.join(", ")}`);
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
    if (empresaId) hub.db.setEmpresaDoBot(r.id, r.name, empresaId, false);
    try {
      registrarPc({ botId: r.id, empresaId: empresaId ?? null, nome: r.name });
      marcarSempreLigado(r.id, true);
      definirAcessoPc(r.id, true);
      void ligarPc(r.id).then((est) => {
        if (est?.estado === "ligada") console.log(`[pc] ${r.id}: PC ligado ao nascer`);
        else console.warn(`[pc] ${r.id}: não ligou ao nascer: ${est?.erro ?? est?.estado}`);
      }).catch((e) => console.error(`[pc] ${r.id}: ligar ao nascer: ${(e as Error).message}`));
    }
    catch (e) { console.error(`[pc] não registrei/liguei o PC de ${r.id}: ${(e as Error).message}`); }
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
  app.get("/api/maquinas", async () => listarMaquinas());
  app.post("/api/maquinas/:botId/ligar", async (req, reply) => {
    const id = String((req.params as any).botId ?? "");
    if (!idSeguro(id) || !lerRegistro(id)) return reply.code(404).send({ error: "pc não registrado" });
    await ligarPc(id);
    const linha = (await listarMaquinas()).find((m) => m.botId === id && m.tipo === "pc");
    return linha ?? reply.code(404).send({ error: "pc não registrado" });
  });
  app.post("/api/maquinas/:botId/desligar", async (req, reply) => {
    const id = String((req.params as any).botId ?? "");
    if (!idSeguro(id) || !lerRegistro(id)) return reply.code(404).send({ error: "pc não registrado" });
    await pararPc(id);
    const linha = (await listarMaquinas()).find((m) => m.botId === id && m.tipo === "pc");
    return linha ?? reply.code(404).send({ error: "pc não registrado" });
  });
  app.put("/api/maquinas/:botId/acesso", async (req, reply) => {
    const id = String((req.params as any).botId ?? "");
    const liberado = (req.body as { liberado?: unknown } | null)?.liberado;
    if (!idSeguro(id) || !lerRegistro(id)) return reply.code(404).send({ error: "pc não registrado" });
    if (typeof liberado !== "boolean") return reply.code(400).send({ error: "liberado deve ser true ou false" });
    definirAcessoPc(id, liberado);
    cacheTela.clear();
    return { botId: id, acessoLiberado: liberado };
  });

  app.get("/api/empresas/:id/maquina", async (req) => {
    const id = (req.params as any).id as string;
    const emp = hub.db.getEmpresa(id);
    const m = await garantirDesktopNaRaiz(id, emp?.nome ?? "");
    return { ...m, imagem: await imagemPronta() };
  });
  app.get("/api/empresas/:id/maquina/uso", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!hub.db.getEmpresa(id)) return reply.code(404).send({ error: "empresa não encontrada" });
    return hub.usoDoPc(id);
  });
  app.get("/api/empresas/:id/maquina/gravacao", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!hub.db.getEmpresa(id)) return reply.code(404).send({ error: "empresa não encontrada" });
    const onde = (req.query as any).onde === "celular" ? "celular" : "pc";
    return hub.estadoGravacao(id, onde);
  });
  app.post("/api/empresas/:id/maquina/gravacao", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!hub.db.getEmpresa(id)) return reply.code(404).send({ error: "empresa não encontrada" });
    const b = (req.body ?? {}) as { acao?: string; conversationId?: string; legenda?: string; onde?: string };
    const onde = b.onde === "celular" ? "celular" as const : "pc" as const;
    if (b.acao === "iniciar") {
      return await hub.iniciarGravacao({ empresaId: id, por: "chefe", nome: "você", conversationId: b.conversationId, onde });
    }
    if (b.acao === "parar") return await hub.pararGravacao(id, b.legenda, onde);
    return reply.code(400).send({ error: "acao deve ser iniciar ou parar" });
  });
  app.get("/api/celulares/descobrir", async () => hub.descobrirCelulares());
  app.get("/api/empresas/:id/celular", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!hub.db.getEmpresa(id)) return reply.code(404).send({ error: "empresa não encontrada" });
    const v = hub.vinculoDoCelular(id);
    const online = v ? (await celular.listar()).some((a) => a.serial === v.serial && a.estado === "device") : false;
    return { vinculo: v, online, trava: hub.travaCelular.ver(id) };
  });
  app.post("/api/empresas/:id/celular", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!hub.db.getEmpresa(id)) return reply.code(404).send({ error: "empresa não encontrada" });
    return hub.vincularCelular(id, String((req.body as any)?.serial ?? ""));
  });
  app.delete("/api/empresas/:id/celular", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!hub.db.getEmpresa(id)) return reply.code(404).send({ error: "empresa não encontrada" });
    hub.esquecerCelular(id);
    return { ok: true };
  });
  app.post("/api/empresas/:id/celular/parear", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!hub.db.getEmpresa(id)) return reply.code(404).send({ error: "empresa não encontrada" });
    return hub.parearCelular(id, (req.body ?? {}) as any);
  });
  app.post("/api/empresas/:id/celular/assumir", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!hub.db.getEmpresa(id)) return reply.code(404).send({ error: "empresa não encontrada" });
    return hub.assumirCelular(id, (req.body as any)?.assumir !== false);
  });
  app.get("/api/empresas/:id/celular/uso", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!hub.db.getEmpresa(id)) return reply.code(404).send({ error: "empresa não encontrada" });
    return hub.usoDoCelular(id);
  });
  app.get("/api/empresas/:id/celular/tela", async (req, reply) => {
    const id = (req.params as any).id as string;
    const v = hub.vinculoDoCelular(id);
    if (!v) return reply.code(404).send({ error: "celular não vinculado" });
    const png = await celular.tela(v.serial);
    if (!png) return reply.code(503).send({ error: "não consegui ver a tela" });
    return reply.type("image/png").header("cache-control", "no-store").send(png);
  });
  app.post("/api/empresas/:id/celular/tocar", async (req, reply) => {
    const id = (req.params as any).id as string;
    const v = hub.vinculoDoCelular(id);
    if (!v) return reply.code(404).send({ error: "celular não vinculado" });
    const trava = hub.travaCelular.ver(id);
    if (!trava || trava.id !== "chefe") {
      return reply.code(409).send({ error: trava ? `${trava.nome} está no celular` : "assuma o celular antes de tocar" });
    }
    const b = req.body as { x?: number; y?: number };
    return { ok: await celular.tocar(v.serial, Number(b?.x), Number(b?.y)) };
  });
  app.post("/api/empresas/:id/celular/janela", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!hub.db.getEmpresa(id)) return reply.code(404).send({ error: "empresa não encontrada" });
    const r = hub.abrirJanelaDoCelular(id);
    return r.ok ? r : reply.code(400).send(r);
  });
  app.post("/api/empresas/:id/maquina/ligar", async (req) => {
    const id = (req.params as any).id as string;
    const emp = hub.db.listEmpresas?.().find((e: any) => e.id === id);
    return await ligarMaquina(id, emp?.nome ?? "");
  });
  app.post("/api/empresas/:id/maquina/recriar", async (req) => {
    const id = (req.params as any).id as string;
    const emp = hub.db.getEmpresa(id);
    return await recriarMaquina(id, emp?.nome ?? "");
  });
  app.post("/api/empresas/:id/maquina/desligar", async (req) => await desligarMaquina((req.params as any).id as string));
  app.delete("/api/empresas/:id/maquina", async (req) => await apagarMaquina((req.params as any).id as string));
  registrarGuia(app, hub);

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
      if (!r.ok) return { ok: false, erro: redigir(`HTTP ${r.status}: ${corpo.slice(0, 220)}`) };
      const j = JSON.parse(corpo);
      const txt = String(j?.choices?.[0]?.message?.content ?? "").trim();
      return { ok: !!txt, ms: Date.now() - t0, resposta: txt.slice(0, 60) || "(vazio)" };
    } catch (e) {
      return { ok: false, erro: redigir((e as Error).message) };
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
  /**
   * Roda (ou roda de novo) o roteiro de primeiros passos de uma empresa.
   *
   * Existe por dois motivos: testar sem precisar criar empresa nova, e dar ao chefe o
   * "fazer de novo" quando ele pulou um canal e quer voltar.
   */
  app.post("/api/empresas/:id/primeiros-passos", async (req, reply) => {
    if (!uiAuthorized(req)) return reply.code(401).send({ error: "não autorizado" });
    const empresaId = String((req.params as any).id);
    if (!hub.db.getEmpresa(empresaId)) return reply.code(404).send({ error: "empresa não encontrada" });
    const bot = hub.summaries().find((b) => b.empresaId === empresaId && hub.ehGerente(b.id))
      ?? hub.summaries().find((b) => b.empresaId === empresaId);
    if (!bot) return reply.code(400).send({ error: "esta empresa ainda não tem bot para conduzir" });
    if (!bot.online) return reply.code(409).send({ error: `o ${bot.name} está offline; ligue ele antes` });
    const refazer = ((req.body ?? {}) as any).refazer === true;
    void (refazer ? hub.passos.refazer(bot.id, empresaId) : hub.passos.iniciar(bot.id, empresaId))
      .catch((e) => hub.db.audit(bot.id, "primeirospassos.erro", { erro: (e as Error).message }));
    return { ok: true, bot: bot.id, refazer };
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
      return await pecaDaDemo(passo, {
        nome: String(b.nome ?? "a empresa"),
        site: b.site, instagram: b.instagram, facebook: b.facebook, segmento: b.segmento,
        resumo: b.resumo, regras: b.regras,
        contatos: b.contatos && typeof b.contatos === "object" ? b.contatos : undefined,
        time: Array.isArray(b.time) ? b.time : undefined,
        anotacoes: Array.isArray(b.anotacoes) ? b.anotacoes : undefined,
        logo: b.logo, arte: b.arte,
      }, salvar, b.imagem);
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
    const e = hub.db.saveEmpresa({
      id, nome: b.nome.trim(), regras: b.regras ?? "", cor: b.cor, idioma: b.idioma ?? "pt",
      ficha: {
        site: b.site, instagram: b.instagram, facebook: b.facebook,
        resumo: b.resumo, segmento: b.segmento, contatos: b.contatos, logo: b.logo,
      },
    });
    hub.db.audit(null, "empresa.salva", { id });
    hub.broadcastKnowledge();
    // Empresa nasce com o WhatsApp dela subindo: o QR aparece no painel em segundos.
    void hub.whats.conectar(id).catch(() => {});
    // ...e com o Gerente Geral dela, que recebe o chefe e apresenta o sistema.
    // comGerente/comMedico false é o atalho dos testes: não sobe Gerente nem Cofre.
    if (b.comGerente === false || b.comMedico === false) return { ...e, gerente: null };
    const cofreBot = manager.criarCofreDaEmpresa(id, e.nome);
    if ("error" in cofreBot) hub.db.audit(null, "empresa.cofre.falhou", { id, erro: cofreBot.error });
    else hub.db.setEmpresaDoBot(cofreBot.id, `Cofre — ${e.nome}`, id, false);
    const gerente = manager.criarGerenteDaEmpresa(id, e.nome);
    if ("error" in gerente) {
      hub.db.audit(null, "empresa.gerente.falhou", { id, erro: gerente.error });
      return { ...e, gerente: null, aviso: `empresa criada, mas o Gerente Geral não subiu: ${gerente.error}` };
    }
    hub.db.setEmpresaDoBot(gerente.id, `Gerente Geral — ${e.nome}`, id, false);
    try { registrarPc({ botId: gerente.id, empresaId: id, nome: `Gerente Geral — ${e.nome}` }); }
    catch (e) { console.error(`[pc] não registrei o PC de ${gerente.id}: ${(e as Error).message}`); }
    hub.broadcastKnowledge();
    hub.apresentarEmpresa(gerente.id, e.nome);
    return { ...e, gerente: gerente.id };
  });
  app.patch("/api/empresas/:id", async (req, reply) => {
    const id = (req.params as any).id;
    const atual = hub.db.getEmpresa(id);
    if (!atual) return reply.code(404).send({ error: "empresa não encontrada" });
    const b = req.body as any;
    const fichaPatch: FichaEmpresa = {};
    for (const k of ["site", "instagram", "facebook", "resumo", "segmento", "logo"] as const) {
      if (b[k] !== undefined) fichaPatch[k] = String(b[k]);
    }
    if (b.contatos && typeof b.contatos === "object") fichaPatch.contatos = b.contatos;
    const e = hub.db.saveEmpresa({
      id, nome: b.nome ?? atual.nome, regras: b.regras ?? atual.regras, cor: b.cor ?? atual.cor, idioma: b.idioma ?? atual.idioma,
      ...(Object.keys(fichaPatch).length ? { ficha: fichaPatch } : {}),
    });
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
    try {
      if (lerRegistro(id)) atualizarEmpresaDoPc(id, b.empresa ?? null, bot.name);
      else registrarPc({ botId: id, empresaId: b.empresa ?? null, nome: bot.name });
    } catch (e) { console.error(`[pc] não atualizei o PC de ${id}: ${(e as Error).message}`); }
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

  /**
   * Manda foto ou documento pelo WhatsApp da empresa.
   *
   * Aceita `base64` (o arquivo já em mãos) ou `caminho` — e o caminho só vale DENTRO da
   * pasta do projeto: uma rota que lê qualquer arquivo do disco por nome é um buraco
   * aberto, e esta fica exposta na LAN. A mesma trava de consentimento do texto vale
   * aqui: foto também é falar com cliente.
   */
  app.post("/api/empresas/:id/whatsapp/enviar-arquivo", async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const empresaId = String((req.params as any).id);
    if (!b.para) return reply.code(400).send({ error: "para é obrigatório" });
    const liberado = hub.podeFalarComCliente(empresaId);
    if (!liberado.ok) return reply.code(400).send({ error: `Esta empresa ainda não aceitou os termos de uso de dados (falta: ${liberado.falta.join(", ")}). Abra Leis e consentimentos.` });

    let dados: Buffer;
    let nome = String(b.nome ?? "arquivo");
    if (b.base64) {
      dados = Buffer.from(String(b.base64), "base64");
    } else if (b.caminho) {
      const raiz = raizDoProjeto();
      const abs = path.resolve(raiz, String(b.caminho));
      if (!abs.startsWith(raiz + path.sep)) return reply.code(400).send({ error: "o caminho precisa estar dentro da pasta do projeto" });
      try { dados = await fs.promises.readFile(abs); } catch (e) { return reply.code(400).send({ error: `não consegui ler o arquivo: ${(e as Error).message}` }); }
      if (!b.nome) nome = path.basename(abs);
    } else {
      return reply.code(400).send({ error: "mande base64 ou caminho" });
    }
    const mime = String(b.mime ?? (/\.(jpe?g)$/i.test(nome) ? "image/jpeg" : /\.png$/i.test(nome) ? "image/png" : /\.pdf$/i.test(nome) ? "application/pdf" : "application/octet-stream"));
    const r = await hub.whats.enviarArquivo(empresaId, String(b.para), { base64: dados.toString("base64"), nome, mime, legenda: b.legenda ? String(b.legenda) : undefined });
    hub.db.audit(null, "whatsapp.arquivo", { empresa: empresaId, nome, mime, kb: Math.round(dados.length / 1024), ok: r.ok });
    return r.ok ? r : reply.code(400).send({ error: r.detalhe });
  });


  app.get("/api/especialidades", async () => {
    const lista = listarEspecialidades();
    return {
      defaultId: idPadrao(),
      categorias: categoriasDoCatalogo(),
      especialidades: lista.map(resumoParaUi),
    };
  });
  app.post("/api/especialidades/recarregar", async () => {
    const lista = recarregarEspecialidades();
    return { ok: true, total: lista.length, defaultId: idPadrao() };
  });
  app.post("/api/especialidades/detectar", async (req) => {
    const b = (req.body ?? {}) as { nome?: string; funcao?: string; especialidadeId?: string; desligar?: boolean };
    const d = await detectarEspecialidade(b.nome ?? "", b.funcao ?? "", {
      forcarId: b.especialidadeId || null,
      desligar: b.desligar === true,
    });
    const esp = d.especialidade;
    return {
      id: esp?.id ?? null,
      nome: esp?.nome ?? null,
      emoji: esp?.emoji ?? null,
      cor: esp?.cor ?? null,
      skills: esp?.skills ?? [],
      ferramentas: esp?.ferramentas ?? [],
      mcpOpcionais: esp?.mcpOpcionais ?? [],
      confianca: d.confianca,
      metodo: d.metodo,
      motivo: d.motivo,
      candidatos: d.candidatos ?? [],
      aviso: esp?.aviso ?? null,
    };
  });

  app.get("/api/managed", async () => manager.list());
  app.get("/api/managed/:id", async (req, reply) => manager.get((req.params as any).id) ?? reply.code(404).send({ error: "bot não encontrado" }));
  app.post("/api/managed", async (req, reply) => {
    const b = req.body as any;
    if (!b?.name?.trim()) return reply.code(400).send({ error: "name é obrigatório" });
    // Especialidade obrigatória: nunca nasce vazio. Default = Assistente geral.
    {
      const espId = b.especialidadeDesligada ? idPadrao() : (String(b.especialidadeId || "").trim() || idPadrao());
      const esp = porId(espId) || porId(idPadrao());
      b.especialidadeId = esp?.id ?? idPadrao();
      if (!b.role?.trim()) b.role = esp?.nome || "Assistente geral";
      if (!b.personaTouched || !String(b.persona || "").trim()) {
        b.persona = montarPersonaComEspecialidade(String(b.name).trim(), String(b.role || esp?.nome || "").trim(), esp, soulBlock());
      }
      if (!isControlMode(b.controlMode) || b.controlMode === "total" || b.controlMode === "deus") {
        b.controlMode = "supervisionado";
      }
    }
    // U+FFFD é texto que já chegou quebrado (acento perdido no caminho). Barrar aqui
    // evita um bot que vai se chamar "Bal?o" para sempre, inclusive no id.
    if (/\uFFFD/.test(`${b.name}${b.role ?? ""}${b.persona ?? ""}`)) {
      return reply.code(400).send({ error: "O texto chegou com caracteres quebrados (acentuação perdida). Mande o nome e a função em UTF-8 — se você é um bot criando outro, use o painel em vez da linha de comando." });
    }
    // Todo bot tem dono: não existe bot sem empresa. Quem cria herda — bot criado por
    // outro bot nasce na empresa de quem o criou.
    const criador = nodeAuthorized(req);
    // Perfil unico: empresa nao vem mais do formulario. Herda do criador ou
    // da primeira empresa da casa — em silencio.
    const empresas = hub.db.listEmpresas();
    let empresa = (b.empresa || (criador ? hub.empresaDe(criador).id : null) || empresas[0]?.id) ?? null;
    if (empresa && !hub.db.getEmpresa(empresa)) empresa = empresas[0]?.id ?? null;
    if (!empresa) {
      return reply.code(400).send({
        error: "Crie a primeira empresa antes: todo bot pertence a uma empresa.",
      });
    }
    const r = manager.create(b);
    if ("error" in r) return reply.code(400).send(r);
    hub.db.setEmpresaDoBot(r.id, r.name, empresa, false);
    // seed-especialidade: skills da especialidade viram saberes deste bot
    try {
      const esp = porId(b.especialidadeId) || porId(idPadrao());
      for (const sk of carregarSkillsDaEspecialidade(esp)) {
        hub.db.saveSaber({
          id: `skill-${r.id}-${sk.id}`,
          titulo: sk.titulo,
          resumo: `Skill da especialidade ${esp?.nome ?? ""} (${sk.id})`,
          conteudo: sk.conteudo,
          tipo: "procedimento",
          tags: ["skill", "especialidade", esp?.id ?? "", sk.id].filter(Boolean),
          bots: [r.id],
          origem: "especialidade",
        });
      }
      if (esp) {
        hub.db.saveSaber({
          id: `esp-${r.id}`,
          titulo: `Especialidade: ${esp.nome}`,
          resumo: esp.onboarding,
          conteudo: [esp.soul, esp.aviso ? "AVISO: " + esp.aviso : "", "Ferramentas: " + (esp.ferramentas || []).join(", ")].filter(Boolean).join("\n\n"),
          tipo: "procedimento",
          tags: ["especialidade", esp.id],
          bots: [r.id],
          origem: "especialidade",
        });
      }
    } catch (e) {
      console.warn("[especialidades] seed falhou:", (e as Error).message);
    }
    // Receita no nascimento: memórias, skills e rotinas pausadas antes da saudação.
    {
      const receitaId = String(b.receitaId || b.especialidadeId || "").trim();
      const receitaBody = b.receita && typeof b.receita === "object" ? b.receita : null;
      const receita = receitaBody || (receitaId ? carregarReceita(receitaId) : null);
      if (receita) {
        const applied = aplicarReceitaNoNascimento(hub.db, {
          botId: r.id,
          botName: r.name,
          empresaId: empresa,
          receita,
        });
        hub.db.audit(r.id, "receita.nascimento", applied);
        if (applied.erros.length) console.warn("[receita] falhas parciais", r.id, applied.erros);
        try {
          hub.storeMessage(dmConversation(r.id), hub.botSender(r.id), saudacaoDeReceita(receita, r.name));
        } catch (e) {
          console.warn("[receita] saudação:", (e as Error).message);
        }
      }
    }

    // Grava avatar/role ja na tabela bots para o bot.update sair completo
    // antes do processo conectar — senao a lista do celular fica vazia.
    hub.db.upsertBot(
      { id: r.id, name: r.name, role: r.role, avatar: r.avatar, color: r.color, voice: r.voice },
      { engine: r.engine, provider: r.provider?.kind, model: r.provider?.model },
    );
    try {
      registrarPc({ botId: r.id, empresaId: empresa, nome: r.name });
      marcarSempreLigado(r.id, true);
      definirAcessoPc(r.id, true);
      void ligarPc(r.id).then((est) => {
        if (est?.estado === "ligada") console.log(`[pc] ${r.id}: PC ligado ao nascer`);
        else console.warn(`[pc] ${r.id}: não ligou ao nascer: ${est?.erro ?? est?.estado}`);
      }).catch((e) => console.error(`[pc] ${r.id}: ligar ao nascer: ${(e as Error).message}`));
    }
    catch (e) { console.error(`[pc] não registrei/liguei o PC de ${r.id}: ${(e as Error).message}`); }
    hub.broadcastKnowledge();
    hub.botUpdate(r.id);
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

  app.get("/api/receitas", async () => ({
    receitas: listarReceitas().map((r) => ({
      id: r.id,
      name: r.profile.name,
      description: r.profile.description,
      ameba: r.profile.ameba,
      skills: r.skills?.length ?? 0,
      memory: r.memory?.length ?? 0,
      routines: r.routines?.length ?? 0,
    })),
    ids: listarIdsReceitas(),
  }));
  app.get("/api/receitas/:id", async (req, reply) => {
    const r = carregarReceita((req.params as any).id);
    if (!r) return reply.code(404).send({ error: "receita não encontrada" });
    return r;
  });
  app.post("/api/receitas/gerar", async () => gerarTodasReceitasDoCatalogo());
  app.post("/api/receitas/import", async (req, reply) => {
    const body = req.body as any;
    const receita = body?.receita || body;
    if (!receita?.versao || !receita?.profile?.name) return reply.code(400).send({ error: "receita inválida" });
    const name = String(body?.name || receita.profile.name).trim();
    const id = String(body?.id || name).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "bot";
    const empresas = hub.db.listEmpresas();
    const empresa = body?.empresa || empresas[0]?.id;
    if (!empresa) return reply.code(400).send({ error: "Crie a primeira empresa antes." });
    const espId = receita.especialidadeId || receita.id || idPadrao();
    const basePadrao = PADRAO_DA_CASA as { engine?: string; provider?: string | { kind: string; model?: string }; model?: string };
    const padraoKind = typeof basePadrao.provider === "string" ? basePadrao.provider : basePadrao.provider?.kind || "zai";
    const padraoModel = (typeof basePadrao.provider === "object" && basePadrao.provider?.model) || basePadrao.model || "glm-4.5-flash";
    const reqProvider = body.provider;
    const pKind = (typeof reqProvider === "string" ? reqProvider : reqProvider?.kind) || padraoKind;
    const pModel = (typeof reqProvider === "object" && reqProvider?.model) || body.model || padraoModel;
    const createBody: any = {
      id,
      name,
      role: receita.profile.description || receita.profile.name,
      avatar: receita.profile.ameba,
      especialidadeId: espId,
      receitaId: receita.id,
      receita,
      controlMode: "supervisionado",
      engine: body.engine || basePadrao.engine || "direct",
      provider: { kind: pKind, model: pModel },
    };
    // reuse POST managed logic via internal call shape
    const r = manager.create(createBody);
    if ("error" in r) return reply.code(400).send(r);
    hub.db.setEmpresaDoBot(r.id, r.name, empresa, false);
    try {
      const esp = porId(espId) || porId(idPadrao());
      for (const sk of carregarSkillsDaEspecialidade(esp)) {
        hub.db.saveSaber({
          id: `skill-${r.id}-${sk.id}`,
          titulo: sk.titulo,
          resumo: `Skill da especialidade ${esp?.nome ?? ""} (${sk.id})`,
          conteudo: sk.conteudo,
          tipo: "procedimento",
          tags: ["skill", "especialidade", esp?.id ?? "", sk.id].filter(Boolean),
          bots: [r.id],
          origem: "especialidade",
        });
      }
    } catch (e) { console.warn("[receita.import] seed esp", (e as Error).message); }
    const applied = aplicarReceitaNoNascimento(hub.db, { botId: r.id, botName: r.name, empresaId: empresa, receita });
    hub.db.audit(r.id, "receita.import", applied);
    try { hub.storeMessage(dmConversation(r.id), hub.botSender(r.id), saudacaoDeReceita(receita, r.name)); } catch {}
    hub.db.upsertBot({ id: r.id, name: r.name, role: r.role, avatar: r.avatar, color: r.color, voice: r.voice }, { engine: r.engine, provider: r.provider?.kind, model: r.provider?.model });
    try { registrarPc({ botId: r.id, empresaId: empresa, nome: r.name }); marcarSempreLigado(r.id, true); definirAcessoPc(r.id, true); void ligarPc(r.id); } catch {}
    hub.broadcastKnowledge();
    hub.botUpdate(r.id);
    return { ...r, receitaAplicada: applied };
  });
  app.get("/api/managed/:id/receita", async (req, reply) => {
    const id = (req.params as any).id;
    const m = manager.get(id);
    if (!m) return reply.code(404).send({ error: "bot não encontrado" });
    return exportarBotComoReceita(hub.db, { botId: id, name: m.name, role: m.role || "", avatar: m.avatar, especialidadeId: (m as any).especialidadeId });
  });
  app.get("/api/bots/:id/fatos", async (req) => {
    const id = (req.params as any).id;
    return { fatos: hub.db.listarFatos(id), resumo: hub.db.lerResumoBot(id), equipe: hub.db.listarFatosEquipe(hub.empresaDe(id).id ?? "") };
  });
  app.post("/api/bots/:id/fatos", async (req, reply) => {
    const id = (req.params as any).id;
    const b = req.body as any;
    const text = String(b?.text || "").trim();
    if (!text) return reply.code(400).send({ error: "text obrigatório" });
    const fato = { id: newId("fato"), botId: id, text, tipo: hub.db.normalizarTipoFato(b?.tipo), learnedAt: Date.now(), empresaId: hub.empresaDe(id).id ?? "", promovido: false };
    hub.db.inserirFato(fato as any);
    hub.db.regenerarResumoBot(id, fato.empresaId);
    return fato;
  });
  app.patch("/api/bots/:id/fatos/:fatoId", async (req, reply) => {
    const fatoId = (req.params as any).fatoId;
    const b = req.body as any;
    if (!hub.db.atualizarFato(fatoId, { text: b?.text, tipo: b?.tipo != null ? hub.db.normalizarTipoFato(b.tipo) : undefined })) return reply.code(404).send({ error: "fato não encontrado" });
    const botId = (req.params as any).id;
    hub.db.regenerarResumoBot(botId, hub.empresaDe(botId).id ?? "");
    return hub.db.getFato(fatoId);
  });
  app.delete("/api/bots/:id/fatos/:fatoId", async (req) => {
    hub.db.apagarFato((req.params as any).fatoId);
    const botId = (req.params as any).id;
    hub.db.regenerarResumoBot(botId, hub.empresaDe(botId).id ?? "");
    return { ok: true };
  });
  app.post("/api/bots/:id/fatos/:fatoId/promover", async (req, reply) => {
    const botId = (req.params as any).id;
    const fatoId = (req.params as any).fatoId;
    const ok = hub.db.promoverFatoEquipe(fatoId, hub.empresaDe(botId).id ?? "");
    if (!ok) return reply.code(404).send({ error: "fato não encontrado" });
    hub.broadcastKnowledge();
    return hub.db.getFato(fatoId);
  });
  app.post("/api/bots/:id/chamada", async (req) => {
    const id = (req.params as any).id;
    const ativa = !!(req.body as any)?.ativa;
    hub.setChamadaAtiva(id, ativa);
    return { ok: true, ativa };
  });


  app.get("/api/routines", async (req) => hub.db.listRoutines((req.query as any).bot));
  app.post("/api/routines", async (req, reply) => {
    const b = req.body as { botId?: string; name?: string; cron?: string; prompt?: string; enabled?: boolean; paused?: boolean };
    if (!b?.botId || !b?.cron || !b?.prompt) return reply.code(400).send({ error: "botId, cron e prompt são obrigatórios" });
    const r = hub.createRoutine(b.botId, b.name ?? "", b.cron, b.prompt, { enabled: b.enabled !== false && b.paused !== true });
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
    // Foto e PDF seguem abertos (o chat já embute). Vídeo pede a senha da interface.
    if (videoExigeSenha(f.mime) && config.uiPassword && !uiAuthorized(req) && !nodeAuthorized(req)) {
      return reply.code(401).send({ error: "senha da interface inválida" });
    }
    const stat = fs.statSync(f.path);
    reply.header("accept-ranges", "bytes").header("content-type", f.mime);
    reply.header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    const faixa = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ""));
    if (faixa && stat.size > 0) {
      const ini = Number(faixa[1]);
      const fim = faixa[2] ? Math.min(Number(faixa[2]), stat.size - 1) : Math.min(ini + 1024 * 1024 - 1, stat.size - 1);
      if (!Number.isFinite(ini) || ini >= stat.size || ini > fim) {
        reply.code(416).header("content-range", `bytes */${stat.size}`);
        return reply.send();
      }
      reply.code(206).header("content-range", `bytes ${ini}-${fim}/${stat.size}`).header("content-length", String(fim - ini + 1));
      return reply.send(fs.createReadStream(f.path, { start: ini, end: fim }));
    }
    reply.header("content-length", String(stat.size));
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


  registrarCofre(app, hub);

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
    // Pagina direta do celular: so a tela do aparelho, sem abertura nem empresa.
    const paginaCel = fileURLToPath(new URL("../celular-page.html", import.meta.url));
    app.get("/celular.html", async (_req, reply) => reply.type("text/html").send(fs.readFileSync(paginaCel, "utf8")));
  }

  if (fs.existsSync(config.uiDist)) {
    await app.register(fastifyStatic, {
      root: config.uiDist,
      prefix: "/",
      setHeaders(res, pathName) {
        if (pathName.endsWith("index.html") || pathName.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Pragma", "no-cache");
        } else if (/\.(?:js|css)$/.test(pathName)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    });
    app.setNotFoundHandler((req, reply) => {
      const u = req.url.split("?")[0];
      if (u.startsWith("/api/") || u.startsWith("/mcp") || u.startsWith("/pc/") || u.startsWith("/android/")) {
        return reply.code(404).send({ error: "não encontrado" });
      }
      reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
      reply.header("Pragma", "no-cache");
      return reply.sendFile("index.html");
    });
  } else {
    app.get("/", async () => ({ ok: true, aviso: `Interface não compilada: rode "npm run build:ui". UI esperada em ${config.uiDist}` }));
  }

  await app.listen({ host: config.host, port: config.port });
  startScheduler(hub);
  manager.startAll();
  void acordarPcsSempreLigados().catch((e) => console.error(`[pc] reacordar sempreLigados: ${(e as Error).message}`));
  const shutdown = () => { void manager.stopAll().finally(() => process.exit(0)); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return app;
}


