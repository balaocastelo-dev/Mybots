// Stub mínimo. Assinaturas iguais às do PR #15 (colaboração: segurança).
// Se aquele PR entrar na main antes, apague este arquivo no rebase e fique com o de lá.
// Aqui checarColab sempre deixa passar e registrarAuditoria não grava.
// O arquivo de verdade aplica profundidade máxima 3, taxa e empresa.

export type TipoColab = "mensagem" | "tarefa";
export type MotivoChecagem = "profundidade" | "taxa" | "empresa";

export type PedidoColab = {
  de: string;
  para: string;
  tipo: TipoColab;
  profundidade: number;
};

export type ResultadoColab =
  | { ok: true }
  | { ok: false; motivo: MotivoChecagem };

export type EventoAuditoria = {
  acao: string;
  de?: string | null;
  para?: string | null;
  detalhe?: unknown;
  quando?: number;
};

export function checarColab(_pedido: PedidoColab): ResultadoColab {
  return { ok: true };
}

export function registrarAuditoria(_evento: EventoAuditoria): void {}
