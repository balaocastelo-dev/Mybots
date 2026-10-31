// Automode: níveis de controle do chefe sobre os bots.
//   supervisionado — pede aprovação para o que muda algo; faz perguntas quando tem dúvida (padrão).
//   autonomo       — aprova sozinho o que é seguro/médio e edições no workspace; só pede para o destrutivo.
//   deus           — MODO DEUS EXTREMO: aprova tudo sozinho, sem perguntas (ask_user vira "decida e siga").
// O nível vem do bot (mybots-node.json → approval.mode) e pode ser sobrescrito globalmente pelo Hub.

export type ControlMode = "supervisionado" | "autonomo" | "deus";

export const CONTROL_MODES: ControlMode[] = ["supervisionado", "autonomo", "deus"];

export const CONTROL_LABELS: Record<ControlMode, string> = {
  supervisionado: "Supervisionado",
  autonomo: "Autônomo",
  deus: "MODO DEUS EXTREMO",
};

export const CONTROL_DESCRIPTIONS: Record<ControlMode, string> = {
  supervisionado: "Pede aprovação para comandos que mudam algo, escrita fora do workspace e gastos; pergunta quando tem dúvida.",
  autonomo: "Aprova sozinho comandos seguros e médios e edições dentro do workspace; só pede para o destrutivo/irreversível (apagar, formatar, pagar, mexer fora do projeto, matar processos).",
  deus: "Faz tudo sozinho, mesmo com riscos: aprova tudo, não faz perguntas. Tudo fica no registro de auditoria. Nunca expõe chaves nem mexe na porta 8787.",
};

/** Estado global do Hub: `global` sobrescreve o nível de todos os bots; null = cada bot usa o seu. */
export type ControlState = { global: ControlMode | null };

export const isControlMode = (v: unknown): v is ControlMode => typeof v === "string" && (CONTROL_MODES as string[]).includes(v);

/** Nível em vigor para um bot. */
export const effectiveControl = (globalMode: ControlMode | null | undefined, botMode: ControlMode | undefined): ControlMode =>
  globalMode ?? botMode ?? "supervisionado";

export type ApprovalKind =
  /** comando no terminal */
  | "command"
  /** escrever fora do workspace */
  | "write_outside"
  /** request_approval (pagar, enviar, publicar...) */
  | "action"
  /**
   * Publicar para fora ou falar como o chefe: post no Instagram/Facebook, e-mail enviado.
   * Regra do o chefe: nada sai para o mundo sem o OK dele. Por isso NEM o MODO DEUS dispensa.
   */
  | "publicacao"
  /**
   * Pagar ou enviar. Preencher o cartão não entra aqui: o clique final sim.
   * Nem o MODO DEUS dispensa.
   */
  | "pagamento";

/**
 * Decide se uma ação precisa passar pelo chefe neste nível.
 *   supervisionado: tudo pede.
 *   autonomo: comandos de risco baixo/médio e ações de risco baixo passam; alto, escrita fora e ações médias/altas pedem.
 *   deus: nada pede.
 */
export function needsHumanApproval(mode: ControlMode, kind: ApprovalKind, risk: "low" | "medium" | "high"): boolean {
  // publicar para fora sempre passa pelo chefe, em qualquer modo — inclusive MODO DEUS
  if (kind === "publicacao" || kind === "pagamento") return true;
  if (mode === "deus") return false;
  if (mode === "supervisionado") return true;
  // autonomo
  if (kind === "command") return risk === "high";
  if (kind === "write_outside") return true;
  return risk !== "low";
}

/** Pagar, comprar ou enviar. Preencher um campo não entra aqui. */
export function textoExigeChefe(texto: string): boolean {
  return /\b(pagar|pagamento|comprar|enviar|mandar|submit|send|pay|buy)\b/i.test(texto);
}

/** request_approval de pagar/enviar não passa no MODO DEUS. O resto segue o nível. */
export function tipoDeAprovacao(texto: string): ApprovalKind {
  return textoExigeChefe(texto) ? "pagamento" : "action";
}

/** Texto curto para o prompt de sistema do bot. */
export function controlPromptLine(mode: ControlMode): string {
  switch (mode) {
    case "deus":
      return "- MODO DE CONTROLE: MODO DEUS EXTREMO. O chefe autorizou você a fazer TUDO sozinho, mesmo com riscos: nada pede aprovação e você NÃO faz perguntas (ask_user responde 'decida você mesmo'). Decida, execute e relate o que fez. Limites absolutos que continuam valendo: nunca imprimir chaves, tokens ou senhas; nunca mexer no processo da porta 8787 (Portal de Agentes); PUBLICAR PARA FORA (post no Instagram/Facebook, e-mail enviado) continua pedindo o OK do chefe; e PAGAR ou ENVIAR (clique de pagar, checkout, mensagem) também — preencher o cartão não dispensa esse clique. O MODO DEUS não dispensa isso.";
    case "autonomo":
      return "- MODO DE CONTROLE: Autônomo. Comandos seguros/médios e edições dentro do workspace rodam sem pedir; só o destrutivo/irreversível (apagar, formatar, pagar, mexer fora do projeto, matar processos) pede aprovação. Evite perguntar o que você consegue decidir sozinho.";
    default:
      return "- MODO DE CONTROLE: Supervisionado. Comandos que mudam algo pedem aprovação automática (isso é normal, não evite). Se faltar informação, pergunte ao chefe com opções curtas.";
  }
}
