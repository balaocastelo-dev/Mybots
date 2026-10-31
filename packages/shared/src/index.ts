// Protocolo compartilhado entre Hub, Nós e Interface. Tudo é JSON por WebSocket.

import type { ControlMode, ControlState } from "./control.ts";
import type { Attachment, MediaKind } from "./media.ts";

export const PROTOCOL_VERSION = 1;

export type BotInfo = {
  id: string;        // slug: joao-videomaker
  name: string;      // João Videomaker
  role: string;      // "Videomaker da empresa"
  avatar?: string;   // emoji ou URL
  color?: string;    // cor do avatar (#hex)
  voice?: string;    // nome da voz TTS preferida (ex.: "pt-BR-AntonioNeural" ou "Google português do Brasil")
};

export type Sender = { kind: "user" | "bot" | "system"; id: string; name: string };

export type Risk = "low" | "medium" | "high";

/** Eventos que um Bot emite enquanto trabalha numa conversa. */
export type BotEvent =
  | { kind: "text.delta"; messageId: string; text: string }
  | { kind: "text.done"; messageId: string; text: string }
  | { kind: "tool.start"; messageId: string; callId: string; tool: string; input: unknown }
  | { kind: "tool.done"; messageId: string; callId: string; tool: string; output: string; ok: boolean }
  | { kind: "approval.request"; requestId: string; tool: string; input: unknown; risk: Risk; description: string }
  | { kind: "question"; questionId: string; question: string; options: string[]; cartao?: CartaoDeAcao }
  | { kind: "file"; messageId: string; name: string; path: string; mime?: string }
  | { kind: "error"; message: string };

/** Nó → Hub */
export type NodeToHub =
  | {
      type: "hello";
      protocol: number;
      token: string;
      bot: BotInfo;
      engine: "direct" | "opencode";
      provider: string;
      model: string;
      version: string;
      /** nível de controle configurado no nó (approval.mode) */
      controlMode?: ControlMode;
    }
  | { type: "heartbeat" }
  /** registro de auditoria (ex.: aprovação automática no modo autônomo/deus) */
  | { type: "audit"; action: string; detail?: unknown }
  | { type: "status"; text: string; busy: boolean }
  | { type: "event"; conversationId: string; event: BotEvent }
  | { type: "ask_bot"; callId: string; conversationId: string; to: string; text: string; wait: boolean }
  | { type: "list_bots"; callId: string }
  /** cuidar da equipe pelo caminho certo: o Hub é quem manda em bot, não o PowerShell */
  | { type: "manage_bot"; callId: string; acao: "excluir" | "parar" | "ligar" | "reiniciar"; bot: string; apagarArquivos?: boolean }
  | { type: "criar_bot"; callId: string; nome: string; funcao?: string; persona?: string }
  | { type: "remember"; key: string; value: string }
  | { type: "recall"; callId: string; key: string }
  | { type: "search_knowledge"; callId: string; query: string; limit?: number; /** ler um verbete inteiro, em pedaços de ~4000 chars */ id?: string; parte?: number }
  | { type: "whatsapp_send"; callId: string; acao?: "estado" | "enviar" | "foto" | "documento"; para?: string; texto?: string;
      arquivo?: { base64: string; nome: string; mime: string; legenda?: string } }
  | { type: "uso"; modelo: string; entrada?: number; saida?: number; cacheLido?: number; cacheGravado?: number }
  | { type: "learn_knowledge"; callId: string; titulo: string; resumo: string; conteudo: string; tipo?: SaberTipo; tags?: string[] }
  | { type: "notify"; text: string }
  /** arquivo gerado pelo bot (imagem, planilha, vídeo pequeno) — base64 */
  | { type: "upload"; callId: string; conversationId: string; messageId: string; name: string; mime: string; dataBase64: string; caption?: string }
  | { type: "schedule"; callId: string; name: string; cron: string; prompt: string }
  | { type: "list_routines"; callId: string }
  | { type: "cancel_routine"; callId: string; id: string }
  /** pede ao Hub para gerar imagem/vídeo (provedores + cota ficam no Hub); o resultado entra na conversa como arquivo */
  | { type: "generate_media"; callId: string; conversationId: string; kind: MediaKind; prompt: string; refFileId?: string; seconds?: number; aspect?: string }
  /** gravar a tela do PC da empresa (o Hub é quem enxerga o container) */
  | { type: "gravar_tela"; callId: string; acao: "iniciar" | "parar" | "estado"; conversationId?: string; legenda?: string; onde?: "pc" | "celular" }
  /** o celular da empresa do bot, via ADB no Hub. aprovado = o chefe já liberou uma ação sensível */
  | { type: "celular"; callId: string; acao: string; conversationId?: string; x?: number; y?: number; x2?: number; y2?: number; texto?: string; tecla?: string; pacote?: string; aprovado?: boolean };

