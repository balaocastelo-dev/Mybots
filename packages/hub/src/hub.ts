import type { WebSocket } from "ws";
import fs from "node:fs";
import path from "node:path";
import {
  type ApprovalKind, type BotEvent, type BotInfo, type BotSummary, type ControlMode, type ControlState, type FaseAtividade, type Group, type HubToNode, type HubToUi, type NodeToHub,
  type PendingApproval, type PendingQuestion, type Routine, type Sender, type StoredMessage, type UiToHub,
  type Saber,
  type SaberTipo,
  botOfConversation, cortarFala, dmConversation, effectiveControl, faseDoStatus, groupOfConversation, isControlMode, needsHumanApproval, newId, pairConversation, PROTOCOL_VERSION, SABER_LABELS,
} from "@mybots/shared";
import { Db } from "./db.js";
import { Cofre } from "./cofre.js";
import { redigir, semSegredo, textoSeguro } from "./redacao.js";
import { WhatsAppDasEmpresas } from "./whatsapp.js";
import { PrimeirosPassos } from "./primeirospassos.js";
import { logoNaPasta } from "./folha.js";
import { OBRIGATORIOS, VERSAO_LEGAL } from "./legal.js";
import { custoMilesimos, reais } from "./creditos.js";
import { config, tokenAllows , raizDoProjeto } from "./config.js";
import { nextRunOf, validateCron } from "./scheduler.js";
import { voiceConfig } from "./voice.js";
import { splitThoughts } from "./thoughts.js";
import { MediaService } from "./media.js";
import { SalaDeConversa } from "./sala.js";
import type { Attachment, ColabEvento, MediaKind, MediaResult, UsoDoPc } from "@mybots/shared";
import { ServicoColab } from "./colab/servico.js";
import { aprovacaoDoPainel, classificarAcaoSensivel, mensagemLiberaEnvioExterno, registrarAuditoria } from "./colab/seguranca.js";
import { UsosDoPc } from "./usoDoPc.js";
import { Gravacoes, codificarMp4, ligarCdp, portaCdpPermitida, temFfmpeg, limitesDaGravacao } from "./gravacao.js";
import { estadoDa as estadoDaMaquina } from "./maquinas.js";
import { acordarPc, botPadraoDaEmpresa, temRegistro, tocarPc, type BotParaPc } from "./pcs.js";
import * as celular from "./celular.js";
import {
  TravaDosCelulares, acaoSensivel, enderecoParaReconectar, lerMdns, lerPareamento, pacoteValido, resumoDoCelular,
  type VinculoCelular,
} from "./celularEmpresa.js";
import { argumentosScrcpy } from "./scrcpy.js";
import { spawn } from "node:child_process";
import { ehHumano, FilaDeTarefas } from "./colab/fila.js";
import { notificarParada, registrarAoParar } from "./colab/parar.js";

type NodeConn = {
  ws: WebSocket;
  bot: BotInfo;
  engine: string;
  provider: string;
  model: string;
  status: string;
  busy: boolean;
  fase?: FaseAtividade;
  connectedAt: number;
  controlMode?: ControlMode;
};

type ToolRecord = { callId: string; tool: string; input?: unknown; output?: string; ok?: boolean; done: boolean };

type PendingAsk = {
  callId: string;
  fromBotId: string;
  conversationId: string;
  targetBotId: string;
  timer: NodeJS.Timeout;
};

const USER: Sender = { kind: "user", id: "user", name: "o chefe" };
const SYSTEM: Sender = { kind: "system", id: "system", name: "MyBots" };

export class Hub {
  readonly db: Db;
  /** preenchido pelo servidor: bots hospedados neste PC */
  managedIds: () => Set<string> = () => new Set();
  /** ids dos bots do sistema (o Médico), que não podem ser excluídos */
  protegidosIds: () => Set<string> = () => new Set();
  /** ids dos bots que respondem em outro idioma (professor de idiomas): o filtro de pensamento não corta inglês deles */
  falamOutroIdioma: () => Set<string> = () => new Set();
  /** equipe de um gerente (preenchido pelo server com o BotManager) */
  managesOf: (botId: string) => string[] | undefined = () => undefined;
  /** é o Gerente Geral da empresa? (preenchido pelo server com o BotManager) */
  ehGerente: (botId: string) => boolean = () => false;
  /** reinicia um bot hospedado aqui (preenchido pelo server); false = não é gerenciado por este PC */
  restartBot: (botId: string) => boolean = () => false;
  /** cuidar da equipe (ligar, parar, reiniciar, excluir). Ligado ao BotManager pelo server. */
  /** o Gerente Geral montando a equipe dele. Ligado ao BotManager pelo server. */
  criarBot: (p: { nome: string; funcao?: string; persona?: string; empresaId?: string | null; gerenteId: string }) => Promise<{ ok: boolean; msg: string }> =
    async () => ({ ok: false, msg: "este Hub nao cria bots." });
  manageBot: (acao: "excluir" | "parar" | "ligar" | "reiniciar", botId: string, apagarArquivos: boolean) => Promise<{ ok: boolean; msg: string }> =
    async () => ({ ok: false, msg: "este Hub não gerencia bots." });
  /** Mensagens entre bots, parar e permissão entre empresas. Tarefa e sala ficam em outros módulos. */
  readonly colab: ServicoColab;
  private nodes = new Map<string, NodeConn>();

  /** A sala: os bots conversando entre si, um de cada vez e com fim marcado.
   *  O limite de turnos e a parada quando o chefe fala nao sao enfeite: sem eles
   *  cada fala acordaria todos os outros e a conta subiria sozinha. */
  readonly sala = new SalaDeConversa({
    membrosDoGrupo: (groupId) => this.db.getGroup(groupId)?.members,
    nomeDoBot: (botId) => this.botSender(botId).name,
    acordarBot: (botId, conversationId, texto) => {
      const de: Sender = { kind: "system", id: "sistema:sala", name: "Sala" };
      const m = this.marcador(conversationId, `Vez de ${this.botSender(botId).name}`, { sala: true });
      return this.sendNode(botId, { type: "message", conversationId, messageId: m.id, from: de, text: texto });
    },
    anotar: (conversationId, texto) => { this.marcador(conversationId, texto, { sala: true }); },
  });
  private uis = new Set<WebSocket>();
  private streams = new Map<string, { conversationId: string; botId: string; text: string; createdAt: number; tools: ToolRecord[]; /** o que já foi mandado para a voz (chamada de voz: ele fala enquanto escreve) */ falado?: string; /** o que a interface já está mostrando, já sem pensamento */ mostrado?: string }>();

  /** Garante a linha da mensagem do bot (texto vai chegando por partes; ferramentas chegam antes do texto). */
  private ensureStream(messageId: string, conversationId: string, botId: string, sender: Sender) {
    let s = this.streams.get(messageId);
    if (!s) {
      const existing = this.db.getMessage(messageId);
      s = { conversationId, botId, text: existing?.text ?? "", createdAt: existing?.createdAt ?? Date.now(), tools: (existing?.meta?.tools as ToolRecord[]) ?? [] };
      this.streams.set(messageId, s);
      if (!existing) {
        const m: StoredMessage = { id: messageId, conversationId, sender, text: "", createdAt: s.createdAt, meta: { streaming: true } };
        this.db.insertMessage(m);
        this.broadcastUi({ type: "message", message: m });
      }
    }
    return s;
  }

  /**
   * Chamada de voz: o bot fala enquanto escreve.
   *
   * A cada pedaço de texto que chega do modelo, manda para a interface só o que já é
   * FRASE INTEIRA e já passou pelo filtro de pensamento — o chefe não ouve o modelo
   * raciocinando em inglês, e não ouve meia frase. O que sobrar sai no fim.
   */
  private falaEmTempoReal(conversationId: string, botId: string, messageId: string, s: { text: string; falado?: string }) {
    const { answer } = splitThoughts(s.text, { permiteIngles: this.falamOutroIdioma().has(botId), aoVivo: true });
    const falado = s.falado ?? "";
    if (!answer.startsWith(falado)) return;          // o filtro mudou de ideia: espera o fim
    const { pedacos, resto } = cortarFala(answer.slice(falado.length), !falado);
    if (!pedacos.length) return;
    for (const texto of pedacos) this.broadcastUi({ type: "speech.delta", conversationId, botId, messageId, text: texto });
    // guarda o PREFIXO exato já falado (não a junção dos pedaços: os espaços não batem)
    s.falado = answer.slice(0, answer.length - resto.length);
  }

  /** Fim da resposta: o que ficou sem ponto final também é falado, e a interface sabe que acabou. */
  private fecharFala(conversationId: string, botId: string, messageId: string, texto: string, falado: string) {
    const resto = texto.startsWith(falado) ? texto.slice(falado.length) : (falado ? "" : texto);
    const { pedacos } = cortarFala(resto, !falado, true);
    for (const t of pedacos) this.broadcastUi({ type: "speech.delta", conversationId, botId, messageId, text: t });
    this.broadcastUi({ type: "speech.done", conversationId, botId, messageId });
  }

  /** Bot ficou livre: fecha mensagens que ficaram "em andamento" (só ferramentas, sem texto final). */
  finalizeStreams(botId: string) {
    for (const [messageId, s] of [...this.streams]) {
      if (s.botId !== botId) continue;
      this.streams.delete(messageId);
      this.encerrados.set(messageId, Date.now());        // o que chegar depois disto é tarde: não entra
      const meta = { streaming: false, interrompido: true, ...(s.tools.length ? { tools: s.tools } : {}) };
      this.db.updateMessageText(messageId, s.text, meta);
      this.broadcastUi({ type: "message", message: { id: messageId, conversationId: s.conversationId, sender: this.botSender(botId), text: s.text, createdAt: s.createdAt, meta } });
    }
  }

  private recordTool(messageId: string, t: ToolRecord) {
    const s = this.streams.get(messageId);
    if (!s) return;
    const i = s.tools.findIndex((x) => x.callId === t.callId);
    if (i >= 0) s.tools[i] = { ...s.tools[i], ...t };
    else s.tools.push(t);
    this.db.updateMessageText(messageId, s.text, { streaming: true, tools: s.tools });
  }
  /**
   * Parar é parar. Estas duas memórias são o que faz "parar" valer DEPOIS do clique:
   * o nó pode levar um instante para abortar e ainda mandar pedaço de texto; a rotina
   * pode estar marcada para o segundo seguinte. Sem isto, o bot "volta a falar sozinho".
   */
  private encerrados = new Map<string, number>();        // messageId interrompido -> quando
  private paradas = new Map<string, number>();           // botId parado -> quando
  /** rotina não dispara nos 2 s seguintes a um "parar" daquele bot */
  private static readonly DEBOUNCE_PARADA_MS = 2000;

  /** Esquece o que é velho demais para importar (e não deixa a memória crescer sem fim). */
  private limpaParadas() {
    const limite = Date.now() - 60_000;
    for (const [k, t] of this.encerrados) if (t < limite) this.encerrados.delete(k);
    for (const [k, t] of this.paradas) if (t < limite) this.paradas.delete(k);
  }

  /** O bot foi parado agora há pouco? (segura rotina que ia disparar em cima do stop) */
  private paradoAgora(botId: string) {
    const t = this.paradas.get(botId);
    return !!t && Date.now() - t < Hub.DEBOUNCE_PARADA_MS;
  }

  /** Últimas ações de navegador/tela, por empresa. O PC é um só para a empresa inteira. */
  private usos = new UsosDoPc();
  /** Uma gravação por empresa. O Chrome do container manda os quadros; o ffmpeg monta o mp4. */
  readonly gravacoes = new Gravacoes({
    ligarFonte: (empresaId, onFrame) => this.fonteDaTela(empresaId, onFrame),
    aoLimite: (empresaId) => { void this.pararGravacao(empresaId, "Gravação da tela (parou no limite de tempo ou de tamanho)."); },
  });
  readonly gravacoesCelular = new Gravacoes({
    ligarFonte: (empresaId, onFrame) => this.fonteDoCelular(empresaId, onFrame),
    aoLimite: (empresaId) => { void this.pararGravacao(empresaId, "Gravação do celular (parou no limite).", "celular"); },
  });
  readonly travaCelular = new TravaDosCelulares();
  private usosCelular = new UsosDoPc();
  private relogioCelular: NodeJS.Timeout | null = null;
  private pendingAsks = new Map<string, PendingAsk>();
  private approvalOwner = new Map<string, string>();
  private questionOwner = new Map<string, string>();

  /** imagens/vídeos: geração com cota e preparo de vídeos recebidos */
  readonly media: MediaService;

  /** Fila de tarefas delegadas entre bots. Persistente. */
  readonly tarefas: FilaDeTarefas;
  private relogioTarefas: NodeJS.Timeout | null = null;
  private soltarParar: (() => void) | null = null;

  /** O WhatsApp de cada empresa: conta propria, QR propria. */
  readonly whats: WhatsAppDasEmpresas;

  /** O roteiro dos primeiros passos de uma empresa nova. */
  readonly passos: PrimeirosPassos;

  /** Credenciais cifradas. O valor não volta para bot nem para a interface. */
  readonly cofre: Cofre;

