// Fila de tarefas por bot. Persiste no SQLite do Hub e sobrevive a reinício.
// Quem pode delegar para quem não é decidido aqui: isso é checarColab.

import { dmConversation, newId, pairConversation, type ColabEvento, type ResultadoTarefa, type StatusTarefa, type TarefaColab } from "@mybots/shared";
import type { Db } from "../db.js";
import type { ParadaColab } from "./parar.js";
import { checarColab, registrarAuditoria, type EventoAuditoria, type MotivoChecagem, type PedidoColab, type ResultadoColab } from "./seguranca.js";

export const TRANSICOES_TAREFA: Record<StatusTarefa, readonly StatusTarefa[]> = {
  queued: ["running", "failed", "cancelled"],
  running: ["waiting", "done", "failed", "cancelled"],
  waiting: ["running", "done", "failed", "cancelled"],
  done: [],
  failed: [],
  cancelled: [],
};

const ATIVOS: readonly StatusTarefa[] = ["queued", "running", "waiting"];
const TERMINAIS: readonly StatusTarefa[] = ["done", "failed", "cancelled"];

const HUMANOS = new Set(["humano", "user", "chefe", "sistema"]);

export function ehHumano(id: string): boolean {
  return HUMANOS.has(id.trim().toLowerCase());
}

/** Conversa em que a tarefa é dita: par bot↔bot, ou o chat do chefe quando ele pediu. */
export function conversaDaTarefa(t: { de: string; para: string }): string {
  if (ehHumano(t.de)) return dmConversation(t.para);
  return pairConversation(t.de, t.para);
}

export type EventoColabSaida = Extract<ColabEvento, { tipo: "colab.tarefa" | "colab.ajudando" | "colab.bloqueio" }>;

export type AcordoTarefa = {
  botId: string;
  conversationId: string;
  texto: string;
  autorId: string;
  tarefaId: string;
};

export type PedidoCriarTarefa = {
  de: string;
  para: string;
  objetivo: string;
  contexto: string;
  criterioSucesso: string;
  prazo: number | null;
  formatoEntrega: string | null;
  /** true = o chamador é humano (painel), profundidade 0. false = um bot delegando. */
  chamadorHumano: boolean;
};

export type ResultadoFila =
  | { ok: true; tarefa: TarefaColab }
  | { ok: false; erro: string; status?: number; motivo?: MotivoChecagem };

type Deps = {
  agora?: () => number;
  checar?: (pedido: PedidoColab) => ResultadoColab;
  auditar?: (evento: EventoAuditoria) => void;
  emitir?: (ev: EventoColabSaida) => void;
  acordar?: (p: AcordoTarefa) => boolean;
  online?: (botId: string) => boolean;
};

export class FilaDeTarefas {
  /** Troca em teste. Em produção aponta para colab/seguranca.ts. */
  checar: (pedido: PedidoColab) => ResultadoColab;
  private auditar: (evento: EventoAuditoria) => void;
  private emitir: (ev: EventoColabSaida) => void;
  private acordar: (p: AcordoTarefa) => boolean;
  private online: (botId: string) => boolean;
  private agora: () => number;

  constructor(private db: Db, deps: Deps = {}) {
    this.checar = deps.checar ?? checarColab;
    this.auditar = deps.auditar ?? registrarAuditoria;
    this.emitir = deps.emitir ?? (() => {});
    this.acordar = deps.acordar ?? (() => false);
    this.online = deps.online ?? (() => false);
    this.agora = deps.agora ?? (() => Date.now());
  }

  obter(id: string): TarefaColab | null {
    return this.db.getTarefa(id);
  }

  listar(filtro: { bot?: string; status?: StatusTarefa } = {}): TarefaColab[] {
    return this.db.listTarefas(filtro);
  }