/** Hub → Nó */
export type HubToNode =
  | { type: "hello.ok"; botId: string; hubVersion: string; /** índice da base comum: o bot nasce sabendo o que a casa sabe */ knowledge?: string; /** processo do Hub: o nó usa para nunca matar quem o mantém de pé */ hubPid?: number }
  /** silent = só adiciona ao contexto, sem responder (falas de outros bots num grupo) */
  | { type: "message"; conversationId: string; messageId: string; from: Sender; text: string; silent?: boolean; attachments?: Attachment[] }
  | { type: "approval.response"; requestId: string; allow: boolean; remember?: boolean }
  | { type: "question.answer"; questionId: string; answer: string }
  /** conversationId "*" = tudo (botão de pânico) */
  | { type: "abort"; conversationId: string }
  /** nível global do Hub que sobrescreve o do nó (null = usa o do nó) */
  | { type: "control"; override: ControlMode | null }
  /** base comum mudou: o Hub reenvia o bloco de herança para quem já está conectado */
  | { type: "knowledge"; knowledge: string }
  | { type: "result"; callId: string; ok: boolean; data: unknown }
  /** o histórico daquela conversa mudou (rebobinar/editar/apagar): o nó troca o que tinha pelo que vem aqui */
  | { type: "history.reset"; conversationId: string; messages: Array<{ role: "user" | "assistant"; content: string }> }
  /** fatal = não adianta tentar de novo (bot excluído, token recusado): o nó encerra. */
  | { type: "error"; message: string; fatal?: boolean };

export type StoredMessage = {
  id: string;
  conversationId: string;
  sender: Sender;
  text: string;
  createdAt: number;
  meta?: Record<string, unknown>;
  /** marcada pelo chefe no menu do chat */
  pinned?: boolean;
  /** versão de outra mensagem (pedido editado) */
  editOf?: string;
};

export type BotSummary = BotInfo & {
  /** empresa dona do bot; vazio = bot do sistema, acima das empresas */
  empresaId?: string | null;
  /** ponte: pode falar com bots de outras empresas */
  ponte?: boolean;
  online: boolean;
  busy: boolean;
  status: string;
  engine?: string;
  provider?: string;
  model?: string;
  lastSeen?: number;
  preview?: string;
  unread?: number;
  /** criado pela interface e hospedado no PC do Hub */
  managed?: boolean;
  /** bot do sistema (o Médico): não pode ser excluído */
  protegido?: boolean;
  /** nível de controle configurado no nó (o global do Hub pode sobrescrever) */
  controlMode?: ControlMode;
  /** se for gerente: ids dos bots que ele comanda */
  manages?: string[];
  /** gerente da empresa: usa a coroa mesmo sem equipe montada ainda */
  gerente?: boolean;
};

export type PendingApproval = {
  id: string;
  botId: string;
  conversationId: string;
  tool: string;
  input: unknown;
  risk: Risk;
  description: string;
  createdAt: number;
};

export type Routine = {
  id: string;
  botId: string;
  name: string;
  cron: string;        // 5 campos: min hora dia mês dia-semana
  prompt: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  createdAt: number;
};

export type Group = { id: string; name: string; members: string[]; createdAt: number };

