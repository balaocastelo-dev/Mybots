import { pairConversation } from "@mybots/shared";
import {
  COLUNAS,
  ROTULO_STATUS,
  STATUS_TAREFA,
  type ColunaId,
  type ConversaColab,
  type ItemAuditoria,
  type MensagemColab,
  type PacoteColab,
  type PassoTarefa,
  type ResultadoTarefa,
  type SalaColab,
  type StatusTarefa,
  type Tarefa,
} from "./tipos";

export function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function comoLista(v: unknown, chaves: string[]): unknown[] {
  if (Array.isArray(v)) return v;
  const o = obj(v);
  if (!o) return [];
  for (const k of chaves) if (Array.isArray(o[k])) return o[k] as unknown[];
  return [];
}

export function statusDe(v: unknown): StatusTarefa {
  const s = typeof v === "string" ? v : "";
  return (STATUS_TAREFA as string[]).includes(s) ? (s as StatusTarefa) : "queued";
}

export function instante(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v > 0 && v < 1e12) return Math.round(v * 1000);
    return Math.round(v);
  }
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 1e11) return Math.round(n);
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return undefined;
}

export function progressoDe(status: StatusTarefa, informado?: number): number {
  if (typeof informado === "number" && Number.isFinite(informado)) {
    return Math.max(0, Math.min(100, Math.round(informado)));
  }
  if (status === "done") return 100;
  if (status === "running") return 40;
  if (status === "waiting") return 55;
  return 0;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function resultadoDe(v: unknown): ResultadoTarefa | undefined {
  const o = obj(v);
  if (!o) return undefined;
  const arquivos = Array.isArray(o.arquivos) ? o.arquivos.filter((a): a is string => typeof a === "string") : undefined;
  const r: ResultadoTarefa = {};
  if (typeof o.resumo === "string" && o.resumo) r.resumo = o.resumo;
  if (arquivos?.length) r.arquivos = arquivos;
  if (typeof o.motivo === "string" && o.motivo) r.motivo = o.motivo;
  return r.resumo || r.arquivos || r.motivo ? r : undefined;
}

function passoDe(v: unknown): PassoTarefa | null {
  const o = obj(v);
  if (!o) return null;
  const status = statusDe(o.status);
  const em = instante(o.em ?? o.at ?? o.quando) ?? Date.now();
  const dito = texto(o.texto ?? o.text ?? o.resumo);
  return { em, status, texto: dito || ROTULO_STATUS[status] };
}

/** Aceita o corpo do GET e também o evento colab.tarefa, completo ou parcial. */
export function fundirTarefa(atual: Tarefa | undefined, bruto: unknown, em = Date.now()): Tarefa | null {
  const o = obj(bruto);
  if (!o) return atual ?? null;
  const id = texto(o.id) || atual?.id || "";
  if (!id) return null;
  const status = o.status !== undefined ? statusDe(o.status) : (atual?.status ?? "queued");
  const progressoInformado = typeof o.progresso === "number" ? o.progresso : typeof o.progress === "number" ? o.progress : undefined;
  const progresso = progressoInformado !== undefined ? progressoDe(status, progressoInformado) : (atual && o.status === undefined ? atual.progresso : progressoDe(status, atual?.progresso));
  const resultado = o.resultado !== undefined ? resultadoDe(o.resultado) : atual?.resultado;
  const historicoBruto = Array.isArray(o.historico) ? o.historico.map(passoDe).filter((p): p is PassoTarefa => !!p) : [];
  let historico = historicoBruto.length ? historicoBruto : [...(atual?.historico ?? [])];
  const mudou = !atual || atual.status !== status || atual.progresso !== progresso || JSON.stringify(atual.resultado ?? null) !== JSON.stringify(resultado ?? null);
  if (!historico.length || (mudou && historicoBruto.length === 0)) {
    const frase = resultado?.resumo || resultado?.motivo || ROTULO_STATUS[status];
    const ultimo = historico[historico.length - 1];
    if (!ultimo || ultimo.status !== status || ultimo.texto !== frase) {
      historico = [...historico, { em, status, texto: frase }];
    }
  }
  const prazo = o.prazo !== undefined ? instante(o.prazo) : atual?.prazo;
  return {
    id,
    de: texto(o.de) || atual?.de || "",
    para: texto(o.para) || atual?.para || "",
    objetivo: texto(o.objetivo ?? o.titulo ?? o.title) || atual?.objetivo || "Tarefa",
    contexto: texto(o.contexto) || atual?.contexto,
    criterioSucesso: texto(o.criterioSucesso) || atual?.criterioSucesso,
    prazo,
    formatoEntrega: texto(o.formatoEntrega) || atual?.formatoEntrega,
    profundidade: typeof o.profundidade === "number" ? o.profundidade : atual?.profundidade,
    status,
    progresso: status === "done" && progressoInformado === undefined ? 100 : progresso,
    resultado,
    historico,
    criadaEm: instante(o.criadaEm ?? o.criadoEm) ?? atual?.criadaEm ?? em,
    atualizadaEm: instante(o.atualizadaEm) ?? em,
    empresaId: texto(o.empresaId) || atual?.empresaId,
  };
}

export function normalizarTarefas(v: unknown): Tarefa[] {
  const saida: Tarefa[] = [];
  for (const item of comoLista(v, ["tarefas", "itens", "items", "tasks"])) {
    const t = fundirTarefa(undefined, item);
    if (t) saida.push(t);
  }
  return saida;
}

export function idsDaConversa(id: string, bots?: unknown): string[] {
  if (Array.isArray(bots) && bots.every((b) => typeof b === "string")) return bots as string[];
  const miolo = id.startsWith("pair:") ? id.slice(5) : id;
  return miolo.split(":").filter(Boolean);
}

export function normalizarConversas(v: unknown): ConversaColab[] {
  const saida: ConversaColab[] = [];
  for (const item of comoLista(v, ["conversas", "itens", "items"])) {
    const o = obj(item);
    if (!o) continue;
    const bots = idsDaConversa(texto(o.id), o.bots);
    const id = texto(o.id) || (bots.length >= 2 ? pairConversation(bots[0], bots[1]) : "");
    if (!id) continue;
    saida.push({
      id,
      bots: idsDaConversa(id, o.bots),
      ultimaEm: instante(o.ultimaEm ?? o.atualizadaEm) ?? 0,
      ultima: texto(o.ultima ?? o.preview) || undefined,
      quantas: typeof o.quantas === "number" ? o.quantas : 0,
    });
  }
  return saida;
}

export function normalizarMensagens(v: unknown, conversaId: string): MensagemColab[] {
  const saida: MensagemColab[] = [];
  for (const item of comoLista(v, ["mensagens", "messages", "itens", "items"])) {
    const o = obj(item);
    if (!o) continue;
    const sender = obj(o.sender);
    const id = texto(o.id) || `m-${saida.length}`;
    const de = sender ? texto(sender.id) : texto(o.de ?? o.from ?? o.autor);
    const textoMsg = texto(o.texto ?? o.text);
    saida.push({
      id,
      conversaId: texto(o.conversationId ?? o.conversaId) || conversaId,
      de,
      para: texto(o.para) || undefined,
      nomeDe: sender ? texto(sender.name) : texto(o.nomeDe ?? o.nome) || undefined,
      texto: textoMsg,
      em: instante(o.em ?? o.createdAt ?? o.criadaEm ?? o.quando) ?? 0,
      prioridade: o.prioridade === true || o.priority === true,
    });
  }
  return saida;
}

export function normalizarSalas(v: unknown): SalaColab[] {
  const saida: SalaColab[] = [];
  for (const item of comoLista(v, ["salas", "itens", "items"])) {
    const o = obj(item);
    if (!o) continue;
    const id = texto(o.id ?? o.salaId);
    if (!id) continue;
    const membros = Array.isArray(o.membros) ? o.membros.filter((m): m is string => typeof m === "string") : [];
    saida.push({
      id,
      nome: texto(o.nome ?? o.name ?? o.assunto) || id,
      instrucoes: texto(o.instrucoes) || undefined,
      membros,
      aberta: o.aberta !== false && o.fechada !== true,
    });
  }
  return saida;
}

export function normalizarAuditoria(v: unknown): ItemAuditoria[] {
  const saida: ItemAuditoria[] = [];
  for (const item of comoLista(v, ["eventos", "itens", "items", "auditoria"])) {
    const o = obj(item);
    if (!o) continue;
    saida.push({
      id: texto(o.id) || `aud-${saida.length}`,
      em: instante(o.em ?? o.ts ?? o.quando ?? o.createdAt) ?? 0,
      botId: texto(o.botId ?? o.bot ?? o.de) || undefined,
      acao: texto(o.acao ?? o.action) || "evento",
      detalhe: texto(o.detalhe ?? o.detail ?? o.texto) || "",
      motivo: texto(o.motivo) || undefined,
    });
  }
  return saida.sort((a, b) => b.em - a.em);
}

export function colunaDe(status: StatusTarefa): ColunaId {
  return COLUNAS.find((c) => c.statuses.includes(status))?.id ?? "queued";
}

export function tarefasNaColuna(tarefas: Tarefa[], coluna: ColunaId): Tarefa[] {
  const def = COLUNAS.find((c) => c.id === coluna);
  if (!def) return [];
  return tarefas
    .filter((t) => def.statuses.includes(t.status))
    .sort((a, b) => (a.prazo ?? Number.MAX_SAFE_INTEGER) - (b.prazo ?? Number.MAX_SAFE_INTEGER) || b.atualizadaEm - a.atualizadaEm);
}

export function tarefasDoBot(tarefas: Tarefa[], botId: string): Tarefa[] {
  return tarefas.filter((t) => t.para === botId);
}

export function tarefasDaEmpresa(
  tarefas: Tarefa[],
  bots: Array<{ id: string; empresaId?: string | null }>,
  empresaId: string,
): Tarefa[] {
  if (!empresaId || empresaId === "todas") return tarefas;
  const ids = new Set(bots.filter((b) => b.empresaId === empresaId).map((b) => b.id));
  return tarefas.filter((t) => t.empresaId === empresaId || ids.has(t.para) || ids.has(t.de));
}

/** Quem está em running ou waiting está ajudando quem pediu a tarefa. */
export function ajudandoDasTarefas(tarefas: Tarefa[]): PacoteColab["ajudando"] {
  const mapa: PacoteColab["ajudando"] = {};
  for (const t of tarefas) {
    if ((t.status === "running" || t.status === "waiting") && t.para && t.de) {
      mapa[t.para] = { ajudando: t.de, tarefaId: t.id };
    }
  }
  return mapa;
}

/** O GET não traz histórico. A recarga não pode apagar os passos que o WebSocket já mostrou. */
export function conservarTarefas(velhas: Tarefa[], novas: Tarefa[]): Tarefa[] {
  return novas.map((t) => {
    const velha = velhas.find((x) => x.id === t.id);
    if (!velha) return t;
    let historico = velha.historico.length >= t.historico.length ? [...velha.historico] : [...t.historico];
    const ultimo = historico[historico.length - 1];
    if (!ultimo || ultimo.status !== t.status) {
      historico.push({
        em: t.atualizadaEm,
        status: t.status,
        texto: t.resultado?.resumo || t.resultado?.motivo || ROTULO_STATUS[t.status],
      });
    }
    const progresso = t.status === velha.status ? Math.max(t.progresso, velha.progresso) : t.progresso;
    return { ...t, historico, progresso };
  });
}

export function podeCancelar(t: Tarefa): boolean {
  return t.status === "queued" || t.status === "running" || t.status === "waiting";
}

export function quando(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function prazoAtrasado(t: Tarefa, agora = Date.now()): boolean {
  if (!t.prazo) return false;
  if (t.status === "done" || t.status === "cancelled" || t.status === "failed") return false;
  return t.prazo < agora;
}

function upsert<T extends { id: string }>(lista: T[], item: T): T[] {
  const i = lista.findIndex((x) => x.id === item.id);
  if (i < 0) return [...lista, item];
  return lista.map((x, n) => (n === i ? item : x));
}

/** Aplica um evento do WebSocket. Mensagens de outro tipo passam direto. */
export function aplicarEvento(p: PacoteColab, msg: unknown, em = Date.now()): PacoteColab {
  const m = obj(msg);
  if (!m) return p;
  const tipo = texto(m.type) === "colab" && texto(m.tipo) ? texto(m.tipo) : texto(m.type);
  if (tipo === "colab.tarefa") {
    const corpo = obj(m.tarefa) ?? m;
    const id = texto(corpo.id);
    if (!id) return p;
    const atual = p.tarefas.find((t) => t.id === id);
    const tarefa = fundirTarefa(atual, { ...corpo, id }, em);
    if (!tarefa) return p;
    return { ...p, tarefas: upsert(p.tarefas, tarefa) };
  }
  if (tipo === "colab.mensagem") {
    const de = texto(m.de);
    const para = texto(m.para);
    if (!de || !para) return p;
    const idConv = pairConversation(de, para);
    const idMsg = texto(m.id) || `msg-${em}`;
    const textoMsg = texto(m.texto ?? m.text);
    const conversaAtual = p.conversas.find((c) => c.id === idConv);
    const conversa: ConversaColab = {
      id: idConv,
      bots: [de, para].sort(),
      ultimaEm: em,
      ultima: textoMsg || conversaAtual?.ultima,
      quantas: (conversaAtual?.quantas ?? 0) + 1,
    };
    const mensagens = textoMsg
      ? upsert(p.mensagens, { id: idMsg, conversaId: idConv, de, para, texto: textoMsg, em, prioridade: m.prioridade === true })
      : p.mensagens;
    return { ...p, conversas: upsert(p.conversas, conversa), mensagens };
  }
  if (tipo === "colab.ajudando") {
    const bot = texto(m.bot);
    if (!bot) return p;
    const quem = m.ajudando == null || m.ajudando === "" ? "" : texto(m.ajudando);
    const ajudando = { ...p.ajudando };
    if (!quem) delete ajudando[bot];
    else ajudando[bot] = { ajudando: quem, tarefaId: m.tarefaId == null || m.tarefaId === "" ? null : texto(m.tarefaId) };
    return { ...p, ajudando };
  }
  if (tipo === "colab.sala") {
    const salaId = texto(m.salaId ?? obj(m.sala)?.id);
    if (!salaId) return p;
    const cheia = obj(m.sala);
    if (cheia) {
      const [sala] = normalizarSalas([cheia.id ? cheia : { ...cheia, id: salaId }]);
      if (sala) return { ...p, salas: upsert(p.salas, sala) };
    }
    const atual = p.salas.find((s) => s.id === salaId);
    if (!atual) return { ...p, salas: [...p.salas, { id: salaId, nome: salaId, membros: [], aberta: true }] };
    return p;
  }
  if (tipo === "colab.bloqueio") {
    const item: ItemAuditoria = {
      id: `bloq-${em}`,
      em,
      botId: texto(m.de) || undefined,
      acao: "bloqueio",
      detalhe: `${texto(m.de)} → ${texto(m.para)}`.trim(),
      motivo: texto(m.motivo) || undefined,
    };
    return { ...p, auditoria: [item, ...p.auditoria].slice(0, 40) };
  }
  if (tipo === "colab.parar") {
    const alvo = m.alvo;
    const todos = alvo === "todos";
    const ids = new Set(Array.isArray(alvo) ? alvo.filter((x): x is string => typeof x === "string") : []);
    const tarefas = p.tarefas.map((t) => {
      if (!podeCancelar(t)) return t;
      if (!todos && !ids.has(t.para)) return t;
      return fundirTarefa(t, { id: t.id, status: "cancelled", resultado: { motivo: "Parada pedida pelo chefe" } }, em) ?? t;
    });
    return { ...p, tarefas };
  }
  return p;
}

export function marcarCancelada(p: PacoteColab, id: string, em = Date.now()): PacoteColab {
  return aplicarEvento(p, { type: "colab.tarefa", id, status: "cancelled", resultado: { motivo: "Cancelada no painel" } }, em);
}

/** Empurra a primeira tarefa da fila para Fazendo — o mesmo caminho do evento colab.tarefa. */
export function simularAndamento(p: PacoteColab, em = Date.now()): PacoteColab {
  const fila = p.tarefas.find((t) => t.status === "queued");
  if (fila) {
    return aplicarEvento(p, {
      type: "colab.tarefa",
      id: fila.id,
      de: fila.de,
      para: fila.para,
      objetivo: fila.objetivo,
      status: "running",
      progresso: 15,
    }, em);
  }
  const fazendo = p.tarefas.find((t) => t.status === "running");
  if (!fazendo) return p;
  const progresso = Math.min(100, fazendo.progresso + 20);
  const status: StatusTarefa = progresso >= 100 ? "done" : "running";
  return aplicarEvento(p, {
    type: "colab.tarefa",
    id: fazendo.id,
    de: fazendo.de,
    para: fazendo.para,
    status,
    progresso,
    resultado: status === "done" ? { resumo: "Entrega simulada no painel" } : undefined,
  }, em);
}
