import { useEffect, useMemo, useRef, useState } from "react";
import type { BotSummary, ControlMode, ControlState, Group, PendingApproval, PendingQuestion, Routine, StoredMessage } from "@mybots/shared";
import { CONTROL_DESCRIPTIONS, CONTROL_LABELS, CONTROL_MODES, dmConversation, effectiveControl, groupConversation } from "@mybots/shared";
import { useHub, type ToolInfo } from "./hub";
import { registrarParada, stopEverything } from "./stop";
import { criarFala, escolherMicrofone, escutaContinua, isSpeaking, listenOnce, microfoneEscolhido, microfones, onSpeaking, speak, speechSupported, stopSpeaking, type EscutaViva, type FalaViva, type VoiceCaps } from "./voice";
import { ContextMenu, useToqueLongo, type ItemMenu } from "./ContextMenu";
import { desintegrarAvatar } from "./particulas";
import { LendoSite } from "./lendo";
import { ArteDoBot, EscolhaAparencia, lerAparencia } from "./aparencia";
import { Trabalhos } from "./trabalhos";
import { Abertura, PrimeiraEmpresa, EscolhaIdioma } from "./abertura";
import { TelaLegal } from "./legal";
import { TelaCreditos } from "./creditos";
import { PcDaEmpresa } from "./pc";
import { AtalhoCelular, CelularDaEmpresaPainel } from "./celularEmpresa";
import { PainelDoPc } from "./painelPc";
import { CelularDaEmpresa } from "./celular";
import { TelaDoMac } from "./mac";
import { Fragment } from "react";
import { usePainelPrefs, nomeNaTela, ChipTrocas, FolhaAbrirTroca, TrocaEntreBots, DialogoTexto, type Troca, type PrefDoBot } from "./painel";
import { montarLista } from "./lista";
import { api } from "./api";
import { Tema, Tamanho, Configuracao } from "./tema";
import { Maquina } from "./maquina";
import { Aviso, GlobalControl, notify } from "./controles";
import { BotMenu, ImportDialog } from "./menuBot";
import { Ameba, Avatar, colorFor, definirTonsDaEquipe } from "./avatar";
import { Conversation } from "./conversa";
import { EmpresasDialog, ExcluirBotDialog, NewBotDialog, NewGerenteDialog, NewGroupDialog } from "./dialogos";
import { Icone } from "./icones";

type Target = { kind: "bot"; bot: BotSummary } | { kind: "group"; group: Group };

const pref = (k: string, d: boolean) => { const v = localStorage.getItem("mybots." + k); return v == null ? d : v === "1"; };
const setPref = (k: string, v: boolean) => localStorage.setItem("mybots." + k, v ? "1" : "0");