export type StoredFile = { id: string; name: string; mime: string; size: number; botId: string; createdAt: number; url: string };

/** Um pedido de ação na tela: o bot travou e deixou o caminho pronto para o
 *  chefe destravar com um toque. Sem isso ele só devolve o problema cru. */
export type CartaoDeAcao = {
  /** o tipo de coisa que precisa ser feita, ex.: "Computador" */
  titulo: string;
  /** o texto do botão principal, ex.: "Abrir computador" */
  botao: string;
};

export type PendingQuestion = {
  id: string;
  botId: string;
  conversationId: string;
  question: string;
  options: string[];
  createdAt: number;
  /** presente = a interface desenha um cartão de ação em vez de uma pergunta */
  cartao?: CartaoDeAcao;
};

/** Interface → Hub */
export type UiToHub =
  | { type: "subscribe" }
  | { type: "send"; conversationId: string; text: string; attachments?: Array<{ name: string; mime: string; dataBase64: string }> }
  | { type: "approval.response"; requestId: string; allow: boolean; remember?: boolean }
  | { type: "question.answer"; questionId: string; answer: string }
  /** botId = para ESTE bot inteiro (todas as conversas dele), não só esta conversa */
  | { type: "abort"; conversationId: string; botId?: string }
  /** PARAR TUDO: toda janela, todo bot, toda fala. O ⏹ grande, o Esc e o fechar da janela. */
  | { type: "stop"; reason?: string };

/** Hub → Interface */
export type HubToUi =
  | { type: "snapshot"; bots: BotSummary[]; approvals: PendingApproval[]; questions: PendingQuestion[]; groups: Group[]; routines: Routine[]; voice: VoiceConfig; control: ControlState; importFile?: { name: string; mime: string; dataBase64: string } }
  | { type: "control"; control: ControlState }
  | { type: "groups"; groups: Group[] }| { type: "groups"; groups: Group[] }
  | { type: "routines"; routines: Routine[] }
  | { type: "bot.update"; bot: BotSummary }
  | { type: "bot.removed"; botId: string }
  | { type: "knowledge"; total: number }
  | { type: "creditos"; empresaId: string; saldoCentavos: number }
  | { type: "whatsapp"; estado: { empresaId: string; estado: "desligado" | "qr" | "conectando" | "conectado"; qr?: string; numero?: string; desde?: number; erro?: string } }
  | { type: "import.request"; file: { name: string; mime: string; dataBase64: string } }
  | { type: "message"; message: StoredMessage }
  | { type: "message.delta"; conversationId: string; messageId: string; text: string }
  /** Chamada de voz: frase pronta (já sem o raciocínio do modelo) para a interface falar enquanto o bot ainda escreve. */
  | { type: "speech.delta"; conversationId: string; botId: string; messageId: string; text: string }
  | { type: "speech.done"; conversationId: string; botId: string; messageId: string }
  | { type: "tool"; conversationId: string; messageId: string; callId: string; tool: string; phase: "start" | "done"; input?: unknown; output?: string; ok?: boolean }
  | { type: "approval.request"; approval: PendingApproval }
  | { type: "approval.resolved"; requestId: string; allow: boolean }
  | { type: "question"; question: PendingQuestion }
  | { type: "question.resolved"; questionId: string; answer: string }
  | { type: "status"; botId: string; text: string; busy: boolean }
  | { type: "notify"; botId: string; text: string }
  /** Quem usou o PC da empresa por último. Um PC por empresa, compartilhado pelos bots dela. */
  | { type: "pc.uso"; empresaId: string; uso: UsoDoPc }
  /** A gravação da tela da empresa começou ou parou. */
  | { type: "pc.gravacao"; empresaId: string; gravando: boolean; desde?: number; nome?: string; onde?: "pc" | "celular" }
  | { type: "celular.uso"; empresaId: string; uso: UsoDoPc }
  /** o histórico mudou (rebobinou, editou, apagou, fixou): quem está com essa conversa aberta recarrega */
  | { type: "conversation.changed"; conversationId: string }
  /** o Hub mandou parar tudo: toda janela cala a fala, fecha o microfone e esquece o que estava gerando */
  | { type: "stop"; reason?: string }
  | { type: "error"; message: string };

