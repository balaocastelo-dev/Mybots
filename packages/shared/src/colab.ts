// Contrato da colaboração entre bots. A tela e os outros PRs importam daqui.
// O envelope no WebSocket da interface é { type: "colab", ...evento }.

/** Estado de uma tarefa na fila de um bot (o destinatário). */
export type StatusTarefa = "queued" | "running" | "waiting" | "done" | "failed" | "cancelled";

export const STATUS_TAREFA: readonly StatusTarefa[] = ["queued", "running", "waiting", "done", "failed", "cancelled"];

/**
 * O que volta quando a tarefa termina.
 * `motivo` acompanha failed e cancelled. `arquivos` é opcional em qualquer desfecho.
 */
export type ResultadoTarefa = {
  resumo: string;
  arquivos?: string[];
  motivo?: string;
};

/** Tarefa persistida. `profundidade` 0 = criada por humano; cada delegação soma 1. */
export type TarefaColab = {
  id: string;
  de: string;
  para: string;
  objetivo: string;
  contexto: string;
  criterioSucesso: string;
  /** epoch em milissegundos; null = sem prazo */
  prazo: number | null;
  formatoEntrega: string | null;
  status: StatusTarefa;
  profundidade: number;
  tarefaMaeId: string | null;
  resultado?: ResultadoTarefa;
  criadaEm: number;
  atualizadaEm: number;
};

/** Pedido que o Hub recebe em POST /api/colab/tarefas (antes de calcular a profundidade). */
export type PedidoTarefa = {
  de: string;
  para: string;
  objetivo: string;
  contexto: string;
  criterioSucesso: string;
  prazo?: number | null;
  formatoEntrega?: string | null;
};

export type MotivoBloqueioColab = "profundidade" | "taxa" | "empresa" | "aprovacao";

export type ColabEvento =
  | { tipo: "colab.mensagem"; id: string; de: string; para: string; prioridade: boolean }
  | { tipo: "colab.tarefa"; id: string; de: string; para: string; status: StatusTarefa; resultado?: ResultadoTarefa }
  | { tipo: "colab.ajudando"; bot: string; ajudando: string | null; tarefaId: string | null }
  | { tipo: "colab.sala"; salaId: string; msgId: string }
  | { tipo: "colab.bloqueio"; motivo: MotivoBloqueioColab; de: string; para: string }
  | { tipo: "colab.parar"; alvo: "todos" | string[]; por: string };

export type ColabWs = { type: "colab" } & ColabEvento;
