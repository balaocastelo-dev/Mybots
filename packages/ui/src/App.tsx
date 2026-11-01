import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { BotSummary, ControlMode, ControlState, Group, PendingApproval, PendingQuestion, Routine, StoredMessage } from "@mybots/shared";
import { CONTROL_DESCRIPTIONS, CONTROL_LABELS, CONTROL_MODES, dmConversation, effectiveControl, faseDoStatus, groupConversation } from "@mybots/shared";
import { useHub, type ToolInfo } from "./hub";
import { registrarParada, stopEverything } from "./stop";
import { criarFala, escolherMicrofone, escutaContinua, isSpeaking, listenOnce, microfoneEscolhido, microfones, onSpeaking, speak, speechSupported, stopSpeaking, type EscutaViva, type FalaViva, type VoiceCaps } from "./voice";
import { ContextMenu, useToqueLongo, type ItemMenu } from "./ContextMenu";
import { desintegrarAvatar } from "./particulas";
import { LendoSite } from "./lendo";
import { ArteDoBot, EscolhaAparencia, lerAparencia } from "./aparencia";
import { Abertura, PrimeiraEmpresa, EscolhaIdioma } from "./abertura";
import { TelaLegal } from "./legal";
import { TelaCreditos } from "./creditos";
import { usePainelPrefs, nomeNaTela, ChipTrocas, FolhaAbrirTroca, TrocaEntreBots, DialogoTexto, type Troca, type PrefDoBot } from "./painel";
import { ehGerente, montarLista } from "./lista";
import { lerLinkGuia } from "./guiaPainel";
import { api, UI_BASE } from "./api";
import { Tema, Tamanho, Configuracao, pularAbertura } from "./tema";
import { TelaConfiguracoes, type AbaConfig } from "./configuracoes/Tela";
import { Maquina } from "./maquina";
import { Aviso, GlobalControl, notify } from "./controles";
import { BotMenu, ImportDialog } from "./menuBot";
import { Ameba, Avatar, colorFor, definirTonsDaEquipe } from "./avatar";
import { TimeAmebas, TituloMyBots } from "./timeAmebas";
import { Conversation } from "./conversa";
import { EmpresasDialog, ExcluirBotDialog, NewBotDialog, NewGerenteDialog, NewGroupDialog } from "./dialogos";
import { Icone } from "./icones";
import { BOTS_EXEMPLO, EMPRESA_EXEMPLO } from "./colab/amostra";
import { useColab } from "./colab/estado";
import { QuemFala } from "./colab/grafo";
import { QuadroKanban } from "./colab/kanban";
import { tarefasDaEmpresa, tarefasDoBot } from "./colab/normalizar";

type Target = { kind: "bot"; bot: BotSummary } | { kind: "group"; group: Group };

const pref = (k: string, d: boolean) => { const v = localStorage.getItem("mybots." + k); return v == null ? d : v === "1"; };
const setPref = (k: string, v: boolean) => localStorage.setItem("mybots." + k, v ? "1" : "0");

const SIDEBAR_PADRAO = 280;
function limparLayoutVelho() {
  try {
    if (localStorage.getItem("mybots-layout-v") === "3") return;
    localStorage.removeItem("mybots-layout-cols");
    localStorage.removeItem("mybots-layout-pct");
    localStorage.removeItem("mybots-pc-w");
    localStorage.removeItem("mybots-pc-pct");
    localStorage.removeItem("mybots-sidebar-w");
    localStorage.removeItem("mybots-sidebar-largura");
    localStorage.setItem("mybots-layout-v", "3");
  } catch { /* sem storage: usa o padrao */ }
}
function lerSidebarLargura() {
  limparLayoutVelho();
  try {
    const n = Number(localStorage.getItem("mybots-sidebar-largura"));
    return n >= 200 && n <= 900 ? n : SIDEBAR_PADRAO;
  } catch { return SIDEBAR_PADRAO; }
}

