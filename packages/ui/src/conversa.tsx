import { Fragment, useEffect, useRef, useState } from "react";
import type { BotSummary, ControlState, Group, PendingApproval, PendingQuestion, Routine, StoredMessage } from "@mybots/shared";
import { CONTROL_DESCRIPTIONS, CONTROL_LABELS, effectiveControl, faseDoStatus } from "@mybots/shared";
import { useHub, type ToolInfo } from "./hub";
import { registrarParada, stopEverything } from "./stop";
import { criarFala, escolherMicrofone, escutaContinua, isSpeaking, listenOnce, microfoneEscolhido, microfones, onSpeaking, speak, speechSupported, stopSpeaking, type EscutaViva, type FalaViva, type VoiceCaps } from "./voice";
import { ContextMenu, type ItemMenu } from "./ContextMenu";
import { ChipTrocas, FolhaAbrirTroca, type Troca } from "./painel";
import { PainelDoPc } from "./painelPc";
import { api } from "./api";
import { Avatar } from "./avatar";
import { ApprovalCard, Bolha, Message, QuestionCard, Visualizador, type ArquivoDoChat } from "./mensagem";
import { DesktopAoVivo } from "./desktop";
import { BotSettingsPanel, RoutinesPanel } from "./dialogos";

export type Target = { kind: "bot"; bot: BotSummary } | { kind: "group"; group: Group };

export type ConvProps = {
  target: Target; conversationId: string; bots: BotSummary[]; messages: StoredMessage[]; tools: Record<string, ToolInfo[]>;
  approvals: PendingApproval[]; questions: PendingQuestion[]; resolvedQuestions: Record<string, string>; routines: Routine[];
  voice: VoiceCaps; tts: boolean; setTts: (v: boolean) => void; handsFree: boolean; setHandsFree: (v: boolean) => void;
  send: ReturnType<typeof useHub>["send"]; onEvent: ReturnType<typeof useHub>["onEvent"]; onOpenSidebar: () => void;
  onAbrirTroca: (conversationId: string) => void;
  control: ControlState;
  initialPanel?: { panel: "settings" | "routines"; n: number } | null;
  empresaNome?: string;
};

