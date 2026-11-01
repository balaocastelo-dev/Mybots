// Limites da colaboração. A delegação importa daqui.
// Assinatura estável: checarColab({ de, para, tipo, profundidade }) e registrarAuditoria(evento).

export const PROFUNDIDADE_MAXIMA = 3;
export const TAXA_POR_REMETENTE = 30;
export const TAXA_POR_PAR = 10;
export const TAXA_JANELA_MS = 60_000;

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

type Contexto = {
  empresaDe: (id: string) => string | null;
  liberado: (empresaA: string, empresaB: string) => boolean;
  gravar: (evento: EventoAuditoria) => void;
  agora: () => number;
};

let ctx: Contexto = {
  empresaDe: () => null,
  liberado: () => false,
  gravar: () => {},
  agora: () => Date.now(),
};

const hits: Array<{ de: string; para: string; t: number }> = [];

/** Liga empresa, permissão e o destino da auditoria. O Hub chama isto ao subir. */
export function ligarSeguranca(parcial: Partial<Contexto>) {
  ctx = { ...ctx, ...parcial };
}

export function resetarContadoresColab() {
  hits.length = 0;
}

export function registrarAuditoria(evento: EventoAuditoria): void {
  const quando = evento.quando ?? ctx.agora();
  const acao = evento.acao.startsWith("colab.") ? evento.acao : `colab.${evento.acao}`;
  ctx.gravar({ ...evento, acao, quando });
}

/**
 * Profundidade máxima 3 (0–3 passam). Taxa: 30/min por remetente e 10/min no par.
 * Empresa diferente só com liberação explícita. Bot sem empresa (sistema) não é outra empresa.
 */
export function checarColab(pedido: PedidoColab): ResultadoColab {
  const de = String(pedido.de ?? "");
  const para = String(pedido.para ?? "");
  const agora = ctx.agora();
  const recentes = hits.filter((h) => agora - h.t < TAXA_JANELA_MS);
  hits.length = 0;
  hits.push(...recentes, { de, para, t: agora });
  const doRemetente = hits.filter((h) => h.de === de);
  const doPar = doRemetente.filter((h) => h.para === para);

  const falha = (motivo: MotivoChecagem): ResultadoColab => {
    registrarAuditoria({
      acao: "colab.bloqueio", de, para,
      detalhe: { motivo, tipo: pedido.tipo, profundidade: pedido.profundidade },
    });
    return { ok: false, motivo };
  };

  if (!Number.isFinite(pedido.profundidade) || pedido.profundidade < 0 || pedido.profundidade > PROFUNDIDADE_MAXIMA) {
    return falha("profundidade");
  }
  if (doRemetente.length > TAXA_POR_REMETENTE || doPar.length > TAXA_POR_PAR) return falha("taxa");
  if (empresaBloqueia(de, para)) return falha("empresa");
  return { ok: true };
}

function empresaBloqueia(de: string, para: string): boolean {
  if (de === "humano" || para === "humano") return false;
  const a = ctx.empresaDe(de);
  const b = ctx.empresaDe(para);
  if (!a || !b || a === b) return false;
  return !ctx.liberado(a, b);
}

/** O painel não manda `de`. `de: "humano"` também é o chefe. Qualquer outro id não conta. */
export function aprovacaoDoPainel(de: string | undefined | null): boolean {
  return de == null || de === "" || de === "humano";
}

/** Só uma mensagem cujo autor é exatamente "humano" libera envio para fora. */
export function mensagemLiberaEnvioExterno(autor: string | undefined | null): boolean {
  return autor === "humano";
}

export type AcaoGate = "envio" | "pagamento" | "exclusao";

/** Envio externo, pagamento e exclusão. O resto não entra no gate. */
export function classificarAcaoSensivel(tool: string, input: unknown, description = ""): AcaoGate | null {
  const nome = String(tool ?? "").toLowerCase();
  const dados = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const acao = String(dados.acao ?? dados.action ?? "").toLowerCase();
  const texto = `${acao} ${description}`.toLowerCase();

  if (nome === "whatsapp" || nome === "whatsapp_proprio") {
    if (acao === "enviar" || acao === "foto" || acao === "documento") return "envio";
    return null;
  }
  if (nome === "email") return acao === "enviar" || /enviar/.test(texto) ? "envio" : null;
  if (nome === "redes_sociais") return dados.publicar_de_verdade === true || /publicar/.test(texto) ? "envio" : null;
  if (nome === "publicacao") return "envio";
  if (nome === "gerenciar_bot") return acao === "excluir" ? "exclusao" : null;
  if (nome === "navegador" || nome === "celular" || nome === "action" || nome === "request_approval") {
    if (/pagar|pagamento|\bpix\b|transfer/.test(texto)) return "pagamento";
    if (/apag|exclu|delet|format|reset/.test(texto)) return "exclusao";
    if (/enviar|publicar|postar|whatsapp|e-mail|email|mandar mensagem/.test(texto)) return "envio";
    return null;
  }
  return null;
}