  /**
   * Cria em queued. A resposta HTTP continua queued mesmo que, na sequência,
   * o prazo já vencido a faça failed ou o despacho a faça running.
   * Bloqueio do checador não grava linha e emite colab.bloqueio.
   */
  criar(p: PedidoCriarTarefa): ResultadoFila {
    const de = p.de.trim();
    const para = p.para.trim();
    if (!de || !para) return { ok: false, erro: "de e para são obrigatórios", status: 400 };
    if (ehHumano(para)) return { ok: false, erro: "o destino da tarefa precisa ser um bot", status: 400 };
    if (de === para) return { ok: false, erro: "um bot não delega uma tarefa para si mesmo", status: 400 };
    const objetivo = p.objetivo.trim();
    if (!objetivo) return { ok: false, erro: "objetivo é obrigatório", status: 400 };

    const mae = p.chamadorHumano ? null : this.maeDe(de);
    const profundidade = p.chamadorHumano ? 0 : (mae ? mae.profundidade + 1 : 1);

    // Ponto de extensão: profundidade (teto padrão 3), taxa e empresa.
    // Este módulo só obedece o que checarColab devolver.
    const checagem = this.checar({ de, para, tipo: "tarefa", profundidade });
    if (!checagem.ok) {
      this.auditar({ acao: "bloqueio", de, para, detalhe: { motivo: checagem.motivo, tipo: "tarefa", profundidade }, quando: this.agora() });
      this.emitir({ tipo: "colab.bloqueio", motivo: checagem.motivo, de, para });
      return { ok: false, erro: "delegação bloqueada", status: 403, motivo: checagem.motivo };
    }

    const agora = this.agora();
    const tarefa: TarefaColab = {
      id: newId("t"),
      de, para, objetivo,
      contexto: p.contexto.trim(),
      criterioSucesso: p.criterioSucesso.trim(),
      prazo: p.prazo,
      formatoEntrega: p.formatoEntrega?.trim() || null,
      status: "queued",
      profundidade,
      tarefaMaeId: mae?.id ?? null,
      criadaEm: agora,
      atualizadaEm: agora,
    };
    this.db.insertTarefa(tarefa);
    this.auditar({ acao: "criar", de, para, detalhe: { tarefaId: tarefa.id, status: "queued", profundidade }, quando: agora });
    this.emitirTarefa(tarefa);

    if (mae && mae.status === "running") {
      this.transicionar(mae.id, "waiting");
    }
    this.vencerPrazos();
    this.despachar(para);
    return { ok: true, tarefa };
  }

  transicionar(id: string, status: StatusTarefa, resultado?: ResultadoTarefa): ResultadoFila {
    const atual = this.db.getTarefa(id);
    if (!atual) return { ok: false, erro: "tarefa não encontrada", status: 404 };
    if (!TRANSICOES_TAREFA[atual.status].includes(status)) {
      return { ok: false, erro: `transição inválida: ${atual.status} → ${status}`, status: 409 };
    }
    const agora = this.agora();
    const tarefa: TarefaColab = {
      ...atual,
      status,
      resultado: resultado ?? atual.resultado,
      atualizadaEm: agora,
    };
    this.db.updateTarefa(tarefa);
    this.auditar({
      acao: "transicao", de: tarefa.de, para: tarefa.para,
      detalhe: { tarefaId: tarefa.id, status, motivo: tarefa.resultado?.motivo },
      quando: agora,
    });
    this.emitirTarefa(tarefa);
    if (TERMINAIS.includes(status)) {
      this.retomarMae(tarefa);
      this.notificarSolicitante(tarefa);
      this.atualizarAjudando(tarefa.para);
      this.despachar(tarefa.para);
    } else {
      this.atualizarAjudando(tarefa.para);
    }
    return { ok: true, tarefa };
  }

  cancelar(id: string, motivo = "cancelada pelo solicitante"): ResultadoFila {
    return this.transicionar(id, "cancelled", {
      resumo: "Tarefa cancelada.",
      motivo,
    });
  }

  /**
   * colab.parar: cancela queued/running/waiting em que o bot é o destinatário.
   * Tarefa já encerrada e tarefa em que ele só é o solicitante ficam como estão.
   */
  receberParar(ev: ParadaColab): TarefaColab[] {
    if (ev.por !== "humano") return [];
    if (ev.alvo !== "todos" && !Array.isArray(ev.alvo)) return [];
    this.auditar({
      acao: "parar",
      detalhe: { alvo: ev.alvo },
      quando: this.agora(),
    });
    const alvo = ev.alvo;
    const afetadas = this.db.listTarefas().filter((t) =>
      ATIVOS.includes(t.status) && (alvo === "todos" || alvo.includes(t.para)));
    const canceladas: TarefaColab[] = [];
    for (const t of afetadas) {
      const r = this.transicionar(t.id, "cancelled", {
        resumo: "Tarefa cancelada porque o humano pediu para parar.",
        motivo: "parado pelo humano",
      });
      if (r.ok) canceladas.push(r.tarefa);
    }
    return canceladas;
  }

  /** Prazo vencido em tarefa ainda aberta vira failed, com motivo, e o solicitante é avisado. */
  vencerPrazos(agora = this.agora()): TarefaColab[] {
    const vencidas: TarefaColab[] = [];
    for (const t of this.db.listTarefas()) {
      if (!ATIVOS.includes(t.status) || t.prazo == null || t.prazo > agora) continue;
      const r = this.transicionar(t.id, "failed", {
        resumo: "O prazo da tarefa venceu antes da entrega.",
        motivo: "prazo vencido",
      });
      if (r.ok) vencidas.push(r.tarefa);
    }
    return vencidas;
  }

  /** Puxa a tarefa mais antiga da fila se o bot está livre e online. */
  despachar(botId: string) {
    if (this.emCurso(botId)) return;
    const proxima = this.db.listTarefas({ bot: botId, status: "queued" })[0];
    if (!proxima) return;
    if (!this.online(botId)) return;
    if (!this.acordarExecucao(proxima)) return;
    this.transicionar(proxima.id, "running");
  }