export function Conversation({ target, conversationId, bots, messages, tools, approvals, questions, resolvedQuestions, routines, voice, tts, setTts, handsFree, setHandsFree, send, onEvent, onOpenSidebar, onAbrirTroca, control, initialPanel, empresaNome = "" }: ConvProps) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(isSpeaking());
  const [showRoutines, setShowRoutines] = useState(false);
  // --- documento aberto em tela cheia ---
  const [arquivoAberto, setArquivoAberto] = useState<ArquivoDoChat | null>(null);
  const [desktopAberto, setDesktopAberto] = useState(false);
  useEffect(() => { setArquivoAberto(null); }, [conversationId]);

  // --- com quais bots ele falou em cada turno (rodapé "Mensageou N bots") ---
  // Uma requisição para a conversa inteira, refeita quando chega mensagem nova.
  const [trocas, setTrocas] = useState<Record<string, Troca[]>>({});
  const [folha, setFolha] = useState<Troca[] | null>(null);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/trocas${location.search}`);
        if (r.ok && vivo) setTrocas((await r.json()) as Record<string, Troca[]>);
      } catch { /* hub reiniciando: o rodapé some, o chat continua */ }
    })();
    return () => { vivo = false; };
  }, [conversationId, messages.length]);

  // --- chamada de voz ---
  // O ciclo (ouvir -> enviar -> o bot fala -> ouvir) e o mesmo do maos-livres;
  // a chamada so o deixa ligado e mostra o que esta acontecendo.
  const [emChamada, setEmChamada] = useState(false);
  const [mudo, setMudo] = useState(false);
  // Entradas de áudio da máquina. Quando há mais de uma, a escolha do navegador costuma
  // ser a errada — e microfone errado é a causa mais comum de "escreveu outra coisa".
  const [micros, setMicros] = useState<{ id: string; nome: string }[]>([]);
  const [micEscolhido, setMicEscolhido] = useState(microfoneEscolhido());
  useEffect(() => {
    if (!emChamada) return;
    let vivo = true;
    void microfones().then((l) => { if (vivo) setMicros(l); });
    return () => { vivo = false; };
  }, [emChamada, listening]);
  const [ondas, setOndas] = useState<number[]>(() => new Array(28).fill(0));
  const inicioChamada = useRef(0);
  const [agoraChamada, setAgoraChamada] = useState(0);
  // abre o painel pedido pelo menu do botão direito (mesmo se o bot já estiver selecionado)
  useEffect(() => {
    if (!initialPanel) return;
    setShowSettings(initialPanel.panel === "settings");
    setShowRoutines(initialPanel.panel === "routines");
  }, [initialPanel?.n]);
  const [showSettings, setShowSettings] = useState(false);
  const [pcAberto, setPcAberto] = useState(() => { try { return localStorage.getItem("mybots-pc-aberto") !== "0"; } catch { return true; } });
  const alternarPc = () => setPcAberto((v) => {
    const n = !v;
    try { localStorage.setItem("mybots-pc-aberto", n ? "1" : "0"); } catch { /* o painel segue neste carregamento */ }
    return n;
  });
  const [attachments, setAttachments] = useState<Array<{ name: string; mime: string; dataBase64: string }>>([]);
  const stopRef = useRef<() => void>(() => {});
  const listRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const handsFreeRef = useRef(handsFree); handsFreeRef.current = handsFree;
  const ttsRef = useRef(tts); ttsRef.current = tts;
  const listeningRef = useRef(false);
  const wantListenRef = useRef(false); // modo conversa ativo (ciclo falar → ouvir)
  // chamada de voz: fala viva (frase a frase) + microfone que nunca fecha
  const falaRef = useRef<FalaViva | null>(null);
  const falaMsgRef = useRef<string>("");
  const escutaRef = useRef<EscutaViva | null>(null);
  const emChamadaRef = useRef(false); emChamadaRef.current = emChamada;
  const busyRef = useRef(false);

  const bot = target.kind === "bot" ? target.bot : null;
  const busy = target.kind === "bot" ? target.bot.busy : target.group.members.some((m) => bots.find((b) => b.id === m)?.busy);
  const statusText = target.kind === "bot" ? target.bot.status : bots.filter((b) => target.group.members.includes(b.id) && b.busy).map((b) => `${b.name.split(" ")[0]}: ${b.status}`).join(" · ");

  busyRef.current = busy;
  // O fim da conversa sempre visivel. Rolamos tambem no quadro seguinte e um pouco
  // depois: a altura real so existe depois do layout, e o balao que acabou de chegar
  // ainda pode crescer (imagem, chip de ferramenta) depois do primeiro desenho.
  const aoFim = () => { const el = listRef.current; if (el) el.scrollTo({ top: el.scrollHeight }); };
  useEffect(() => {
    aoFim();
    const q = requestAnimationFrame(aoFim);
    const t = setTimeout(aoFim, 90);
    return () => { cancelAnimationFrame(q); clearTimeout(t); };
  }, [messages, approvals.length, questions.length]);
  useEffect(() => onSpeaking(setSpeaking), []);

  // resposta final do bot → fala; ao terminar, volta a escutar se o modo conversa estiver ativo
  useEffect(() => onEvent((m) => {
    if (m.type !== "message" || m.message.conversationId !== conversationId || m.message.sender.kind !== "bot" || m.message.meta?.streaming !== false || !m.message.text) return;
    const b = bots.find((x) => x.id === m.message.sender.id);
    if (emChamadaRef.current) return;   // em chamada ele já falou enquanto escrevia (speech.delta)
    (async () => {
      if (ttsRef.current) await speak(m.message.text, m.message.sender.id, voice, b?.voice);
      if (wantListenRef.current && handsFreeRef.current && !listeningRef.current) startListening();
    })();
  }), [conversationId, bots, voice]);

  // Chamada: cada frase pronta que o Hub manda já vira som — o bot fala enquanto escreve.
  useEffect(() => onEvent((m) => {
    if (m.type === "speech.delta") {
      if (!emChamadaRef.current || !ttsRef.current || m.conversationId !== conversationId) return;
      if (!falaRef.current || falaMsgRef.current !== m.messageId) {
        falaRef.current = criarFala(m.botId, voice, bots.find((b) => b.id === m.botId)?.voice);
        falaMsgRef.current = m.messageId;
      }
      falaRef.current.alimentar(m.text);
      return;
    }
    if (m.type === "speech.done" && m.messageId === falaMsgRef.current) falaRef.current?.fim();
  }), [conversationId, bots, voice]);

  // Tudo que ESTA tela precisa largar quando mandam parar. Quem chama é o stopEverything —
  // um lugar só, para não existir de novo "parei e continuou falando".
  useEffect(() => registrarParada(() => {
    wantListenRef.current = false;
    try { stopRef.current(); } catch { /* microfone já fechado */ }
    escutaRef.current?.parar(); escutaRef.current = null;
    falaRef.current?.cancelar(); falaRef.current = null;
    setListening(false); setLevel(0);
    setHandsFree(false);                 // auto-envio desligado: senão ele reenvia sozinho e parece que não parou
    if (emChamadaRef.current) { emChamadaRef.current = false; setEmChamada(false); setOndas(new Array(28).fill(0)); }
  }), []);

  // O Hub mandou parar (veio de outra janela, do celular ou do /api/stop).
  useEffect(() => onEvent((m) => { if (m.type === "stop") stopEverything(m.reason ?? "o Hub mandou parar", { soAqui: true }); }), []);

  // Esc para tudo, de qualquer lugar do painel — só quando há algo acontecendo,
  // para não brigar com o Esc que fecha menu e janela.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!(isSpeaking() || listeningRef.current || emChamadaRef.current || busyRef.current)) return;
      e.preventDefault();
      stopEverything("Esc");
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  // fechar a janela também cala: nada de voz tocando numa aba que já foi embora
  useEffect(() => {
    const sair = () => stopEverything("janela fechada");
    window.addEventListener("pagehide", sair);
    return () => window.removeEventListener("pagehide", sair);
  }, []);

  // sair da conversa desliga o microfone e cala o bot — aqui só nesta janela:
  // o trabalho dos outros bots não tem nada a ver com eu trocar de tela.
  useEffect(() => () => stopEverything("troquei de conversa", { soAqui: true }), [conversationId]);

  // ---- menu de botão direito do chat ----
  const [menuMsg, setMenuMsg] = useState<{ m: StoredMessage; x: number; y: number } | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [desfazer, setDesfazer] = useState<{ token: number; texto: string } | null>(null);
  const [detalhes, setDetalhes] = useState<StoredMessage | null>(null);
  const [recado, setRecado] = useState("");
  useEffect(() => { setMenuMsg(null); setEditando(null); setDesfazer(null); }, [conversationId]);
  useEffect(() => { if (!desfazer) return; const t = setTimeout(() => setDesfazer(null), 10_000); return () => clearTimeout(t); }, [desfazer]);
  useEffect(() => { if (!recado) return; const t = setTimeout(() => setRecado(""), 4000); return () => clearTimeout(t); }, [recado]);

  const avisar = (t: string) => setRecado(t);
  const pedidoAntesDe = (m: StoredMessage) => [...messages.slice(0, messages.findIndex((x) => x.id === m.id))].reverse().find((x) => x.sender.kind === "user");

  const rebobinar = async (m: StoredMessage, include: "this" | "after", textoDaBarra: string) => {
    stopSpeaking();
    const r = await api(`/conversations/${encodeURIComponent(conversationId)}/rewind`, { method: "POST", body: JSON.stringify({ messageId: m.id, include }) });
    if (!r.ok) return avisar("não consegui rebobinar");
    const { token } = await r.json();
    setDesfazer({ token, texto: textoDaBarra });
  };

  const itensDoMenu = (m: StoredMessage): ItemMenu[] => {
    const meu = m.sender.kind === "user";
    const selecao = String(window.getSelection?.() ?? "").trim();
    const copiar = { label: "Copiar", icone: "📋", onClick: () => void navigator.clipboard?.writeText(m.text) };
    const fixar = { label: m.pinned ? "Desafixar" : "Fixar", icone: "📌", onClick: async () => { await api(`/messages/${m.id}/pin`, { method: "POST", body: JSON.stringify({ pinned: !m.pinned }) }); } };
    const apagar = { label: "Apagar mensagem", icone: "🗑️", perigo: true, separar: true, onClick: async () => { stopSpeaking(); await api(`/messages/${m.id}`, { method: "DELETE" }); } };
    const guardar = { label: "Guardar na memória", icone: "🧠", onClick: async () => { const r = await api(`/messages/${m.id}/remember`, { method: "POST", body: JSON.stringify({}) }); avisar(r.ok ? "guardado na base da casa" : "não consegui guardar"); } };
    if (selecao && selecao.length > 2 && m.text.includes(selecao.slice(0, 20))) {
      return [
        { label: "Perguntar sobre isso", icone: "💬", onClick: () => { setText(`> ${selecao}\n\n`); textRef.current?.focus(); } },
        { label: "Explicar melhor", icone: "🔎", onClick: () => submit(`> ${selecao}\n\nExplique melhor esse trecho.`) },
        { label: "Ler em voz alta", icone: "🔊", onClick: () => void speak(selecao, m.sender.id, voice, bots.find((b) => b.id === m.sender.id)?.voice, true) },
        { label: "Copiar", icone: "📋", onClick: () => void navigator.clipboard?.writeText(selecao) },
      ];
    }
    if (meu) {
      return [
        { label: "Editar pedido", icone: "✏️", atalho: "E", onClick: () => { stopSpeaking(); setEditando(m.id); } },
        { label: "Reenviar", icone: "🔁", onClick: async () => { stopSpeaking(); const r = await api(`/messages/${m.id}/edit`, { method: "POST", body: JSON.stringify({ text: m.text }) }); if (!r.ok) avisar("não consegui reenviar"); } },
        { label: "Voltar aqui", icone: "⏪", separar: true, onClick: () => void rebobinar(m, "after", "Voltei até este pedido") },
        copiar, fixar, apagar,
      ];
    }
    return [
      { label: "Tentar de novo", icone: "🔁", onClick: async () => { stopSpeaking(); const r = await api(`/messages/${m.id}/retry`, { method: "POST" }); if (!r.ok) avisar("não achei o pedido que gerou essa resposta"); } },
      { label: "Ler em voz alta", icone: "🔊", onClick: () => { if (isSpeaking()) stopSpeaking(); else void speak(m.text, m.sender.id, voice, bots.find((b) => b.id === m.sender.id)?.voice, true); } },
      guardar,
      { label: "Voltar aqui", icone: "⏪", separar: true, onClick: async () => { const pedido = pedidoAntesDe(m); if (!pedido) return avisar("não achei o pedido desta resposta"); setText(pedido.text); await rebobinar(pedido, "this", "Desfiz esta resposta"); textRef.current?.focus(); } },
      copiar,
      { label: "Salvar como .md", icone: "💾", onClick: () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([m.text], { type: "text/markdown" }));
        a.download = `${m.sender.name.replace(/\W+/g, "-").toLowerCase()}-${new Date(m.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`;
        a.click(); URL.revokeObjectURL(a.href);
      } },
      { label: "Ver detalhes", icone: "ℹ️", onClick: () => setDetalhes(m) },
      fixar, apagar,
    ];
  };

  const submit = (t?: string) => {
    const value = (t ?? text).trim();
    if (!value && !attachments.length) return;
    send({ type: "send", conversationId, text: value || (attachments.length ? "Segue o arquivo." : ""), attachments: attachments.length ? attachments : undefined });
    setText(""); setAttachments([]);
    stopSpeaking();
    textRef.current?.focus();
  };

  const startListening = () => {
    if (listeningRef.current) return;
    stopSpeaking();
    listeningRef.current = true; setListening(true);
    const base = text;
    stopRef.current = listenOnce(voice, {
      onPartial: (t) => setText((base ? base + " " : "") + t),
      onFinal: (t) => { const full = (base ? base + " " : "") + t; setText(full); setTimeout(() => submit(full), 30); },
      onEnd: () => { listeningRef.current = false; setListening(false); setLevel(0); },
      onLevel: (x) => { setLevel(x); setOndas((o) => [...o.slice(1), x]); },
    });
  };

  const toggleMic = () => {
    if (listening) { wantListenRef.current = false; stopRef.current(); return; }
    wantListenRef.current = true;
    startListening();
  };

  const stopAll = () => { wantListenRef.current = false; stopRef.current(); stopSpeaking(); };

  const iniciarChamada = () => {
    if (!speechSupported(voice)) { alert("Este navegador não deixa usar o microfone aqui."); return; }
    inicioChamada.current = Date.now();
    setAgoraChamada(0); setMudo(false); setEmChamada(true); emChamadaRef.current = true;
    setHandsFree(true); setTts(true);          // chamada e' conversa: ouvir e falar
    // fora da chamada o ciclo e' "ouve, para, envia"; aqui o microfone fica aberto o tempo todo
    wantListenRef.current = false;
    stopRef.current();
    escutaRef.current?.parar();
    escutaRef.current = escutaContinua(voice, {
      botFalando: () => isSpeaking(),
      ecoDoBot: () => falaRef.current?.dito() ?? "",
      onEstado: (ouvindo) => { setListening(ouvindo); if (!ouvindo) setLevel(0); },
      onLevel: (x) => { setLevel(x); setOndas((o) => [...o.slice(1), x]); },
      // ele abriu a boca: o bot cala na hora (ainda sem saber o que foi dito)
      onVoz: () => falaRef.current?.pausar(),
      // era tosse, eco do alto-falante ou barulho da loja: volta de onde parou
      onFalsoAlarme: () => falaRef.current?.retomar(),
      onFinal: (texto) => {
        falaRef.current?.cancelar();
        if (busyRef.current) { send({ type: "abort", conversationId }); setTimeout(() => submit(texto), 250); }
        else submit(texto);
      },
    });
  };

  const encerrarChamada = async () => {
    const seg = Math.max(1, Math.round((Date.now() - inicioChamada.current) / 1000));
    setEmChamada(false); emChamadaRef.current = false;
    escutaRef.current?.parar(); escutaRef.current = null;
    falaRef.current?.cancelar(); falaRef.current = null;
    stopAll(); setOndas(new Array(28).fill(0)); setListening(false); setLevel(0);
    const mmss = `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`;
    // fica na conversa, gravado no Hub — nao some quando a pagina recarrega
    try {
      await api(`/conversations/${encodeURIComponent(conversationId)}/marcador`, {
        method: "POST", body: JSON.stringify({ texto: `Chamada de voz · ${mmss}`, meta: { chamada: seg } }),
      });
    } catch { /* se o Hub nao responder, a chamada ja acabou do mesmo jeito */ }
  };

  // relogio da chamada
  useEffect(() => {
    if (!emChamada) return;
    const t = setInterval(() => setAgoraChamada(Math.round((Date.now() - inicioChamada.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [emChamada]);

  // ficar mudo so' para de ouvir; o bot continua falando
  useEffect(() => {
    if (!emChamada) return;
    escutaRef.current?.mudo(mudo);
  }, [mudo, emChamada]);

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const list: typeof attachments = [];
    for (const f of Array.from(files)) {
      if (f.size > 20 * 1024 * 1024) { alert(`${f.name}: máximo 20 MB`); continue; }
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      list.push({ name: f.name, mime: f.type || "application/octet-stream", dataBase64: btoa(bin) });
    }
    setAttachments((a) => [...a, ...list]);
  };

  const title = target.kind === "bot" ? target.bot.name : target.group.name;
  const fase = target.kind === "bot"
    ? faseDoStatus(target.bot.status, target.bot.busy, target.bot.fase)
    : (bots.some((b) => target.group.members.includes(b.id) && b.busy && faseDoStatus(b.status, true, b.fase) === "trabalhando") ? "trabalhando" : "digitando");
  const subtitle = target.kind === "bot"
    ? (target.bot.online ? (target.bot.busy ? (fase === "trabalhando" ? "está trabalhando" : "digitando…") : target.bot.role) : "Offline")
    : (busy ? (fase === "trabalhando" ? "está trabalhando" : "digitando…") : target.group.members.map((m) => bots.find((b) => b.id === m)?.name ?? m).join(", "));

  return (
    <>
      <header className="chat-head">
        <button className="icon-btn only-mobile" onClick={onOpenSidebar} title="Bots">☰</button>
        {bot ? <Avatar bot={bot} size={40} /> : <div className="avatar group-avatar" style={{ width: 40, height: 40 }}>👥</div>}
        <div className="chat-title">
          <b>{title}</b>
          <small><span className="sub-texto">{subtitle}</span>{bot?.model && <span className="chip">{bot.engine} · {bot.provider}/{bot.model}</span>}{bot?.online && <span className={"chip mode-" + effectiveControl(control.global, bot.controlMode)} title={CONTROL_DESCRIPTIONS[effectiveControl(control.global, bot.controlMode)]}>{CONTROL_LABELS[effectiveControl(control.global, bot.controlMode)]}{control.global ? " (global)" : ""}</span>}</small>
        </div>
        <div className="chat-actions">
          {bot && (
            emChamada
              ? <button className="icon-btn desligar" title="Desligar" onClick={() => void encerrarChamada()}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.99.99 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .27-.11.52-.29.7l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28a11.27 11.27 0 0 0-2.67-1.85.998.998 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" transform="rotate(135 12 12)"/></svg>
                </button>
              : <button className="icon-btn" title={`Ligar para ${bot.name}`} onClick={iniciarChamada}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg>
                </button>
          )}
          {bot && <button className={"icon-btn" + (pcAberto ? " on" : "")} title={pcAberto ? "Recolher a tela do PC" : "Tela do PC da empresa"} aria-pressed={pcAberto} onClick={alternarPc}>🖥️</button>}
          {bot && <button className={"icon-btn" + (showSettings ? " on" : "")} title="Configurar este bot" onClick={() => { setShowSettings(!showSettings); setShowRoutines(false); }}>⚙️</button>}
          {bot && <button className={"icon-btn" + (showRoutines ? " on" : "")} title="Rotinas agendadas" onClick={() => { setShowRoutines(!showRoutines); setShowSettings(false); }}>⏰{routines.length ? <sup>{routines.length}</sup> : null}</button>}
          {(busy || speaking || listening) && <button className="icon-btn parar-tudo" title="Parar tudo: a fala, o microfone e o que os bots estão fazendo (Esc)" onClick={() => stopEverything("⏹ no painel")}>⏹ Parar</button>}
          <button className={"icon-btn" + (handsFree ? " on" : "")} title={handsFree ? "Modo conversa: volta a ouvir depois que o bot fala" : "Modo conversa desligado"} onClick={() => setHandsFree(!handsFree)}>🗣️</button>
        </div>
      </header>

      <div className="conversa-corpo">
      <div className="conversa-miolo">
      {showRoutines && bot && <RoutinesPanel bot={bot} routines={routines} onClose={() => setShowRoutines(false)} />}
      {showSettings && bot && <BotSettingsPanel bot={bot} onClose={() => setShowSettings(false)} />}

      {emChamada && bot && (
        <div className={"barra-chamada" + (speaking ? " falando" : "") + (listening ? " ouvindo" : "")}>
          <Avatar bot={bot} size={68} falando={speaking} />
          <div className="quem">
            <b>{bot.name}</b>
            <small>{mudo ? "microfone desligado" : speaking ? "falando — pode interromper" : busy ? (statusText || "pensando") + "…" : listening ? "pode falar" : "abrindo o microfone…"}</small>
          </div>
          <div className="onda" aria-hidden>
            {ondas.map((h, i) => <i key={i} style={{ height: `${Math.min(100, 12 + h * 240)}%` }} />)}
          </div>
          <span className="relogio num">{Math.floor(agoraChamada / 60)}:{String(agoraChamada % 60).padStart(2, "0")}</span>
          <button className="bola" title={tts ? "Desligar a voz dele" : "Ligar a voz dele"} onClick={() => setTts(!tts)}>{tts ? "🔊" : "🔇"}</button>
          <button className={"bola" + (mudo ? " off" : "")} title={mudo ? "Ligar meu microfone" : "Desligar meu microfone"} onClick={() => setMudo(!mudo)}>{mudo ? "🎙️" : "🎤"}</button>
          {micros.length > 1 && (
            <select className="escolhe-mic" value={micEscolhido} title="De qual microfone eu escuto (vale a partir da próxima chamada)"
              onChange={(e) => { escolherMicrofone(e.target.value); setMicEscolhido(e.target.value); }}>
              <option value="">Microfone padrão</option>
              {micros.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          )}
          <button className="bola encerrar" title="Desligar" onClick={() => void encerrarChamada()}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="#fff"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.99.99 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .27-.11.52-.29.7l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28a11.27 11.27 0 0 0-2.67-1.85.998.998 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" transform="rotate(135 12 12)"/></svg>
          </button>
        </div>
      )}

      <div className="messages" ref={listRef}>
        {!messages.length && <div className="hint">{bot ? `Diga olá para ${bot.name}. ${bot.role}.` : "Fale com o grupo: todos os bots recebem e cada um responde o que é da sua área."}</div>}
        {messages.map((m) => <Fragment key={m.id}><Message m={m} showName={target.kind === "group" || m.conversationId.startsWith("pair:")} tools={tools[m.id] ?? (m.meta?.tools as ToolInfo[] | undefined)} answer={m.meta?.question ? resolvedQuestions[String(m.meta.question)] : undefined}
          onAbrirArquivo={setArquivoAberto}
          onAbrirTela={bot ? () => setDesktopAberto(true) : undefined}
          onMenu={(msg, x, y) => setMenuMsg({ m: msg, x, y })}
          editando={editando === m.id}
          onCancelarEdicao={() => setEditando(null)}
          onSalvarEdicao={async (texto) => {
            setEditando(null); stopSpeaking();
            const r = await api(`/messages/${m.id}/edit`, { method: "POST", body: JSON.stringify({ text: texto }) });
            if (!r.ok) avisar("não consegui editar o pedido");
          }}
          onSpeak={m.sender.kind === "bot" ? () => { if (isSpeaking()) stopSpeaking(); else void speak(m.text, m.sender.id, voice, bots.find((b) => b.id === m.sender.id)?.voice, true); } : undefined} />{trocas[m.id]?.length ? <ChipTrocas trocas={trocas[m.id]} bots={bots} Avatar={Avatar} onAbrir={(ts) => ts.length === 1 ? onAbrirTroca(ts[0].conversationId) : setFolha(ts)} /> : null}</Fragment>)}
        {approvals.map((a) => <ApprovalCard key={a.id} a={a} botName={bots.find((b) => b.id === a.botId)?.name} onAnswer={(allow, remember) => send({ type: "approval.response", requestId: a.id, allow, remember })} />)}
        {questions.map((q) => <QuestionCard key={q.id} q={q} botName={bots.find((b) => b.id === q.botId)?.name} onAnswer={(answer) => send({ type: "question.answer", questionId: q.id, answer })} />)}
      </div>

      {busy && !approvals.length && !questions.length && (
        <div className={"linha-atividade " + (fase === "trabalhando" ? "trabalhando" : "digitando")} role="status">
          {target.kind === "bot"
            ? <span className={fase === "trabalhando" ? "gira" : "av"}><Avatar bot={target.bot} size={22} /></span>
            : <Bolha />}
          {fase === "trabalhando"
            ? <span>{title} está trabalhando</span>
            : <><span>Digitando</span><span className="pontos" aria-hidden><i /><i /><i /></span></>}
        </div>
      )}

      {menuMsg && <ContextMenu x={menuMsg.x} y={menuMsg.y} itens={itensDoMenu(menuMsg.m)} onClose={() => setMenuMsg(null)} />}

      {desfazer && (
        <div className="barra-desfazer">
          <span>{desfazer.texto}</span>
          <button className="link" onClick={async () => {
            const t = desfazer.token; setDesfazer(null);
            const r = await api(`/conversations/${encodeURIComponent(conversationId)}/unrewind`, { method: "POST", body: JSON.stringify({ token: t }) });
            if (!r.ok) avisar("não consegui desfazer");
          }}>Desfazer</button>
        </div>
      )}
      {recado && <div className="barra-desfazer recado">{recado}</div>}

      {detalhes && (
        <div className="modal-bg" onClick={() => setDetalhes(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head"><b>Detalhes da mensagem</b><button className="link" onClick={() => setDetalhes(null)}>fechar</button></div>
            <p><b>De:</b> {detalhes.sender.name} · <b>quando:</b> {new Date(detalhes.createdAt).toLocaleString("pt-BR")}</p>
            {(() => { const b = bots.find((x) => x.id === detalhes.sender.id); return b ? <p><b>Modelo:</b> {b.provider}/{b.model} · <b>motor:</b> {b.engine}</p> : null; })()}
            <p><b>Caracteres:</b> {detalhes.text.length}{detalhes.editOf ? " · versão de um pedido editado" : ""}{detalhes.pinned ? " · fixada" : ""}</p>
            {(() => {
              const ts = (tools[detalhes.id] ?? (detalhes.meta?.tools as ToolInfo[] | undefined)) ?? [];
              return ts.length ? <><p><b>Ferramentas deste turno:</b></p><ul>{ts.map((t) => <li key={t.callId}>{t.tool}{t.ok === false ? " (falhou)" : ""}</li>)}</ul></> : <p>Nenhuma ferramenta neste turno.</p>;
            })()}
          </div>
        </div>
      )}

      {(listening || speaking) && (
        <div className={"voice-bar" + (listening ? " listening" : " speaking")}>
          <span className="voice-dot" style={{ transform: `scale(${1 + level * 1.5})` }} />
          {listening ? (voice.stt ? "Ouvindo… pode falar; quando você parar, eu envio." : "Ouvindo… quando você parar de falar, eu envio.") : `${title} está falando…`}
          <button className="link" onClick={() => stopEverything("⏹ na barra de voz")}>parar</button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="attachments">{attachments.map((a, i) => <span key={i} className="chip">📎 {a.name} <button className="link" onClick={() => setAttachments(attachments.filter((_, j) => j !== i))}>×</button></span>)}</div>
      )}

      <footer className="composer">
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
        <button className="icon-btn mais" type="button" title="Anexar arquivo" aria-label="Anexar" onClick={() => fileRef.current?.click()}>+</button>
        <textarea
          ref={textRef}
          value={text}
          placeholder={bot && !bot.online ? `${bot.name} está offline — a mensagem fica salva` : `Escreva para ${title}`}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); return; }
            // campo vazio + seta pra cima = editar o último pedido, como no WhatsApp.
            if (e.key === "ArrowUp" && !text.trim()) {
              const ultimo = [...messages].reverse().find((m) => m.sender.kind === "user" && m.sender.id === "user");
              if (ultimo) { e.preventDefault(); stopSpeaking(); setEditando(ultimo.id); }
            }
          }}
        />
        {(text.trim() || attachments.length) ? (
          <button className="send" type="button" aria-label="Enviar" onClick={() => submit()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 12l16-8-6 16-2-6z"/></svg>
          </button>
        ) : speechSupported(voice) ? (
          <button className={"icon-btn mic" + (listening ? " rec" : "")} type="button" title={listening ? "Parar de ouvir" : "Falar (envia sozinho quando você parar)"} aria-label="Microfone" onClick={toggleMic}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4"/></svg>
          </button>
        ) : (
          <button className="send" type="button" aria-label="Enviar" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 12l16-8-6 16-2-6z"/></svg>
          </button>
        )}
      </footer>
      {folha && <FolhaAbrirTroca trocas={folha} bots={bots} Avatar={Avatar} onEscolher={(t) => onAbrirTroca(t.conversationId)} onFechar={() => setFolha(null)} />}
      {arquivoAberto && <Visualizador f={arquivoAberto} onFechar={() => setArquivoAberto(null)} />}
      {desktopAberto && bot && <DesktopAoVivo bot={bot} empresaId={bot.empresaId ?? null} nome={empresaNome} onFechar={() => setDesktopAberto(false)} />}
      </div>
      {bot && pcAberto && (
        <PainelDoPc
          empresaId={bot.empresaId ?? null}
          nome={empresaNome}
          conversationId={conversationId}
          onFechar={alternarPc}
          onEvent={onEvent}
          rotinas={routines.map((r) => ({ id: r.id, nome: r.name, cron: r.cron }))}
          arquivos={messages.flatMap((m) => (m.meta?.files as Array<{ name: string; url: string }> | undefined) ?? []).slice(-12).reverse()}
        />
      )}
      </div>
    </>
  );
}