export function App() {
  const exemplo = new URLSearchParams(location.search).get("colab") === "exemplo";
  const tela = new URLSearchParams(location.search).get("tela");
  const pcDemo = useRef(false);
  if (exemplo && !pcDemo.current) {
    pcDemo.current = true;
    try { localStorage.setItem("mybots-pc-aberto", "0"); } catch { /* a demonstração segue com a tela do PC como estava */ }
  }
  const { state, send, loadHistory, onEvent, removeToast, clearImport, setImport } = useHub();
  const { pacote, cancelar, decidir, simular } = useColab(onEvent, exemplo);
  const equipe = state.bots.length ? state.bots : (exemplo ? BOTS_EXEMPLO : state.bots);
  definirTonsDaEquipe(equipe.map((b) => b.id)); // cada bot com a sua cor, sem dois parecidos
  const [selected, setSelected] = useState<string | null>(null); // conversationId
  const [filter, setFilter] = useState("");
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [mais, setMais] = useState(false);
  const [tts, setTts] = useState(() => pref("tts", true));          // resposta em áudio (ligada por padrão)
  const [handsFree, setHandsFree] = useState(() => pref("handsfree", true)); // volta a escutar depois que o bot fala
  const [avisos, setAvisos] = useState(() => pref("avisos", true));
  const [verConfig, setVerConfig] = useState<AbaConfig | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarW, setSidebarW] = useState(lerSidebarLargura);
  const sidebarWRef = useRef(sidebarW);
  sidebarWRef.current = sidebarW;
  const aoPuxarSidebar = (e: ReactPointerEvent) => {
    if (typeof window !== "undefined" && window.innerWidth < 768) return;
    e.preventDefault();
    const inicioX = e.clientX;
    const inicioW = sidebarWRef.current;
    const mover = (ev: PointerEvent) => {
      const max = Math.min(window.innerWidth * 0.5, Math.max(200, window.innerWidth - 420));
      const w = Math.min(Math.max(200, inicioW + (ev.clientX - inicioX)), max);
      setSidebarW(w);
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      try { localStorage.setItem("mybots-sidebar-largura", String(Math.round(sidebarWRef.current))); } catch { /* segue */ }
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };
  const resetSidebarW = () => {
    setSidebarW(SIDEBAR_PADRAO);
    try { localStorage.setItem("mybots-sidebar-largura", String(SIDEBAR_PADRAO)); } catch { /* segue */ }
  };
  const [newGroup, setNewGroup] = useState(false);
  const [newBot, setNewBot] = useState(false);
  const [nascendoId, setNascendoId] = useState<string | null>(null);
  // Empresas: cada uma com seus bots, gerentes e regras. O conhecimento continua universal.
  const [empresas, setEmpresas] = useState<Array<{ id: string; nome: string; regras: string; idioma?: string; bots: number }>>([]);
  const [empresaAtiva, setEmpresaAtiva] = useState<string>("todas"); // perfil unico: sem troca de empresa na UI
  const [verEmpresas, setVerEmpresas] = useState(false);
  // A abertura aparece toda vez que o painel abre; depois dela, se a casa ainda nao
  // tem empresa nenhuma, a tela de cadastro e o que ele ve — nao um painel vazio.
  const [pularIntro] = useState(pularAbertura);
  const [abertura, setAbertura] = useState(!exemplo && !pularIntro);
  // a lingua da casa: primeira coisa depois da explosao, antes de qualquer cadastro
  // A escolha da lingua e parte da abertura: vale sempre que a casa esta VAZIA, mesmo
  // que o navegador ja tenha uma guardada. Casa com empresa nao volta a perguntar.
  const [idiomaPronto, setIdiomaPronto] = useState(exemplo);
  // cutucar o bot: clique seguido no mesmo bot acumula. Zera sozinho depois de um
  // tempo — senao um clique de manha e outro a tarde somariam.
  const [cutuca, setCutuca] = useState<{ id: string; n: number }>({ id: "", n: 0 });
  const relogioCutuca = useRef<number | null>(null);
  const cutucar = (id: string) => {
    setCutuca((c) => ({ id, n: c.id === id ? c.n + 1 : 1 }));
    if (relogioCutuca.current) clearTimeout(relogioCutuca.current);
    relogioCutuca.current = window.setTimeout(() => setCutuca({ id: "", n: 0 }), 2600);
  };
  const [empresasCarregadas, setEmpresasCarregadas] = useState(exemplo);
  const [pularPrimeira, setPularPrimeira] = useState(exemplo);
  const [legalPara, setLegalPara] = useState<string | null>(null);
  const [aExcluir, setAExcluir] = useState<BotSummary | null>(null);
  const carregarEmpresas = async () => { try { const r = await api("/empresas"); if (r.ok) setEmpresas(await r.json()); } catch {} finally { setEmpresasCarregadas(true); } };
  useEffect(() => { void carregarEmpresas(); }, []);
  useEffect(() => {
    const ir = () => {
      const link = lerLinkGuia(location.hash);
      if (!link) return;
      setEmpresaAtiva(link.empresaId);
      const g = state.bots.find((b) => b.empresaId === link.empresaId && /gerente/i.test(`${b.role} ${b.name}`));
      if (g) setSelected(dmConversation(g.id));
    };
    ir();
    window.addEventListener("hashchange", ir);
    return () => window.removeEventListener("hashchange", ir);
  }, [state.bots]);
  useEffect(() => { try { localStorage.setItem("mybots-empresa", empresaAtiva); } catch {} }, [empresaAtiva]);
  // Empresa escolhida que não existe mais (apagada, renomeada, banco zerado) escondia
  // TODOS os bots sem dizer por quê. Some o filtro em vez de sumir a equipe.
  useEffect(() => {
    if (!empresasCarregadas || empresaAtiva === "todas") return;
    if (!empresas.some((e) => e.id === empresaAtiva)) setEmpresaAtiva("todas");
  }, [empresas, empresasCarregadas, empresaAtiva]);
  const [newGerente, setNewGerente] = useState(false);
  const [menu, setMenu] = useState<{ bot: BotSummary; x: number; y: number } | null>(null);
  const painel = usePainelPrefs();
  const [verTroca, setVerTroca] = useState<string | null>(null);
  const [verQuadro, setVerQuadro] = useState(tela === "quadro");
  const [verGrafo, setVerGrafo] = useState(tela === "grafo");
  const [filtroBot, setFiltroBot] = useState(() => (tela === "quadro" ? new URLSearchParams(location.search).get("bot") ?? "" : ""));
  const [dialogo, setDialogo] = useState<{ tipo: "renomear" | "secao" | "aparencia"; bot: BotSummary } | null>(null);
  const [panel, setPanel] = useState<{ conv: string; panel: "settings" | "routines"; n: number } | null>(null);
  const openPanel = (botId: string, which: "settings" | "routines") => {
    const conv = dmConversation(botId);
    setSelected(conv);
    setPanel({ conv, panel: which, n: Date.now() });
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const bots = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return [...equipe]
      .filter((b) => !f || b.name.toLowerCase().includes(f) || b.role.toLowerCase().includes(f))
      .filter((b) => true /* escondidos entram na lista flat; recurso de esconder permanece no menu */)
      // Perfil unico: todos os bots na mesma lista
      .sort((a, b) => nomeNaTela(a, painel.prefs).localeCompare(nomeNaTela(b, painel.prefs), "pt"));
  }, [equipe, filter, painel.prefs]);

  /** Fixados viram a grade. Na lista, cada empresa põe o gerente na frente. */
  const empresasVisiveis = empresas.length ? empresas : (exemplo ? [EMPRESA_EXEMPLO] : empresas);
  const listaPronta = useMemo(() => montarLista(bots.map((b) => ({
    id: b.id,
    nome: nomeNaTela(b, painel.prefs),
    empresaId: b.empresaId,
    fixado: !!painel.prefs[b.id]?.fixado,
    gerente: !!b.gerente,
    manages: b.manages,
    role: b.role,
  })), empresasVisiveis), [bots, painel.prefs, empresasVisiveis]);
  const porId = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  // Celular: sem bot aberto a lista e a tela padrao. Nunca deixar so o placeholder.
  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth >= 768) return;
    if (!selected && !verQuadro && !verGrafo && !verTroca) setSidebarOpen(true);
  }, [selected, verQuadro, verGrafo, verTroca]);

  const busca = filter.trim().toLowerCase();
  const gruposVisiveis = state.groups.filter((g) => !busca || g.name.toLowerCase().includes(busca));
  const linhaGrupo = (g: Group) => (
    <li key={g.id} className={(groupConversation(g.id) === selected ? "active" : "")} onClick={() => { fecharColab(); setSelected(groupConversation(g.id)); if (window.innerWidth < 768) setSidebarOpen(false); }}>
      <div className="avatar group-avatar" style={{ width: 36, height: 36 }}>👥</div>
      <div className="bot-text">
        <div className="bot-name">{g.name}</div>
        <div className="bot-status">{g.members.map((m) => state.bots.find((b) => b.id === m)?.name.split(" ")[0] ?? m).join(", ")}</div>
      </div>
      <button className={"row-pin" + (painel.prefs[g.id]?.fixado ? " on" : "")} type="button" title={painel.prefs[g.id]?.fixado ? "Desafixar" : "Fixar"} aria-label={(painel.prefs[g.id]?.fixado ? "Desafixar " : "Fixar ") + g.name}
        onClick={(e) => { e.stopPropagation(); void painel.salvar(g.id, { fixado: !painel.prefs[g.id]?.fixado }); }}><Icone nome="alfinete" /></button>
    </li>
  );

  const target: Target | null = useMemo(() => {
    if (!selected) return null;
    if (selected.startsWith("dm:")) { const bot = equipe.find((b) => dmConversation(b.id) === selected); return bot ? { kind: "bot", bot } : null; }
    if (selected.startsWith("group:")) { const group = state.groups.find((g) => groupConversation(g.id) === selected); return group ? { kind: "group", group } : null; }
    return null;
  }, [selected, equipe, state.groups]);

  useEffect(() => { if (selected) void loadHistory(selected); }, [selected]);
  useEffect(() => { setPref("tts", tts); }, [tts]);
  useEffect(() => { setPref("handsfree", handsFree); }, [handsFree]);
  useEffect(() => { setPref("avisos", avisos); }, [avisos]);
  useEffect(() => {
    if (selected) return;
    if (typeof window !== "undefined" && window.innerWidth < 768) return; // no celular a lista vem primeiro
    if (exemplo && (tela === "tarefas" || tela === "detalhe") && equipe.some((b) => b.id === "pixel")) {
      setSelected(dmConversation("pixel"));
      return;
    }
    if (bots.length) setSelected(dmConversation(bots[0].id));
  }, [bots.length]);
  // arrastar um arquivo para qualquer lugar da janela abre o mesmo diálogo de importação
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } };
    const drop = async (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      e.preventDefault();
      const buf = await f.arrayBuffer();
      let bin = ""; const b = new Uint8Array(buf);
      for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
      setImport({ name: f.name, mime: f.type || "application/octet-stream", dataBase64: btoa(bin) });
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
  }, []);

  // bot excluído: solta a conversa aberta para o efeito acima escolher outra
  useEffect(() => { if (selected?.startsWith("dm:") && !target) setSelected(null); }, [target, selected]);
  // ...e cala a fala na hora. A voz é o que mais assusta: o bot já foi excluído e a
  // frase dele continua sendo lida em voz alta até o fim.
  useEffect(() => onEvent((m) => {
    if (m.type !== "bot.removed") return;
    stopSpeaking();
    setSelected((cur) => (cur && (cur === `dm:${m.botId}` || (cur.startsWith("pair:") && cur.slice(5).split(":").includes(m.botId))) ? null : cur));
  }), []);
  useEffect(() => { if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission(); }, []);

  // mexeram no histórico (rebobinar, editar, apagar, fixar): quem está com a conversa
  // aberta recarrega — inclusive as outras janelas e o celular.
  useEffect(() => onEvent((m) => {
    if (m.type === "conversation.changed" && m.conversationId === selected) void loadHistory(selected);
  }), [selected]);

  // notificações quando a aba está escondida
  useEffect(() => onEvent((m) => {
    if (!pref("avisos", true)) return;
    if (m.type === "message" && m.message.sender.kind === "bot" && m.message.meta?.streaming !== true && document.hidden) notify(m.message.sender.name, m.message.text);
    if (m.type === "approval.request") notify("Aprovação necessária", m.approval.description);
    if (m.type === "question") notify("Precisa da sua resposta", m.question.question);
    if (m.type === "notify") notify(state.bots.find((b) => b.id === m.botId)?.name ?? "MyBots", m.text);
  }), [state.bots]);

  const pendingFor = (id: string) => state.approvals.filter((a) => a.botId === id).length + state.questions.filter((q) => q.botId === id).length;
  const nomeDe = (id: string) => (id === "humano" || id === "user" ? "você" : (equipe.find((b) => b.id === id)?.name ?? id));
  const ativos = bots.filter((b) => b.online && (b.busy || !!pacote?.ajudando[b.id]));
  const tarefasQuadro = tarefasDaEmpresa(pacote?.tarefas ?? [], equipe, empresaAtiva);
  const tarefasFiltradas = filtroBot ? tarefasDoBot(tarefasQuadro, filtroBot) : tarefasQuadro;
  const fecharColab = () => { setVerQuadro(false); setVerGrafo(false); };
  const deusActive = state.control.global === "deus" || state.bots.some((b) => b.online && effectiveControl(state.control.global, b.controlMode) === "deus");

  return (
    <div className={"app" + (sidebarOpen ? "" : " sidebar-closed") + (deusActive ? " deus" : "") + (selected && !sidebarOpen ? " chat-aberto" : "") + ((verQuadro || verGrafo || verTroca) ? " painel-colab" : "")} style={{ ["--sidebar-w" as any]: sidebarW + "px" }}>
      {deusActive && (
        <div className="deus-banner" role="alert">
          <span>⚠️ <b>MODO DEUS EXTREMO</b> ativo{state.control.global === "deus" ? " para todos os bots" : " em " + state.bots.filter((b) => b.online && effectiveControl(state.control.global, b.controlMode) === "deus").map((b) => b.name).join(", ")}: agem sem pedir aprovação. Tudo vai para a auditoria.</span>
          <button className="btn danger panic" title="Interrompe todos os bots e volta para Supervisionado" onClick={() => void api("/control/panic", { method: "POST" })}>⏹ Pânico</button>
        </div>
      )}
      <aside className="sidebar">
        <header className="sidebar-head">
          <button type="button" className="icon-btn only-mobile voltar sidebar-voltar" title="Início" aria-label="Início"
            onClick={() => { setSelected(null); setVerQuadro(false); setVerGrafo(false); setVerTroca(null); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div className="brand">
            <span className="logo-img logo-chefe"><img src={`${UI_BASE}/amebas/v2/ameba-v2-091.png`} alt="MyBots" draggable={false} /></span>
            <div className="brand-titulo">
              <b className="brand-desktop only-desktop">MyBots</b>
              <b className="brand-mobile only-mobile">MyBots</b>
            </div>
          </div>
          <div className="sidebar-canto">
            <span className="only-desktop"><Tema /></span>
            <span className="only-desktop"><Configuracao aberto={verConfig !== null} onOpen={() => setVerConfig((v) => (v ? null : "geral"))} /></span>
            <button className={"icon-btn canto" + (buscaAberta ? " on" : "")} type="button" title="Buscar" aria-label="Buscar" onClick={() => setBuscaAberta((v) => !v)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            </button>
            <button className="icon-btn canto only-desktop" type="button" title="Novo" aria-label="Novo" onClick={() => setMais((v) => !v)}>+</button>
            <button className={"icon-btn canto head-overflow-btn" + (mais ? " on" : "")} type="button" title="Mais" aria-label="Mais opções" aria-haspopup="menu" aria-expanded={mais}
              onClick={() => setMais((v) => !v)}>⋮</button>
            {mais && (
              <div className="mais-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setMais(false); setNewBot(true); }}>Novo bot</button>
                <button type="button" role="menuitem" onClick={() => { setMais(false); setNewGerente(true); }}>Novo gerente</button>
                <button type="button" role="menuitem" onClick={() => { setMais(false); setNewGroup(true); }}>Novo grupo</button>
                <button type="button" role="menuitem" className="only-mobile" onClick={() => { setMais(false); setVerConfig("geral"); }}>Configurações</button>
              </div>
            )}
          </div>
        </header>
        <div className="only-desktop barra-desktop-extra">
          <Tamanho />
          <GlobalControl control={state.control} />
        </div>
        {(buscaAberta || filter) && <input className="search" placeholder="Buscar bot…" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />}
        <ul className="bots">
          <li className="section secao-ativos" data-colab="ativos">Ativos</li>
          {!ativos.length && <li className="empty ativos-vazio">Ninguém trabalhando agora.</li>}
          {ativos.map((b) => {
            const ajuda = pacote?.ajudando[b.id];
            const conv = dmConversation(b.id);
            return (
              <li key={"ativo-" + b.id} data-colab={ajuda ? "ajudando" : "ativo"} className={"linha-bot" + (conv === selected && !verQuadro && !verGrafo ? " active" : "")}
                onClick={() => { cutucar(b.id); fecharColab(); setSelected(conv); if (window.innerWidth < 768) setSidebarOpen(false); }}>
                <Avatar bot={b} size={42} cutucadas={cutuca.id === b.id ? cutuca.n : 0} forceAnim={nascendoId === b.id ? "nascer" : null} />
                <div className="bot-text">
                  <div className="bot-name">{nomeNaTela(b, painel.prefs)}</div>
                  <div className={"bot-status" + (ajuda ? " ajudando" : " busy")}>
                    {ajuda ? `Ajudando ${nomeDe(ajuda.ajudando)}` : "trabalhando"}
                  </div>
                </div>
              </li>
            );
          })}
          {listaPronta.fixados.length > 0 && (
            <li className="grade-wrap">
              <ul className="grade-fixados">
                {listaPronta.fixados.map((id) => {
                  const b = porId.get(id);
                  if (!b) return null;
                  const conv = dmConversation(b.id);
                  return (
                    <li key={b.id} className={conv === selected ? "ativo" : ""}
                      onClick={() => { cutucar(b.id); fecharColab(); setSelected(conv); if (window.innerWidth < 768) setSidebarOpen(false); }}
                      onContextMenu={(e) => { e.preventDefault(); setSelected(conv); setMenu({ bot: b, x: e.clientX, y: e.clientY }); }}>
                      <span className="grade-rosto">
                        <Avatar bot={b} size={80} cutucadas={cutuca.id === b.id ? cutuca.n : 0} forceAnim={nascendoId === b.id ? "nascer" : null} />
                        {(b.unread ?? 0) > 0 && <i className="nao-lido" title="não lido" />}
                      </span>
                      <span className="grade-nome">{nomeNaTela(b, painel.prefs)}</span>
                      {b.online && b.busy && <span className="grade-vivo">{faseDoStatus(b.status, b.busy, b.fase) === "trabalhando" ? "trabalhando" : "digitando"}</span>}
                    </li>
                  );
                })}
              </ul>
            </li>
          )}
          {listaPronta.ids.map((id) => {
            const b = porId.get(id);
            if (!b) return null;
            const conv = dmConversation(b.id);
            const gerente = ehGerente({ gerente: !!b.gerente, manages: b.manages, role: b.role, nome: b.name });
            const espera = pendingFor(b.id) > 0 && !deusActive;
            return (
              <li key={b.id} className={"linha-bot" + (gerente ? " linha-gerente" : "") + (conv === selected ? " active" : "") + (b.online ? "" : " offline") + (espera ? " espera-ok" : "") + (pendingFor(b.id) > 0 ? " tem-aprovacao" : "") + (b.gerente ? " gerente-linha" : "")}
                onClick={() => { cutucar(b.id); fecharColab(); setSelected(conv); if (window.innerWidth < 768) setSidebarOpen(false); }}
                onContextMenu={(e) => { e.preventDefault(); setSelected(conv); setMenu({ bot: b, x: e.clientX, y: e.clientY }); }}>
                <Avatar bot={b} size={gerente ? 64 : 42} cutucadas={cutuca.id === b.id ? cutuca.n : 0} forceAnim={nascendoId === b.id ? "nascer" : null} />
                <div className="bot-text">
                  <div className="bot-name">{nomeNaTela(b, painel.prefs)}{espera && <span className="badge perigo">OK</span>}{pendingFor(b.id) > 0 && <span className="badge aprovacao" title="Espera o seu OK">{pendingFor(b.id)}</span>}{(b.unread ?? 0) > 0 && conv !== selected && pendingFor(b.id) === 0 && !espera && <span className="badge">{b.unread}</span>}</div>
                  {b.online && b.busy && pendingFor(b.id) === 0 && <div className="bot-vivo">{faseDoStatus(b.status, b.busy, b.fase) === "trabalhando" ? "está trabalhando" : "digitando…"}</div>}
                  <div className={"bot-status" + (pacote?.ajudando[b.id] ? " ajudando" : "") + (b.busy ? " busy" : "") + (espera ? " pedindo" : "")}>
                    {pacote?.ajudando[b.id]
                      ? `Ajudando ${nomeDe(pacote.ajudando[b.id].ajudando)}`
                      : pendingFor(b.id) > 0 ? (deusActive ? "auditoria" : "Espera o seu OK") : b.online ? (b.preview ?? (b.busy ? b.status : "Disponível")) : "Offline"}
                  </div>
                </div>
                {b.lastSeen ? <time className="bot-hora">{new Date(b.lastSeen).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time> : null}
                {b.busy && (
                  <button className="row-parar" title={`Parar o ${b.name} (só ele)`} aria-label={"Parar " + b.name}
                    onClick={(e) => { e.stopPropagation(); void api(`/bots/${b.id}/parar`, { method: "POST" }); }}>⏹</button>
                )}
                <button className="row-menu" title="Opções do bot" aria-label={"Opções de " + b.name}
                  onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setSelected(conv); setMenu({ bot: b, x: r.right, y: r.bottom }); }}>⋮</button>
              </li>
            );
          })}
          {!bots.length && (
            <li className="empty welcome-time">
              <div className="only-mobile welcome-time-bloco">
                <TimeAmebas />
                <TituloMyBots />
              </div>
              <span>Nenhum bot conectado ainda. Rode o nó em cada PC.</span>
            </li>
          )}
          {(gruposVisiveis.length > 0 || state.groups.length > 0 || (bots.length > 1 && bots.some((b) => b.gerente || (b.manages?.length)))) && (
            <li className="section">Grupos <button className="link" onClick={() => setNewGroup(true)}>+ novo</button></li>
          )}
          {gruposVisiveis.map(linhaGrupo)}
        </ul>
        <footer className="sidebar-foot only-desktop">{equipe.filter((b) => b.online).length} de {equipe.length} online · voz: {state.voice.tts ? state.voice.ttsEngine : "navegador"} / {state.voice.stt ? "whisper" : "navegador"}</footer>
        <div className="sidebar-pega only-desktop" role="separator" aria-orientation="vertical" title="Arraste para mudar a largura; clique duplo para voltar"
          onPointerDown={aoPuxarSidebar} onDoubleClick={resetSidebarW} />
      </aside>

      <main className="chat" style={target?.kind === "bot" ? ({ "--bot": colorFor(target.bot.id) } as any) : undefined}>
        {verTroca ? (
          <TrocaEntreBots conversationId={verTroca} bots={equipe} Avatar={Avatar} onFechar={() => setVerTroca(null)} />
        ) : verQuadro ? (
          <QuadroKanban
            titulo="Quadro de tarefas"
            subtitulo="Planos e tarefas dos bots"
            onFechar={() => setVerQuadro(false)}
            tarefas={tarefasFiltradas}
            nome={nomeDe}
            mostrarResponsavel
            fonte={pacote?.fonte}
            aviso={pacote?.aviso}
            onCancelar={(id) => void cancelar(id)}
            onDecidir={(id, resposta) => void decidir(id, resposta)}
            onSimular={pacote?.fonte === "exemplo" ? simular : undefined}
            filtro={filtroBot}
            onFiltro={setFiltroBot}
            botsFiltro={equipe.map((b) => ({ id: b.id, nome: nomeNaTela(b, painel.prefs) }))}
            bots={equipe}
            onAbrirBot={(id) => { setVerQuadro(false); setSelected(dmConversation(id)); }}
          />
        ) : verGrafo && pacote ? (
          <QuemFala pacote={pacote} bots={equipe} nome={nomeDe} onFechar={() => setVerGrafo(false)} />
        ) : target && selected ? (
          <Conversation
            key={selected}
            target={target}
            conversationId={selected}
            bots={equipe}
            abaInicial={tela === "tarefas" || tela === "detalhe" ? "tarefas" : null}
            tarefaInicial={tela === "detalhe" ? "t-video" : null}
            colab={pacote ? {
              tarefas: pacote.tarefas,
              fonte: pacote.fonte,
              aviso: pacote.aviso,
              nome: nomeDe,
              cancelar: (id) => void cancelar(id),
                decidir: (id, resposta) => void decidir(id, resposta),
              simular: pacote.fonte === "exemplo" ? simular : undefined,
            } : undefined}
            messages={state.messages[selected] ?? []}
            tools={state.tools}
            approvals={state.approvals.filter((a) => a.conversationId === selected || (target.kind === "bot" && a.botId === target.bot.id))}
            questions={state.questions.filter((q) => q.conversationId === selected || (target.kind === "bot" && q.botId === target.bot.id))}
            resolvedQuestions={state.resolvedQuestions}
            routines={target.kind === "bot" ? state.routines.filter((r) => r.botId === target.bot.id) : []}
            voice={state.voice}
            tts={tts} setTts={setTts}
            handsFree={handsFree} setHandsFree={setHandsFree}
            send={send}
            onEvent={onEvent}
            onOpenSidebar={() => { setSidebarOpen(true); setSelected(null); setVerQuadro(false); setVerGrafo(false); setVerTroca(null); }}
            onAbrirTroca={(conv) => { setVerTroca(conv); }}
            onAbrirEquipe={() => { setVerGrafo(true); setVerQuadro(false); setVerTroca(null); }}
            onAbrirBot={(id) => { setVerQuadro(false); setVerGrafo(false); setVerTroca(null); setSelected(dmConversation(id)); }}
            control={state.control}
            initialPanel={panel && panel.conv === selected ? panel : null}
            empresaNome={target.kind === "bot" && target.bot.empresaId ? (empresas.find((e) => e.id === target.bot.empresaId)?.nome ?? "") : ""}
          />
        ) : (
          <div className="placeholder">
            <TimeAmebas />
            <TituloMyBots grande />
            <p>Escolha um bot ou grupo na lista para conversar.</p>
          </div>
        )}
      </main>

      <Maquina bots={state.bots} pendencias={state.approvals.length + state.questions.length} voz={state.voice} />

      {verConfig && (
        <TelaConfiguracoes
          bots={state.bots}
          empresas={empresas}
          abaInicial={verConfig}
          onClose={() => setVerConfig(null)}
          tts={tts} setTts={setTts}
          handsFree={handsFree} setHandsFree={setHandsFree}
          avisos={avisos} setAvisos={setAvisos}
        />
      )}

      {newGroup && <NewGroupDialog bots={state.bots} onClose={() => setNewGroup(false)} onCreated={(g) => { setNewGroup(false); setSelected(groupConversation(g.id)); }} />}
      {state.importFile && (
        <ImportDialog
          file={state.importFile}
          bots={state.bots}
          onClose={clearImport}
          onSend={(botId, text, file) => {
            const conv = dmConversation(botId);
            send({ type: "send", conversationId: conv, text, attachments: [{ name: file.name, mime: file.mime, dataBase64: file.dataBase64 }] });
            clearImport();
            setSelected(conv);
          }}
        />
      )}
      {menu && <BotMenu bot={menu.bot} x={menu.x} y={menu.y} onClose={() => setMenu(null)}
        pref={painel.prefs[menu.bot.id] ?? {}} secoes={painel.secoes}
        onPref={(p) => void painel.salvar(menu.bot.id, p)}
        onRenomear={() => setDialogo({ tipo: "renomear", bot: menu.bot })}
        onNovaSecao={() => setDialogo({ tipo: "secao", bot: menu.bot })}
        onAparencia={() => setDialogo({ tipo: "aparencia", bot: menu.bot })}
        onExcluir={() => setAExcluir(menu.bot)}
        onOpen={(id) => { setSelected(dmConversation(id)); if (window.innerWidth < 768) setSidebarOpen(false); }}
        onPanel={openPanel} />}
      {newGerente && <NewGerenteDialog bots={state.bots} onClose={() => setNewGerente(false)} onCreated={(id) => { setNewGerente(false); setSelected(dmConversation(id)); }} />}
      {aExcluir && <ExcluirBotDialog bot={aExcluir} onClose={() => setAExcluir(null)} />}
      {/* A abertura segura a tela ate saber SE a casa tem empresa. Sem isso o painel
          pisca entre a explosao e o cadastro — e o cliente ve por um instante uma casa
          que ainda nao e dele. */}
      {!pularIntro && (abertura || !empresasCarregadas) && <Abertura onFim={() => setAbertura(false)} />}
      {!abertura && empresasCarregadas && !idiomaPronto && !empresas.length && !pularPrimeira && <EscolhaIdioma onEscolher={() => setIdiomaPronto(true)} />}
      {!abertura && empresasCarregadas && (idiomaPronto || !!empresas.length) && !empresas.length && !pularPrimeira && (
        <PrimeiraEmpresa
          onPular={() => setPularPrimeira(true)}
          onPronto={(id) => { setPularPrimeira(true); setEmpresaAtiva(id); void carregarEmpresas(); setLegalPara(id); }}
        />
      )}
      {legalPara && <TelaLegal empresaId={legalPara} empresaNome={empresas.find((e) => e.id === legalPara)?.nome ?? legalPara}
        onClose={() => { setLegalPara(null); setVerEmpresas(true); }} />}
      {verEmpresas && <EmpresasDialog empresas={empresas} bots={state.bots} onClose={() => { setVerEmpresas(false); void carregarEmpresas(); }} />}
      {newBot && <NewBotDialog empresas={empresas} empresaAtiva={empresaAtiva} onCriou={() => void carregarEmpresas()} onClose={() => setNewBot(false)} onCreated={(id) => { setNewBot(false); setNascendoId(id); window.setTimeout(() => setNascendoId((cur) => cur === id ? null : cur), 2800); setSelected(dmConversation(id)); if (window.innerWidth < 768) setSidebarOpen(true); }} />}

      {dialogo?.tipo === "aparencia" && (
        <EscolhaAparencia id={dialogo.bot.id} valor={dialogo.bot.avatar} onFechar={() => setDialogo(null)}
          onSalvar={async (codigo) => { await api(`/managed/${dialogo.bot.id}`, { method: "PATCH", body: JSON.stringify({ avatar: codigo }) }); }} />
      )}
      {dialogo?.tipo === "renomear" && (
        <DialogoTexto titulo="Renomear bot" rotulo={`Como ${dialogo.bot.name} aparece na sua lista. Muda só aqui no painel.`}
          valor={nomeNaTela(dialogo.bot, painel.prefs)} onFechar={() => setDialogo(null)}
          onOk={(v) => void painel.salvar(dialogo.bot.id, { apelido: v === dialogo.bot.name ? "" : v })} />
      )}
      {dialogo?.tipo === "secao" && (
        <DialogoTexto titulo="Nova Seção" rotulo={`${dialogo.bot.name} entra nesta seção.`} placeholder="Ex.: Vendas"
          onFechar={() => setDialogo(null)}
          onOk={async (v) => { await painel.criarSecao(v); await painel.salvar(dialogo.bot.id, { secao: v }); }} />
      )}

      <div className="toasts">
        {state.toasts.map((t) => (
          <Aviso
            key={t.id}
            quem={state.bots.find((b) => b.id === t.botId)?.name ?? "MyBots"}
            texto={t.text}
            vezes={t.vezes}
            em={t.em}
            onFechar={() => removeToast(t.id)}
          />
        ))}
      </div>
    </div>
  );
}













