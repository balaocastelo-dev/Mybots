// Cliente da interface: WebSocket com o Hub + estado reativo.
import { useEffect, useReducer, useRef } from "react";
import { faseDoStatus, type BotSummary, type ControlState, type Group, type HubToUi, type PendingApproval, type PendingQuestion, type Routine, type StoredMessage, type UiToHub, type VoiceConfig } from "@mybots/shared";

export type ToolInfo = { callId: string; tool: string; input?: unknown; output?: string; ok?: boolean; done: boolean };

export type State = {
  connected: boolean;
  groups: Group[];
  routines: Routine[];
  voice: VoiceConfig;
  control: ControlState;
  bots: BotSummary[];
  messages: Record<string, StoredMessage[]>;
  tools: Record<string, ToolInfo[]>; // por messageId
  approvals: PendingApproval[];
  questions: PendingQuestion[];
  resolvedQuestions: Record<string, string>;
  toasts: Array<{ id: string; text: string; botId?: string; vezes: number; em: number }>;
  importFile?: { name: string; mime: string; dataBase64: string };
};

/** No máximo 3 avisos na tela ao mesmo tempo. Vinte e cinco avisos empilhados
 *  tapam a coluna da direita — foi o que aconteceu. O mais novo fica; o mais
 *  velho sai. Aviso repetido não vira pilha: vira contador no mesmo cartão. */
const MAX_AVISOS = 3;

function empilha(
  toasts: State["toasts"],
  text: string,
  botId?: string,
): State["toasts"] {
  const igual = toasts.find((t) => t.text === text && t.botId === botId);
  // o "em" novo reinicia o relógio dos 3 segundos daquele cartão
  if (igual) return toasts.map((t) => (t === igual ? { ...t, vezes: t.vezes + 1, em: Date.now() } : t));
  return [...toasts, { id: Math.random().toString(36).slice(2), text, botId, vezes: 1, em: Date.now() }].slice(-MAX_AVISOS);
}

type Action =
  | { type: "ws"; msg: HubToUi }
  | { type: "connected"; value: boolean }
  | { type: "history"; conversationId: string; messages: StoredMessage[] }
  | { type: "toast.remove"; id: string }
  | { type: "import.clear" }
  | { type: "import.set"; file: { name: string; mime: string; dataBase64: string } };

const initial: State = { connected: false, groups: [], routines: [], voice: { stt: false, tts: false, ttsEngine: "none", sttEngine: "browser" }, control: { global: null }, bots: [], messages: {}, tools: {}, approvals: [], questions: [], resolvedQuestions: {}, toasts: [] };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "connected": return { ...s, connected: a.value };
    case "history": return { ...s, messages: { ...s.messages, [a.conversationId]: a.messages } };
    case "toast.remove": return { ...s, toasts: s.toasts.filter((t) => t.id !== a.id) };
    case "import.clear": return { ...s, importFile: undefined };
    case "import.set": return { ...s, importFile: a.file };
    case "ws": {
      const m = a.msg;
      switch (m.type) {
        case "snapshot": return { ...s, importFile: m.importFile ?? s.importFile, bots: m.bots, approvals: m.approvals, questions: m.questions, groups: m.groups ?? [], routines: m.routines ?? [], voice: m.voice ?? s.voice, control: m.control ?? s.control };
        case "control": return { ...s, control: m.control };
        case "groups": return { ...s, groups: m.groups };
        case "routines": return { ...s, routines: m.routines };
        case "bot.update": return { ...s, bots: upsert(s.bots, m.bot) };
        // Excluir é acabar com tudo: some o bot, somem as conversas dele, o que estava
        // escrito nelas, as aprovações e perguntas paradas e os avisos na tela. Antes
        // ficava tudo isso no estado e a conversa seguia aberta com um bot que não existe.
        case "bot.removed": {
          const doBot = (conv: string) => conv === `dm:${m.botId}` || (conv.startsWith("pair:") && conv.slice(5).split(":").includes(m.botId));
          const messages = { ...s.messages };
          const tools = { ...s.tools };
          for (const conv of Object.keys(messages)) {
            if (!doBot(conv)) continue;
            for (const msg of messages[conv]) delete tools[msg.id];
            delete messages[conv];
          }
          return {
            ...s,
            bots: s.bots.filter((b) => b.id !== m.botId),
            messages, tools,
            approvals: s.approvals.filter((a) => a.botId !== m.botId),
            questions: s.questions.filter((q) => q.botId !== m.botId),
            toasts: s.toasts.filter((t) => t.botId !== m.botId),
          };
        }
        case "import.request": return { ...s, importFile: m.file };
        case "status": return { ...s, bots: s.bots.map((b) => (b.id === m.botId ? { ...b, status: m.text, busy: m.busy, fase: faseDoStatus(m.text, m.busy, m.fase), online: true } : b)) };
        case "message": {
          const list = s.messages[m.message.conversationId] ?? [];
          const idx = list.findIndex((x) => x.id === m.message.id);
          const next = idx >= 0 ? list.map((x, i) => (i === idx ? m.message : x)) : [...list, m.message];
          return { ...s, bots: comPrevia(s.bots, m.message), messages: { ...s.messages, [m.message.conversationId]: next } };
        }
        case "message.delta": {
          const list = s.messages[m.conversationId] ?? [];
          const atual = list.find((x) => x.id === m.messageId);
          const texto = (x: StoredMessage) => (m.replace ? m.text : x.text + m.text);
          const next = list.map((x) => (x.id === m.messageId ? { ...x, text: texto(x) } : x));
          const bots = atual ? comPrevia(s.bots, { ...atual, text: texto(atual) }) : s.bots;
          return { ...s, bots, messages: { ...s.messages, [m.conversationId]: next } };
        }
        case "tool": {
          const list = s.tools[m.messageId] ?? [];
          const idx = list.findIndex((t) => t.callId === m.callId);
          const info: ToolInfo = idx >= 0 ? { ...list[idx] } : { callId: m.callId, tool: m.tool, done: false };
          if (m.phase === "start") { info.input = m.input; info.done = false; }
          else { info.output = m.output; info.ok = m.ok; info.done = true; }
          const next = idx >= 0 ? list.map((t, i) => (i === idx ? info : t)) : [...list, info];
          return { ...s, tools: { ...s.tools, [m.messageId]: next } };
        }
        case "approval.request": return { ...s, approvals: [...s.approvals.filter((x) => x.id !== m.approval.id), m.approval] };
        case "approval.resolved": return { ...s, approvals: s.approvals.filter((x) => x.id !== m.requestId) };
        case "question": return { ...s, questions: [...s.questions.filter((x) => x.id !== m.question.id), m.question] };
        case "question.resolved": return { ...s, questions: s.questions.filter((x) => x.id !== m.questionId), resolvedQuestions: { ...s.resolvedQuestions, [m.questionId]: m.answer } };
        case "notify": return { ...s, toasts: empilha(s.toasts, m.text, m.botId) };
        case "pc.uso": return s;
        case "pc.gravacao": return s;
        case "celular.uso": return s;
        case "error": return { ...s, toasts: empilha(s.toasts, m.message) };
      }
      return s;
    }
  }
}

