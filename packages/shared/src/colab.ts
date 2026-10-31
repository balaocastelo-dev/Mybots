// Contrato da colaboração entre bots. A tela e os outros PRs importam daqui.
// O envelope no WebSocket da interface é { type: "colab", ...evento }.

export type StatusTarefa = "queued" | "running" | "waiting" | "done" | "failed" | "cancelled";

export type ResultadoTarefa = {
  resumo: string;
  arquivos?: string[];
  motivo?: string;
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