  /** Reconexão: se já estava executando, o pedido é reenviado; senão entra a próxima da fila. */
  aoConectar(botId: string) {
    const atual = this.emCurso(botId);
    if (atual?.status === "running") {
      if (this.online(botId)) this.acordarExecucao(atual);
      return;
    }
    if (atual) return;
    this.despachar(botId);
  }

  /** A resposta do destinatário, no turno da tarefa, encerra o que está running. */
  aoResponder(botId: string, conversationId: string, texto: string) {
    const t = this.emCurso(botId);
    if (!t || t.status !== "running") return;
    if (conversaDaTarefa(t) !== conversationId) return;
    const resumo = texto.trim();
    if (!resumo) {
      this.transicionar(t.id, "failed", { resumo: "O bot não entregou resultado.", motivo: "resposta vazia" });
      return;
    }
    this.transicionar(t.id, "done", { resumo });
  }

  private maeDe(de: string): TarefaColab | null {
    if (ehHumano(de)) return null;
    const lista = this.db.listTarefas({ bot: de });
    return lista.find((t) => t.status === "running") ?? lista.find((t) => t.status === "waiting") ?? null;
  }

  private emCurso(botId: string): TarefaColab | null {
    return this.db.listTarefas({ bot: botId }).find((t) => t.status === "running" || t.status === "waiting") ?? null;
  }

  private retomarMae(tarefa: TarefaColab) {
    if (!tarefa.tarefaMaeId) return;
    const mae = this.db.getTarefa(tarefa.tarefaMaeId);
    if (!mae || mae.status !== "waiting" || mae.para !== tarefa.de) return;
    this.transicionar(mae.id, "running");
  }

  private notificarSolicitante(tarefa: TarefaColab) {
    if (ehHumano(tarefa.de)) {
      this.acordar({
        botId: tarefa.de,
        conversationId: conversaDaTarefa(tarefa),
        texto: textoResultado(tarefa),
        autorId: tarefa.para,
        tarefaId: tarefa.id,
      });
      return;
    }
    const mae = tarefa.tarefaMaeId ? this.db.getTarefa(tarefa.tarefaMaeId) : null;
    const naMae = mae && mae.para === tarefa.de && (mae.status === "running" || mae.status === "waiting");
    this.acordar({
      botId: tarefa.de,
      conversationId: naMae ? conversaDaTarefa(mae) : conversaDaTarefa(tarefa),
      texto: textoResultado(tarefa),
      autorId: tarefa.para,
      tarefaId: tarefa.id,
    });
  }

  private acordarExecucao(tarefa: TarefaColab): boolean {
    return this.acordar({
      botId: tarefa.para,
      conversationId: conversaDaTarefa(tarefa),
      texto: textoPedido(tarefa),
      autorId: tarefa.de,
      tarefaId: tarefa.id,
    });
  }

  private atualizarAjudando(botId: string) {
    const ativa = this.emCurso(botId);
    const emAjuda = !!ativa && (ativa.status === "running" || ativa.status === "waiting");
    this.emitir({
      tipo: "colab.ajudando",
      bot: botId,
      ajudando: emAjuda && ativa ? ativa.de : null,
      tarefaId: emAjuda && ativa ? ativa.id : null,
    });
  }

  private emitirTarefa(t: TarefaColab) {
    this.emitir({
      tipo: "colab.tarefa",
      id: t.id,
      de: t.de,
      para: t.para,
      status: t.status,
      ...(t.resultado ? { resultado: t.resultado } : {}),
    });
  }
}

function textoPedido(t: TarefaColab): string {
  const linhas = [
    `Tarefa ${t.id} de ${t.de}.`,
    `Objetivo: ${t.objetivo}`,
    `Contexto: ${t.contexto}`,
    `Critério de sucesso: ${t.criterioSucesso}`,
  ];
  if (t.formatoEntrega) linhas.push(`Formato de entrega: ${t.formatoEntrega}`);
  if (t.prazo != null) linhas.push(`Prazo: ${new Date(t.prazo).toISOString()}`);
  linhas.push("Faça o trabalho e responda com o resultado nesta conversa. Você não aprova nada: se precisar pagar, enviar, apagar ou publicar, o pedido segue para o chefe em /api/approvals.");
  return linhas.join("\n");
}

function textoResultado(t: TarefaColab): string {
  const r = t.resultado;
  const linhas = [`Resultado da tarefa ${t.id} (${t.status}).`];
  if (r?.resumo) linhas.push(r.resumo);
  if (r?.motivo) linhas.push(`Motivo: ${r.motivo}`);
  if (r?.arquivos?.length) linhas.push(`Arquivos: ${r.arquivos.join(", ")}`);
  return linhas.join("\n");
}