  constructor(dbFile: string, public readonly userName = process.env.MYBOTS_USER_NAME ?? "o chefe") {
    this.db = new Db(dbFile);
    this.cofre = new Cofre(this.db.sqlite);
    this.whats = new WhatsAppDasEmpresas(path.dirname(dbFile), (estado) => this.broadcastUi({ type: "whatsapp", estado }));
    // Sessao ja escaneada volta sozinha quando o Hub sobe: ninguem escaneia duas vezes.
    setTimeout(() => { for (const id of this.whats.salvas()) void this.whats.conectar(id).catch(() => {}); }, 1500);
    // O roteiro dos primeiros passos fala PELO Gerente. A interface e minuscula de
    // proposito: ele nao enxerga o Hub inteiro, so o que precisa para falar, perguntar,
    // guardar arquivo e ler a empresa.
    this.relogioCelular = setInterval(() => { void this.reconectarCelulares(); }, 20_000);
    if (typeof this.relogioCelular.unref === "function") this.relogioCelular.unref();
    this.passos = new PrimeirosPassos({
      falar: (botId, texto, anexos) =>
        void this.storeMessage(dmConversation(botId), this.botSender(botId), texto, anexos?.length ? { files: anexos } : undefined),
      perguntar: (botId, questionId, question, options) => {
        const q: PendingQuestion = { id: questionId, botId, conversationId: dmConversation(botId), question, options, createdAt: Date.now() };
        this.db.insertQuestion(q);
        this.questionOwner.set(q.id, botId);
        this.broadcastUi({ type: "question", question: q });
      },
      fecharPergunta: (questionId, respostaGravada) => {
        this.db.resolveQuestion(questionId, respostaGravada);
        this.questionOwner.delete(questionId);
        this.broadcastUi({ type: "question.resolved", questionId, answer: respostaGravada });
      },
      salvarArquivo: (botId, nome, mime, data) => this.saveFile(botId, nome, mime, data),
      empresa: (empresaId) => {
        const e = this.db.getEmpresa(empresaId);
        if (!e) return undefined;
        const f = e.ficha ?? {};
        // O resumo NÃO é um recorte das regras: isso fazia a folha repetir a política
        // interna como se fosse "quem somos", e ainda por cima de outra instalação.
        return {
          id: e.id, nome: e.nome, regras: e.regras,
          site: f.site, instagram: f.instagram, facebook: f.facebook,
          resumo: f.resumo, segmento: f.segmento, contatos: f.contatos,
          logo: f.logo || logoNaPasta(path.join(raizDoProjeto(), "dados", "empresas", e.id)),
        };
      },
      time: (empresaId) => this.db.listBots()
        .filter((b) => b.empresaId === empresaId && b.name)
        .map((b) => ({ nome: b.name, funcao: b.role || undefined })),
      anotacoes: (empresaId) => this.db.saberesDaEmpresa(empresaId)
        .map((s) => ({ titulo: s.titulo, texto: s.conteudo, tipo: s.tipo })),
      memoria: (empresaId) => this.db.recallPrefix("", empresaId)
        .slice(0, 40)
        .map((m) => ({ chave: m.key, valor: m.value })),
      whats: this.whats,
      lerEstado: (chave) => this.db.getSetting(chave),
      gravarEstado: (chave, valor) => this.db.setSetting(chave, valor),
      audit: (botId, acao, detalhe) => this.db.audit(botId, acao, detalhe as Record<string, unknown>),
      raizDoProjeto: raizDoProjeto(),
    });
    USER.name = this.userName;
    this.media = new MediaService(this.db, (botId, name, mime, data) => this.saveFile(botId, name, mime, data), (id) => this.db.getFile(id) ?? undefined);
    this.tarefas = new FilaDeTarefas(this.db, {
      emitir: (ev) => this.broadcastUi({ type: "colab", ...ev }),
      online: (botId) => {
        const n = this.nodes.get(botId);
        return !!n && n.ws.readyState === n.ws.OPEN;
      },
      acordar: (p) => {
        const sender: Sender = ehHumano(p.autorId)
          ? { kind: "user", id: p.autorId, name: this.userName }
          : this.botSender(p.autorId);
        const m = this.storeMessage(p.conversationId, sender, p.texto, { tarefa: p.tarefaId });
        if (ehHumano(p.botId)) return true;
        return this.sendNode(p.botId, { type: "message", conversationId: p.conversationId, messageId: m.id, from: sender, text: p.texto });
      },
    });
    this.tarefas.vencerPrazos();
    this.relogioTarefas = setInterval(() => {
      this.tarefas.vencerPrazos();
      for (const id of this.nodes.keys()) this.tarefas.despachar(id);
    }, 5_000);
    if (typeof this.relogioTarefas.unref === "function") this.relogioTarefas.unref();
    this.soltarParar = registrarAoParar((e) => { this.tarefas.receberParar(e); });
    for (const a of this.db.pendingApprovals()) this.approvalOwner.set(a.id, a.botId);
    for (const q of this.db.pendingQuestions()) this.questionOwner.set(q.id, q.botId);
    this.passos.retomar(this.db.pendingQuestions());
    this.colab = new ServicoColab({
      db: this.db,
      empresaId: (id) => this.empresaDe(id).id,
      entregarNo: (id, msg) => this.entregarNo(id, msg),
      online: (id) => !!this.nodes.get(id),
      storeMessage: (conversationId, sender, text, meta) => this.storeMessage(conversationId, sender, text, meta),
      emitirUi: (msg) => this.broadcastUi(msg),
      pararBot: (id, motivo) => { this.pararBot(id, motivo); },
      idsDosBots: () => this.idsDosBots(),
      botSender: (id) => this.botSender(id),
      acharBot: (de, para) => this.acharBotColab(de, para),
    });
    this.cleanOldThoughts();
  }

  /** Para o relógio da fila. Os testes usam; o processo do Hub morre com o intervalo. */
  encerrarTarefas() {
    if (this.relogioTarefas) clearInterval(this.relogioTarefas);
    this.relogioTarefas = null;
    this.soltarParar?.();
    this.soltarParar = null;
  }

  entregarNo(botId: string, msg: HubToNode) { return this.sendNode(botId, msg); }
  emitirUi(msg: HubToUi) { this.broadcastUi(msg); }
  emitirColab(evento: ColabEvento) { this.colab.emitir(evento); }
  idsDosBots(): string[] {
    return [...new Set([...this.db.listBots().map((b) => b.id), ...this.nodes.keys()])];
  }

  /** Acha o id mesmo quando o bot é de outra empresa — o bloqueio fica com checarColab. */
  acharBotColab(de: string, bruto: string): { id: string } | { erro: string } {
    const nome = bruto.trim();
    if (!nome) return { erro: "Diga para quem é a mensagem." };
    if (nome === "humano") return { id: "humano" };
    const n = nome.toLowerCase();
    const todos = this.db.listBots();
    const achado = todos.find((b) => b.id === nome || b.id === n || b.name.toLowerCase() === n)
      ?? todos.find((b) => b.name.toLowerCase().startsWith(n));
    if (!achado) {
      const online = this.colegasDe(de).filter((b) => b.online).map((b) => b.id).join(", ");
      return { erro: `Bot "${bruto}" não está online. Da sua empresa, online: ${online || "nenhum"}.` };
    }
    return { id: achado.id };
  }

  /**
   * Envio externo, pagamento e exclusão. O cartão em /api/approvals tem de ter sido
   * resolvido pelo humano. Envio externo ainda exige que o turno tenha sido acordado
   * por uma mensagem de autor "humano".
   */
  liberarAcaoSensivel(botId: string, tool: string, input: unknown, description = ""): { ok: true } | { ok: false; texto: string } {
    const classe = classificarAcaoSensivel(tool, input, description);
    if (!classe) return { ok: true };
    if (classe === "envio" && !mensagemLiberaEnvioExterno(this.colab.autorDe(botId))) {
      registrarAuditoria({ acao: "colab.bloqueio", de: botId, para: "externo", detalhe: { motivo: "aprovacao", ferramenta: tool, autor: this.colab.autorDe(botId) || null } });
      this.colab.emitir({ tipo: "colab.bloqueio", motivo: "aprovacao", de: botId, para: "externo" });
      return { ok: false, texto: "Não enviei. Só uma mensagem com autor 'humano' libera envio externo. Aprovação de outro bot não conta." };
    }
    if (!this.db.temAprovacaoHumana(botId, tool)) {
      registrarAuditoria({ acao: "colab.bloqueio", de: botId, para: tool, detalhe: { motivo: "aprovacao", classe } });
      this.colab.emitir({ tipo: "colab.bloqueio", motivo: "aprovacao", de: botId, para: tool });
      return { ok: false, texto: "Essa ação (envio, pagamento ou exclusão) precisa do OK do humano em /api/approvals. Aprovação de bot não conta." };
    }
    return { ok: true };
  }

  /** POST /api/approvals. `de` omitido ou "humano" é o painel. Bot não resolve o cartão. */
  responderAprovacao(id: string, allow: boolean, remember: boolean | undefined, de: string | undefined): { ok: true } | { ok: false; motivo: "aprovacao"; error: string } {
    if (!aprovacaoDoPainel(de)) {
      const quem = String(de);
      registrarAuditoria({ acao: "colab.bloqueio", de: quem, para: id, detalhe: { motivo: "aprovacao", allow: !!allow } });
      this.colab.emitir({ tipo: "colab.bloqueio", motivo: "aprovacao", de: quem, para: id });
      return { ok: false, motivo: "aprovacao", error: "Aprovação vinda de bot não conta como aprovação humana." };
    }
    this.resolveApproval(id, allow, remember, "humano");
    return { ok: true };
  }

  /** Limpa pensamentos de mensagens gravadas antes do filtro existir (roda uma vez por mensagem). */
  private cleanOldThoughts() {
    let n = 0;
    for (const m of this.db.allBotMessages()) {
      if (m.meta?.thought !== undefined || m.meta?.hidden) continue;
      const { answer, thought } = splitThoughts(m.text);
      if (!thought) continue;
      this.db.updateMessageText(m.id, answer, { ...(m.meta ?? {}), thought, ...(answer ? {} : { hidden: true }) });
      n++;
    }
    if (n) console.log(`[hub] ${n} mensagens antigas tiveram os pensamentos escondidos`);
  }

  // ---------- automode (níveis de controle) ----------

  /** Nível global do Hub; null = cada bot usa o seu (approval.mode do nó). Persistido em settings. */
  control(): ControlState {
    const g = this.db.getSetting<string>("control.global");
    return { global: isControlMode(g) ? g : null };
  }

  /** Nível em vigor para um bot (global sobrescreve o do nó). */
  effectiveModeFor(botId: string): ControlMode {
    return effectiveControl(this.control().global, this.nodes.get(botId)?.controlMode);
  }

  setGlobalControl(mode: ControlMode | null) {
    const before = this.control().global;
    this.db.setSetting("control.global", mode);
    this.db.audit(null, "control.global", { from: before, to: mode });
    const control = this.control();
    this.broadcastUi({ type: "control", control });
    for (const id of this.nodes.keys()) this.sendNode(id, { type: "control", override: control.global });
    if (mode === "deus") this.broadcastUi({ type: "notify", botId: "system", text: "MODO DEUS EXTREMO ligado para todos os bots: eles vão agir sem pedir aprovação. ⏹ Pânico desliga." });
    for (const b of this.db.listBots()) this.botUpdate(b.id);
    return control;
  }

  /** Botão ⏹ de pânico: interrompe todos os bots e volta para Supervisionado. */
  panic() {
    // Pânico é o parar individual aplicado a todos: mesmo caminho, mesma limpeza.
    for (const id of [...this.nodes.keys()]) this.pararBot(id, "pânico");
    this.db.audit(null, "control.panic", { bots: [...this.nodes.keys()] });
    // perguntas e aprovações pendentes no modo antigo caem como negadas
    for (const a of this.db.pendingApprovals()) this.resolveApproval(a.id, false);
    const control = this.setGlobalControl("supervisionado");
    this.broadcastUi({ type: "notify", botId: "system", text: "⏹ Pânico: todos os bots foram interrompidos e o nível voltou para Supervisionado." });
    return control;
  }

  // ---------- utilidades ----------

  private mcpWaiters = new Map<string, (r: { ok: boolean; data: unknown }) => void>();
  private questionWaiters = new Map<string, (answer: string) => void>();
  private approvalWaiters = new Map<string, (allow: boolean) => void>();

  private sendNode(botId: string, msg: HubToNode): boolean {
    // Chamadas feitas pelo servidor MCP não têm nó atrás: resolvem promessas locais.
    if (msg.type === "result") {
      const w = this.mcpWaiters.get(msg.callId);
      if (w) { this.mcpWaiters.delete(msg.callId); w({ ok: msg.ok, data: msg.data }); return true; }
    }
    if (msg.type === "approval.response") {
      const w = this.approvalWaiters.get(msg.requestId);
      if (w) { this.approvalWaiters.delete(msg.requestId); w(msg.allow); }
    }
    if (msg.type === "question.answer") {
      const w = this.questionWaiters.get(msg.questionId);
      if (w) { this.questionWaiters.delete(msg.questionId); w(msg.answer); }
    }
    const n = this.nodes.get(botId);
    if (!n || n.ws.readyState !== n.ws.OPEN) return false;
    if (msg.type === "message" && temRegistro(botId)) {
      tocarPc(botId);
      void acordarPc(botId).catch((e) => console.error(`[pc] ${botId}: ${(e as Error).message}`));
    }
    n.ws.send(JSON.stringify(msg));
    return true;
  }

