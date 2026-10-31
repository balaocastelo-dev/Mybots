/**
 * Contrato de colaboração (docs/colaboracao.md, PR do backend — ainda fora da main).
 *
 * REST:
 * - POST /api/colab/mensagens { de, para, texto, prioridade, contexto? } → { id }
 * - GET  /api/colab/conversas?bot= → [{ id:'pair:<a>:<b>', bots, ultimaEm }]
 * - GET  /api/colab/conversas/:id/mensagens
 * - POST /api/colab/tarefas { de, para, objetivo, contexto, criterioSucesso, prazo?, formatoEntrega?, profundidade? } → { id, status:'queued' }
 * - GET  /api/colab/tarefas?bot=&status=
 * - GET  /api/colab/tarefas/:id
 * - POST /api/colab/tarefas/:id/cancelar
 * - GET  /api/colab/salas  e  POST /api/colab/salas { nome, instrucoes, membros }
 * - POST /api/colab/salas/:id/mensagens
 * - GET  /api/colab/auditoria?bot=&desde=
 * - GET/PUT /api/colab/permissoes-empresa
 * - POST /api/colab/parar { de:'humano', alvo:'todos'|botId[] }
 *
 * Eventos no WebSocket já existente:
 * - colab.mensagem { id, de, para, prioridade }
 * - colab.tarefa { id, de, para, status, resultado?: { resumo, arquivos?: string[], motivo? }, progresso? }
 * - colab.ajudando { bot, ajudando, tarefaId|null }
 * - colab.sala { salaId, msgId }
 * - colab.bloqueio { motivo:'profundidade'|'taxa'|'empresa'|'aprovacao', de, para }
 * - colab.parar { alvo, por }
 */

export type StatusTarefa = "queued" | "running" | "waiting" | "done" | "failed" | "cancelled";

export const STATUS_TAREFA: StatusTarefa[] = ["queued", "running", "waiting", "done", "failed", "cancelled"];

export type ResultadoTarefa = {
  resumo?: string;
  arquivos?: string[];
  motivo?: string;
};

export type PassoTarefa = {
  em: number;
  status: StatusTarefa;
  texto: string;
};

export type Tarefa = {
  id: string;
  de: string;
  para: string;
  objetivo: string;
  contexto?: string;
  criterioSucesso?: string;
  prazo?: number;
  formatoEntrega?: string;
  profundidade?: number;
  status: StatusTarefa;
  /** 0–100. O contrato não obriga o campo; a UI deriva quando ele não vem. */
  progresso: number;
  resultado?: ResultadoTarefa;
  historico: PassoTarefa[];
  criadaEm: number;
  atualizadaEm: number;
  empresaId?: string;
};

export type ConversaColab = {
  id: string;
  bots: string[];
  ultimaEm: number;
  ultima?: string;
  quantas: number;
};

export type MensagemColab = {
  id: string;
  conversaId: string;
  de: string;
  para?: string;
  nomeDe?: string;
  texto: string;
  em: number;
  prioridade?: boolean;
};

export type SalaColab = {
  id: string;
  nome: string;
  instrucoes?: string;
  membros: string[];
  aberta: boolean;
};

export type ItemAuditoria = {
  id: string;
  em: number;
  botId?: string;
  acao: string;
  detalhe: string;
  motivo?: string;
};

export type Ajudando = { ajudando: string; tarefaId: string | null };

export type FonteColab = "api" | "exemplo";

export type PacoteColab = {
  fonte: FonteColab;
  aviso: string;
  tarefas: Tarefa[];
  conversas: ConversaColab[];
  mensagens: MensagemColab[];
  salas: SalaColab[];
  auditoria: ItemAuditoria[];
  ajudando: Record<string, Ajudando>;
};

export type ColunaId = "queued" | "running" | "waiting" | "feito";

export const COLUNAS: Array<{ id: ColunaId; titulo: string; statuses: StatusTarefa[] }> = [
  { id: "queued", titulo: "Na fila", statuses: ["queued"] },
  { id: "running", titulo: "Fazendo", statuses: ["running"] },
  { id: "waiting", titulo: "Esperando", statuses: ["waiting"] },
  { id: "feito", titulo: "Pronto / Falhou", statuses: ["done", "failed", "cancelled"] },
];

export const ROTULO_STATUS: Record<StatusTarefa, string> = {
  queued: "Na fila",
  running: "Fazendo",
  waiting: "Esperando",
  done: "Pronto",
  failed: "Falhou",
  cancelled: "Cancelada",
};
