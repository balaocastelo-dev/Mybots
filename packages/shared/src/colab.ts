// Contrato da delegação de tarefas entre bots. O outro agente (send_to_bot,
// segurança e auditoria) completa a política; aqui ficam só os tipos estáveis.

/** Estado de uma tarefa na fila de um bot (o destinatário). */
export type StatusTarefa = "queued" | "running" | "waiting" | "done" | "failed" | "cancelled";

export const STATUS_TAREFA: readonly StatusTarefa[] = ["queued", "running", "waiting", "done", "failed", "cancelled"];

/** Motivo devolvido por checarColab. Quem aplica a regra é o módulo de segurança. */
export type MotivoBloqueioColab = "profundidade" | "taxa" | "empresa";

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