export function App() {
  const { state, send, loadHistory, onEvent, removeToast, clearImport, setImport } = useHub();
  definirTonsDaEquipe(state.bots.map((b) => b.id)); // cada bot com a sua cor, sem dois parecidos
  const [selected, setSelected] = useState<string | null>(null); // conversationId
  const [filter, setFilter] = useState("");
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [mais, setMais] = useState(false);
  const [tts, setTts] = useState(() => pref("tts", true));          // resposta em áudio (ligada por padrão)
  const [handsFree, setHandsFree] = useState(() => pref("handsfree", true)); // volta a escutar depois que o bot fala
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [newGroup, setNewGroup] = useState(false);
  const [verTrabalhos, setVerTrabalhos] = useState(false);
  const [verCelular, setVerCelular] = useState(false);
  const [verMac, setVerMac] = useState(false);
  const [newBot, setNewBot] = useState(false);
  // Empresas: cada uma com seus bots, gerentes e regras. O conhecimento continua universal.
  const [empresas, setEmpresas] = useState<Array<{ id: string; nome: string; regras: string; idioma?: string; bots: number }>>([]);
  const [empresaAtiva, setEmpresaAtiva] = useState<string>(() => { try { return localStorage.getItem("mybots-empresa") || "todas"; } catch { return "todas"; } });
  const [verEmpresas, setVerEmpresas] = useState(false);
  // A abertura aparece toda vez que o painel abre; depois dela, se a casa ainda nao
  // tem empresa nenhuma, a tela de cadastro e o que ele ve — nao um painel vazio.
  const [abertura, setAbertura] = useState(true);
  // a lingua da casa: primeira coisa depois da explosao, antes de qualquer cadastro
  // A escolha da lingua e parte da abertura: vale sempre que a casa esta VAZIA, mesmo
  // que o navegador ja tenha uma guardada. Casa com empresa nao volta a perguntar.
  const [idiomaPronto, setIdiomaPronto] = useState(false);
  // cutucar o bot: clique seguido no mesmo bot acumula. Zera sozinho depois de um
  // tempo — senao um clique de manha e outro a tarde somariam.
  const [cutuca, setCutuca] = useState<{ id: string; n: number }>({ id: "", n: 0 });
  const relogioCutuca = useRef<number | null>(null);
  const cutucar = (id: string) => {
    setCutuca((c) => ({ id, n: c.id === id ? c.n + 1 : 1 }));
    if (relogioCutuca.current) clearTimeout(relogioCutuca.current);
    relogioCutuca.current = window.setTimeout(() => setCutuca({ id: "", n: 0 }), 2600);
  };
  const [empresasCarregadas, setEmpresasCarregadas] = useState(false);
  const [pularPrimeira, setPularPrimeira] = useState(false);
  const [legalPara, setLegalPara] = useState<string | null>(null);
  const [aExcluir, setAExcluir] = useState<BotSummary | null>(null);
  const carregarEmpresas = async () => { try { const r = await api("/empresas"); if (r.ok) setEmpresas(await r.json()); } catch {} finally { setEmpresasCarregadas(true); } };
  useEffect(() => { void carregarEmpresas(); }, []);
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
  const [mostrarEscondidos, setMostrarEscondidos] = useState(false);
  const [verTroca, setVerTroca] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<{ tipo: "renomear" | "secao" | "aparencia"; bot: BotSummary } | null>(null);
  const [panel, setPanel] = useState<{ conv: string; panel: "settings" | "routines"; n: number } | null>(null);
  const openPanel = (botId: string, which: "settings" | "routines") => {
    const conv = dmConversation(botId);
    setSelected(conv);
    setPanel({ conv, panel: which, n: Date.now() });
    if (window.innerWidth < 620) setSidebarOpen(false);
  };

  const bots = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return [...state.bots]
      .filter((b) => !f || b.name.toLowerCase().includes(f) || b.role.toLowerCase().includes(f))
      .filter((b) => mostrarEscondidos || !painel.prefs[b.id]?.escondido)
      // bot do sistema (sem empresa) aparece sempre; o resto só na empresa escolhida
      .filter((b) => empresaAtiva === "todas" || !b.empresaId || b.empresaId === empresaAtiva)
      .sort((a, b) => nomeNaTela(a, painel.prefs).localeCompare(nomeNaTela(b, painel.prefs), "pt"));
  }, [state.bots, filter, painel.prefs, mostrarEscondidos, empresaAtiva]);

  /** Fixados viram a grade. Na lista, cada empresa põe o gerente na frente. */
  const listaPronta = useMemo(() => montarLista(bots.map((b) => ({
    id: b.id,
    nome: nomeNaTela(b, painel.prefs),
    empresaId: b.empresaId,
    fixado: !!painel.prefs[b.id]?.fixado,
    gerente: !!b.gerente,
    manages: b.manages,
    role: b.role,
  })), empresas), [bots, painel.prefs, empresas]);
  const porId = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);

  const busca = filter.trim().toLowerCase();
  const gruposVisiveis = state.groups.filter((g) => !busca || g.name.toLowerCase().includes(busca));
  const linhaGrupo = (g: Group) => (
    <li key={g.id} className={(groupConversation(g.id) === selected ? "active" : "")} onClick={() => { setVerTrabalhos(false); setSelected(groupConversation(g.id)); if (window.innerWidth < 720) setSidebarOpen(false); }}>
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
    if (selected.startsWith("dm:")) { const bot = state.bots.find((b) => dmConversation(b.id) === selected); return bot ? { kind: "bot", bot } : null; }
    if (selected.startsWith("group:")) { const group = state.groups.find((g) => groupConversation(g.id) === selected); return group ? { kind: "group", group } : null; }
    return null;
  }, [selected, state.bots, state.groups]);

  useEffect(() => { if (selected) void loadHistory(selected); }, [selected]);
  useEffect(() => { setPref("tts", tts); }, [tts]);
  useEffect(() => { setPref("handsfree", handsFree); }, [handsFree]);
  useEffect(() => { if (!selected && bots.length) setSelected(dmConversation(bots[0].id)); }, [bots.length]);
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
    if (m.type === "message" && m.message.sender.kind === "bot" && m.message.meta?.streaming !== true && document.hidden) notify(m.message.sender.name, m.message.text);
    if (m.type === "approval.request") notify("Aprovação necessária", m.approval.description);
    if (m.type === "question") notify("Precisa da sua resposta", m.question.question);
    if (m.type === "notify") notify(state.bots.find((b) => b.id === m.botId)?.name ?? "MyBots", m.text);
  }), [state.bots]);

  const pendingFor = (id: string) => state.approvals.filter((a) => a.botId === id).length + state.questions.filter((q) => q.botId === id).length;
  const deusActive = state.control.global === "deus" || state.bots.some((b) => b.online && effectiveControl(state.control.global, b.controlMode) === "deus");

  return (
    <div className={"app" + (sidebarOpen ? "" : " sidebar-closed") + (deusActive ? " deus" : "")}>
      {deusActive && (
        <div className="deus-banner" role="alert">
          <span>⚠️ <b>MODO DEUS EXTREMO</b> ativo{state.control.global === "deus" ? " para todos os bots" : " em " + state.bots.filter((b) => b.online && effectiveControl(state.control.global, b.controlMode) === "deus").map((b) => b.name).join(", ")}: agem sem pedir aprovação. Tudo vai para a auditoria.</span>
          <button className="btn danger panic" title="Interrompe todos os bots e volta para Supervisionado" onClick={() => void api("/control/panic", { method: "POST" })}>⏹ Pânico</button>
        </div>
      )}
      <aside className="sidebar">
        <header className="sidebar-head">
          <div className="brand"><span className="logo-img"><Ameba id="mybots" size={32} /></span><div><b>MyBots</b></div></div>
          <div className="sidebar-canto">
            <Tema />
            <Configuracao />
            <button className={"icon-btn canto" + (buscaAberta ? " on" : "")} type="button" title="Buscar" aria-label="Buscar" onClick={() => setBuscaAberta((v) => !v)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            </button>
            <button className="icon-btn canto" type="button" title="Novo" aria-label="Novo" onClick={() => setMais((v) => !v)}>+</button>
            {mais && (
              <div className="mais-menu" role="menu">
                <button type="button" onClick={() => { setMais(false); setNewBot(true); }}>Novo bot</button>
                <button type="button" onClick={() => { setMais(false); setNewGerente(true); }}>Novo gerente</button>
                <button type="button" onClick={() => { setMais(false); setNewGroup(true); }}>Novo grupo</button>
              </div>
            )}
          </div>
        </header>
        <Tamanho />
        <GlobalControl control={state.control} />
        {(buscaAberta || filter) && <input className="search" placeholder="Buscar bot…" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />}
        <ul className="bots">
          <li className="atalho-trabalhos" onClick={() => { setVerCelular(true); if (window.innerWidth < 720) setSidebarOpen(false); }}>
            <span className="at-icone"><Icone nome="celular" /></span><div><b>Celular</b></div>
          </li>
          <li className="atalho-trabalhos" onClick={() => { setVerMac(true); if (window.innerWidth < 720) setSidebarOpen(false); }}>
            <span className="at-icone"><Icone nome="mac" /></span><div><b>Tela do Mac</b></div>
          </li>
          <li className="atalho-trabalhos" onClick={() => { setVerTrabalhos(true); if (window.innerWidth < 720) setSidebarOpen(false); }}>
            <span className="at-icone"><Icone nome="pasta" /></span><div><b>Trabalhos</b></div>
          </li>
          <li className="section empresa-linha">
            <select className="empresa-sel" value={empresaAtiva} onChange={(e) => { if (e.target.value === "+nova") { setVerEmpresas(true); return; } setEmpresaAtiva(e.target.value); }}>
              <option value="todas">Todas as empresas</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome} ({e.bots})</option>)}
              <option value="+nova">＋ gerenciar empresas…</option>
            </select>
          </li>
          {empresaAtiva !== "todas" && state.bots.length > bots.length && (
            <li className="section aviso-filtro">
              {state.bots.length - bots.length} bot(s) de outras empresas escondidos ·{" "}
              <button className="link" onClick={() => setEmpresaAtiva("todas")}>ver todos</button>
            </li>
          )}
          {Object.values(painel.prefs).some((p) => p.escondido) && (
            <li className="section"><button className="link" onClick={() => setMostrarEscondidos(!mostrarEscondidos)}>{mostrarEscondidos ? "ocultar escondidos" : "escondidos"}</button></li>
          )}
          {listaPronta.fixados.length > 0 && (
            <li className="grade-wrap">
              <ul className="grade-fixados">
                {listaPronta.fixados.map((id) => {
                  const b = porId.get(id);
                  if (!b) return null;
                  const conv = dmConversation(b.id);
                  return (
                    <li key={b.id} className={conv === selected ? "ativo" : ""}
                      onClick={() => { cutucar(b.id); setVerTrabalhos(false); setSelected(conv); if (window.innerWidth < 620) setSidebarOpen(false); }}
                      onContextMenu={(e) => { e.preventDefault(); setSelected(conv); setMenu({ bot: b, x: e.clientX, y: e.clientY }); }}>
                      <span className="grade-rosto">
                        <Avatar bot={b} size={64} cutucadas={cutuca.id === b.id ? cutuca.n : 0} />
                        {(b.unread ?? 0) > 0 && <i className="nao-lido" title="não lido" />}
                      </span>
                      <span className="grade-nome">{nomeNaTela(b, painel.prefs)}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          )}
          {listaPronta.grupos.map((g) => (
            <Fragment key={g.titulo}>
              <li className="section secao-nome">{g.titulo}</li>
              {g.ids.map((id) => {
                const b = porId.get(id);
                if (!b) return null;
                const conv = dmConversation(b.id);
                return (
                  <li key={b.id} className={"linha-bot" + (conv === selected ? " active" : "") + (b.online ? "" : " offline")}
                    onClick={() => { cutucar(b.id); setVerTrabalhos(false); setSelected(conv); if (window.innerWidth < 620) setSidebarOpen(false); }}
                    onContextMenu={(e) => { e.preventDefault(); setSelected(conv); setMenu({ bot: b, x: e.clientX, y: e.clientY }); }}>
                    <Avatar bot={b} size={36} cutucadas={cutuca.id === b.id ? cutuca.n : 0} />
                    <div className="bot-text">
                      <div className="bot-name">{nomeNaTela(b, painel.prefs)}{(b.unread ?? 0) > 0 && conv !== selected && <span className="badge">{b.unread}</span>}</div>
                      <div className={"bot-status" + (b.busy ? " busy" : "") + (pendingFor(b.id) > 0 ? " pedindo" : "")}>
                        {pendingFor(b.id) > 0 ? "Espera o seu OK" : b.online ? (b.busy ? b.status + "…" : b.preview ?? b.status) : "Offline"}
                      </div>
                    </div>
                    {b.busy && (
                      <button className="row-parar" title={`Parar o ${b.name} (só ele)`} aria-label={"Parar " + b.name}
                        onClick={(e) => { e.stopPropagation(); void api(`/bots/${b.id}/parar`, { method: "POST" }); }}>⏹</button>
                    )}
                    <button className="row-menu" title="Opções do bot" aria-label={"Opções de " + b.name}
                      onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setSelected(conv); setMenu({ bot: b, x: r.right, y: r.bottom }); }}>⋮</button>
                  </li>
                );
              })}
            </Fragment>
          ))}
          {!bots.length && <li className="empty">Nenhum bot conectado ainda. Rode o nó em cada PC.</li>}
          {(gruposVisiveis.length > 0 || state.groups.length > 0 || (bots.length > 1 && bots.some((b) => b.gerente || (b.manages?.length)))) && (
            <li className="section">Grupos <button className="link" onClick={() => setNewGroup(true)}>+ novo</button></li>
          )}
          {gruposVisiveis.map(linhaGrupo)}
        </ul>
        <footer className="sidebar-foot">{state.bots.filter((b) => b.online).length} de {state.bots.length} online · voz: {state.voice.tts ? state.voice.ttsEngine : "navegador"} / {state.voice.stt ? "whisper" : "navegador"}</footer>
      </aside>

      <main className="chat" style={target?.kind === "bot" ? ({ "--bot": colorFor(target.bot.id) } as any) : undefined}>
        {verTroca ? (
          <TrocaEntreBots conversationId={verTroca} bots={state.bots} Avatar={Avatar} onFechar={() => setVerTroca(null)} />
        ) : verTrabalhos ? (
          <Trabalhos bots={state.bots} onClose={() => setVerTrabalhos(false)} />
        ) : target && selected ? (
          <Conversation
            key={selected}
            target={target}
            conversationId={selected}
            bots={state.bots}
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
            onOpenSidebar={() => setSidebarOpen(true)}
            onAbrirTroca={(conv) => { setVerTrabalhos(false); setVerTroca(conv); }}
            control={state.control}
            initialPanel={panel && panel.conv === selected ? panel : null}
            empresaNome={target.kind === "bot" && target.bot.empresaId ? (empresas.find((e) => e.id === target.bot.empresaId)?.nome ?? "") : ""}
          />
        ) : (
          <div className="placeholder"><span className="logo-img big"><Ameba id="mybots" size={96} /></span><h2>MyBots</h2><p>Escolha um bot ou grupo na lista para conversar.</p></div>
        )}
      </main>

      <Maquina bots={state.bots} pendencias={state.approvals.length + state.questions.length} voz={state.voice} />

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
        onOpen={(id) => { setSelected(dmConversation(id)); if (window.innerWidth < 620) setSidebarOpen(false); }}
        onPanel={openPanel} />}
      {newGerente && <NewGerenteDialog bots={state.bots} onClose={() => setNewGerente(false)} onCreated={(id) => { setNewGerente(false); setSelected(dmConversation(id)); }} />}
      {aExcluir && <ExcluirBotDialog bot={aExcluir} onClose={() => setAExcluir(null)} />}
      {/* A abertura segura a tela ate saber SE a casa tem empresa. Sem isso o painel
          pisca entre a explosao e o cadastro — e o cliente ve por um instante uma casa
          que ainda nao e dele. */}
      {(abertura || !empresasCarregadas) && <Abertura onFim={() => setAbertura(false)} />}
      {!abertura && empresasCarregadas && !idiomaPronto && !empresas.length && !pularPrimeira && <EscolhaIdioma onEscolher={() => setIdiomaPronto(true)} />}
      {!abertura && empresasCarregadas && (idiomaPronto || !!empresas.length) && !empresas.length && !pularPrimeira && (
        <PrimeiraEmpresa
          onPular={() => setPularPrimeira(true)}
          onPronto={(id) => { setPularPrimeira(true); setEmpresaAtiva(id); void carregarEmpresas(); setLegalPara(id); }}
        />
      )}
      {legalPara && <TelaLegal empresaId={legalPara} empresaNome={empresas.find((e) => e.id === legalPara)?.nome ?? legalPara}
        onClose={() => { setLegalPara(null); setVerEmpresas(true); }} />}
      {verCelular && <AtalhoCelular empresas={empresas} ativa={empresaAtiva} onFechar={() => setVerCelular(false)} />}
      {verMac && <TelaDoMac onFechar={() => setVerMac(false)} />}
      {verEmpresas && <EmpresasDialog empresas={empresas} bots={state.bots} onClose={() => { setVerEmpresas(false); void carregarEmpresas(); }} />}
      {newBot && <NewBotDialog empresas={empresas} empresaAtiva={empresaAtiva} onCriou={() => void carregarEmpresas()} onClose={() => setNewBot(false)} onCreated={(id) => { setNewBot(false); setSelected(dmConversation(id)); }} />}

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