function previaDe(m: StoredMessage): string {
  const files = (m.meta?.files as Array<{ name: string }> | undefined) ?? [];
  const quem = m.sender.kind === "user" ? "Você: " : "";
  const arquivo = files[0]?.name;
  const texto = m.text.replace(/\s+/g, " ").trim();
  const miolo = texto || (arquivo ? `📎 ${arquivo}` : "");
  return (quem + miolo).slice(0, 80);
}

/** A lista acompanha o chat mesmo quando o chefe já saiu dele. */
function comPrevia(bots: BotSummary[], m: StoredMessage): BotSummary[] {
  if (!m.conversationId.startsWith("dm:") || m.meta?.hidden || m.meta?.marcador) return bots;
  const id = m.conversationId.slice(3);
  const preview = previaDe(m);
  if (!preview) return bots;
  return bots.map((b) => (b.id === id ? { ...b, preview } : b));
}

function upsert(list: BotSummary[], b: BotSummary) {
  const i = list.findIndex((x) => x.id === b.id);
  return i >= 0 ? list.map((x, j) => (j === i ? b : x)) : [...list, b];
}

export function useHub() {
  const [state, dispatch] = useReducer(reducer, initial);
  const wsRef = useRef<WebSocket | null>(null);
  const listeners = useRef(new Set<(m: HubToUi) => void>());

  useEffect(() => {
    let closed = false;
    let retry = 1000;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/ui${location.search}`);
      wsRef.current = ws;
      ws.onopen = () => { retry = 1000; dispatch({ type: "connected", value: true }); ws.send(JSON.stringify({ type: "subscribe" } satisfies UiToHub)); };
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data) as HubToUi; dispatch({ type: "ws", msg: m }); for (const l of listeners.current) l(m); };
      ws.onclose = () => { dispatch({ type: "connected", value: false }); if (!closed) { setTimeout(connect, retry); retry = Math.min(retry * 2, 15000); } };
    };
    connect();
    return () => { closed = true; wsRef.current?.close(); };
  }, []);

  const send = (m: UiToHub) => wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(m));
  const loadHistory = async (conversationId: string) => {
    const r = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages${location.search}`);
    if (r.ok) dispatch({ type: "history", conversationId, messages: await r.json() });
    void fetch(`/api/conversations/${encodeURIComponent(conversationId)}/read${location.search}`, { method: "POST" });
  };
  const onEvent = (l: (m: HubToUi) => void) => { listeners.current.add(l); return () => { listeners.current.delete(l); }; };
  const removeToast = (id: string) => dispatch({ type: "toast.remove", id });
  const clearImport = () => {
    dispatch({ type: "import.clear" });
    void fetch(`/api/import/clear${location.search}`, { method: "POST" }).catch(() => {});
  };
  const setImport = (file: { name: string; mime: string; dataBase64: string }) => dispatch({ type: "import.set", file });
  return { state, send, loadHistory, onEvent, removeToast, clearImport, setImport };
}