  private broadcastUi(msg: HubToUi) {
    const data = JSON.stringify(msg);
    for (const ws of this.uis) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  /**
   * Remove o bot do painel e do banco. Sem isso ele continuava aparecendo
   * (offline) mesmo depois de excluído, porque a lista vem da tabela `bots`.
   */
  removeBot(botId: string, purge = false) {
    const n = this.nodes.get(botId);
    if (n) { try { n.ws.close(); } catch { /* já caiu */ } this.nodes.delete(botId); }
    // Fecha a resposta que estava sendo escrita neste instante: sem isso o stream fica
    // aberto e a interface continua mostrando o bot "digitando" depois de ele não existir mais.
    this.finalizeStreams(botId);
    this.db.deleteBot(botId, purge);
    this.broadcastUi({ type: "bot.removed", botId });
    this.broadcastUi({ type: "groups", groups: this.db.listGroups() });
  }

  /**
   * Arquivo largado no atalho/painel: a interface pergunta a qual bot entregar.
   * Fica guardado até alguém resolver, senão o arquivo some quando o painel ainda
   * não terminou de conectar (foi o que acontecia ao arrastar com o app fechado).
   */
  private pendingImport?: { name: string; mime: string; dataBase64: string };
  requestImport(name: string, mime: string, data: Buffer) {
    this.pendingImport = { name, mime, dataBase64: data.toString("base64") };
    this.broadcastUi({ type: "import.request", file: this.pendingImport });
    this.db.audit(null, "import.request", { name, mime, size: data.length });
  }
  importPending() { return this.pendingImport; }
  clearImport() { this.pendingImport = undefined; }

  /** Quem quer saber quando um bot termina de responder (a ponte do Telegram usa isto). */
  private replyListeners: Array<(conversationId: string, botId: string, text: string, thought?: string) => void> = [];
  onBotReply(fn: (conversationId: string, botId: string, text: string, thought?: string) => void) { this.replyListeners.push(fn); }

  /** Manda o bot parar o que está fazendo. */
  abortBot(botId: string) { this.pararBot(botId); }

  /**
   * Para TUDO que ESTE bot está fazendo — e só ele.
   *
   * Antes, parar mandava abortar UMA conversa (a direta). O trabalho do bot podia estar
   * numa rotina, num grupo ou numa conversa com outro bot, e seguia correndo: para o
   * chefe, o botão de parar não funcionava. E o único "parar de verdade" era o Pânico,
   * que cala todo mundo. Aqui é individual: o bot ao lado não sente nada.
   */
  pararBot(botId: string, motivo = "pedido pelo chefe"): { online: boolean; cartoes: number; salas: string[] } {
    const online = this.sendNode(botId, { type: "abort", conversationId: "*" });
    // Onde ele estava escrevendo agora: é onde vai ficar a marca de interrompido,
    // para a conversa não terminar num texto pela metade sem explicação.
    const escrevendo = [...new Set([...this.streams.values()].filter((s) => s.botId === botId).map((s) => s.conversationId))];
    this.finalizeStreams(botId);
    for (const c of escrevendo) this.marcador(c, `⏹ ${this.botSender(botId).name} foi interrompido`);

    // Cartões dele que ficariam órfãos esperando clique.
    let cartoes = 0;
    for (const a of this.db.pendingApprovals().filter((x) => x.botId === botId)) {
      this.db.cancelApproval(a.id);
      const w = this.approvalWaiters.get(a.id);
      if (w) { this.approvalWaiters.delete(a.id); w(false); }
      this.broadcastUi({ type: "approval.resolved", requestId: a.id, allow: false });
      cartoes++;
    }
    for (const q of this.db.pendingQuestions().filter((x) => x.botId === botId)) {
      this.db.cancelQuestion(q.id);
      const w = this.questionWaiters.get(q.id);
      if (w) { this.questionWaiters.delete(q.id); w(""); }
      this.broadcastUi({ type: "question.resolved", questionId: q.id, answer: "" });
      cartoes++;
    }

    // Quem estava esperando resposta DELE não fica pendurado até o tempo acabar.
    for (const [key, p] of this.pendingAsks) {
      if (p.targetBotId !== botId && p.fromBotId !== botId) continue;
      clearTimeout(p.timer);
      this.pendingAsks.delete(key);
      if (p.targetBotId === botId && p.fromBotId !== botId) {
        this.sendNode(p.fromBotId, { type: "result", callId: p.callId, ok: false, data: `O bot ${botId} foi parado antes de responder.` });
      }
    }

    // Sala em que ele tem a vez: sem isso a roda fica esperando quem já parou.
    const salas: string[] = [];
    for (const s of this.sala.ativas()) {
      if (!s.fila.includes(botId)) continue;
      this.sala.parar(s.groupId);
      salas.push(s.groupId);
    }

    const n = this.nodes.get(botId);
    if (n) { n.busy = false; n.status = "Disponível"; }
    this.paradas.set(botId, Date.now());
    this.limpaParadas();
    this.botUpdate(botId);
    this.db.audit(botId, "bot.parado", { motivo, online, cartoes, salas });
    return { online, cartoes, salas };
  }

  /**
   * Índice da base comum: títulos + uma linha cada. Vai no prompt de TODO bot,
   * para ele nascer sabendo o que existe e buscar o resto com search_knowledge.
   */
  /** A base mudou: reenvia a herança para a interface E para todo bot já conectado. */
  broadcastKnowledge() {
    this.broadcastUi({ type: "knowledge", total: this.db.listSaberes().length });
    for (const id of this.nodes.keys()) this.sendNode(id, { type: "knowledge", knowledge: this.knowledgeIndex(id) });
  }

  /** Quanto texto de identidade cabe no prompt antes de virar peso morto. */
  private static readonly IDENTIDADE_MAX = 8000;
  /** Teto do indice completo no prompt: acima disto vira peso morto em toda mensagem. */
  private static readonly INDICE_MAX = 9000;

  knowledgeIndex(botId?: string): string {
    // A base e COMUM a todas as empresas. O que muda de bot para bot e a EMPRESA dele.
    const empresaDoBot = botId ? this.empresaDe(botId).id : null;
    const todos = this.db.listSaberes(empresaDoBot);
    const empresaBloco = botId ? this.blocoDaEmpresa(botId) : "";
    if (!todos.length) return empresaBloco;

    // "identidade" e heranca: vai INTEIRA no prompt, todo bot nasce sabendo de cabeca.
    const identidade = todos.filter((v) => v.tipo === "identidade");
    const resto = todos.filter((v) => v.tipo !== "identidade");

    const blocos: string[] = [];
    let gasto = 0;
    for (const v of identidade) {
      const corpo = this.db.getSaber(v.id)?.conteudo ?? "";
      if (!corpo) continue;
      if (gasto + corpo.length > Hub.IDENTIDADE_MAX) {
        blocos.push(`### ${v.titulo}\n${corpo.slice(0, Math.max(0, Hub.IDENTIDADE_MAX - gasto))}\n(...resto na base: busque com search_knowledge)`);
        break;
      }
      blocos.push(`### ${v.titulo}\n${corpo}`);
      gasto += corpo.length;
    }

    // Indice COMPLETO, nao amostra: todo bot ve TODOS os titulos, com o id para ler
    // o documento inteiro. So existe um teto de caracteres para o prompt nao virar
    // peso morto; o que nao couber vira contagem e continua achavel pela busca.
    const ORDEM: string[] = ["procedimento", "ferramenta", "skill", "conhecimento", "historia", "contato", "produto"];
    const agrupado = new Map<string, Saber[]>();
    for (const v of resto) {
      const l = agrupado.get(v.tipo) ?? [];
      l.push(v);
      agrupado.set(v.tipo, l);
    }
    const tipos = [...agrupado.keys()].sort((a, b) => {
      const ia = ORDEM.indexOf(a), ib = ORDEM.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    let orcamento = Hub.INDICE_MAX;
    let cortados = 0;
    const partes: string[] = [];
    for (const tipo of tipos) {
      const itens = agrupado.get(tipo)!;
      const linhas: string[] = [];
      let n = 0;
      for (const v of itens) {
        const resumo = (v.resumo ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
        const linha = `  - ${v.titulo}${resumo ? ` — ${resumo}` : ""}  [id: ${v.id}]`;
        if (linha.length > orcamento) break;
        linhas.push(linha);
        orcamento -= linha.length + 1;
        n++;
      }
      const sobra = itens.length - n;
      cortados += sobra;
      if (sobra > 0) linhas.push(`  (e mais ${sobra} de ${SABER_LABELS[tipo as SaberTipo] ?? tipo} — chame search_knowledge por palavra-chave)`);
      if (linhas.length) partes.push(`${SABER_LABELS[tipo as SaberTipo] ?? tipo} (${itens.length}):\n${linhas.join("\n")}`);
    }

    const chaves = this.db.listMemoryKeys(60, botId ? (this.empresaDe(botId).id ?? "") : "");
    const memoria = chaves.length
      ? [
          "## Memoria da equipe (compartilhada: qualquer bot le e escreve)",
          "Estas chaves JA estao anotadas. Leia com recall(\"chave\") antes de perguntar ao chefe. Para listar varias: recall(\"prefixo*\").",
          chaves.map((c) => `  - ${c.key}`).join("\n"),
        ]
      : ["## Memoria da equipe (compartilhada)", "Ainda vazia. O que a equipe precisar lembrar, grave com remember(chave, valor) — todos os bots leem."];

    return [
      empresaBloco,
      blocos.length ? "## Quem e a casa (voce ja sabe isto de cabeca)" : "",
      ...blocos,
      resto.length ? "## Base de conhecimento da casa (COMUM A TODOS OS BOTS)" : "",
      resto.length ? `Esta base e compartilhada: tudo o que esta aqui e seu tambem, nao importa qual bot gravou. Sao ${resto.length} documentos e a lista abaixo e o INDICE COMPLETO${cortados > 0 ? ` (exceto ${cortados} que nao couberam no prompt e aparecem so na contagem)` : ""}.` : "",
      resto.length ? "Para LER qualquer um por inteiro: search_knowledge com o id que esta entre colchetes (e parte=2, 3... para continuar). Para procurar por assunto: search_knowledge com palavras-chave. Para ver a BASE INTEIRA, inclusive o que nao coube na lista acima: search_knowledge com query=\"*\"." : "",
      resto.length ? "Antes de dizer que nao encontrou, que nao existe ou que nao sabe de algo da casa, voce e OBRIGADO a chamar search_knowledge com as palavras do pedido — e, se nao achar, tentar outras palavras. So depois de buscar de verdade voce pode dizer que nao achou, e ai diga quais palavras tentou." : "",
      ...partes,
      "",
      ...memoria,
      "",
      "Aprendeu algo que serve para a equipe? Grave com learn_knowledge: no mesmo instante TODO bot passa a enxergar, inclusive os que nascerem depois.",
    ].filter(Boolean).join("\n");
  }

  /**
   * A empresa pode falar com cliente? Só depois de os consentimentos obrigatórios
   * (LGPD, identificação de IA, uso do WhatsApp, retenção, terceiros) estarem
   * aceitos NA VERSÃO atual. Consentimento que não trava nada não é consentimento.
   */
  podeFalarComCliente(empresaId: string): { ok: true } | { ok: false; falta: string[] } {
    const aceitos = new Set(this.db.listConsentimentos(empresaId).filter((c) => c.aceito && c.versao === VERSAO_LEGAL).map((c) => c.doc));
    const falta = OBRIGATORIOS.filter((d) => !aceitos.has(d));
    return falta.length ? { ok: false, falta } : { ok: true };
  }

  /**
   * A empresa pode fazer o bot trabalhar? Mensalidade cobre a franquia; acima dela
   * cada resposta debita o saldo. Sem saldo e sem carência, o bot não é acionado —
   * e o chefe vê o motivo na conversa, com o valor e como recarregar.
   */
  podeTrabalhar(empresaId: string): { ok: true } | { ok: false; motivo: string } {
    const p = this.db.plano(empresaId);
    if (!p.cobranca) return { ok: true };   // plano desligado: ninguém é barrado
    if (p.carenciaAte && p.carenciaAte > Date.now()) return { ok: true };
    if (p.usadasNoCiclo < p.franquiaMensagens) return { ok: true };
    if (p.saldoCentavos >= p.precoMensagemCentavos) return { ok: true };
    return { ok: false, motivo: `Sem crédito: a franquia de ${p.franquiaMensagens} mensagens do ciclo acabou e o saldo é ${reais(p.saldoCentavos)} (cada resposta custa ${reais(p.precoMensagemCentavos)}). Recarregue por Pix na tela de Créditos.` };
  }

  /** Onde o bot trabalha: a empresa dele, as regras dela e com quem ele pode falar. */
  blocoDaEmpresa(botId: string): string {
    const eu = this.empresaDe(botId);
    if (!eu.id) {
      return ["## Sua posição",
        "Você é bot do SISTEMA: fica acima das empresas e enxerga os bots de todas elas.",
        "Nunca leve informação de uma empresa para outra sem o chefe mandar."].join("\n");
    }
    const e = this.db.getEmpresa(eu.id);
    const colegas = this.colegasDe(botId).filter((b) => b.empresaId === eu.id);
    return [
      `## A empresa onde você trabalha: ${e?.nome ?? eu.id}`,
      "Você trabalha DENTRO desta empresa. A base de conhecimento é universal (toda a casa sabe o mesmo),",
      "mas as conversas, a memória curta (remember/recall) e os colegas são só desta empresa.",
      colegas.length ? `Colegas desta empresa: ${colegas.map((b) => `${b.name} (${b.id})`).join(", ")}.` : "Você é o único bot desta empresa por enquanto.",
      eu.ponte ? "Você é PONTE: pode falar com bots de outras empresas quando precisar."
               : "Você NÃO fala com bots de outras empresas; se precisar de algo de fora, peça ao chefe.",
      this.regraDeIdioma(e?.idioma ?? "pt"),
      e?.regras?.trim() ? `\n### Regras desta empresa (valem sobre o resto, menos as regras duras da casa)\n${e.regras.trim()}` : "",
    ].filter(Boolean).join("\n");
  }

  /**
   * O sistema é nativo em três idiomas: português, inglês e espanhol. A empresa escolhe
   * o dela; o bot responde no idioma de quem escreveu, entre esses três.
   */
  private regraDeIdioma(idioma: string): string {
    const nome = idioma === "en" ? "inglês" : idioma === "es" ? "espanhol" : "português do Brasil";
    return [
      `\n### Idioma`,
      `O idioma desta empresa é o ${nome}: é nele que você fala por padrão, inclusive status, nomes de arquivo e mensagens para colegas.`,
      "Esta casa é nativa em três idiomas: português, inglês e espanhol. Se quem escreveu usou um dos outros dois, RESPONDA NO IDIOMA DELE, por inteiro, sem avisar que mudou de idioma e sem misturar os dois.",
      "Fora desses três, responda no idioma da empresa e diga em uma linha que pode continuar em português, inglês ou espanhol.",
    ].join("\n");
  }

  /** Le um verbete inteiro, em pedacos. Mesmo texto para o engine direct (WS) e para o MCP. */
  lerSaberTexto(botId: string, id: string, parte?: number): string {
    const v = this.db.getSaber(id);
    // Saber de outra empresa não existe para este bot — nem para dizer que existe.
    if (v?.empresaId && v.empresaId !== this.empresaDe(botId).id) return `Não existe verbete com id "${id}".`;
    if (!v) {
      const perto = this.db.searchSaberes(id.replace(/[-_]+/g, " "), this.empresaDe(botId).id, 5);
      return perto.length
        ? `Nao existe verbete com id "${id}". Parecidos: ${perto.map((h) => `${h.titulo} [id: ${h.id}]`).join("; ")}`
        : `Nao existe verbete com id "${id}".`;
    }
    const PEDACO = 4000;
    const p = Math.max(1, Math.floor(parte ?? 1));
    const total = Math.max(1, Math.ceil(v.conteudo.length / PEDACO));
    const corpo = v.conteudo.slice((p - 1) * PEDACO, p * PEDACO);
    this.db.audit(botId, "knowledge.read", { id: v.id, parte: p, total });
    return [
      `### ${v.titulo} — parte ${p} de ${total}`,
      corpo,
      p < total
        ? `\n[ESTE DOCUMENTO CONTINUA. Isto e so a parte ${p} de ${total}. Para ler o resto, chame search_knowledge de novo com id="${v.id}" e parte=${p + 1}. NAO complete o que falta de cabeca.]`
        : `\n[fim do documento]`,
    ].join("\n");
  }

  /** Busca na base comum. Mesmo texto para o engine direct (WS) e para o MCP. */
  buscarSaberTexto(botId: string, query: string, limit?: number): string {
    // "*" (ou "indice"/"tudo") = me mostre a base inteira. O prompt leva so os principais
    // titulos para nao pesar em toda mensagem; por aqui o bot alcanca TODOS, sem excecao.
    const q = (query ?? "").trim();
    if (!q || q === "*" || /^(indice|índice|tudo|lista|listar)$/i.test(q)) {
      const todos = this.db.listSaberes(this.empresaDe(botId).id);
      this.db.audit(botId, "knowledge.index", { total: todos.length });
      return [`A base da casa tem ${todos.length} documentos. Este e o indice INTEIRO. Para ler qualquer um: search_knowledge com o id (e parte=2,3... para continuar).`, "",
        ...todos.map((v) => `- [${v.tipo}] ${v.titulo}${v.resumo ? ` — ${v.resumo}` : ""}  [id: ${v.id}]`)].join("\n");
    }
    const hits = this.db.searchSaberes(q, this.empresaDe(botId).id, Math.min(10, limit ?? 5));
    const txt = hits.length
      ? [
          `ACHEI na base da casa. O conteudo abaixo e confiavel: use ele para responder. So nao acrescente nada por fora dele — se faltar detalhe, leia mais do documento com id + parte.`,
          ...hits.map((h, i) => {
            const inteiro = this.db.getSaber(h.id)?.conteudo ?? "";
            const corpo = i < 2 ? inteiro.slice(0, 1200) : "";
            const cortado = i < 2 && inteiro.length > 1200;
            return [
              `### ${h.titulo}  (id: ${h.id})`,
              h.resumo ? h.resumo : "",
              corpo || h.trecho,
              cortado ? `[Este documento tem ${inteiro.length} caracteres; acima estao os primeiros 1200. Para ler mais: search_knowledge com id="${h.id}" e parte=2.]` : "",
            ].filter(Boolean).join("\n");
          }),
        ].join("\n\n")
      : "Nada na base sobre isso. Tente outras palavras antes de desistir. Se voce descobrir algo que sirva para a equipe, grave com learn_knowledge.";
    this.db.audit(botId, "knowledge.search", { query: q, achou: hits.length });
    return txt;
  }

  /** Grava na base comum e avisa TODO bot conectado na hora. */
  aprenderSaberTexto(botId: string, v: { titulo: string; resumo?: string; conteudo: string; tipo?: SaberTipo; tags?: string[] }): string {
    const id = (v.titulo || "saber").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || newId("s");
    // Bot de empresa aprende PARA a empresa dele; bot do sistema aprende para a casa.
    const salvo = this.db.saveSaber({ id, titulo: v.titulo, resumo: v.resumo ?? "", conteudo: v.conteudo, tipo: v.tipo ?? "conhecimento", tags: v.tags ?? [], origem: `bot:${botId}`, empresaId: this.empresaDe(botId).id ?? undefined } as any);
    this.db.audit(botId, "knowledge.learn", { id: salvo.id, titulo: salvo.titulo });
    // compartilhar e o ponto: a base mudou, todo bot ja conectado recebe o indice novo agora.
    this.broadcastKnowledge();
    return `Guardado na base: "${salvo.titulo}" (id: ${salvo.id}). Toda a equipe ja enxerga, inclusive quem nascer depois.`;
  }

  summaries(): BotSummary[] {
    return this.db.listBots().map((b) => ({ ...this.summary(b), empresaId: b.empresaId ?? null, ponte: !!b.ponte }));
  }

  /** A empresa de um bot. null = acima das empresas (o chefe e o Medico do Sistema). */
  empresaDe(botId: string): { id: string | null; ponte: boolean } {
    const b = this.db.listBots().find((x) => x.id === botId);
    return { id: b?.empresaId || null, ponte: !!b?.ponte };
  }

  /**
   * Quem este bot enxerga: colegas da MESMA empresa, mais os bots do sistema.
   * Bot marcado como ponte atravessa; bot do sistema ve todo mundo.
   */
  colegasDe(botId: string): BotSummary[] {
    const eu = this.empresaDe(botId);
    return this.summaries().filter((b) => {
      if (b.id === botId) return false;
      if (!eu.id || eu.ponte || b.ponte || !b.empresaId) return true;
      return b.empresaId === eu.id;
    });
  }

  private summary(b: BotInfo & { engine?: string; provider?: string; model?: string; lastSeen?: number }): BotSummary {
    const n = this.nodes.get(b.id);
    const conv = dmConversation(b.id);
    const last = this.db.lastMessage(conv);
    return {
      ...b,
      online: !!n,
      busy: n?.busy ?? false,
      status: n?.status ?? (n ? "Disponível" : "Offline"),
      fase: n ? faseDoStatus(n.status, n.busy, n.fase) : "livre",
      engine: n?.engine ?? b.engine,
      provider: n?.provider ?? b.provider,
      model: n?.model ?? b.model,
      preview: last ? (last.sender.kind === "user" ? "Você: " : "") + last.text.slice(0, 80) : undefined,
      unread: this.db.unreadCount(conv),
      managed: this.managedIds().has(b.id),
      protegido: this.protegidosIds().has(b.id) || undefined,
      controlMode: this.effectiveModeFor(b.id),
      manages: this.managesOf(b.id),
      gerente: this.ehGerente(b.id) || undefined,
    };
  }

  botUpdate(botId: string) {
    const b = this.db.listBots().find((x) => x.id === botId);
    if (b) this.broadcastUi({ type: "bot.update", bot: this.summary(b) });
  }

  storeMessage(conversationId: string, sender: Sender, text: string, meta?: Record<string, unknown>, id = newId("m")): StoredMessage {
    const m: StoredMessage = { id, conversationId, sender, text, createdAt: Date.now(), meta };
    this.db.insertMessage(m);
    this.broadcastUi({ type: "message", message: m });
    return m;
  }

  // ---------- menu do chat: rebobinar, editar, apagar, fixar ----------

  /** O histórico que o nó deve passar a enxergar depois de mexermos na conversa. */
  private historicoPara(conversationId: string): Array<{ role: "user" | "assistant"; content: string }> {
    return this.db.getMessages(conversationId, 200)
      .filter((m) => (m.sender.kind === "user" || m.sender.kind === "bot") && m.text.trim())
      .map((m) => ({ role: m.sender.kind === "user" ? ("user" as const) : ("assistant" as const), content: m.text }));
  }

  /**
   * Antes de mexer no histórico, para tudo que está no ar naquela conversa: o stream em
   * curso, a fala e os cartões parados. Senão fica cartão órfão esperando clique e voz
   * lendo texto que já não existe.
   */
  private pararConversa(conversationId: string) {
    const botId = botOfConversation(conversationId);
    if (botId) {
      this.sendNode(botId, { type: "abort", conversationId });
      this.finalizeStreams(botId);
    }
    for (const a of this.db.pendingApprovals().filter((x) => x.conversationId === conversationId)) {
      this.db.cancelApproval(a.id);
      this.broadcastUi({ type: "approval.resolved", requestId: a.id, allow: false });
    }
    for (const q of this.db.pendingQuestions().filter((x) => x.conversationId === conversationId)) {
      this.db.cancelQuestion(q.id);
      this.broadcastUi({ type: "question.resolved", questionId: q.id, answer: "" });
    }
  }

  /** Manda o nó trocar o histórico dele pelo que sobrou aqui. */
  private sincronizarHistorico(conversationId: string) {
    const botId = botOfConversation(conversationId);
    if (botId) this.sendNode(botId, { type: "history.reset", conversationId, messages: this.historicoPara(conversationId) });
    this.broadcastUi({ type: "conversation.changed", conversationId });
  }

  rewind(conversationId: string, messageId: string, include: "this" | "after" = "after") {
    this.pararConversa(conversationId);
    const r = this.db.rewind(conversationId, messageId, include);
    this.db.audit(botOfConversation(conversationId), "chat.rewind", { conversationId, messageId, include, afetadas: r.afetadas });
    this.sincronizarHistorico(conversationId);
    return r;
  }

  unrewind(conversationId: string, token: number) {
    const voltaram = this.db.unrewind(conversationId, token);
    this.db.audit(botOfConversation(conversationId), "chat.unrewind", { conversationId, voltaram });
    this.sincronizarHistorico(conversationId);
    return voltaram;
  }

  deleteMessage(messageId: string) {
    const m = this.db.getMessage(messageId);
    if (!m) return undefined;
    this.db.softDeleteMessage(messageId);
    this.db.audit(botOfConversation(m.conversationId), "chat.message.deleted", { conversationId: m.conversationId, messageId });
    this.sincronizarHistorico(m.conversationId);
    return m;
  }

  pinMessage(messageId: string, pinned: boolean) {
    const m = this.db.getMessage(messageId);
    if (!m) return undefined;
    this.db.setPinned(messageId, pinned);
    this.broadcastUi({ type: "conversation.changed", conversationId: m.conversationId });
    return { ...m, pinned };
  }

  /** Edita um pedido do chefe: rebobina até antes dele e manda a nova versão ao bot. */
  editMessage(messageId: string, text: string) {
    const m = this.db.getMessage(messageId);
    if (!m || m.sender.kind !== "user") return undefined;
    const r = this.rewind(m.conversationId, messageId, "this");
    const novo = this.sendUserMessage(m.conversationId, text, undefined, m.sender);
    this.db.audit(botOfConversation(m.conversationId), "chat.message.edited", { conversationId: m.conversationId, messageId, novo: novo.id });
    return { ...novo, token: r.token };
  }

  /** Tenta de novo: descarta a resposta e reenvia o pedido que veio antes dela. */
  retryMessage(messageId: string) {
    const m = this.db.getMessage(messageId);
    if (!m) return undefined;
    const todas = this.db.getMessages(m.conversationId, 200);
    const i = todas.findIndex((x) => x.id === messageId);
    const pedido = [...todas.slice(0, i)].reverse().find((x) => x.sender.kind === "user");
    if (!pedido) return undefined;
    const r = this.rewind(m.conversationId, pedido.id, "after");
    const novo = this.sendUserMessage(m.conversationId, pedido.text, undefined, pedido.sender);
    this.db.audit(botOfConversation(m.conversationId), "chat.message.retry", { conversationId: m.conversationId, messageId });
    return { ...novo, token: r.token };
  }

  /**
   * Anota que este bot mexeu no PC da empresa. Ferramenta que não é de tela
   * (ou bot sem empresa) não entra. Devolve o uso atualizado, ou null.
   */
  anotarTela(botId: string, ferramenta: string, input: unknown): UsoDoPc | null {
    const emp = this.empresaDe(botId).id;
    if (!emp) return null;
    const uso = this.usos.registrar(emp, { botId, nome: this.botSender(botId).name, ferramenta, input });
    if (uso) this.broadcastUi({ type: "pc.uso", empresaId: emp, uso });
    return uso;
  }

  usoDoPc(empresaId: string): UsoDoPc {
    return this.usos.ver(empresaId);
  }

  private botsParaPc(): BotParaPc[] {
    const managed = new Map(this.db.listManaged().map((d: { id: string; name?: string; gerente?: boolean; createdAt?: number }) => [d.id, d]));
    return this.db.listBots().map((b) => ({
      id: b.id,
      nome: managed.get(b.id)?.name ?? b.name,
      empresaId: b.empresaId ?? null,
      gerente: !!managed.get(b.id)?.gerente,
      createdAt: managed.get(b.id)?.createdAt ?? 0,
    }));
  }

  /** O bot ainda está no meio de uma tarefa: o PC dele não conta como ocioso. */
  estaOcupado(botId: string): boolean {
    return !!this.nodes.get(botId)?.busy;
  }

  private async fonteDaTela(empresaId: string, onFrame: (jpeg: Buffer) => boolean) {
    const padrao = botPadraoDaEmpresa(empresaId, this.botsParaPc());
    const m = padrao ? await acordarPc(padrao) : await estadoDaMaquina(empresaId);
    if (!m) return { erro: "o PC desta empresa está desligado" };
    if (m.estado === "sem-docker") return { erro: "o Docker não está no ar nesta máquina" };
    if (m.estado !== "ligada") return { erro: m.erro || "o PC desta empresa está desligado" };
    if (!portaCdpPermitida(m.portaCdp)) return { erro: "a porta do navegador está fora da faixa deste Hub" };
    return ligarCdp(m.portaCdp, onFrame, limitesDaGravacao().fps);
  }

  private gravadorDe(onde: "pc" | "celular") {
    return onde === "celular" ? this.gravacoesCelular : this.gravacoes;
  }

  async iniciarGravacao(p: { empresaId: string; por: string; nome: string; conversationId?: string; onde?: "pc" | "celular" }) {
    const onde = p.onde === "celular" ? "celular" : "pc";
    const r = await this.gravadorDe(onde).iniciar(p);
    if (r.ok) this.broadcastUi({ type: "pc.gravacao", empresaId: p.empresaId, gravando: true, desde: r.desde, nome: p.nome, onde });
    return r;
  }

  estadoGravacao(empresaId: string, onde: "pc" | "celular" = "pc") {
    return this.gravadorDe(onde).estado(empresaId);
  }

  private async atenderGravacao(botId: string, acao: "iniciar" | "parar" | "estado", conversationId?: string, legenda?: string, onde: "pc" | "celular" = "pc"): Promise<{ ok: boolean; texto: string }> {
    const emp = this.empresaDe(botId).id;
    if (!emp) return { ok: false, texto: "Você não está numa empresa, então não tem tela para gravar." };
    const qual = onde === "celular" ? "celular" : "PC";
    if (acao === "estado") {
      const e = this.estadoGravacao(emp, onde);
      return { ok: true, texto: e.gravando ? `Gravando o ${qual} há ${e.segundos ?? 0}s (${e.nome ?? "alguém"}).` : `O ${qual} não está sendo gravado.` };
    }
    if (acao === "iniciar") {
      const r = await this.iniciarGravacao({ empresaId: emp, por: botId, nome: this.botSender(botId).name, conversationId, onde });
      return r.ok
        ? { ok: true, texto: `Gravando a tela do ${qual}. Quando terminar, chame gravar_tela com acao parar e uma legenda de uma linha do que fez.` }
        : { ok: false, texto: r.erro };
    }
    const r = await this.pararGravacao(emp, legenda, onde);
    return r.ok
      ? { ok: true, texto: `Vídeo no chat (${r.segundos}s, ${r.mb} MB) com ${r.prints} print(s). A legenda já está na mensagem.` }
      : { ok: false, texto: r.erro };
  }

  /**
   * Fecha a gravação, monta o mp4 e manda no chat com um ou dois prints.
   * A legenda é a frase do bot (ou do chefe) sobre o que aconteceu na tela.
   */
  async pararGravacao(empresaId: string, legenda?: string, onde: "pc" | "celular" = "pc") {
    const fim = this.gravadorDe(onde).parar(empresaId, legenda);
    if (!fim.ok) return fim;
    if (!(await temFfmpeg())) return { ok: false as const, erro: "ffmpeg não está no Hub. Sem ele não dá para montar o mp4." };
    const mp4 = await codificarMp4(fim.frames, limitesDaGravacao().fps);
    if (!mp4.ok) return mp4;
    const lim = limitesDaGravacao();
    if (mp4.data.length > lim.maxBytes) {
      return { ok: false as const, erro: `o vídeo passou de ${Math.round(lim.maxBytes / (1024 * 1024))} MB. Grave um trecho mais curto.` };
    }
    const dono = fim.por === "chefe" ? "user" : fim.por;
    const video = this.saveFile(dono, `tela-${fim.empresaId}.mp4`, "video/mp4", mp4.data);
    const prints = fim.chaves.slice(0, 2).map((quadro, i) => {
      const png = quadro[0] === 0x89 && quadro[1] === 0x50;
      return this.saveFile(dono, `tela-${fim.empresaId}-${i + 1}.${png ? "png" : "jpg"}`, png ? "image/png" : "image/jpeg", quadro);
    });
    const texto = fim.legenda || (onde === "celular" ? "Gravação da tela do celular" : "Gravação da tela do PC");
    const conv = fim.conversationId || (fim.por !== "chefe" ? dmConversation(fim.por) : "");
    if (conv) {
      const sender = fim.por === "chefe"
        ? { kind: "user" as const, id: "user", name: this.userName }
        : this.botSender(fim.por);
      this.storeMessage(conv, sender, texto, {
        files: [video, ...prints].map((f) => ({ id: f.id, name: f.name, url: f.url, mime: f.mime })),
        gravacao: { segundos: fim.segundos, empresaId: fim.empresaId },
      });
    }
    this.broadcastUi({ type: "pc.gravacao", empresaId: fim.empresaId, gravando: false, onde });
    return {
      ok: true as const,
      segundos: fim.segundos,
      url: video.url,
      nome: video.name,
      mb: Math.round((mp4.data.length / (1024 * 1024)) * 10) / 10,
      prints: prints.length,
    };
  }

  private chaveCelular(empresaId: string) { return `celular:${empresaId}`; }

  vinculoDoCelular(empresaId: string): VinculoCelular | null {
    return this.db.getSetting<VinculoCelular>(this.chaveCelular(empresaId)) ?? null;
  }

  guardarCelular(empresaId: string, v: VinculoCelular) {
    this.db.setSetting(this.chaveCelular(empresaId), v);
    return v;
  }

  esquecerCelular(empresaId: string) {
    this.db.setSetting(this.chaveCelular(empresaId), null);
    this.travaCelular.soltar(empresaId, "chefe");
  }

  async descobrirCelulares() {
    const [lista, texto, naRede] = await Promise.all([celular.listar(), celular.mdns(), celular.varrerRedeLocal()]);
    const ja = new Set(lista.map((a) => a.serial));
    const extras = naRede
      .filter((h) => !ja.has(`${h}:5555`))
      .map((h) => ({ serial: `${h}:5555`, modelo: "Android na rede (porta 5555)", estado: "na-rede", viaWifi: true }));
    return { aparelhos: [...lista, ...extras], servicos: lerMdns(texto), adb: celular.temAdb() };
  }

  async parearCelular(empresaId: string, bruto: { host?: string; porta?: number; codigo?: string; texto?: string }) {
    const lido = lerPareamento(bruto.texto || bruto.codigo || "");
    const host = bruto.host || lido?.host;
    const porta = Number(bruto.porta || lido?.porta);
    const codigo = lido?.codigo || String(bruto.codigo ?? "").replace(/\s/g, "");
    if (!host || !porta || !/^\d{6}$/.test(codigo)) return { ok: false as const, erro: "preciso do endereço, da porta e do código de 6 dígitos" };
    const r = await celular.parear(host, porta, codigo);
    if (!r.ok) return { ok: false as const, erro: r.msg || "não pareou" };
    const md = lerMdns(await celular.mdns());
    const alvo = md.find((s) => s.tipo === "connect" && (lido?.nome ? s.nome === lido.nome : s.host === host));
    if (alvo) {
      await celular.conectar(`${alvo.host}:${alvo.porta}`);
      const serial = `${alvo.host}:${alvo.porta}`;
      const modelo = (await celular.modeloDe(serial)) || alvo.nome;
      const v = this.guardarCelular(empresaId, { nomeMdns: alvo.nome, modelo, serial, host: alvo.host, porta: alvo.porta });
      return { ok: true as const, vinculo: v };
    }
    return { ok: true as const, vinculo: null, aviso: "pareou, mas ainda não achei o aparelho para conectar. Toque em Atualizar." };
  }

  async vincularCelular(empresaId: string, serial: string) {
    const lista = await celular.listar();
    const a = lista.find((x) => x.serial === serial);
    if (!a || a.estado !== "device") return { ok: false as const, erro: "esse aparelho não está disponível" };
    const modelo = a.modelo || (await celular.modeloDe(serial)) || serial;
    const host = serial.includes(":") ? serial.split(":")[0] : undefined;
    const porta = serial.includes(":") ? Number(serial.split(":")[1]) : undefined;
    const v = this.guardarCelular(empresaId, { modelo, serial, host, porta: porta || undefined });
    return { ok: true as const, vinculo: v };
  }

  async reconectarCelulares() {
    const empresas = this.db.listEmpresas();
    const salvos = empresas.map((e) => ({ id: e.id, v: this.vinculoDoCelular(e.id) })).filter((x) => x.v);
    if (!salvos.length || !celular.temAdb()) return;
    const online = new Set((await celular.listar()).filter((a) => a.estado === "device").map((a) => a.serial));
    const faltam = salvos.filter((s) => s.v && !online.has(s.v.serial));
    if (!faltam.length) return;
    const servicos = lerMdns(await celular.mdns());
    for (const s of faltam) {
      const alvo = enderecoParaReconectar(s.v!, servicos);
      if (!alvo) continue;
      const serial = `${alvo.host}:${alvo.porta}`;
      const c = await celular.conectar(serial);
      if (!c.ok) continue;
      this.guardarCelular(s.id, { ...s.v!, serial, host: alvo.host, porta: alvo.porta });
    }
  }

  private async fonteDoCelular(empresaId: string, onFrame: (jpeg: Buffer) => boolean) {
    const v = this.vinculoDoCelular(empresaId);
    if (!v) return { erro: "esta empresa ainda não tem celular vinculado" };
    let vivo = true;
    const laco = async () => {
      while (vivo) {
        const png = await celular.tela(v.serial);
        if (!png) { await new Promise((r) => setTimeout(r, 700)); continue; }
        if (!onFrame(png)) { vivo = false; return; }
        await new Promise((r) => setTimeout(r, 700));
      }
    };
    void laco();
    return { cortar: () => { vivo = false; } };
  }

  anotarCelular(botId: string, ferramenta: string, input: unknown) {
    if (String(ferramenta).replace(/^.*_/, "") !== "celular") return null;
    const emp = this.empresaDe(botId).id;
    if (!emp) return null;
    const acao = input && typeof input === "object" ? String((input as any).acao ?? "") : "";
    const uso = this.usosCelular.registrarDireto(emp, {
      botId, nome: this.botSender(botId).name, ferramenta: "celular",
      resumo: resumoDoCelular(acao, acao === "digitar" ? "" : String((input as any)?.pacote ?? (input as any)?.tecla ?? "")),
      quando: Date.now(),
    });
    if (uso) this.broadcastUi({ type: "celular.uso", empresaId: emp, uso });
    return uso;
  }

  usoDoCelular(empresaId: string) {
    return this.usosCelular.ver(empresaId);
  }

  assumirCelular(empresaId: string, assumir: boolean) {
    if (assumir) return this.travaCelular.pegar(empresaId, "chefe", "você", true);
    this.travaCelular.soltar(empresaId, "chefe");
    return { ok: true as const };
  }

  private async atenderCelular(botId: string, msg: Extract<NodeToHub, { type: "celular" }>): Promise<{ ok: boolean; texto: string }> {
    const emp = this.empresaDe(botId).id;
    if (!emp) return { ok: false, texto: "Você não está numa empresa, então não tem celular." };
    const v = this.vinculoDoCelular(emp);
    if (!v) return { ok: false, texto: "O celular desta empresa ainda não foi vinculado. O chefe liga em Empresas → Celular da empresa." };
    const acao = String(msg.acao || "estado");
    if (acaoSensivel(acao, msg.texto, msg.pacote)) {
      if (!msg.aprovado) return { ok: false, texto: "Essa ação no celular (pagamento, apagar ou enviar) precisa do OK do chefe. Peça com request_approval e tente de novo." };
      const gate = this.liberarAcaoSensivel(botId, "celular", { acao, texto: msg.texto, pacote: msg.pacote }, `${acao} ${msg.texto ?? ""} ${msg.pacote ?? ""}`);
      if (!gate.ok) return { ok: false, texto: gate.texto };
    }
    if (acao !== "estado" && acao !== "print" && acao !== "arvore") {
      const trava = this.travaCelular.pegar(emp, botId, this.botSender(botId).name, false);
      if (!trava.ok) return { ok: false, texto: `${trava.nome} está no celular agora. Espere um instante e tente de novo.` };
    }
    if (acao === "estado") {
      const lista = await celular.listar();
      const on = lista.some((a) => a.serial === v.serial && a.estado === "device");
      const t = this.travaCelular.ver(emp);
      return { ok: true, texto: `${v.modelo} (${v.serial}) ${on ? "online" : "offline"}${t ? `. Quem está nele: ${t.nome}` : ""}` };
    }
    if (acao === "print") {
      const png = await celular.tela(v.serial);
      if (!png) return { ok: false, texto: "não consegui fotografar a tela do celular" };
      const f = this.saveFile(botId, `celular-${emp}.png`, "image/png", png);
      if (msg.conversationId) this.storeMessage(msg.conversationId, this.botSender(botId), "Tela do celular", { files: [{ id: f.id, name: f.name, url: f.url, mime: f.mime }] });
      return { ok: true, texto: "Mandei a foto da tela no chat." };
    }
    if (acao === "arvore") {
      const x = await celular.arvore(v.serial);
      return x ? { ok: true, texto: x.slice(0, 8000) } : { ok: false, texto: "não consegui ler a árvore da tela" };
    }
    if (acao === "tocar") return { ok: await celular.tocar(v.serial, Number(msg.x), Number(msg.y)), texto: "toquei" };
    if (acao === "deslizar") return { ok: await celular.deslizar(v.serial, Number(msg.x), Number(msg.y), Number(msg.x2), Number(msg.y2)), texto: "deslizei" };
    if (acao === "digitar") return { ok: await celular.digitar(v.serial, String(msg.texto ?? "")), texto: "digitei" };
    if (acao === "tecla") return { ok: await celular.tecla(v.serial, String(msg.tecla ?? "")), texto: "tecla enviada" };
    if (acao === "abrir") {
      if (!pacoteValido(String(msg.pacote ?? ""))) return { ok: false, texto: "pacote inválido" };
      return { ok: await celular.abrirApp(v.serial, String(msg.pacote)), texto: `pedi para abrir ${msg.pacote}` };
    }
    return { ok: false, texto: "acao deve ser estado, print, arvore, tocar, deslizar, digitar, tecla ou abrir" };
  }

  abrirJanelaDoCelular(empresaId: string): { ok: boolean; erro?: string } {
    const v = this.vinculoDoCelular(empresaId);
    if (!v) return { ok: false, erro: "esta empresa não tem celular vinculado" };
    const exe = path.join(raizDoProjeto(), "ferramentas", "scrcpy", process.platform === "win32" ? "scrcpy.exe" : "scrcpy");
    if (!fs.existsSync(exe)) return { ok: false, erro: "não achei o scrcpy em ferramentas/scrcpy" };
    const args = argumentosScrcpy({ serial: v.serial, titulo: `Celular — ${empresaId}`, audio: false });
    const child = spawn(exe, args, { cwd: path.dirname(exe), detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    return { ok: true };
  }

  botSender(botId: string): Sender {
    const b = this.nodes.get(botId)?.bot ?? this.db.listBots().find((x) => x.id === botId);
    return { kind: "bot", id: botId, name: b?.name ?? botId };
  }

  // ---------- nós ----------

  handleNodeConnection(ws: WebSocket) {
    let botId: string | null = null;
    ws.on("message", (raw) => {
      let msg: NodeToHub;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === "hello") {
        if (msg.protocol !== PROTOCOL_VERSION) {
          ws.send(JSON.stringify({ type: "error", message: `Protocolo ${msg.protocol} incompatível (hub usa ${PROTOCOL_VERSION})` } satisfies HubToNode));
          return ws.close();
        }
        if (!tokenAllows(msg.bot.id, msg.token)) {
          this.db.audit(msg.bot.id, "node.rejected", { reason: "token inválido" });
          ws.send(JSON.stringify({ type: "error", message: "Token inválido para este bot" } satisfies HubToNode));
          return ws.close();
        }
        // Bot excluido NAO ressuscita. O no dele pode estar vivo (em outro PC, ou por ter
        // escapado do kill aqui) e volta dizendo "ola" — e o Hub recriava a linha em `bots`,
        // fazendo o bot reaparecer sozinho no painel minutos depois de excluido.
        // Agora a porta fica fechada e o no recebe ordem de encerrar de vez.
        if (this.db.estaExcluido(msg.bot.id)) {
          this.db.audit(msg.bot.id, "node.rejected", { reason: "bot excluído" });
          ws.send(JSON.stringify({ type: "error", message: `O bot "${msg.bot.id}" foi excluído no Hub. Este nó vai encerrar.`, fatal: true } satisfies HubToNode));
          return ws.close();
        }
        const old = this.nodes.get(msg.bot.id);
        if (old && old.ws !== ws) { try { old.ws.close(); } catch {} }
        botId = msg.bot.id;
        this.nodes.set(botId, { ws, bot: msg.bot, engine: msg.engine, provider: msg.provider, model: msg.model, status: "Disponível", busy: false, connectedAt: Date.now(), controlMode: isControlMode(msg.controlMode) ? msg.controlMode : "supervisionado" });
        this.db.upsertBot(msg.bot, { engine: msg.engine, provider: msg.provider, model: msg.model });
        this.db.audit(botId, "node.connected", { engine: msg.engine, provider: msg.provider, model: msg.model, controlMode: msg.controlMode });
        ws.send(JSON.stringify({ type: "hello.ok", botId, hubVersion: config.version, knowledge: this.knowledgeIndex(botId), hubPid: process.pid } satisfies HubToNode));
        ws.send(JSON.stringify({ type: "control", override: this.control().global } satisfies HubToNode));
        this.botUpdate(botId);
        this.colab.reidratar(botId);
        this.tarefas.aoConectar(botId);
        console.log(`[hub] bot online: ${msg.bot.name} (${botId}) engine=${msg.engine} ${msg.provider}/${msg.model}`);
        return;
      }
      if (!botId) return; // ignora tudo antes do hello
      try { this.onNodeMessage(botId, msg); }
      catch (e) { console.error(`[hub] erro ao processar ${msg.type} de ${botId}: ${(e as Error).message}`); }
    });
    ws.on("close", () => {
      if (!botId) return;
      const n = this.nodes.get(botId);
      if (n && n.ws === ws) {
        this.nodes.delete(botId);
        this.db.audit(botId, "node.disconnected");
        this.botUpdate(botId);
        console.log(`[hub] bot offline: ${botId}`);
        // asks pendentes para este bot falham
        for (const [key, p] of this.pendingAsks) {
          if (p.targetBotId === botId) {
            clearTimeout(p.timer);
            this.pendingAsks.delete(key);
            this.sendNode(p.fromBotId, { type: "result", callId: p.callId, ok: false, data: `O bot ${botId} ficou offline antes de responder.` });
          }
        }
      }
    });
  }

  private onNodeMessage(botId: string, msg: NodeToHub) {
    const node = this.nodes.get(botId);
    if (!node) return;
    switch (msg.type) {
      case "heartbeat":
        this.db.touchBot(botId);
        return;
      case "audit":
        this.db.audit(botId, msg.action, msg.detail);
        return;
      case "generate_media": {
        void this.generateMedia(botId, msg.conversationId, msg.kind, msg.prompt, { refFileId: msg.refFileId, seconds: msg.seconds, aspect: msg.aspect })
          .then((r) => this.sendNode(botId, { type: "result", callId: msg.callId, ok: r.ok, data: r.ok ? `${msg.kind === "image" ? "Imagem" : "Vídeo"} gerado por ${r.provider} e enviado ao chat: ${r.file.name} (${config.publicUrl}${r.file.url})${r.note ? ` — ${r.note}` : ""}` : r.error }));
        return;
      }
      case "status":
        this.definirAtividade(botId, msg.text, msg.busy, msg.fase);
        return;
      case "event":
        return this.onBotEvent(botId, msg.conversationId, msg.event);
      case "ask_bot":
        return this.onAskBot(botId, msg);
      case "list_bots":
        return this.sendNode(botId, { type: "result", callId: msg.callId, ok: true, data: this.colegasDe(botId).map((b) => ({ id: b.id, name: b.name, role: b.role, online: b.online, status: b.status })) });
      case "manage_bot": {
        // Um bot não se exclui nem se para a si mesmo: ficaria metade feito, sem ninguém para terminar.
        if (msg.bot === botId) {
          return this.sendNode(botId, { type: "result", callId: msg.callId, ok: false, data: "Você não pode fazer isso com você mesmo. Peça ao chefe." });
        }
        if (msg.acao === "excluir") {
          const gate = this.liberarAcaoSensivel(botId, "gerenciar_bot", { acao: "excluir" }, "excluir");
          if (!gate.ok) return this.sendNode(botId, { type: "result", callId: msg.callId, ok: false, data: gate.texto });
        }
        void this.manageBot(msg.acao, msg.bot, msg.apagarArquivos === true)
          .then((r) => this.sendNode(botId, { type: "result", callId: msg.callId, ok: r.ok, data: r.msg }))
          .catch((e) => this.sendNode(botId, { type: "result", callId: msg.callId, ok: false, data: textoSeguro(e) }));
        return;
      }
      case "criar_bot": {
        // So quem manda na equipe monta a equipe. Um atendente criando bots sozinho
        // viraria uma fabrica de bots sem dono e sem empresa.
        if (!this.ehGerente(botId)) {
          return this.sendNode(botId, { type: "result", callId: msg.callId, ok: false, data: "So o Gerente Geral cria bots. Peca a ele, ou ao chefe pelo painel." });
        }
        void this.criarBot({ nome: msg.nome, funcao: msg.funcao, persona: msg.persona, empresaId: this.empresaDe(botId).id, gerenteId: botId })
          .then((r) => this.sendNode(botId, { type: "result", callId: msg.callId, ok: r.ok, data: r.msg }))
          .catch((e) => this.sendNode(botId, { type: "result", callId: msg.callId, ok: false, data: textoSeguro(e) }));
        return;
      }
      case "remember":
        this.db.remember(botId, msg.key, msg.value, this.empresaDe(botId).id ?? "");
        this.db.audit(botId, "memory.set", { key: msg.key });
        return;
      case "search_knowledge": {
        const data = msg.id ? this.lerSaberTexto(botId, msg.id, msg.parte) : this.buscarSaberTexto(botId, msg.query, msg.limit);
        return this.sendNode(botId, { type: "result", callId: msg.callId, ok: true, data });
      }
      case "uso": {
        const emp = this.empresaDe(botId).id;
        const custo = custoMilesimos(msg.modelo, msg);
        if (!emp) { this.db.audit(botId, "uso.sem-empresa", { modelo: msg.modelo, custo }); return; }
        const cob = this.db.cobrarMensagem(emp);
        this.db.registrarConsumo({
          empresaId: emp, botId, modelo: msg.modelo,
          entrada: msg.entrada ?? 0, saida: msg.saida ?? 0, cacheLido: msg.cacheLido ?? 0, cacheGravado: msg.cacheGravado ?? 0,
          custoMilesimos: custo, cobradoCentavos: cob.cobrado,
        });
        this.broadcastUi({ type: "creditos", empresaId: emp, saldoCentavos: cob.saldo });
        return;
      }
      case "fill_credential": {
        void this.cofre.preencher({ botId, empresaId: this.empresaDe(botId).id, site: msg.site, campo: msg.campo })
          .then((texto) => this.sendNode(botId, { type: "result", callId: msg.callId, ok: texto === "ok", data: texto }))
          .catch(() => this.sendNode(botId, { type: "result", callId: msg.callId, ok: false, data: "erro: não consegui preencher" }));
        return;
      }
      case "gravar_tela": {
        const onde = msg.onde === "celular" ? "celular" : "pc";
        void this.atenderGravacao(botId, msg.acao, msg.conversationId, msg.legenda, onde)
          .then((r) => this.sendNode(botId, { type: "result", callId: msg.callId, ok: r.ok, data: r.texto }))
          .catch((e) => this.sendNode(botId, { type: "result", callId: msg.callId, ok: false, data: textoSeguro(e) }));
        return;
      }
      case "celular": {
        void this.atenderCelular(botId, msg)
          .then((r) => this.sendNode(botId, { type: "result", callId: msg.callId, ok: r.ok, data: r.texto }))
          .catch((e) => this.sendNode(botId, { type: "result", callId: msg.callId, ok: false, data: textoSeguro(e) }));
        return;
      }
      case "whatsapp_send": {
        // Cada empresa fala pela sua conta. Bot do sistema nao tem conta propria.
        const emp = this.empresaDe(botId).id;
        if (!emp) return this.sendNode(botId, { type: "result", callId: msg.callId, ok: false, data: "Você é bot do sistema e não tem WhatsApp próprio. Quem manda WhatsApp é bot de empresa." });
        const liberado = this.podeFalarComCliente(emp);
        if (!liberado.ok) return this.sendNode(botId, { type: "result", callId: msg.callId, ok: false, data: `Não enviei: esta empresa ainda não aceitou os termos de uso de dados (falta: ${liberado.falta.join(", ")}). O chefe precisa abrir Leis e consentimentos no painel.` });
        const acao = msg.acao ?? "enviar";
        if (acao !== "estado") {
          const gate = this.liberarAcaoSensivel(botId, "whatsapp", { acao, texto: msg.texto, para: msg.para }, acao);
          if (!gate.ok) return this.sendNode(botId, { type: "result", callId: msg.callId, ok: false, data: gate.texto });
        }
        if (acao === "estado") {
          const e = this.whats.estado(emp);
          const texto = e.estado === "conectado"
            ? `WhatsApp desta empresa conectado no número ${e.numero ?? "(desconhecido)"}.`
            : e.estado === "qr" ? "O WhatsApp desta empresa está esperando o chefe escanear o QR no painel (Empresas)."
            : e.estado === "conectando" ? "O WhatsApp desta empresa está conectando."
            : "O WhatsApp desta empresa está desligado. O chefe liga em Empresas → Gerar QR.";
          return this.sendNode(botId, { type: "result", callId: msg.callId, ok: e.estado === "conectado", data: texto });
        }
        const envio = msg.arquivo
          ? this.whats.enviarArquivo(emp, String(msg.para ?? ""), msg.arquivo)
          : this.whats.enviar(emp, String(msg.para ?? ""), String(msg.texto ?? ""));
        void envio
          .then((r) => this.sendNode(botId, { type: "result", callId: msg.callId, ok: r.ok, data: r.detalhe }))
          .catch((e) => this.sendNode(botId, { type: "result", callId: msg.callId, ok: false, data: textoSeguro(e) }));
        return;
      }
      case "learn_knowledge": {
        const data = this.aprenderSaberTexto(botId, { titulo: msg.titulo, resumo: msg.resumo, conteudo: msg.conteudo, tipo: msg.tipo, tags: msg.tags });
        return this.sendNode(botId, { type: "result", callId: msg.callId, ok: true, data });
      }
      case "recall":
        return this.sendNode(botId, { type: "result", callId: msg.callId, ok: true, data: (() => { const e = this.empresaDe(botId).id ?? ""; return msg.key.endsWith("*") ? this.db.recallPrefix(msg.key.slice(0, -1), e) : this.db.recall(msg.key, e); })() });
      case "notify":
        this.broadcastUi({ type: "notify", botId, text: msg.text });
        this.storeMessage(dmConversation(botId), this.botSender(botId), msg.text, { notify: true });
        return;
      case "upload": {
        try {
          const f = this.saveFile(botId, msg.name, msg.mime, Buffer.from(msg.dataBase64, "base64"));
          this.storeMessage(msg.conversationId, this.botSender(botId), msg.caption ?? `Enviou ${f.name}`, {
            files: [{ id: f.id, name: f.name, url: f.url, mime: f.mime }],
            ...(msg.tela ? { tela: true } : {}),
          });
          this.db.audit(botId, "file.sent", { name: f.name, size: f.size });
          return this.sendNode(botId, { type: "result", callId: msg.callId, ok: true, data: `Arquivo enviado ao chefe: ${f.name} (${config.publicUrl}${f.url})` });
        } catch (e) {
          return this.sendNode(botId, { type: "result", callId: msg.callId, ok: false, data: textoSeguro(e) });
        }
      }
      case "schedule": {
        const r = this.createRoutine(botId, msg.name, msg.cron, msg.prompt);
        return this.sendNode(botId, { type: "result", callId: msg.callId, ok: !("error" in r), data: "error" in r ? r.error : `Rotina "${r.name}" criada (id ${r.id}); próxima execução ${new Date(r.nextRun!).toLocaleString("pt-BR")}` });
      }
      case "list_routines":
        return this.sendNode(botId, { type: "result", callId: msg.callId, ok: true, data: this.db.listRoutines(botId) });
      case "cancel_routine": {
        const r = this.db.listRoutines(botId).find((x) => x.id === msg.id);
        if (!r) return this.sendNode(botId, { type: "result", callId: msg.callId, ok: false, data: "rotina não encontrada (ou não é sua)" });
        this.deleteRoutine(msg.id);
        return this.sendNode(botId, { type: "result", callId: msg.callId, ok: true, data: "rotina cancelada" });
      }
    }
  }

  /** Resposta de um bot numa conversa de canal → webhook de saída (o CRM entrega no WhatsApp). */
  private async channelOutgoing(conversationId: string, botId: string, text: string) {
    const url = config.channelWebhook;
    if (!url) return;
    const [, channel, from] = conversationId.split(":");
    try {
      await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(config.channelWebhookKey ? { authorization: `Bearer ${config.channelWebhookKey}` } : {}) }, body: JSON.stringify({ channel, to: from, botId, text }), signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      this.storeMessage(conversationId, SYSTEM, `Falha ao entregar no canal ${channel}: ${textoSeguro(e)}`, { error: true });
    }
  }

  private onBotEvent(botId: string, conversationId: string, ev: BotEvent) {
    // Chegou depois do "parar": o nó ainda estava desligando. Nada disso vira texto,
    // fala ou cartão — senão o chefe para e o bot continua escrevendo mais um pouco.
    if ("messageId" in ev && ev.messageId && this.encerrados.has(ev.messageId)) return;
    const sender = this.botSender(botId);
    switch (ev.kind) {
      case "text.delta": {
        const s = this.ensureStream(ev.messageId, conversationId, botId, sender);
        s.text += ev.text;
        // Só sai o que já é resposta. O raciocínio em inglês fica no filtro até o fim.
        const { answer } = splitThoughts(s.text, { permiteIngles: this.falamOutroIdioma().has(botId), aoVivo: true });
        const mostrado = s.mostrado ?? "";
        // Frase pela metade que ainda pode ser raciocínio não vai para a tela.
        // Com 40 caracteres ou um ponto final, já é resposta e pode ir saindo.
        const pronto = /[.!?…]\s*$/.test(answer) || answer.length >= 40;
        if (pronto && answer !== mostrado) {
          if (answer.startsWith(mostrado)) {
            this.broadcastUi({ type: "message.delta", conversationId, messageId: ev.messageId, text: answer.slice(mostrado.length) });
          } else {
            this.broadcastUi({ type: "message.delta", conversationId, messageId: ev.messageId, text: answer, replace: true });
          }
          s.mostrado = answer;
        }
        this.falaEmTempoReal(conversationId, botId, ev.messageId, s);
        return;
      }
      case "text.note": {
        const frase = ev.text.trim();
        if (frase) this.storeMessage(conversationId, sender, frase, { nota: true }, ev.messageId);
        return;
      }
      case "text.done": {
        const s = this.streams.get(ev.messageId);
        const raw = ev.text || s?.text || "";
        const { answer, thought } = splitThoughts(raw, { permiteIngles: this.falamOutroIdioma().has(botId) });
        const text = answer;
        const extra: Record<string, unknown> = {};
        if (thought) extra.thought = thought;
        if (!text) extra.hidden = true;
        // a voz vem primeiro: numa chamada, o último pedaço não pode chegar depois do texto
        this.fecharFala(conversationId, botId, ev.messageId, text, s?.falado ?? "");
        if (s) {
          this.streams.delete(ev.messageId);
          const meta = { streaming: false, ...(s.tools?.length ? { tools: s.tools } : {}), ...extra };
          this.db.updateMessageText(ev.messageId, text, meta);
          this.broadcastUi({ type: "message", message: { id: ev.messageId, conversationId, sender, text, createdAt: s.createdAt, meta } });
        } else if (raw) {
          this.storeMessage(conversationId, sender, text, Object.keys(extra).length ? extra : undefined, ev.messageId);
        }
        this.botUpdate(botId);
        this.fanOutGroupReply(conversationId, botId, text, ev.messageId);
        this.sala.respondeu(conversationId, botId, text);
        if (conversationId.startsWith("channel:")) void this.channelOutgoing(conversationId, botId, text);
        for (const fn of this.replyListeners) { try { fn(conversationId, botId, text, thought || undefined); } catch { /* ouvinte não derruba o hub */ } }
        // resposta de um ask_bot?
        const key = `${conversationId}:${botId}`;
        const p = this.pendingAsks.get(key);
        if (p) {
          clearTimeout(p.timer);
          this.pendingAsks.delete(key);
          this.sendNode(p.fromBotId, { type: "result", callId: p.callId, ok: true, data: text });
        }
        this.tarefas.aoResponder(botId, conversationId, text);
        return;
      }
      case "tool.start": {
        this.ensureStream(ev.messageId, conversationId, botId, sender);
        const entrada = semSegredo(ev.input);
        this.recordTool(ev.messageId, { callId: ev.callId, tool: ev.tool, input: entrada, done: false });
        this.broadcastUi({ type: "tool", conversationId, messageId: ev.messageId, callId: ev.callId, tool: ev.tool, phase: "start", input: entrada });
        this.db.audit(botId, "tool.start", { tool: ev.tool, input: entrada, conversationId });
        this.anotarTela(botId, ev.tool, ev.input);
        this.anotarCelular(botId, ev.tool, ev.input);
        this.definirAtividade(botId, "Trabalhando", true, "trabalhando");
        return;
      }
      case "tool.done": {
        this.ensureStream(ev.messageId, conversationId, botId, sender);
        const saida = redigir(ev.output).slice(0, 4000);
        this.recordTool(ev.messageId, { callId: ev.callId, tool: ev.tool, output: saida, ok: ev.ok, done: true });
        this.broadcastUi({ type: "tool", conversationId, messageId: ev.messageId, callId: ev.callId, tool: ev.tool, phase: "done", output: saida, ok: ev.ok });
        return;
      }
      case "approval.request": {
        const a: PendingApproval = { id: ev.requestId, botId, conversationId, tool: ev.tool, input: ev.input, risk: ev.risk, description: ev.description, createdAt: Date.now() };
        this.db.insertApproval(a);
        this.approvalOwner.set(a.id, botId);
        this.db.audit(botId, "approval.requested", { tool: ev.tool, input: ev.input, risk: ev.risk });
        this.broadcastUi({ type: "approval.request", approval: a });
        return;
      }
      case "question": {
        const q: PendingQuestion = { id: ev.questionId, botId, conversationId, question: ev.question, options: ev.options, createdAt: Date.now(), ...(ev.cartao ? { cartao: ev.cartao } : {}) };
        this.db.insertQuestion(q);
        this.questionOwner.set(q.id, botId);
        this.broadcastUi({ type: "question", question: q });
        return;
      }
      case "file":
        this.storeMessage(conversationId, sender, `Enviou ${ev.name}`, { file: { name: ev.name, path: ev.path, mime: ev.mime } });
        return;
      case "error":
        const msgErro = redigir(ev.message);
        this.storeMessage(conversationId, SYSTEM, `Erro em ${sender.name}: ${msgErro}`, { error: true });
        this.db.audit(botId, "error", { message: msgErro, conversationId });
        return;
    }
  }

  private onAskBot(fromBotId: string, msg: Extract<NodeToHub, { type: "ask_bot" }>) {
    const r = this.colab.enviar({
      de: fromBotId,
      para: msg.to,
      texto: msg.text,
      prioridade: msg.wait || msg.prioridade === true,
      profundidade: Number.isFinite(msg.profundidade) ? Number(msg.profundidade) : 0,
      contexto: msg.contexto,
    });
    if (!r.ok) return this.sendNode(fromBotId, { type: "result", callId: msg.callId, ok: false, data: r.erro });
    if (!msg.wait) return this.sendNode(fromBotId, { type: "result", callId: msg.callId, ok: true, data: r.aviso });
    const alvo = this.acharBotColab(fromBotId, msg.to);
    if ("erro" in alvo || !this.nodes.get(alvo.id)) {
      return this.sendNode(fromBotId, { type: "result", callId: msg.callId, ok: false, data: r.aviso });
    }
    const target = alvo.id;
    const conversationId = pairConversation(fromBotId, target);
    const key = `${conversationId}:${target}`;
    const old = this.pendingAsks.get(key);
    if (old) { clearTimeout(old.timer); this.sendNode(old.fromBotId, { type: "result", callId: old.callId, ok: false, data: "Substituído por uma nova pergunta." }); }
    const timer = setTimeout(() => {
      this.pendingAsks.delete(key);
      this.sendNode(fromBotId, { type: "result", callId: msg.callId, ok: false, data: `O bot ${target} não respondeu em ${Math.round(config.askBotTimeoutMs / 1000)}s.` });
    }, config.askBotTimeoutMs);
    this.pendingAsks.set(key, { callId: msg.callId, fromBotId, conversationId, targetBotId: target, timer });
  }

  private resolveBotByName(name: string, deBotId?: string): string | null {
    const n = name.trim().toLowerCase();
    for (const b of (deBotId ? this.colegasDe(deBotId) : this.db.listBots())) {
      if (b.id === n || b.name.toLowerCase() === n || b.name.toLowerCase().startsWith(n)) return b.id;
    }
    return null;
  }

  // ---------- interface ----------

  handleUiConnection(ws: WebSocket) {
    this.uis.add(ws);
    ws.on("message", (raw) => {
      let msg: UiToHub;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      try { this.onUiMessage(ws, msg); }
      catch (e) { console.error(`[hub] erro ao processar ${msg.type} da interface: ${(e as Error).message}`); }
    });
    ws.on("close", () => this.uis.delete(ws));
  }

  private onUiMessage(ws: WebSocket, msg: UiToHub) {
    switch (msg.type) {
      case "subscribe":
        ws.send(JSON.stringify({ type: "snapshot", bots: this.summaries(), approvals: this.db.pendingApprovals(), questions: this.db.pendingQuestions(), groups: this.db.listGroups(), routines: this.db.listRoutines(), voice: voiceConfig(), control: this.control(), importFile: this.pendingImport } satisfies HubToUi));
        return;
      case "send":
        this.sendUserMessage(msg.conversationId, msg.text, msg.attachments);
        return;
      case "approval.response":
        this.resolveApproval(msg.requestId, msg.allow, msg.remember);
        return;
      case "question.answer":
        this.answerQuestion(msg.questionId, msg.answer);
        return;
      case "stop": { this.pararTudo(msg.reason || "⏹ no painel"); return; }
      case "colab.parar":
        notificarParada({ alvo: msg.alvo, por: msg.por });
        return;
      case "abort": {
        // Com botId: para aquele bot inteiro (é o ⏹ ao lado do nome na lista).
        if (msg.botId) { this.pararBot(msg.botId, "⏹ no painel"); return; }
        const bot = botOfConversation(msg.conversationId);
        if (bot) { this.pararBot(bot, "⏹ na conversa"); return; }
        // Grupo: não existe "o bot" da conversa. Antes disso o ⏹ num grupo não fazia
        // nada. Agora para cada membro, um por um.
        const g = msg.conversationId.startsWith("group:") ? this.db.getGroup(msg.conversationId.slice(6)) : undefined;
        for (const id of g?.members ?? []) this.pararBot(id, "⏹ no grupo");
        return;
      }
    }
  }

  /** Mensagem do usuário para um bot ou grupo (usada pelo WS e pela API REST). */
  sendUserMessage(conversationId: string, text: string, attachments?: Array<{ name: string; mime: string; dataBase64: string }>, from: Sender = USER): StoredMessage {
    const files: Array<{ id: string; name: string; url: string; mime: string; size: number }> = [];
    for (const a of attachments ?? []) {
      const f = this.saveFile(from.id, a.name, a.mime, Buffer.from(a.dataBase64, "base64"));
      files.push({ id: f.id, name: f.name, url: f.url, mime: f.mime, size: f.size });
    }
    // Chefe falando na sala tem precedencia: a roda para e a palavra volta pra ele.
    if (from.kind === "user") this.sala.pausarPorHumano(conversationId);
    const stored = this.storeMessage(conversationId, from, text, files.length ? { files: files.map(({ size: _s, ...f }) => f) } : undefined);
    this.db.markRead(conversationId);
    // Sem crédito o bot não é acionado. Dizer isso na conversa é melhor que um bot mudo.
    const alvoDaCobranca = botOfConversation(conversationId);
    const empresaDoAlvo = alvoDaCobranca ? this.empresaDe(alvoDaCobranca).id : null;
    if (empresaDoAlvo && from.kind !== "bot") {
      const pode = this.podeTrabalhar(empresaDoAlvo);
      if (!pode.ok) {
        this.storeMessage(conversationId, SYSTEM, pode.motivo, { error: true });
        this.db.audit(alvoDaCobranca, "credito.bloqueado", { empresa: empresaDoAlvo });
        return stored;
      }
    }
    const deliver = (atts: Attachment[]) => {
      let fullText = text;
      for (const a of atts) {
        if (a.derivedFrom) continue;
        fullText += `\n[anexo: ${a.name} — ${config.publicUrl}${a.url}${a.transcript ? ` — transcrição do áudio: "${a.transcript.slice(0, 2000)}"` : ""}]`;
      }
      const frames = atts.filter((a) => a.derivedFrom).length;
      if (frames) fullText += `\n[${frames} quadros do vídeo seguem como imagens]`;
      const payload = (messageId: string) => ({ type: "message" as const, conversationId, messageId, from, text: fullText, ...(atts.length ? { attachments: atts } : {}) });
      const groupId = groupOfConversation(conversationId);
      if (groupId) {
        const g = this.db.getGroup(groupId);
        if (!g) { this.storeMessage(conversationId, SYSTEM, "Grupo não existe mais.", { error: true }); return; }
        const offline: string[] = [];
        for (const member of g.members) {
          const ok = this.sendNode(member, payload(stored.id));
          if (ok) this.colab.anotarAutor(member, from.kind === "user" ? "humano" : from.kind === "bot" ? from.id : from.kind);
          if (ok && from.kind === "user") this.definirAtividade(member, "Digitando", true, "digitando");
          else if (!ok) offline.push(this.botSender(member).name);
        }
        if (offline.length) this.storeMessage(conversationId, SYSTEM, `Offline: ${offline.join(", ")}.`, { error: true });
        return;
      }
      const botId = botOfConversation(conversationId) ?? conversationId.split(":").pop()!;
      const ok = this.sendNode(botId, payload(stored.id));
      if (ok) this.colab.anotarAutor(botId, from.kind === "user" ? "humano" : from.kind === "bot" ? from.id : from.kind);
      if (ok && from.kind === "user") this.definirAtividade(botId, "Digitando", true, "digitando");
      else if (!ok) this.storeMessage(conversationId, SYSTEM, `${this.botSender(botId).name} está offline. A mensagem fica salva, mas o bot não vai responder até o PC dele conectar.`, { error: true });
    };
    const atts: Attachment[] = files.map((f) => ({ id: f.id, name: f.name, mime: f.mime, url: f.url, size: f.size }));
    // vídeos/áudios: quadros + transcrição antes de entregar (assíncrono; sem ffmpeg/STT entrega só o original)
    if (atts.some((a) => /^(video|audio)\//i.test(a.mime))) {
      const owner = botOfConversation(conversationId) ?? from.id;
      void this.media.enrich(owner, atts).then(deliver, (e) => { console.error(`[hub] preparo de mídia: ${(e as Error).message}`); deliver(atts); });
    } else deliver(atts);
    return stored;
  }

  /** Gera imagem/vídeo para um bot (nó direct via WS, ou MCP) e coloca o resultado na conversa como arquivo. */
  async generateMedia(botId: string, conversationId: string, kind: MediaKind, prompt: string, opts: { refFileId?: string; seconds?: number; aspect?: string }): Promise<MediaResult> {
    const conv = conversationId || dmConversation(botId);
    const n = this.nodes.get(botId);
    const prev = n ? { status: n.status, busy: n.busy } : null;
    this.setStatusFromMcp(botId, kind === "image" ? "Gerando imagem" : "Gerando vídeo", true);
    const r = await this.media.generate(botId, kind, prompt, opts);
    if (prev) this.setStatusFromMcp(botId, prev.status, prev.busy);
    if (r.ok) {
      this.storeMessage(conv, this.botSender(botId), `${kind === "image" ? "🖼️" : "🎬"} ${prompt.slice(0, 140)}${r.note ? `\n_${r.note}_` : ""}`, { files: [{ id: r.file.id, name: r.file.name, url: r.file.url, mime: r.file.mime }], generated: { kind, provider: r.provider, seconds: r.seconds } });
    } else if (r.tried.length && r.tried.every((t) => /cota/.test(t.reason))) {
      // estourou a cota: avisa o chefe em vez de gastar
      this.broadcastUi({ type: "notify", botId, text: `Cota de ${kind === "image" ? "imagens" : "vídeo"} do dia esgotada (${r.tried.map((t) => t.provider).join(", ")}). Aumente em ⚙️ › Mídia ou tente amanhã.` });
      this.storeMessage(conv, SYSTEM, r.error, { error: true });
    }
    return r;
  }

  /** Grava um arquivo em data/files e registra no banco. */
  saveFile(botId: string, name: string, mime: string, data: Buffer): { id: string; name: string; mime: string; size: number; url: string } {
    const id = newId("f");
    const safe = name.replace(/[^\w.\-\u00C0-\u024F ]+/g, "_").slice(0, 120) || "arquivo";
    const dir = path.join(path.dirname(config.dbFile), "files");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}-${safe}`);
    fs.writeFileSync(file, data);
    this.db.insertFile({ id, name: safe, mime, size: data.length, botId, path: file, createdAt: Date.now() });
    return { id, name: safe, mime, size: data.length, url: `/api/files/${id}/${encodeURIComponent(safe)}` };
  }

  // ---------- grupos ----------

  createGroup(name: string, members: string[]): Group {
    const g: Group = { id: newId("g"), name: name.trim() || "Grupo", members: [...new Set(members)], createdAt: Date.now() };
    this.db.upsertGroup(g);
    this.db.audit(null, "group.created", { id: g.id, name: g.name, members: g.members });
    this.broadcastUi({ type: "groups", groups: this.db.listGroups() });
    return g;
  }

  updateGroup(id: string, patch: { name?: string; members?: string[] }): Group | undefined {
    const g = this.db.getGroup(id);
    if (!g) return undefined;
    const next = { ...g, ...(patch.name ? { name: patch.name } : {}), ...(patch.members ? { members: [...new Set(patch.members)] } : {}) };
    this.db.upsertGroup(next);
    this.broadcastUi({ type: "groups", groups: this.db.listGroups() });
    return next;
  }

  deleteGroup(id: string) {
    this.db.deleteGroup(id);
    this.broadcastUi({ type: "groups", groups: this.db.listGroups() });
  }

  /** Fala de um bot num grupo: os outros membros recebem como contexto, sem responder. */
  private fanOutGroupReply(conversationId: string, fromBotId: string, text: string, messageId: string) {
    const groupId = groupOfConversation(conversationId);
    if (!groupId || !text) return;
    const g = this.db.getGroup(groupId);
    if (!g) return;
    const from = this.botSender(fromBotId);
    for (const member of g.members) {
      if (member === fromBotId) continue;
      this.sendNode(member, { type: "message", conversationId, messageId, from, text, silent: true });
    }
  }

  // ---------- rotinas ----------

  createRoutine(botId: string, name: string, cron: string, prompt: string): Routine | { error: string } {
    const err = validateCron(cron);
    if (err) return { error: `cron inválido (${cron}): ${err}` };
    const r: Routine = { id: newId("r"), botId, name: name.trim() || prompt.slice(0, 40), cron, prompt, enabled: true, nextRun: nextRunOf(cron), createdAt: Date.now() };
    this.db.insertRoutine(r);
    this.db.audit(botId, "routine.created", { id: r.id, cron, name: r.name });
    this.broadcastRoutines();
    return r;
  }

  updateRoutine(id: string, patch: { enabled?: boolean; cron?: string; prompt?: string; name?: string }): Routine | { error: string } | undefined {
    const r = this.db.listRoutines().find((x) => x.id === id);
    if (!r) return undefined;
    if (patch.cron) {
      const err = validateCron(patch.cron);
      if (err) return { error: `cron inválido: ${err}` };
      this.db.updateRoutine(id, { cron: patch.cron, nextRun: nextRunOf(patch.cron) });
    }
    this.db.updateRoutine(id, { enabled: patch.enabled, prompt: patch.prompt, name: patch.name });
    this.broadcastRoutines();
    return this.db.listRoutines().find((x) => x.id === id);
  }

  deleteRoutine(id: string) {
    this.db.deleteRoutine(id);
    this.broadcastRoutines();
  }

  broadcastRoutines() {
    this.broadcastUi({ type: "routines", routines: this.db.listRoutines() });
  }

  /**
   * PARAR TUDO — a mesma função para o ⏹, o Esc, o fechar da janela e o /api/stop.
   *
   * Para cada bot (o que mata o fluxo, os comandos e solta os cartões), avisa TODAS as
   * janelas (quatro janelas abertas falando juntas foi o que motivou isto) e segura as
   * rotinas por 2 s. O que o nó mandar atrasado morre em `encerrados`.
   */
  pararTudo(motivo = "parar tudo"): { bots: string[] } {
    const bots = [...this.nodes.keys()];
    for (const id of bots) this.pararBot(id, motivo);
    // cartão de bot que já não está conectado também sai da tela
    for (const a of this.db.pendingApprovals()) { this.db.cancelApproval(a.id); this.broadcastUi({ type: "approval.resolved", requestId: a.id, allow: false }); }
    for (const q of this.db.pendingQuestions()) { this.db.cancelQuestion(q.id); this.broadcastUi({ type: "question.resolved", questionId: q.id, answer: "" }); }
    this.broadcastUi({ type: "stop", reason: motivo });
    this.db.audit(null, "stop.tudo", { motivo, bots });
    return { bots };
  }

  /**
   * Espera o bot subir e manda a mensagem de abertura. Entra como mensagem do
   * sistema (igual a uma rotina), nao como se o chefe tivesse digitado.
   */
  apresentarEmpresa(botId: string, nomeEmpresa: string, tentativas = 30) {
    if (this.nodes.get(botId)) {
      const sender: Sender = { kind: "system", id: "abertura", name: "Abertura" };
      const empresaId = this.empresaDe(botId).id;
      if (empresaId) {
        // O ROTEIRO, nao o modelo. A persona ja mandava fazer isto e o modelo devolveu
        // um menu de bullets; com modelo fraco ou sem chave nenhuma, instrucao nao vira
        // comportamento. O codigo faz, e depois entrega a conversa ao modelo.
        void this.passos.iniciar(botId, empresaId).catch((e) => this.db.audit(botId, "primeirospassos.erro", { erro: (e as Error).message }));
      } else {
        this.sendUserMessage(dmConversation(botId), `[Abertura da empresa ${nomeEmpresa}] Apresente o MyBots para esta empresa, como diz a sua persona, e termine sugerindo os primeiros bots.`, undefined, sender);
      }
      this.db.audit(botId, "empresa.apresentacao", { empresa: nomeEmpresa });
      return;
    }
    if (tentativas <= 0) return;
    setTimeout(() => this.apresentarEmpresa(botId, nomeEmpresa, tentativas - 1), 4000);
  }

  /** Dispara a rotina agora (pelo scheduler ou pelo botão "Rodar agora"). */
  fireRoutine(r: Routine, how: "agendada" | "manual") {
    // Acabaram de mandar parar esse bot: deixar a rotina entrar agora é o bot
    // "voltando a falar sozinho" dois segundos depois do ⏹.
    if (how === "agendada" && this.paradoAgora(r.botId)) {
      this.db.audit(r.botId, "routine.segurada", { id: r.id, motivo: "parada recente" });
      return;
    }
    const sender: Sender = { kind: "system", id: `routine:${r.id}`, name: `Rotina: ${r.name}` };
    this.db.audit(r.botId, "routine.fired", { id: r.id, how });
    this.sendUserMessage(dmConversation(r.botId), `[Rotina "${r.name}" (${how})]\n${r.prompt}`, undefined, sender);
  }

  /**
   * Conta ao Medico do Sistema que um bot caiu, com a causa ja mastigada.
   *
   * Entrega na conversa dele do mesmo jeito que uma rotina entrega trabalho,
   * para ele PROCESSAR o caso, nao so registrar. Se quem caiu for o proprio
   * Medico, nao adianta falar com ele: fica so no painel e na auditoria.
   */
  avisarMedico(botId: string, nome: string, recado: string, resumo: string) {
    this.broadcastUi({ type: "notify", botId, text: `${nome} caiu: ${resumo}` });
    // Quem recebe e o Medico DA EMPRESA do bot que caiu. Se o que caiu for o proprio
    // medico, nao adianta falar com ele: fica no painel e na auditoria.
    const empresa = this.empresaDe(botId).id;
    const alvo = empresa ? `gerente-${empresa}` : null;
    if (!alvo || botId === alvo) return;
    if (!this.db.listBots().some((b) => b.id === alvo)) return;
    const sender: Sender = { kind: "system", id: "sistema:queda", name: "Sistema" };
    this.sendUserMessage(dmConversation(alvo), recado, undefined, sender);
  }

  /**
   * Grava um marcador na conversa (ex.: "Chamada de voz - 0:05") e mostra no
   * painel, sem acordar bot nenhum. Um marcador conta o que aconteceu; nao e
   * uma pergunta esperando resposta.
   */
  marcador(conversationId: string, texto: string, meta?: Record<string, unknown>) {
    const sender: Sender = { kind: "system", id: "sistema:marcador", name: "" };
    const m = this.storeMessage(conversationId, sender, texto, { ...(meta ?? {}), marcador: true });
    this.broadcastUi({ type: "message", message: m });
    return m;
  }

  /** Mensagem vinda de um canal externo (WhatsApp via CRM, e-mail...). */
  channelMessage(channel: string, from: string, botId: string, text: string): StoredMessage {
    const conversationId = `channel:${channel}:${from}:${botId}`;
    const sender: Sender = { kind: "user", id: `${channel}:${from}`, name: `${from} (${channel})` };
    return this.sendUserMessage(conversationId, text, undefined, sender);
  }

  resolveApproval(requestId: string, allow: boolean, remember?: boolean, por = "humano") {
    if (allow && por !== "humano") {
      registrarAuditoria({ acao: "colab.bloqueio", de: por, para: requestId, detalhe: { motivo: "aprovacao" } });
      this.colab.emitir({ tipo: "colab.bloqueio", motivo: "aprovacao", de: por, para: requestId });
      return;
    }
    const botId = this.approvalOwner.get(requestId);
    this.db.resolveApproval(requestId, allow, "humano");
    this.approvalOwner.delete(requestId);
    this.db.audit(botId ?? null, allow ? "approval.allowed" : "approval.denied", { requestId, remember: !!remember, por: "humano" });
    this.broadcastUi({ type: "approval.resolved", requestId, allow });
    if (botId) this.sendNode(botId, { type: "approval.response", requestId, allow, remember });
  }

  answerQuestion(questionId: string, answer: string) {
    // Pergunta do roteiro de primeiros passos: quem responde e o roteiro, nao o no.
    // (E o roteiro apaga a resposta da tabela quando ela pode ser senha ou token.)
    if (this.passos.responder(questionId, answer)) return;
    const botId = this.questionOwner.get(questionId);
    this.db.resolveQuestion(questionId, answer);
    this.questionOwner.delete(questionId);
    this.broadcastUi({ type: "question.resolved", questionId, answer });
    if (botId) {
      this.storeMessage(dmConversation(botId), USER, answer, { answerTo: questionId });
      this.sendNode(botId, { type: "question.answer", questionId, answer });
    }
  }

  onlineBots(): string[] {
    return [...this.nodes.keys()];
  }

  /** Usado pelo servidor MCP: o bot `fromBotId` pergunta a outro e espera. */
  askBotFromMcp(fromBotId: string, to: string, text: string, wait: boolean, opts?: { prioridade?: boolean; profundidade?: number; contexto?: string }): Promise<{ ok: boolean; data: unknown }> {
    return new Promise((resolve) => {
      const callId = newId("mcp");
      const r = this.colab.enviar({
        de: fromBotId, para: to, texto: text,
        prioridade: wait || opts?.prioridade === true,
        profundidade: Number.isFinite(opts?.profundidade) ? Number(opts?.profundidade) : 0,
        contexto: opts?.contexto,
      });
      if (!r.ok) return resolve({ ok: false, data: r.erro });
      const alvo = this.acharBotColab(fromBotId, to);
      const target = "erro" in alvo ? "" : alvo.id;
      if (!wait) return resolve({ ok: true, data: r.aviso });
      if (!target || !this.nodes.get(target)) return resolve({ ok: false, data: r.aviso });
      const conversationId = pairConversation(fromBotId, target);
      const key = `${conversationId}:${target}`;
      const old = this.pendingAsks.get(key);
      if (old) { clearTimeout(old.timer); this.sendNode(old.fromBotId, { type: "result", callId: old.callId, ok: false, data: "Substituído por uma nova pergunta." }); }
      const timer = setTimeout(() => { this.pendingAsks.delete(key); this.mcpWaiters.delete(callId); resolve({ ok: false, data: "Sem resposta a tempo." }); }, config.askBotTimeoutMs);
      this.pendingAsks.set(key, { callId, fromBotId, conversationId, targetBotId: target, timer });
      this.mcpWaiters.set(callId, resolve);
    });
  }

  /** Pergunta ao usuário vinda do MCP; resolve quando ele responder na interface. */
  askUserFromMcp(botId: string, question: string, options: string[]): Promise<string> {
    if (this.effectiveModeFor(botId) === "deus") {
      this.db.audit(botId, "question.auto", { mode: "deus", question, options, via: "mcp" });
      return Promise.resolve(`[MODO DEUS EXTREMO] O chefe não será consultado. Decida você mesmo${options.length ? ` (ex.: "${options[0]}")` : ""} e siga em frente.`);
    }
    return new Promise((resolve) => {
      const q: PendingQuestion = { id: newId("q"), botId, conversationId: dmConversation(botId), question, options, createdAt: Date.now() };
      this.db.insertQuestion(q);
      this.questionOwner.set(q.id, botId);
      this.storeMessage(q.conversationId, this.botSender(botId), question, { question: q.id, options });
      this.broadcastUi({ type: "question", question: q });
      this.questionWaiters.set(q.id, resolve);
    });
  }

  requestApprovalFromMcp(botId: string, tool: string, input: unknown, risk: PendingApproval["risk"], description: string, kind: ApprovalKind = "action"): Promise<boolean> {
    const gate = classificarAcaoSensivel(tool, input, description);
    if (gate === "envio" && !mensagemLiberaEnvioExterno(this.colab.autorDe(botId))) {
      registrarAuditoria({ acao: "colab.bloqueio", de: botId, para: "externo", detalhe: { motivo: "aprovacao", ferramenta: tool, via: "mcp" } });
      this.colab.emitir({ tipo: "colab.bloqueio", motivo: "aprovacao", de: botId, para: "externo" });
      return Promise.resolve(false);
    }
    const mode = this.effectiveModeFor(botId);
    if (!gate && !needsHumanApproval(mode, kind, risk)) {
      this.db.audit(botId, "approval.auto", { mode, tool, input, risk, description, via: "mcp" });
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const a: PendingApproval = { id: newId("ap"), botId, conversationId: dmConversation(botId), tool, input, risk, description, createdAt: Date.now() };
      this.db.insertApproval(a);
      this.approvalOwner.set(a.id, botId);
      this.db.audit(botId, "approval.requested", { tool, input, risk, via: "mcp" });
      this.broadcastUi({ type: "approval.request", approval: a });
      this.approvalWaiters.set(a.id, resolve);
    });
  }

  setStatusFromMcp(botId: string, text: string, busy: boolean) {
    this.definirAtividade(botId, text, busy);
  }

  /** Avisa a lista e o chat na hora. O nó pode detalhar depois; a fase é o que a tela usa. */
  private definirAtividade(botId: string, text: string, busy: boolean, fase?: FaseAtividade) {
    const n = this.nodes.get(botId);
    const resolvida = faseDoStatus(text, busy, fase);
    if (n) { n.status = text; n.busy = busy; n.fase = resolvida; }
    if (busy && temRegistro(botId)) tocarPc(botId);
    this.broadcastUi({ type: "status", botId, text, busy, fase: resolvida });
    if (!busy) this.finalizeStreams(botId);
  }

  notifyFromMcp(botId: string, text: string) {
    this.broadcastUi({ type: "notify", botId, text });
    this.storeMessage(dmConversation(botId), this.botSender(botId), text, { notify: true });
  }
}