/** Uma ação de navegador ou de tela no PC da empresa. O texto digitado não entra aqui. */
export type AcaoNaTela = {
  botId: string;
  nome: string;
  ferramenta: string;
  resumo: string;
  quando: number;
};

/** O bot da última ação é quem está usando o PC agora. O histórico é o mais novo primeiro. */
export type UsoDoPc = {
  usando: AcaoNaTela | null;
  historico: AcaoNaTela[];
};

export type VoiceConfig = { stt: boolean; tts: boolean; ttsEngine: string; sttEngine: string };

/** Conversa direta usuário↔bot */
export const dmConversation = (botId: string) => `dm:${botId}`;
/** Conversa em grupo (vários bots + usuário) */
export const groupConversation = (groupId: string) => `group:${groupId}`;
export const groupOfConversation = (conversationId: string): string | null =>
  conversationId.startsWith("group:") ? conversationId.slice(6) : null;
/** Conversa vinda de um canal externo (WhatsApp etc.) */
export const channelConversation = (channel: string, from: string, botId: string) => `channel:${channel}:${from}:${botId}`;
/** Conversa bot↔bot (ordem fixa para os dois lados usarem o mesmo id) */
export const pairConversation = (a: string, b: string) => `pair:${[a, b].sort().join(":")}`;
/** Bot envolvido numa conversa dm */
export const botOfConversation = (conversationId: string): string | null =>
  conversationId.startsWith("dm:") ? conversationId.slice(3) : null;

export const newId = (prefix = "") =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---- base de conhecimento comum a todos os bots ----
/** Tipo de verbete: o que ele ensina ao bot. */
export type SaberTipo = "identidade" | "historia" | "skill" | "conhecimento" | "procedimento" | "ferramenta" | "contato" | "produto";
export const SABER_TIPOS: SaberTipo[] = ["identidade", "historia", "skill", "conhecimento", "procedimento", "ferramenta", "contato", "produto"];
export const SABER_LABELS: Record<SaberTipo, string> = {
  identidade: "Identidade da casa (vai inteiro no prompt de todo bot)",
  historia: "História e memória do dono",
  skill: "Habilidade (como fazer)",
  conhecimento: "Conhecimento (o que é)",
  procedimento: "Procedimento da casa",
  ferramenta: "Ferramenta, API ou MCP (o que ela faz e como chamar)",
  contato: "Pessoa ou fornecedor",
  produto: "Produto ou serviço",
};

/** Um verbete da base comum. Todo bot nasce sabendo que ele existe e busca quando precisa. */
export type Saber = {
  id: string;
  titulo: string;
  /** uma linha: quando usar isto. É o que entra no índice que todo bot carrega. */
  resumo: string;
  conteudo: string;
  tipo: SaberTipo;
  /** empresa dona; vazio = saber da casa, que toda empresa lê */
  empresaId?: string;
  tags: string[];
  /** vazio = todos os bots; senão só os ids listados */
  bots?: string[];
  origem?: string;
  criadoEm: number;
  atualizadoEm: number;
  /** quantas vezes algum bot consultou (ajuda a ver o que presta) */
  usos?: number;
};

export type SaberHit = { id: string; titulo: string; resumo: string; tipo: SaberTipo; tags: string[]; trecho: string };

export * from "./speech.ts";
export * from "./instance.ts";
export * from "./control.ts";
export * from "./media.ts";
export * from "./resources.ts";

/** Uma empresa: o conjunto de bots, gerentes e regras que andam juntos. */
export type Idioma = "pt" | "en" | "es";
export const IDIOMAS: Array<{ id: Idioma; nome: string }> = [
  { id: "pt", nome: "Português (Brasil)" }, { id: "en", nome: "English" }, { id: "es", nome: "Español" },
];
export type Empresa = { id: string; nome: string; regras: string; cor?: string; idioma: Idioma; criadaEm: number; bots: number };
export * from "./cotas.js";
