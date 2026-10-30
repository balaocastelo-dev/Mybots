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
import { CelularDaEmpresa } from "./celular";
import { TelaDoMac } from "./mac";
import { Fragment } from "react";
import { usePainelPrefs, nomeNaTela, ChipTrocas, FolhaAbrirTroca, TrocaEntreBots, DialogoTexto, type Troca, type PrefDoBot } from "./painel";

type Target = { kind: "bot"; bot: BotSummary } | { kind: "group"; group: Group };

const pref = (k: string, d: boolean) => { const v = localStorage.getItem("mybots." + k); return v == null ? d : v === "1"; };
const setPref = (k: string, v: boolean) => localStorage.setItem("mybots." + k, v ? "1" : "0");

export function App() {
  const { state, send, loadHistory, onEvent, removeToast, clearImport, setImport } = useHub();
  definirTonsDaEquipe(state.bots.map((b) => b.id)); // cada bot com a sua cor, sem dois parecidos
  const [selected, setSelected] = useState<string | null>(null); // conversationId
  const [filter, setFilter] = useState("");
  const [tts, setTts] = useState(() => pref("tts", true));          // resposta em áudio (ligada por padrão)
  const [handsFree, setHandsFree] = useState(() => pref("handsfree", true)); // volta a escutar depois que o bot fala
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [newGroup, setNewGroup] = useState(false);
  const [verTrabalhos, setVerTrabalhos] = useState(false);
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
      .sort((a, b) =>
        Number(!!painel.prefs[b.id]?.fixado) - Number(!!painel.prefs[a.id]?.fixado)
        || Number(b.online) - Number(a.online)
        || nomeNaTela(a, painel.prefs).localeCompare(nomeNaTela(b, painel.prefs)));
  }, [state.bots, filter, painel.prefs, mostrarEscondidos, empresaAtiva]);

  /** A mesma lista, com os cabeçalhos de seção no lugar certo. Fixados sempre
   *  em cima; depois as seções na ordem em que ele criou; soltos por último. */
  const listaDaBarra = useMemo(() => {
    const chave = (b: BotSummary) => painel.prefs[b.id]?.fixado ? "📌 Fixados" : (painel.prefs[b.id]?.secao || "");
    const grupos = new Map<string, BotSummary[]>();
    for (const b of bots) { const k = chave(b); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k)!.push(b); }
    const peso = (n: string) => n.endsWith("Fixados") ? -1 : n === "" ? 99 : painel.secoes.indexOf(n);
    const saida: Array<{ b: BotSummary; secao?: string }> = [];
    for (const n of [...grupos.keys()].sort((a, b) => peso(a) - peso(b))) {
      grupos.get(n)!.forEach((b, i) => saida.push({ b, secao: i === 0 && n ? n : undefined }));
    }
    return saida;
  }, [bots, painel.prefs, painel.secoes]);

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
          <div className="brand"><span className="logo-img"><Ameba id="mybots" size={40} /></span><div><b>MyBots</b><small>{state.connected ? "conectado ao Hub" : "reconectando…"}</small></div></div>
          <Tema />
      <Tamanho />
          <span className={"dot " + (state.connected ? "on" : "off")} />
        </header>
        <GlobalControl control={state.control} />
        <input className="search" placeholder="Buscar bot…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul className="bots">
          <li className="atalho-trabalhos" onClick={() => { setVerTrabalhos(true); if (window.innerWidth < 620) setSidebarOpen(false); }}>
            <span className="at-icone" aria-hidden="true">📂</span><div><b>Trabalhos feitos</b><small>imagens, vídeos, PDFs, .md, zips e sites</small></div>
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
          <li className="section">Bots <span className="section-acoes">{Object.values(painel.prefs).some((p) => p.escondido) && <button className="link" onClick={() => setMostrarEscondidos(!mostrarEscondidos)}>{mostrarEscondidos ? "ocultar escondidos" : "escondidos"}</button>}<button className="link" onClick={() => setNewGerente(true)}>+ gerente</button><button className="link" onClick={() => setNewBot(true)}>+ novo bot</button></span></li>
          {listaDaBarra.map(({ b, secao }) => (
            <Fragment key={b.id}>
            {secao && <li className="section secao-nome">{secao}</li>}
            <li key={b.id} className={(dmConversation(b.id) === selected ? "active" : "") + (b.online ? "" : " offline")}
              onClick={() => { cutucar(b.id); setVerTrabalhos(false); setSelected(dmConversation(b.id)); if (window.innerWidth < 620) setSidebarOpen(false); }}
              onContextMenu={(e) => { e.preventDefault(); setSelected(dmConversation(b.id)); setMenu({ bot: b, x: e.clientX, y: e.clientY }); }}>
              <Avatar key={cutuca.id === b.id ? cutuca.n : 0} bot={b} cutucadas={cutuca.id === b.id ? cutuca.n : 0} />
              <div className="bot-text">
                <div className="bot-name">{(b.manages?.length || b.gerente) ? <span className="coroa" title={b.manages?.length ? `Gerencia ${b.manages.length} bot(s)` : "Gerente Geral da empresa"}>👑</span> : null}{painel.prefs[b.id]?.fixado ? <span className="pin" title="Fixado">📌</span> : null}{nomeNaTela(b, painel.prefs)}{pendingFor(b.id) > 0 && <span className="badge warn">{pendingFor(b.id)}</span>}{(b.unread ?? 0) > 0 && dmConversation(b.id) !== selected && <span className="badge">{b.unread}</span>}</div>
                {b.role && <div className="papel">{b.role}</div>}
                <div className={"bot-status" + (b.busy ? " busy" : "") + (pendingFor(b.id) > 0 ? " pedindo" : "")}>
                  {pendingFor(b.id) > 0 ? "Espera o seu OK" : b.online ? (b.busy ? b.status + "…" : b.preview ?? b.status) : "Offline"}
                </div>
              </div>
              {b.busy && (
                <button className="row-parar" title={`Parar o ${b.name} (só ele)`} aria-label={"Parar " + b.name}
                  onClick={(e) => { e.stopPropagation(); void api(`/bots/${b.id}/parar`, { method: "POST" }); }}>⏹</button>
              )}
              <button className="row-menu" title="Opções do bot" aria-label={"Opções de " + b.name}
                onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setSelected(dmConversation(b.id)); setMenu({ bot: b, x: r.right, y: r.bottom }); }}>⋮</button>
            </li>
            </Fragment>
          ))}
          {!bots.length && <li className="empty">Nenhum bot conectado ainda. Rode o nó em cada PC.</li>}
          {/* Grupo so faz sentido quando ja existe EQUIPE: um gerente e pelo menos um bot
              alem dele. Antes disso a secao so ocupava espaco e oferecia uma acao que nao
              tinha com quem ser feita. Grupo que ja existe continua aparecendo. */}
          {(state.groups.length > 0 || (bots.length > 1 && bots.some((b) => (b as any).gerente || (b as any).manages?.length))) && (
            <li className="section">Grupos <button className="link" onClick={() => setNewGroup(true)}>+ novo</button></li>
          )}
          {state.groups.map((g) => (
            <li key={g.id} className={groupConversation(g.id) === selected ? "active" : ""} onClick={() => { setVerTrabalhos(false); setSelected(groupConversation(g.id)); if (window.innerWidth < 620) setSidebarOpen(false); }}>
              <div className="avatar group-avatar" style={{ width: 88, height: 88 }}>👥</div>
              <div className="bot-text">
                <div className="bot-name">{g.name}</div>
                <div className="bot-status">{g.members.map((m) => state.bots.find((b) => b.id === m)?.name.split(" ")[0] ?? m).join(", ")}</div>
              </div>
            </li>
          ))}
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


// ---------------- tema: Balcao (claro) e Bancada (escuro) ----------------

/** O tema nao segue o sistema operacional: quem manda e este botao, e a
 *  escolha fica guardada no navegador. Claro e o padrao. */
function Tema() {
  const [tema, setTema] = useState<"claro" | "escuro">(
    () => (localStorage.getItem("mybots.tema") === "escuro" ? "escuro" : "claro"),
  );
  useEffect(() => {
    document.documentElement.dataset.tema = tema;
    localStorage.setItem("mybots.tema", tema);
  }, [tema]);
  return (
    <div className="tema" role="group" aria-label="Tema do painel">
      <button className={tema === "claro" ? "on" : ""} onClick={() => setTema("claro")} aria-pressed={tema === "claro"} title="Tema claro" aria-label="Tema claro">&#9728;</button>
      <button className={tema === "escuro" ? "on" : ""} onClick={() => setTema("escuro")} aria-pressed={tema === "escuro"} title="Tema escuro" aria-label="Tema escuro">&#9790;</button>
    </div>
  );
}

// ---------------- a coluna da maquina ----------------

type MaquinaInfo = {
  ram: { usadaGb: number; totalGb: number };
  vram: { usadaGb: number; totalGb: number; nome: string } | null;
  reserva: { ramGb: number; vramGb: number };
  saberes: { total: number; porTipo: Array<{ tipo: string; n: number }> };
};

/** Numeros lidos do Hub de verdade (RAM do sistema, VRAM pelo nvidia-smi).
 *  A marca e a reserva que o dono mandou guardar: 12 GB e 4 GB. */
function Maquina({ bots, pendencias, voz }: { bots: BotSummary[]; pendencias: number; voz: { tts: boolean; ttsEngine: string; stt: boolean } }) {
  const [m, setM] = useState<MaquinaInfo | null>(null);
  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      try {
        const r = await fetch("/api/maquina");
        if (r.ok && vivo) setM(await r.json());
      } catch { /* hub caiu: a coluna simplesmente para de atualizar */ }
    };
    void ler();
    const t = setInterval(ler, 5000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  const online = bots.filter((b) => b.online).length;
  return (
    <aside className="maquina">
      <div>
        <h3>Máquina</h3>
        {m ? (
          <>
            <Medidor rotulo="Memória" usada={m.ram.usadaGb} total={m.ram.totalGb} reserva={m.reserva.ramGb} />
            {m.vram
              ? <Medidor rotulo={"Vídeo · " + m.vram.nome.replace(/^NVIDIA GeForce /, "")} usada={m.vram.usadaGb} total={m.vram.totalGb} reserva={m.reserva.vramGb} />
              : <p className="maq-nota">Sem placa NVIDIA visível aqui.</p>}
            <p className="maq-nota">
              A marca é a reserva da casa: {m.reserva.ramGb} GB de memória e {m.reserva.vramGb} GB de vídeo
              sempre livres para o sistema.
            </p>
          </>
        ) : <p className="maq-nota">Lendo a máquina…</p>}
      </div>

      <div>
        <h3>Equipe</h3>
        <div className="lig"><span className="nome">Bots ligados</span><span className="n">{online} / {bots.length}</span></div>
        <div className="lig"><span className="nome">Esperando você</span><span className="n">{pendencias}</span></div>
        <div className="lig"><span className="nome">Voz</span><span className="n">{voz.tts ? voz.ttsEngine : "navegador"}</span></div>
      </div>

      <div>
        <h3>Base de conhecimento</h3>
        {m?.saberes?.porTipo?.length
          ? m.saberes.porTipo.slice(0, 7).map((t) => (
              <div className="lig" key={t.tipo}><span className="nome">{t.tipo}</span><span className="n">{t.n}</span></div>
            ))
          : <div className="vazio">Base vazia.</div>}
      </div>
    </aside>
  );
}

function Medidor({ rotulo, usada, total, reserva }: { rotulo: string; usada: number; total: number; reserva: number }) {
  const cheio = total > 0 ? Math.min(100, (usada / total) * 100) : 0;
  const limite = total > 0 ? Math.max(0, Math.min(100, ((total - reserva) / total) * 100)) : 0;
  const folga = total - usada;
  const classe = folga < reserva ? "estourado" : folga < reserva * 1.5 ? "apertado" : "";
  return (
    <div className="med">
      <div className="med-topo">
        <span>{rotulo}</span>
        <span className="maq-num">{usada.toFixed(1)} / {total.toFixed(1)} GB</span>
      </div>
      <div className="tubo" title={`Reserva: ${reserva} GB livres`}>
        <i className={classe} style={{ width: cheio + "%" }} />
        <span className="reserva" style={{ left: limite + "%" }} />
      </div>
    </div>
  );
}

// ---------------- automode: níveis de controle ----------------

/** Pede para digitar DEUS antes de ligar o MODO DEUS EXTREMO. */
function confirmDeus(): boolean {
  const typed = prompt(`MODO DEUS EXTREMO: os bots vão fazer TUDO sozinhos, sem pedir aprovação nem fazer perguntas, mesmo com riscos.\n\n${CONTROL_DESCRIPTIONS.deus}\n\nDigite DEUS para confirmar:`);
  return typed?.trim().toUpperCase() === "DEUS";
}

/** Seletor global no cabeçalho da sidebar: "Por bot" ou um nível que vale para todos. */
function GlobalControl({ control }: { control: ControlState }) {
  const [msg, setMsg] = useState("");
  const set = async (value: string) => {
    const g = value === "" ? null : (value as ControlMode);
    if (g === "deus" && !confirmDeus()) return;
    setMsg("…");
    const r = await api("/control", { method: "PUT", body: JSON.stringify({ global: g, confirm: g === "deus" ? "DEUS" : undefined }) });
    setMsg(r.ok ? "" : (await r.json()).error ?? "falhou");
  };
  const cur = control.global ?? "";
  return (
    <div className={"control-bar" + (control.global ? " mode-" + control.global : "")} title={control.global ? CONTROL_DESCRIPTIONS[control.global] : "Cada bot usa o nível configurado nele (⚙️ do bot)."}>
      <label>Controle</label>
      <select value={cur} onChange={(e) => void set(e.target.value)}>
        <option value="">Por bot</option>
        {CONTROL_MODES.map((m) => <option key={m} value={m}>{CONTROL_LABELS[m]}</option>)}
      </select>
      {msg && <small className="err">{msg}</small>}
    </div>
  );
}

/**
 * Aviso que some sozinho em 3 segundos e tem X para fechar na hora.
 * Com o mouse em cima ele espera: aviso que foge no meio da leitura é tão
 * ruim quanto aviso que nunca sai. O relógio reinicia quando o mesmo aviso
 * se repete (o contador sobe no lugar de nascer outro cartão).
 */
function Aviso({ quem, texto, vezes, em, onFechar }: { quem: string; texto: string; vezes: number; em: number; onFechar: () => void }) {
  const [parado, setParado] = useState(false);
  const fechar = useRef(onFechar);
  fechar.current = onFechar;
  useEffect(() => {
    if (parado) return;
    const t = setTimeout(() => fechar.current(), 3000);
    return () => clearTimeout(t);
  }, [parado, em, vezes]);
  return (
    <div className="toast" onMouseEnter={() => setParado(true)} onMouseLeave={() => setParado(false)}>
      <div className="toast-texto" onClick={() => fechar.current()}>
        <b>{quem}</b> {texto}{vezes > 1 ? ` (${vezes}x)` : ""}
      </div>
      <button className="toast-x" title="Fechar" aria-label="Fechar aviso" onClick={() => fechar.current()}>×</button>
    </div>
  );
}

function notify(title: string, body: string) {
  try { if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body: body.slice(0, 200) }); } catch {}
}

// Só declara JSON quando há corpo: "content-type: application/json" sem corpo faz o
// Fastify recusar com 400 antes de a rota rodar — foi o que quebrava excluir bot.
const api = (path: string, init?: RequestInit) =>
  fetch(`/api${path}${location.search}`, init?.body === undefined ? { ...init } : { headers: { "content-type": "application/json" }, ...init });

/** Menu do botão direito num bot da lista. Só mostra o que o Hub realmente sabe fazer. */
/** O que fazer com um arquivo trazido de fora: qual bot lê e para quê. */
const IMPORT_ACTIONS = [
  { id: "ler", titulo: "Só ler e me resumir", desc: "O bot lê e responde o que é e para que serve.",
    texto: (n: string) => `Leia o arquivo anexo (${n}) inteiro e me diga em até 5 linhas: o que é, o que dá para fazer com isso e se vale a pena você guardar. Não instale nada ainda.` },
  { id: "skill", titulo: "Instalar como skill", desc: "Vira uma habilidade que ele passa a usar sozinho.",
    texto: (n: string) => `Leia o arquivo anexo (${n}) e INSTALE como skill sua: crie a pasta .opencode/skills/<nome-curto-em-minusculas>/ dentro do seu workspace e grave o conteúdo em SKILL.md. Se o arquivo não tiver frontmatter, acrescente no topo um bloco --- com name e description (uma linha dizendo quando usar). Depois confirme em 2 linhas o que você passou a saber fazer.` },
  { id: "alma", titulo: "Incorporar à alma", desc: "Entra na persona dele, muda como ele é e responde.",
    texto: (n: string) => `Leia o arquivo anexo (${n}) e incorpore à sua alma: acrescente ao seu persona.md o que for permanente sobre quem você é, como fala e o que valoriza. NÃO apague o que já está lá, só acrescente. Depois me diga em 2 linhas o que mudou em você.` },
] as const;

function ImportDialog({ file, bots, onClose, onSend }: {
  file: { name: string; mime: string; dataBase64: string };
  bots: BotSummary[];
  onClose: () => void;
  onSend: (botId: string, text: string, file: { name: string; mime: string; dataBase64: string }) => void;
}) {
  const online = bots.filter((b) => b.online);
  const [botId, setBotId] = useState(online[0]?.id ?? bots[0]?.id ?? "");
  const [acao, setAcao] = useState<(typeof IMPORT_ACTIONS)[number]["id"]>("ler");
  const kb = Math.max(1, Math.round((file.dataBase64.length * 3) / 4 / 1024));
  const escolhida = IMPORT_ACTIONS.find((a) => a.id === acao)!;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Importar arquivo</h3>
        <p className="muted">📄 <b>{file.name}</b> · {kb} KB</p>
        {!bots.length ? <p>Nenhum bot cadastrado ainda.</p> : (
          <>
            <label>Qual bot deve ler?</label>
            <select value={botId} onChange={(e) => setBotId(e.target.value)}>
              {bots.map((b) => <option key={b.id} value={b.id} disabled={!b.online}>{b.avatar || "·"} {b.name}{b.online ? "" : " (offline)"}</option>)}
            </select>
            <label>O que ele faz com isso?</label>
            <div className="import-acoes">
              {IMPORT_ACTIONS.map((a) => (
                <button key={a.id} className={"import-acao" + (acao === a.id ? " on" : "")} onClick={() => setAcao(a.id)}>
                  <b>{a.titulo}</b><small>{a.desc}</small>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!botId || !bots.find((b) => b.id === botId)?.online}
            onClick={() => onSend(botId, escolhida.texto(file.name), file)}>Enviar para o bot</button>
        </div>
      </div>
    </div>
  );
}

function BotMenu({ bot, x, y, onClose, onOpen, onPanel, pref, secoes, onPref, onRenomear, onNovaSecao, onExcluir, onAparencia }: {
  bot: BotSummary; x: number; y: number; onClose: () => void;
  onOpen: (botId: string) => void; onPanel: (botId: string, panel: "settings" | "routines") => void;
  pref: PrefDoBot; secoes: string[];
  onPref: (p: PrefDoBot) => void; onRenomear: () => void; onNovaSecao: () => void; onExcluir: () => void; onAparencia: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [busy, setBusy] = useState("");
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
    el.focus();
  }, []);
  useEffect(() => {
    const close = () => onClose();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("resize", close); window.removeEventListener("blur", close); window.removeEventListener("keydown", key); };
  }, [onClose]);
  // Antes isto engolia a resposta: um 400 ou 401 do Hub virava "nada aconteceu" na
  // tela, e a gente ficou caçando no escuro um excluir que o servidor nem recebeu.
  const act = async (label: string, run: () => Promise<Response | unknown>) => {
    setBusy(label);
    try {
      const r = await run();
      if (r instanceof Response && !r.ok) {
        const erro = await r.json().catch(() => ({} as any));
        alert(`Não deu para ${label}: ${erro?.error ?? `o Hub respondeu ${r.status}`}`);
      }
    } catch (e) {
      alert(`Não deu para ${label}: ${(e as Error).message}`);
    }
    onClose();
  };
  const managed = !!bot.managed;
  return (
    <div className="ctx-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div ref={ref} className="ctx-menu" tabIndex={-1} style={{ left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()}>
        <div className="ctx-head"><Avatar bot={bot} size={56} /><div><b>{bot.name}</b><small>{bot.online ? (bot.busy ? bot.status + "…" : "Disponível") : "Offline"} · {bot.model ?? bot.provider}</small></div></div>
        <button onClick={() => { onOpen(bot.id); onClose(); }}>💬 Abrir conversa</button>
        <button onClick={() => { onPanel(bot.id, "settings"); onClose(); }}>✏️ Editar bot…</button>
        <button onClick={() => { onAparencia(); onClose(); }}>{"\uD83C\uDFA8"} Aparencia do bot...</button>
        <button onClick={() => { onPanel(bot.id, "routines"); onClose(); }}>⏰ Rotinas…</button>
        {(bot.unread ?? 0) > 0 && (
          <button onClick={() => void act("ler", () => api(`/conversations/${dmConversation(bot.id)}/read`, { method: "POST" }))}>✅ Marcar como lido</button>
        )}
        <button onClick={() => { void api(`/conversations/${dmConversation(bot.id)}/unread`, { method: "POST" }); onClose(); }}>🔵 Marcar como não lido</button>
        <hr />
        <button onClick={() => { onPref({ fixado: !pref.fixado }); onClose(); }}>📌 {pref.fixado ? "Desafixar" : "Fixar"}</button>
        <button onClick={() => { onNovaSecao(); onClose(); }}>🗂️ Nova Seção…</button>
        {secoes.length > 0 && (
          <div className="ctx-sub">
            <small>Mover para</small>
            {secoes.map((s) => (
              <button key={s} className={pref.secao === s ? "on" : ""}
                onClick={() => { onPref({ secao: pref.secao === s ? "" : s }); onClose(); }}>{pref.secao === s ? "✓ " : ""}{s}</button>
            ))}
          </div>
        )}
        <button onClick={() => { onRenomear(); onClose(); }}>✏️ Renomear bot…</button>
        <button onClick={() => { onPref({ escondido: !pref.escondido }); onClose(); }}>🚫 {pref.escondido ? "Mostrar" : "Esconder"}</button>
        <button onClick={() => { window.open(`/api/bots/${bot.id}/modelo${location.search}`, "_blank"); onClose(); }}>📤 Compartilhar como modelo</button>
        {bot.online && <>
          <hr />
          {/* Parar o trabalho é uma coisa; desligar o bot é outra. As duas valem só para
              ESTE bot — o do lado continua como estava. */}
          <button onClick={() => void act("parar", () => api(`/bots/${bot.id}/parar`, { method: "POST" }))}>⏹ Parar o que está fazendo</button>
        </>}
        {managed && <>
          {!bot.online && <hr />}
          {bot.online
            ? <button onClick={() => void act("desligar", () => api(`/managed/${bot.id}/stop`, { method: "POST" }))}>⏻ Desligar o bot</button>
            : <button onClick={() => void act("ligar", () => api(`/managed/${bot.id}/start`, { method: "POST" }))}>▶️ Ligar o bot</button>}
          <button onClick={() => void act("reiniciar", () => api(`/managed/${bot.id}/restart`, { method: "POST" }))}>🔄 Reiniciar</button>
        </>}
        <hr />
        <button onClick={() => { void navigator.clipboard?.writeText(bot.id); onClose(); }}>🏷️ Copiar ID</button>
        {managed && (
          <button className="danger" onClick={() => {
            // Nada de confirm() nativo: ele tira o foco da janela, o menu se desmonta
            // junto e o pedido morria no meio do caminho. Quem pergunta agora é o
            // próprio painel, com uma caixa que não depende do navegador.
            onClose();
            onExcluir();
          }}>🗑️ Excluir bot…</button>
        )}
        {busy && <div className="ctx-busy">{busy}…</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retrato do bot. Em vez de iniciais ou emoji, cada bot ganha um rosto
// desenhado a partir do próprio identificador: sempre o mesmo rosto para o
// mesmo bot, sem internet, sem arquivo, nítido em qualquer tamanho.
// Se o bot tiver uma foto (URL) ou um emoji escolhido, isso tem prioridade.
// ---------------------------------------------------------------------------

/** Números estáveis a partir de um texto (mesmo id = mesmo rosto, sempre). */
function sorteios(id: string) {
  let h = 2166136261;
  for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  let x = h >>> 0;
  return (max: number) => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x % max; };
}

const PELE = ["#f2d3b6", "#e8bd96", "#d19d72", "#b07a52", "#8a5a3b", "#6b4430"];
const CABELO = ["#2b2118", "#4a2f1d", "#7b4a24", "#b5763b", "#d9ae6a", "#8c8c94", "#1f1b1b"];
const ROUPA = ["#2b6cb0", "#2f855a", "#9b2c2c", "#4c51bf", "#2c7a7b", "#744210", "#4a5568", "#97266d"];
const FUNDO = ["#dbeafe", "#dcfce7", "#fee2e2", "#ede9fe", "#ccfbf1", "#fef3c7", "#e2e8f0", "#fce7f3"];

/**
 * Tons da equipe inteira, repartidos de uma vez.
 *
 * Sortear a cor de cada bot em separado juntava dois vizinhos a 6 graus um do
 * outro — no olho, a mesma cor. Empurrar quem cai perto também não resolve: com
 * dez bots, cada um exigindo folga dos dois lados, a conta passa de 360 graus e o
 * último não acha lugar. Então os lugares são fixos e igualmente espaçados (com
 * dez bots, 36 graus entre vizinhos) e o sorteio só decide QUEM fica em qual —
 * pelo id, não pela ordem da tela, para a cor não dançar quando a lista se mexe.
 * O anel começa meio passo depois do vermelho do logo, que assim fica no maior
 * buraco possível entre dois bots.
 */
let TONS: Record<string, number> = {};
let versaoDosTons = 0;
const TOM_DO_LOGO = 356;

function definirTonsDaEquipe(ids: string[]) {
  const lista = [...new Set(ids)].sort();
  const novo: Record<string, number> = {};
  if (lista.length) {
    const passo = 360 / lista.length;
    const inicio = (TOM_DO_LOGO + passo / 2) % 360;
    lista
      .map((id) => ({ id, chave: sorteios(id + "#tom")(3600) }))
      .sort((a, b) => a.chave - b.chave || a.id.localeCompare(b.id))
      .forEach((x, i) => { novo[x.id] = Math.round((inicio + i * passo) % 360); });
  }
  const mudou = Object.keys(novo).length !== Object.keys(TONS).length
    || Object.keys(novo).some((id) => TONS[id] !== novo[id]);
  if (mudou) { TONS = novo; versaoDosTons++; }
}

/**
 * A ameba de um bot. Forma, cor, ritmo do loop e tempo da piscada saem todos do id:
 * dois bots nunca ficam iguais, e o mesmo bot é sempre o mesmo — dá para reconhecer
 * de longe, que é o ponto de ter avatar.
 */
function amebaDe(id: string) {
  const r = sorteios(id);
  // O tom sai do id e anda pelos 360 graus do círculo: numa paleta fechada de 12
  // cores três bots da mesma lista saíam iguais. O logo da casa não sorteia nada:
  // é o vermelho da empresa.
  const tom = id === "mybots" ? TOM_DO_LOGO : TONS[id] ?? r(360);
  const clara = `hsl(${tom} 78% 62%)`;
  const escura = `hsl(${tom} 72% 34%)`;
  const gordura = 30 + r(7);
  const base = Array.from({ length: 8 }, () => gordura + r(9) - 4);
  const semente = r(100) / 10;
  // Os quadros são o mesmo corpo respirando, não formas sorteadas: por isso o loop
  // fica mole e contínuo em vez de pular de uma forma para outra.
  const formas = [0, 1, 2, 3].map((f) => base.map((v, i) => Math.max(18, v + Math.sin(semente + f * 1.9 + i * 2.3) * 5)));
  return {
    inicial: caminhoDaBolha(formas[0]),
    passos: [...formas, formas[0]].map(caminhoDaBolha).join(";"),
    dur: (6 + r(50) / 10).toFixed(1) + "s",
    atraso: (r(70) / 10).toFixed(1) + "s",
    clara,
    escura,
    olhar: r(5) - 2,
  };
}

/** Ameba com olhinhos. É o retrato de todo bot e também o logo da casa. */
function Ameba({ id, size = 44 }: { id: string; size?: number }) {
  const a = useMemo(() => amebaDe(id), [id, versaoDosTons]);
  const grad = "ameba-" + id.replace(/[^a-zA-Z0-9_-]/g, "") ;
  return (
    <svg className="retrato ameba" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" style={{ display: "block", ["--atraso" as any]: a.atraso }}>
      <defs>
        <linearGradient id={grad} x1="0.1" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={a.clara} />
          <stop offset="1" stopColor={a.escura} />
        </linearGradient>
      </defs>
      <path d={a.inicial} fill={`url(#${grad})`}>
        <animate attributeName="d" dur={a.dur} repeatCount="indefinite" values={a.passos}
          calcMode="spline" keyTimes="0;0.25;0.5;0.75;1"
          keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1" />
      </path>
      {/* brilho: dá volume sem precisar de sombra */}
      <ellipse cx="37" cy="31" rx="9" ry="5.5" fill="#fff" opacity=".2" transform="rotate(-22 37 31)" />
      <g className="r-olhos">
        <ellipse cx="41" cy="45" rx="7.2" ry="7.6" fill="#fff" />
        <ellipse cx="59" cy="45" rx="7.2" ry="7.6" fill="#fff" />
        <circle cx={41 + a.olhar} cy="46" r="3.3" fill="#16202c" />
        <circle cx={59 + a.olhar} cy="46" r="3.3" fill="#16202c" />
        <circle cx={39.5 + a.olhar} cy="44.2" r="1.1" fill="#fff" opacity=".9" />
        <circle cx={57.5 + a.olhar} cy="44.2" r="1.1" fill="#fff" opacity=".9" />
      </g>
      <g className="r-boca">
        <path d="M44 57q6 5.5 12 0" stroke="#16202c" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".8" />
      </g>
    </svg>
  );
}

/** Retrato em SVG, desenhado na hora. */
function Retrato({ id, size = 44 }: { id: string; size?: number }) {
  const r = sorteios(id);
  // Cada bot pisca no seu tempo. Nove rostos piscando juntos parecem um robô só.
  const atraso = (r(70) / 10).toFixed(1) + "s";
  const pele = PELE[r(PELE.length)];
  const cabelo = CABELO[r(CABELO.length)];
  const roupa = ROUPA[r(ROUPA.length)];
  const fundo = FUNDO[r(FUNDO.length)];
  const penteado = r(6);
  const olhos = r(3);
  const boca = r(4);
  const oculos = r(5) === 0;
  const barba = r(6) === 0;
  const sobrancelha = 36 + r(3);

  return (
    <svg className="retrato" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" style={{ display: "block", borderRadius: "50%", ["--atraso" as any]: atraso }}>
      <rect width="100" height="100" fill={fundo} />
      {/* ombros e colarinho: faz ler como retrato, não como bola */}
      <path d="M12 100c0-20 17-28 38-28s38 8 38 28z" fill={roupa} />
      <path d="M43 73l7 9 7-9-7-4z" fill="#fff" opacity=".9" />
      {/* orelhas */}
      <ellipse cx="27" cy="48" rx="4.5" ry="6" fill={pele} />
      <ellipse cx="73" cy="48" rx="4.5" ry="6" fill={pele} />
      {/* cabeça */}
      <path d="M50 16c-14 0-23 11-23 25 0 16 10 28 23 28s23-12 23-28c0-14-9-25-23-25z" fill={pele} />
      {/* cabelo */}
      {penteado === 0 && <path d="M27 40c0-15 10-24 23-24s23 9 23 24c0-8-10-12-23-12s-23 4-23 12z" fill={cabelo} />}
      {penteado === 1 && <path d="M26 42c-1-17 10-27 24-27s25 10 24 27c-2-11-7-16-12-13-6 4-18 4-24 0-5-3-10 2-12 13z" fill={cabelo} />}
      {penteado === 2 && <path d="M27 38c2-14 11-22 23-22s21 8 23 22c-3-9-9-14-14-11-5 3-13 3-18 0-5-3-11 2-14 11z" fill={cabelo} />}
      {penteado === 3 && <><path d="M27 41c0-16 10-25 23-25s23 9 23 25c-1-9-9-14-23-14s-22 5-23 14z" fill={cabelo} /><path d="M24 44c-2 12 0 22 4 27-5-9-5-21-4-27zM76 44c2 12 0 22-4 27 5-9 5-21 4-27z" fill={cabelo} /></>}
      {penteado === 4 && <path d="M28 36c4-13 11-20 22-20s18 7 22 20c-4-6-9-9-15-9-8 0-11 2-14 5-3 3-8 1-15 4z" fill={cabelo} />}
      {penteado === 5 && <><path d="M27 39c1-15 11-23 23-23s22 8 23 23c-2-10-10-15-23-15s-21 5-23 15z" fill={cabelo} /><circle cx="50" cy="13" r="6" fill={cabelo} /></>}
      {/* sobrancelhas */}
      <path d={`M38 ${sobrancelha}q5-2.5 10 0`} stroke={cabelo} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d={`M52 ${sobrancelha}q5-2.5 10 0`} stroke={cabelo} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      {/* olhos — no grupo, para a piscada fechar os dois juntos */}
      <g className="r-olhos">
        {olhos === 0 && <><circle cx="42" cy="45" r="2.6" fill="#2d3748" /><circle cx="58" cy="45" r="2.6" fill="#2d3748" /></>}
        {olhos === 1 && <><ellipse cx="42" cy="45" rx="3.2" ry="2.2" fill="#2d3748" /><ellipse cx="58" cy="45" rx="3.2" ry="2.2" fill="#2d3748" /></>}
        {olhos === 2 && <><path d="M39 45q3-3 6 0" stroke="#2d3748" strokeWidth="2.2" fill="none" strokeLinecap="round" /><path d="M55 45q3-3 6 0" stroke="#2d3748" strokeWidth="2.2" fill="none" strokeLinecap="round" /></>}
      </g>
      {/* nariz */}
      <path d="M50 48v5" stroke={pele} strokeWidth="2.4" strokeLinecap="round" opacity=".55" />
      {/* boca — no grupo, para mexer quando o bot fala */}
      <g className="r-boca">
        {boca === 0 && <path d="M44 57q6 5 12 0" stroke="#9b4a4a" strokeWidth="2.2" fill="none" strokeLinecap="round" />}
        {boca === 1 && <path d="M45 58h10" stroke="#9b4a4a" strokeWidth="2.2" fill="none" strokeLinecap="round" />}
        {boca === 2 && <ellipse cx="50" cy="58" rx="4" ry="2.6" fill="#9b4a4a" />}
        {boca === 3 && <path d="M44 57q6 4 12 0" stroke="#9b4a4a" strokeWidth="2" fill="none" strokeLinecap="round" />}
      </g>
      {/* barba */}
      {barba && <path d="M33 50c0 14 8 22 17 22s17-8 17-22c-2 10-8 15-17 15s-15-5-17-15z" fill={cabelo} opacity=".85" />}
      {/* óculos */}
      {oculos && <g stroke="#2d3748" strokeWidth="1.8" fill="none"><circle cx="42" cy="45" r="6.5" /><circle cx="58" cy="45" r="6.5" /><path d="M48.5 45h3M27 44l8.5 1M73 44l-8.5 1" /></g>}
    </svg>
  );
}

// O tamanho padrão vale para a lista da esquerda: o chefe pediu as amebas no dobro.
/** Um emoji só, no balão de pensamento, dizendo o que o bot faz AGORA.
 *  Sai do status curto que ele mesmo escreve com set_status ("Lendo o site",
 *  "Gravando o áudio"), então acompanha o trabalho de verdade em vez de ser um
 *  enfeite fixo. Sem status reconhecido e estando ocupado, fica o pensar genérico. */
function emojiDoEstado(bot: BotSummary, falando: boolean): string | undefined {
  if (!bot.online) return "😴";
  if (falando) return "💬";
  const s = String((bot as any).status ?? "").toLowerCase();
  const tabela: [RegExp, string][] = [
    [/liga(ç|c)|chamada|telefone/, "📞"],
    [/grava|áudio|audio|v(í|i)deo|renderiz|edita/, "🎬"],
    [/naveg|site|página|pagina|chrome|web|link/, "🌐"],
    [/busca|pesquis|consult|procur/, "🔎"],
    [/lend|ler |estud|aprend|document|base de|memória|memoria/, "📚"],
    [/escrev|redig|rascunh|roteiro|texto/, "✍️"],
    [/cálcul|calcul|planilha|número|numero|relatório|relatorio|preço|preco/, "📊"],
    [/whatsapp|mensagem|e-?mail|enviand|postand|public/, "📨"],
    [/comando|terminal|instal|executa|rodando|compil/, "⚙️"],
    [/imagem|foto|desenh|arte|capa/, "🎨"],
    [/espera|aprova|aguard/, "✋"],
    [/pens|analis|racioc/, "💭"],
  ];
  for (const [re, e] of tabela) if (re.test(s)) return e;
  if (bot.busy) return "💭";
  // Parado tambem tem sinal: um bot sem balao nenhum parece desligado. Estes giram
  // devagar, so para a tela ter vida — nunca sugerem trabalho que nao esta havendo.
  return PARADO[Math.floor(Date.now() / 6000) % PARADO.length];
}
const PARADO = ["👀", "🧠", "📋", "☕"];

function Avatar({ bot, size = 88, falando = false, cutucadas = 0 }: { bot: BotSummary; size?: number; falando?: boolean; cutucadas?: number }) {
  const emoji = bot.avatar && /\p{Extended_Pictographic}/u.test(bot.avatar) ? bot.avatar : null;
  const url = bot.avatar && /^(https?:|data:|\/)/.test(bot.avatar) ? bot.avatar : null;
  const style = { width: size, height: size, fontSize: size * 0.45, background: "transparent" };
  // Parado respira. Trabalhando pula e balança. Falando mexe a boca.
  const [, tique] = useState(0);
  useEffect(() => { const i = setInterval(() => tique((n) => n + 1), 6000); return () => clearInterval(i); }, []);
  // 1 a 4 cliques: ele se sacode. Do 5o em diante fica bravo — e segue bravo
  // enquanto voce insistir, nao so por um instante.
  const bravo = cutucadas >= 5;
  const estado = (!bot.online ? " dormindo" : falando ? " falando" : bot.busy ? " ocupado" : "")
    + (bravo ? " bravo" : cutucadas > 0 ? " cutucado" : "");
  return (
    <div className={"avatar" + estado} style={style} data-ameba={bot.id} data-emoji={bravo ? "\uD83D\uDE20" : cutucadas > 0 ? "\u2757" : emojiDoEstado(bot, falando)}>
      {url ? <img src={url} alt="" /> : lerAparencia(bot.avatar) ? <ArteDoBot id={bot.id} avatar={bot.avatar} size={size} /> : <Ameba id={bot.id} size={size} />}
      {((bot as any).gerente || (bot as any).manages?.length) ? <span className="coroa-cabeca" aria-hidden>👑</span> : null}
      <span className={"presence " + (bot.online ? (bot.busy ? "busy" : "on") : "off")} />
    </div>
  );
}

/** Mostra o retrato que o bot teria, para o formulário. */
function RetratoPreview({ id, avatar, size = 56 }: { id: string; avatar?: string; size?: number }) {
  const emoji = avatar && /\p{Extended_Pictographic}/u.test(avatar) ? avatar : null;
  const url = avatar && /^(https?:|data:|\/)/.test(avatar) ? avatar : null;
  if (url) return <img className="retrato-previa" src={url} alt="" style={{ width: size, height: size }} />;
  return <div className="retrato-previa"><Ameba id={id || "novo"} size={size} /></div>;
}

function colorFor(id: string) {
  const palette = ["#0f766e", "#b45309", "#1d4ed8", "#7c3aed", "#be123c", "#15803d", "#0369a1", "#9333ea", "#c2410c"];
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

type ConvProps = {
  target: Target; conversationId: string; bots: BotSummary[]; messages: StoredMessage[]; tools: Record<string, ToolInfo[]>;
  approvals: PendingApproval[]; questions: PendingQuestion[]; resolvedQuestions: Record<string, string>; routines: Routine[];
  voice: VoiceCaps; tts: boolean; setTts: (v: boolean) => void; handsFree: boolean; setHandsFree: (v: boolean) => void;
  send: ReturnType<typeof useHub>["send"]; onEvent: ReturnType<typeof useHub>["onEvent"]; onOpenSidebar: () => void;
  onAbrirTroca: (conversationId: string) => void;
  control: ControlState;
  initialPanel?: { panel: "settings" | "routines"; n: number } | null;
};

function Conversation({ target, conversationId, bots, messages, tools, approvals, questions, resolvedQuestions, routines, voice, tts, setTts, handsFree, setHandsFree, send, onEvent, onOpenSidebar, onAbrirTroca, control, initialPanel }: ConvProps) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(isSpeaking());
  const [showRoutines, setShowRoutines] = useState(false);
  // --- documento aberto em tela cheia ---
  const [arquivoAberto, setArquivoAberto] = useState<ArquivoDoChat | null>(null);
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
  const subtitle = target.kind === "bot"
    ? (target.bot.online ? (target.bot.busy ? target.bot.status + "…" : target.bot.role) : "Offline")
    : (busy ? statusText : target.group.members.map((m) => bots.find((b) => b.id === m)?.name ?? m).join(", "));

  return (
    <>
      <header className="chat-head">
        <button className="icon-btn only-mobile" onClick={onOpenSidebar} title="Bots">☰</button>
        {bot ? <Avatar bot={bot} size={80} /> : <div className="avatar group-avatar" style={{ width: 80, height: 80 }}>👥</div>}
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
          {bot && <button className={"icon-btn" + (showSettings ? " on" : "")} title="Configurar este bot" onClick={() => { setShowSettings(!showSettings); setShowRoutines(false); }}>⚙️</button>}
          {bot && <button className={"icon-btn" + (showRoutines ? " on" : "")} title="Rotinas agendadas" onClick={() => { setShowRoutines(!showRoutines); setShowSettings(false); }}>⏰{routines.length ? <sup>{routines.length}</sup> : null}</button>}
          {(busy || speaking || listening) && <button className="icon-btn parar-tudo" title="Parar tudo: a fala, o microfone e o que os bots estão fazendo (Esc)" onClick={() => stopEverything("⏹ no painel")}>⏹ Parar</button>}
          <button className={"icon-btn" + (handsFree ? " on" : "")} title={handsFree ? "Modo conversa: volta a ouvir depois que o bot fala" : "Modo conversa desligado"} onClick={() => setHandsFree(!handsFree)}>🗣️</button>
        </div>
      </header>

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
        {busy && !approvals.length && !questions.length && (
          <div className="typing">
            {target.kind === "bot" ? <Avatar bot={target.bot} size={44} /> : <Bolha />}
            <span className="brilho">{(target.kind === "bot" ? target.bot.name + " está " : "") + (statusText || "trabalhando").toLowerCase()}</span>
          </div>
        )}
      </div>

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
        <button className="icon-btn" title="Anexar arquivo" onClick={() => fileRef.current?.click()}>📎</button>
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
        {speechSupported(voice) && <button className={"icon-btn mic" + (listening ? " rec" : "")} title={listening ? "Parar de ouvir" : "Falar (envia sozinho quando você parar)"} onClick={toggleMic}>🎤</button>}
        <button className="send" onClick={() => submit()} disabled={!text.trim() && !attachments.length}>➤</button>
      </footer>
      {folha && <FolhaAbrirTroca trocas={folha} bots={bots} Avatar={Avatar} onEscolher={(t) => onAbrirTroca(t.conversationId)} onFechar={() => setFolha(null)} />}
      {arquivoAberto && <Visualizador f={arquivoAberto} onFechar={() => setArquivoAberto(null)} />}
    </>
  );
}

/** Raciocínio do modelo: letra de máquina atrás de um vidro azul, fechado por padrão.
 *  Nunca é lido em voz alta — a fala usa só a resposta. */
function Thought({ text }: { text: string }) {
  const [aberto, setAberto] = useState(false);
  const linhas = text.split("\n").filter((l) => l.trim());
  const PREVIA = 4;
  const resto = linhas.length - PREVIA;
  const mostrar = aberto ? linhas : linhas.slice(0, PREVIA);
  return (
    <div className={"thought" + (aberto ? " aberto" : "")} onClick={() => setAberto(!aberto)}
      title={aberto ? "Clique para fechar o raciocínio" : "Clique para ver o raciocínio"}>
      <div className="thought-cabeca">💭 pensando<span>{aberto ? "fechar" : "abrir"}</span></div>
      <pre>{mostrar.join("\n")}{!aberto && resto > 0 ? `\n… (${resto} ${resto === 1 ? "linha" : "linhas"} a mais)` : ""}</pre>
    </div>
  );
}

function Message({ m, tools, answer, showName, onSpeak, onAbrirArquivo, onMenu, editando, onSalvarEdicao, onCancelarEdicao }: { m: StoredMessage; tools?: ToolInfo[]; answer?: string; showName: boolean; onSpeak?: () => void; onAbrirArquivo?: (f: ArquivoDoChat) => void; onMenu?: (m: StoredMessage, x: number, y: number) => void; editando?: boolean; onSalvarEdicao?: (texto: string) => void; onCancelarEdicao?: () => void }) {
  if (m.sender.kind === "system" && !m.sender.id.startsWith("routine:")) return <div className={"sys" + (m.meta?.error ? " err" : "")}>{m.text}</div>;
  const mine = m.sender.kind === "user" && m.sender.id === "user";
  const files = (m.meta?.files as Array<{ id: string; name: string; url: string; mime: string }> | undefined) ?? [];
  const routine = m.sender.id.startsWith("routine:");
  const toqueLongo = useToqueLongo((x, y) => onMenu?.(m, x, y));
  if (editando) return <EdicaoDoPedido m={m} onSalvar={onSalvarEdicao!} onCancelar={onCancelarEdicao!} />;
  return (
    <div className={"msg " + (m.meta?.marcador ? "marcador" : mine ? "mine" : "theirs")}
      onContextMenu={(e) => { if (!onMenu || e.shiftKey) return; e.preventDefault(); onMenu(m, e.clientX, e.clientY); }}
      {...(onMenu ? toqueLongo : {})}>
      {tools?.length ? <div className="tools">{tools.map((t) => <ToolChip key={t.callId} t={t} />)}</div> : null}
      {(m.text || files.length) ? (
        <div className={"bubble" + (m.meta?.notify ? " notify" : "") + (routine ? " routine" : "")}>
          {(showName && !mine) || routine || (m.sender.kind === "user" && !mine) ? <div className="who">{routine ? "⏰ " : ""}{m.sender.name}</div> : null}
          {m.meta?.thought ? <Thought text={String(m.meta.thought)} /> : null}
          <Markdownish text={m.text} />
          {files.map((f) => <Arquivo key={f.id} f={f} onAbrir={onAbrirArquivo} />)}
          {answer && <div className="answered">Você respondeu: <b>{answer}</b></div>}
          {onSpeak && m.text ? <button className="speak-btn" title="Ler a mensagem inteira em voz alta" onClick={onSpeak}>🔊</button> : null}
          {onMenu && (
            <button className="msg-menu-btn" title="Opções desta mensagem"
              onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onMenu(m, r.left, r.bottom); }}>⋯</button>
          )}
          <time>{m.pinned ? "📌 " : ""}{m.meta?.interrompido ? "interrompido · " : ""}{m.editOf ? "editado · " : ""}{new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time>
        </div>
      ) : null}
    </div>
  );
}

/** A bolha vira caixa de texto no lugar. Enter manda, Shift+Enter quebra linha, Esc desiste. */
function EdicaoDoPedido({ m, onSalvar, onCancelar }: { m: StoredMessage; onSalvar: (t: string) => void; onCancelar: () => void }) {
  const [texto, setTexto] = useState(m.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.setSelectionRange(texto.length, texto.length); }, []);
  return (
    <div className="msg mine editando">
      <div className="bubble">
        <textarea ref={ref} value={texto} rows={Math.min(10, texto.split("\n").length + 1)}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); onCancelar(); }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (texto.trim()) onSalvar(texto.trim()); }
          }} />
        <div className="card-actions">
          <button className="btn primary" disabled={!texto.trim()} onClick={() => onSalvar(texto.trim())}>Enviar de novo</button>
          <button className="btn" onClick={onCancelar}>Cancelar</button>
          <span className="hint-inline">o que veio depois deste pedido sai da conversa</span>
        </div>
      </div>
    </div>
  );
}

/** O bichinho que fica trabalhando: uma estrela gorda que muda de forma sem
 *  parar, como a do app que o chefe quis copiar.
 *
 *  POR QUE ASSIM E NAO COM TRES DESENHOS TROCANDO: a primeira versão era três
 *  caminhos aparecendo e sumindo por opacidade — dava um piscado no ponto da
 *  troca e não parecia um loop, parecia um corte. Aqui é UM caminho só, e o
 *  próprio navegador interpola a forma de um estado ao outro. Todas as formas
 *  têm o mesmo número de pontos (é por isso que a interpolação funciona) e a
 *  última é igual à primeira, então a volta é invisível: dá loop de verdade.
 */
const CENTRO = 50;

/** Caminho fechado e redondo a partir de N raios. Catmull-Rom virando Bézier:
 *  os pontos ficam com curva suave e sem bico. */
function caminhoDaBolha(raios: number[]): string {
  const n = raios.length;
  const ponto = (k: number): [number, number] => {
    const i = ((k % n) + n) % n;
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [CENTRO + Math.cos(a) * raios[i], CENTRO + Math.sin(a) * raios[i]];
  };
  const nd = (v: number) => v.toFixed(2);
  let d = "";
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ponto(i), [x1, y1] = ponto(i + 1);
    const [xa, ya] = ponto(i - 1), [xb, yb] = ponto(i + 2);
    const c1x = x0 + (x1 - xa) / 6, c1y = y0 + (y1 - ya) / 6;
    const c2x = x1 - (xb - x0) / 6, c2y = y1 - (yb - y0) / 6;
    if (i === 0) d += `M${nd(x0)} ${nd(y0)}`;
    d += `C${nd(c1x)} ${nd(c1y)} ${nd(c2x)} ${nd(c2y)} ${nd(x1)} ${nd(y1)}`;
  }
  return d + "Z";
}

// Oito raios por forma — estrela cheia, estrela magra, estrela virada, bolha
// gorda — e a quinta é a cópia da primeira, para fechar a volta.
const FORMAS = [
  [44, 19, 44, 19, 44, 19, 44, 19],
  [40, 25, 46, 16, 38, 27, 45, 18],
  [21, 43, 18, 45, 22, 42, 17, 44],
  [46, 20, 36, 29, 44, 22, 38, 26],
  [33, 33, 33, 33, 33, 33, 33, 33],
];
const PASSOS = [...FORMAS, FORMAS[0]].map(caminhoDaBolha).join(";");

function Bolha({ size = 40 }: { size?: number }) {
  return (
    <svg className="bolha" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <path d={caminhoDaBolha(FORMAS[0])}>
        <animate attributeName="d" dur="5.4s" repeatCount="indefinite" values={PASSOS}
          calcMode="spline" keyTimes="0;0.2;0.4;0.6;0.8;1"
          keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1" />
      </path>
    </svg>
  );
}

export type ArquivoDoChat = { id: string; name: string; url: string; mime: string };

const ehPdf = (f: ArquivoDoChat) => f.mime === "application/pdf" || /\.pdf$/i.test(f.name);
const ehImagem = (f: ArquivoDoChat) => f.mime.startsWith("image/");
const ehVideo = (f: ArquivoDoChat) => f.mime.startsWith("video/");
const ehAudio = (f: ArquivoDoChat) => f.mime.startsWith("audio/");

/** Um arquivo dentro da conversa. Documento se vê, não se clica para ver:
 *  o PDF já aparece aberto na primeira página, a imagem já aparece. Link solto
 *  obriga o chefe a abrir outra janela só para saber o que o bot mandou. */
function Arquivo({ f, onAbrir }: { f: ArquivoDoChat; onAbrir?: (f: ArquivoDoChat) => void }) {
  const src = f.url + location.search;
  const abrir = () => onAbrir?.(f);
  if (ehImagem(f)) {
    return (
      <figure className="arq imagem" onClick={abrir} title="Abrir em tamanho cheio">
        <img src={src} alt={f.name} />
        <figcaption>{f.name}</figcaption>
      </figure>
    );
  }
  if (ehPdf(f)) {
    return (
      <div className="arq pdf">
        <div className="arq-previa" onClick={abrir} title="Abrir o documento inteiro">
          <iframe src={`${src}#toolbar=0&navpanes=0&view=FitH`} title={f.name} tabIndex={-1} />
          <div className="arq-capa" />
        </div>
        <div className="arq-pe">
          <span className="arq-nome" title={f.name}>{f.name}</span>
          <button className="btn" onClick={abrir}>Abrir</button>
          <a className="btn fraco" href={src} download={f.name}>Baixar</a>
        </div>
      </div>
    );
  }
  if (ehVideo(f)) return <div className="arq video"><video src={src} controls preload="metadata" /><div className="arq-pe"><span className="arq-nome">{f.name}</span></div></div>;
  if (ehAudio(f)) return <div className="arq audio"><audio src={src} controls preload="metadata" /><div className="arq-pe"><span className="arq-nome">{f.name}</span></div></div>;
  return <div className="arq outro"><a href={src} target="_blank" rel="noopener">📎 {f.name}</a></div>;
}

/** Tela cheia: o PDF com as miniaturas e a busca do próprio navegador, a imagem
 *  inteira. Esc fecha, clicar no fundo fecha. */
function Visualizador({ f, onFechar }: { f: ArquivoDoChat; onFechar: () => void }) {
  const src = f.url + location.search;
  useEffect(() => {
    const t = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", t);
    return () => window.removeEventListener("keydown", t);
  }, [onFechar]);
  return (
    <div className="visor-fundo" onClick={onFechar}>
      <div className="visor" onClick={(e) => e.stopPropagation()}>
        <header>
          <span className="visor-nome" title={f.name}>{f.name}</span>
          <a className="btn fraco" href={src} download={f.name}>Baixar</a>
          <a className="btn fraco" href={src} target="_blank" rel="noopener">Nova aba</a>
          <button className="btn" onClick={onFechar}>Fechar</button>
        </header>
        <div className="visor-corpo">
          {ehImagem(f) ? <img src={src} alt={f.name} />
            : ehVideo(f) ? <video src={src} controls autoPlay />
            : ehAudio(f) ? <audio src={src} controls autoPlay />
            : <iframe src={src} title={f.name} />}
        </div>
      </div>
    </div>
  );
}

function ToolChip({ t }: { t: ToolInfo }) {
  const [open, setOpen] = useState(false);
  const label = t.tool.replace(/^mybots(-local)?_/, "");
  return (
    <div className={"tool" + (t.done ? (t.ok === false ? " fail" : " ok") : " running")} onClick={() => setOpen(!open)}>
      <span className="tool-head">{t.done ? (t.ok === false ? "✖" : "✔") : "⏳"} {label} {!open && t.input ? <em>{summarize(t.input)}</em> : null}</span>
      {open && (
        <div className="tool-body">
          {t.input !== undefined && <pre>{typeof t.input === "string" ? t.input : JSON.stringify(t.input, null, 2)}</pre>}
          {t.output !== undefined && <pre className="out">{t.output}</pre>}
        </div>
      )}
    </div>
  );
}

function summarize(input: unknown): string {
  if (typeof input === "string") return input.slice(0, 80);
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    const v = o.command ?? o.path ?? o.url ?? o.question ?? o.text ?? o.bot ?? o.action ?? o.key ?? o.name ?? Object.values(o)[0];
    return String(v ?? "").slice(0, 80);
  }
  return "";
}

function ApprovalCard({ a, botName, onAnswer }: { a: PendingApproval; botName?: string; onAnswer: (allow: boolean, remember?: boolean) => void }) {
  const cmd = (a.input as any)?.command ?? (a.input as any)?.patterns?.join("\n") ?? (a.input as any)?.detail;
  const showCmd = cmd && !a.description.includes(String(cmd));
  return (
    <div className={"card approval risk-" + a.risk}>
      <div className="card-title">🔐 Permitir que {botName ?? "o bot"} execute?</div>
      <div className="card-desc">{a.description}</div>
      {showCmd && <pre>{String(cmd)}</pre>}
      <div className="card-meta">ferramenta {a.tool} · risco {{ low: "baixo", medium: "médio", high: "ALTO" }[a.risk]}</div>
      <div className="card-actions">
        <button className="btn primary" onClick={() => onAnswer(true)}>Permitir</button>
        {a.tool === "run_command" || a.tool === "bash" ? <button className="btn" onClick={() => onAnswer(true, true)}>Permitir sempre</button> : null}
        <button className="btn danger" onClick={() => onAnswer(false)}>Negar</button>
      </div>
    </div>
  );
}

/** Cartão de ação: o bot travou e deixou o caminho pronto. Em vez de devolver o
 *  problema cru ("deu erro"), ele diz o que já preparou e o chefe destrava num
 *  toque. Título à esquerda, "Pular" discreto à direita, botão principal cheio. */
function CartaoDeAcaoCard({ q, botName, onAnswer }: { q: PendingQuestion; botName?: string; onAnswer: (a: string) => void }) {
  const c = q.cartao!;
  const principal = c.botao || "Terminei";
  return (
    <div className="card acao">
      <div className="acao-topo">
        <span className="acao-titulo">{c.titulo}</span>
        <button className="acao-pular" onClick={() => onAnswer("Pular")}>Pular</button>
      </div>
      <div className="acao-texto">{q.question}</div>
      <div className="acao-botoes">
        <button className="btn primario" onClick={() => onAnswer(principal)}>{principal}</button>
      </div>
      {botName && <div className="acao-quem">{botName} está esperando</div>}
    </div>
  );
}

function QuestionCard({ q, botName, onAnswer }: { q: PendingQuestion; botName?: string; onAnswer: (a: string) => void }) {
  const [custom, setCustom] = useState("");
  if (q.cartao) return <CartaoDeAcaoCard q={q} botName={botName} onAnswer={onAnswer} />;
  return (
    <div className="card question">
      <div className="card-title">❓ {botName ?? "O bot"} precisa da sua resposta</div>
      <div className="card-desc">{q.question}</div>
      <div className="card-actions wrap">
        {q.options.map((o) => <button key={o} className="btn option" onClick={() => onAnswer(o)}>{o}</button>)}
      </div>
      <div className="card-custom">
        <input placeholder="Ou responda com suas palavras…" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && custom.trim()) onAnswer(custom.trim()); }} />
        <button className="btn" disabled={!custom.trim()} onClick={() => onAnswer(custom.trim())}>Enviar</button>
      </div>
    </div>
  );
}

const CRON_PRESETS: Array<[string, string]> = [["Todo dia às 8h", "0 8 * * *"], ["Segunda a sexta às 9h", "0 9 * * 1-5"], ["Segundas às 8h", "0 8 * * 1"], ["A cada hora", "0 * * * *"], ["A cada 30 min", "*/30 * * * *"], ["Sexta às 18h", "0 18 * * 5"]];

function RoutinesPanel({ bot, routines, onClose }: { bot: BotSummary; routines: Routine[]; onClose: () => void }) {
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 8 * * *");
  const [prompt, setPrompt] = useState("");
  const [err, setErr] = useState("");
  const create = async () => {
    setErr("");
    const r = await api("/routines", { method: "POST", body: JSON.stringify({ botId: bot.id, name, cron, prompt }) });
    if (!r.ok) { setErr((await r.json()).error ?? "erro"); return; }
    setName(""); setPrompt("");
  };
  return (
    <div className="panel">
      <div className="panel-head"><b>⏰ Rotinas de {bot.name}</b><button className="link" onClick={onClose}>fechar</button></div>
      {routines.length === 0 && <div className="hint">Nenhuma rotina. Crie uma abaixo — ou peça ao bot: "toda segunda às 8h, confira o o ERP".</div>}
      {routines.map((r) => (
        <div key={r.id} className={"routine" + (r.enabled ? "" : " off")}>
          <div className="routine-main"><b>{r.name}</b> <code>{r.cron}</code><div className="routine-prompt">{r.prompt}</div><small>{r.nextRun ? "próxima: " + new Date(r.nextRun).toLocaleString("pt-BR") : ""}{r.lastRun ? " · última: " + new Date(r.lastRun).toLocaleString("pt-BR") : ""}</small></div>
          <div className="routine-actions">
            <button className="btn" onClick={() => api(`/routines/${r.id}/run`, { method: "POST" })}>Rodar agora</button>
            <button className="btn" onClick={() => api(`/routines/${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !r.enabled }) })}>{r.enabled ? "Pausar" : "Ativar"}</button>
            <button className="btn danger" onClick={() => { if (confirm(`Apagar a rotina "${r.name}"?`)) void api(`/routines/${r.id}`, { method: "DELETE" }); }}>Apagar</button>
          </div>
        </div>
      ))}
      <div className="routine-form">
        <input placeholder="Nome (ex.: Conferir o o ERP)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          <input placeholder="cron: min hora dia mês dia-semana" value={cron} onChange={(e) => setCron(e.target.value)} />
          <select value="" onChange={(e) => { if (e.target.value) setCron(e.target.value); }}>
            <option value="">atalhos…</option>
            {CRON_PRESETS.map(([l, c]) => <option key={c} value={c}>{l}</option>)}
          </select>
        </div>
        <textarea placeholder="O que o bot deve fazer nesse horário" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        {err && <div className="err">{err}</div>}
        <button className="btn primary" disabled={!cron || !prompt.trim()} onClick={create}>Criar rotina</button>
      </div>
    </div>
  );
}

function NewGroupDialog({ bots, onClose, onCreated }: { bots: BotSummary[]; onClose: () => void; onCreated: (g: Group) => void }) {
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const create = async () => {
    const r = await api("/groups", { method: "POST", body: JSON.stringify({ name: name || "Grupo", members }) });
    if (r.ok) onCreated(await r.json());
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Novo grupo</h3>
        <input placeholder="Nome do grupo (ex.: Equipe de vídeo)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="checks">
          {bots.map((b) => (
            <label key={b.id}><input type="checkbox" checked={members.includes(b.id)} onChange={(e) => setMembers(e.target.checked ? [...members, b.id] : members.filter((m) => m !== b.id))} /> {b.name} <small>{b.role}</small></label>
          ))}
        </div>
        <div className="card-actions">
          <button className="btn primary" disabled={members.length < 1} onClick={create}>Criar</button>
          <button className="btn" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

/** Render mínimo de markdown: blocos de código, negrito, itálico, links, listas e quebras de linha. */
function Markdownish({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <div className="md">
      {parts.map((p, i) => {
        if (p.startsWith("```")) return <pre key={i}>{p.replace(/^```\w*\n?/, "").replace(/```$/, "")}</pre>;
        return <span key={i} dangerouslySetInnerHTML={{ __html: inline(p) }} />;
      })}
    </div>
  );
}

function inline(s: string): string {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|\s)\*([^*\n]+)\*/g, "$1<i>$2</i>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/^(\s*)[-•] (.*)$/gm, "$1• $2")
    .replace(/\n/g, "<br/>");
}


// ---------------- criar e configurar bots ----------------

type ProviderInfo = { kind: string; label: string; engines: string[]; needsKey: boolean; keyEnv: string; defaultModel: string; defaultBaseURL?: string; models: string[]; chaveDaCasa?: boolean };

function usePresets() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [voices, setVoices] = useState<Array<{ valor: string; nome: string; clonada?: boolean }>>([]);
  useEffect(() => {
    api("/providers").then((r) => r.json()).then(setProviders).catch(() => {});
    api("/voice/voices").then((r) => r.json()).then(setVoices).catch(() => {});
  }, []);
  return { providers, voices };
}

/** Como todo bot nasce: no Claude, motor direto, sem ninguem digitar chave.
 *  A chave fica no .env do Hub e chega ao bot pelo ambiente do processo. */
const PADRAO_DA_CASA = { engine: "direct", provider: { kind: "zai", model: "glm-4.5-flash" } };

const slug = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

function personaTemplate(name: string, role: string) {
  return `# ${name}\n\nVocê é ${name}, ${role} da equipe de Bots do sua empresa.\nSeu chefe é o o chefe. Você fala em português, de forma direta, curta e simpática.\n\n## O que você faz\n- (descreva aqui as tarefas típicas)\n- Mantém um LOG.md no workspace com o que fez.\n- Quando precisa de algo de outra área, consulta o Bot certo (ask_bot).\n\n## Regras\n- Antes de qualquer ação crítica (apagar, pagar, enviar, publicar, instalar), peça aprovação.\n- Se faltar informação, pergunte ao chefe com opções curtas em vez de supor.\n- Quando terminar algo, avise o chefe com uma frase.\n- Nunca exponha chaves, senhas ou dados de cliente.\n`;
}

function BotForm({ value, onChange, providers, voices, isNew }: { value: any; onChange: (v: any) => void; providers: ProviderInfo[]; voices: Array<{ valor: string; nome: string; clonada?: boolean }>; isNew: boolean }) {
  const prov = providers.find((p) => p.kind === value.provider?.kind);
  const set = (patch: any) => onChange({ ...value, ...patch });
  const setProv = (patch: any) => onChange({ ...value, provider: { ...value.provider, ...patch } });
  return (
    <div className="form">
      <div className="row">
        <label>Nome<input value={value.name} onChange={(e) => set({ name: e.target.value, ...(isNew && !value.personaTouched ? { persona: personaTemplate(e.target.value, value.role) } : {}) })} placeholder="Ex.: Malaquias Marketing" /></label>
        <div className="campo-rosto">
          <RetratoPreview id={value.id ?? value.name ?? ""} avatar={value.avatar} />
          <label className="narrow">Rosto<input value={value.avatar} onChange={(e) => set({ avatar: e.target.value })} placeholder="deixe vazio: desenho próprio" /><small>Vazio = retrato desenhado para este bot. Pode pôr um emoji ou o endereço de uma foto.</small></label>
        </div>
      </div>
      <label>Função<input value={value.role} onChange={(e) => set({ role: e.target.value, ...(isNew && !value.personaTouched ? { persona: personaTemplate(value.name, e.target.value) } : {}) })} placeholder="Ex.: Marketing e redes sociais" /></label>
      <div className="row">
        <label>Provedor do modelo
          <select value={value.provider?.kind ?? "anthropic"} onChange={(e) => { const p = providers.find((x) => x.kind === e.target.value); setProv({ kind: e.target.value, model: p?.defaultModel ?? "", baseURL: p?.defaultBaseURL ?? "" }); if (e.target.value === "opencode") set({ engine: "opencode", provider: { kind: "opencode", model: p?.defaultModel ?? "big-pickle" } }); }}>
            {/* quem ja tem chave no Hub vem marcado: evita escolher um provedor que nao responde */}
                {providers.map((p) => <option key={p.kind} value={p.kind}>{p.label}{p.chaveDaCasa ? "  \u2713 chave pronta" : p.needsKey ? "  (sem chave)" : ""}</option>)}
          </select>
        </label>
        <label>Modelo
          <input list="models" value={value.provider?.model ?? ""} onChange={(e) => setProv({ model: e.target.value })} />
          <datalist id="models">{(prov?.models ?? []).map((m) => <option key={m} value={m} />)}</datalist>
        </label>
      </div>
      {prov?.needsKey && (prov.chaveDaCasa
        ? <p className="hint-inline">🔑 A chave da casa ({prov.keyEnv}) já está no Hub — este bot usa ela, você não precisa digitar nada.</p>
        : <label>Chave de API ({prov.keyEnv})<input type="password" value={value.provider?.apiKey ?? ""} onChange={(e) => setProv({ apiKey: e.target.value })} placeholder={isNew ? "cole a chave" : "deixe em branco para manter"} /></label>)}
      {prov?.kind === "ollama" && <label>Endereço do Ollama<input value={value.provider?.baseURL ?? ""} onChange={(e) => setProv({ baseURL: e.target.value })} placeholder="http://192.168.0.50:11434/v1" /></label>}
      <div className="row">
        <label>Motor
          <select value={value.engine} disabled={value.provider?.kind === "opencode"} onChange={(e) => set({ engine: e.target.value })}>
            <option value="opencode">OpenCode (agente completo, ferramentas do OpenCode)</option>
            <option value="direct">Direto na API (mais leve, ferramentas do MyBots)</option>
          </select>
        </label>
        <label>Voz
          <select value={value.voice ?? ""} onChange={(e) => set({ voice: e.target.value })}>
            <option value="">automática</option>
            {voices.some((v) => v.clonada) && (
              <optgroup label="Vozes da casa (clonadas, na 4090)">
                {voices.filter((v) => v.clonada).map((v) => <option key={v.valor} value={v.valor}>{v.nome}</option>)}
              </optgroup>
            )}
            <optgroup label="Vozes prontas">
              {voices.filter((v) => !v.clonada).map((v) => <option key={v.valor} value={v.valor}>{v.nome}</option>)}
            </optgroup>
          </select>
        </label>
      </div>
      <label>Nível de controle (automode)
        <select value={value.controlMode ?? "supervisionado"} onChange={(e) => { const m = e.target.value as ControlMode; if (m === "deus" && !confirmDeus()) return; set({ controlMode: m }); }}>
          {CONTROL_MODES.map((m) => <option key={m} value={m}>{CONTROL_LABELS[m]}</option>)}
        </select>
        <small className="hint-inline">{CONTROL_DESCRIPTIONS[(value.controlMode ?? "supervisionado") as ControlMode]} O seletor "Controle" da lista de bots, quando não está em "Por bot", vale sobre este.</small>
      </label>
      <label>Personalidade (system prompt)<textarea rows={8} value={value.persona} onChange={(e) => set({ persona: e.target.value, personaTouched: true })} /></label>
    </div>
  );
}

/** Cria um gerente: um bot acima dos outros, que recebe o pedido e distribui para a equipe. */
function NewGerenteDialog({ bots, onClose, onCreated }: { bots: BotSummary[]; onClose: () => void; onCreated: (id: string) => void }) {
  const { providers, voices } = usePresets();
  const [equipe, setEquipe] = useState<string[]>(bots.filter((b) => !b.manages?.length).map((b) => b.id));
  const [v, setV] = useState<any>({ name: "", role: "Gerente da equipe", avatar: "", voice: "", ...PADRAO_DA_CASA });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const id = slug(v.name || "gerente");
  const candidatos = bots.filter((b) => !b.manages?.length);
  const criar = async () => {
    if (!equipe.length) { setErr("Escolha pelo menos um bot para ele gerenciar."); return; }
    setBusy(true); setErr("");
    // O gerente é da mesma empresa de quem ele comanda — não existe bot sem empresa.
    const empresaDaEquipe = candidatos.find((b) => b.id === equipe[0])?.empresaId ?? undefined;
    const r = await api("/managed", { method: "POST", body: JSON.stringify({ ...v, id, manages: equipe, empresa: empresaDaEquipe }) });
    setBusy(false);
    if (!r.ok) { setErr((await r.json()).error ?? "erro"); return; }
    onCreated(id);
  };
  const alterna = (botId: string) => setEquipe(equipe.includes(botId) ? equipe.filter((x) => x !== botId) : [...equipe, botId]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>👑 Novo gerente</h3>
        <p className="muted">Ele fica acima dos bots escolhidos: você pede a ele, ele distribui e volta com o resultado. É quem atende no Telegram por padrão.</p>
        {!candidatos.length ? <p>Crie pelo menos um bot antes de nomear um gerente.</p> : (
          <>
            <label>Quem ele gerencia <small className="muted">({equipe.length} de {candidatos.length})</small></label>
            <div className="equipe">
              {candidatos.map((b) => (
                <button key={b.id} className={"equipe-item" + (equipe.includes(b.id) ? " on" : "")} onClick={() => alterna(b.id)}>
                  <span>{equipe.includes(b.id) ? "☑" : "☐"}</span>
                  <b>{b.avatar || "·"} {b.name}</b>
                  <small>{b.role}</small>
                </button>
              ))}
            </div>
            <BotForm value={v} onChange={setV} providers={providers} voices={voices} isNew />
            <p className="muted">A persona de gerente é escrita automaticamente com a equipe escolhida. Dá para editar depois no ⚙️ dele.</p>
          </>
        )}
        {err && <div className="err">{err}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || !v.name.trim() || !equipe.length} onClick={() => void criar()}>{busy ? "Criando…" : "Criar gerente"}</button>
        </div>
      </div>
    </div>
  );
}

function NewBotDialog({ onClose, onCreated, empresas = [], empresaAtiva = "todas", onCriou }: { onClose: () => void; onCreated: (id: string) => void; empresas?: Array<{ id: string; nome: string }>; empresaAtiva?: string; onCriou?: () => void }) {
  const { providers, voices } = usePresets();
  const [where, setWhere] = useState<"hub" | "other">("hub");
  // Com uma empresa só na casa, "Todas" não é motivo para o bot nascer órfão.
  const [empresa, setEmpresa] = useState(
    empresaAtiva !== "todas" ? empresaAtiva : (empresas.length === 1 ? empresas[0].id : ""),
  );
  const [ponte, setPonte] = useState(false);
  const [v, setV] = useState<any>({ name: "", role: "", avatar: "", voice: "", ...PADRAO_DA_CASA, persona: personaTemplate("", "") });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const id = slug(v.name || "bot");
  const create = async () => {
    setBusy(true); setErr("");
    const r = await api("/managed", { method: "POST", body: JSON.stringify({ ...v, id, empresa: empresa || null, ponte }) });
    setBusy(false);
    if (!r.ok) { setErr((await r.json()).error ?? "erro"); return; }
    onCriou?.();
    onCreated(id);
  };
  const prov = providers.find((p) => p.kind === v.provider?.kind);
  const cmd = `.\\scripts\\install-node.ps1 -Bot ${id} -Nome "${v.name}" -Funcao "${v.role}" -Avatar "${v.avatar}" -Hub ws://${location.hostname}:${location.port || 80} -Token <token do .env do Hub> -Engine ${v.engine} -Provider ${v.provider?.kind} -Modelo ${v.provider?.model}${prov?.needsKey ? " -ApiKey <sua chave>" : ""}${v.provider?.baseURL ? ` -BaseUrl ${v.provider.baseURL}` : ""}`;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Novo bot</h3>
        <div className="seg">
          <button className={where === "hub" ? "on" : ""} onClick={() => setWhere("hub")}>Roda neste PC (o Hub cuida dele)</button>
          <button className={where === "other" ? "on" : ""} onClick={() => setWhere("other")}>Roda em outro PC</button>
        </div>
        <label>Empresa <small className="muted">(todo bot pertence a uma)</small></label>
        <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
          <option value="" disabled>Escolha a empresa…</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        {!empresas.length && <p className="muted">Nenhuma empresa cadastrada ainda — crie a empresa primeiro, em ＋ gerenciar empresas.</p>}
        <label className="linha-check"><input type="checkbox" checked={ponte} onChange={(e) => setPonte(e.target.checked)} /> Ponte: pode falar com bots de outras empresas</label>

        <BotForm value={v} onChange={setV} providers={providers} voices={voices} isNew />
        {where === "other" && (
          <div className="hint-box">Na pasta <code>mybots</code> do outro PC, rode no PowerShell:<pre>{cmd}</pre>Depois inicie com <code>bots\{id}\start-bot.cmd</code>. O bot aparece aqui assim que conectar.</div>
        )}
        {err && <div className="err">{err}</div>}
        <div className="card-actions">
          {where === "hub" ? <button className="btn primary" disabled={!v.name.trim() || !empresa || busy} onClick={create}>{busy ? "Criando…" : `Criar e iniciar (${id})`}</button> : <button className="btn primary" onClick={() => { navigator.clipboard?.writeText(cmd); onClose(); }}>Copiar comando e fechar</button>}
          <button className="btn" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function BotSettingsPanel({ bot, onClose }: { bot: BotSummary; onClose: () => void }) {
  const { providers, voices } = usePresets();
  const [def, setDef] = useState<any | null>(null);
  const [v, setV] = useState<any | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const load = async () => {
    const r = await api(`/managed/${bot.id}`);
    if (r.ok) { const d = await r.json(); setDef(d); setV({ ...d, provider: { ...d.provider, apiKey: "" } }); } else setDef(false);
  };
  useEffect(() => { void load(); }, [bot.id]);
  const act = async (what: string) => {
    setMsg("…");
    const r = await api(`/managed/${bot.id}/${what}`, { method: "POST" });
    setMsg(r.ok ? (what === "restart" ? "Reiniciando (uns 20 s)…" : "ok") : "falhou");
    setTimeout(load, 1500);
  };
  const save = async () => {
    setMsg("Salvando…");
    const body = { ...v, provider: { ...v.provider, apiKey: v.provider.apiKey || undefined } };
    const r = await api(`/managed/${bot.id}`, { method: "PATCH", body: JSON.stringify(body) });
    setMsg(r.ok ? "Salvo. O bot reinicia com a nova configuração." : (await r.json()).error ?? "falhou");
    setTimeout(load, 1500);
  };
  const remove = async () => {
    if (!confirm(`Excluir o bot "${bot.name}"? A pasta com o workspace fica no disco.`)) return;
    const r = await api(`/managed/${bot.id}`, { method: "DELETE" }).catch((e) => e as Error);
    if (r instanceof Error || !r.ok) {
      const erro = r instanceof Error ? r.message : ((await r.json().catch(() => ({} as any)))?.error ?? `o Hub respondeu ${r.status}`);
      setMsg(`Não deu para excluir: ${erro}`);
      return;
    }
    void desintegrarAvatar(bot.id);
    onClose();
  };
  if (def === null) return <div className="panel">Carregando…</div>;
  if (def === false) {
    return (
      <div className="panel">
        <div className="panel-head"><b>⚙️ {bot.name}</b><button className="link" onClick={onClose}>fechar</button></div>
        <p>Este bot roda em outro PC (não é gerenciado por este Hub). Para mudar a personalidade ou o modelo, edite <code>bots\{bot.id}\persona.md</code> e <code>mybots-node.json</code> naquele PC e reinicie o <code>start-bot.cmd</code>.</p>
        <p>Motor: <b>{bot.engine}</b> · modelo: <b>{bot.provider}/{bot.model}</b> · status: {bot.online ? "online" : "offline"}</p>
      </div>
    );
  }
  return (
    <div className="panel">
      <div className="panel-head"><b>⚙️ {bot.name} <small>{def.running ? `rodando (pid ${def.pid})` : "parado"}{def.restarts ? ` · ${def.restarts} reinícios` : ""}</small></b><button className="link" onClick={onClose}>fechar</button></div>
      {v && <BotForm value={v} onChange={setV} providers={providers} voices={voices} isNew={false} />}
      <div className="card-actions wrap">
        <button className="btn primary" onClick={save}>Salvar e reiniciar</button>
        <button className="btn" onClick={() => act("restart")}>Reiniciar</button>
        {bot.online && <button className="btn" onClick={async () => { setMsg("Parando…"); await api(`/bots/${bot.id}/parar`, { method: "POST" }); setMsg("Parado o que ele estava fazendo."); }}>Parar o trabalho</button>}
        {def.running ? <button className="btn" onClick={() => act("stop")}>Desligar</button> : <button className="btn" onClick={() => act("start")}>Ligar</button>}
        <button className="btn" onClick={async () => { const r = await api(`/managed/${bot.id}/logs?lines=120`); setLog((await r.json()).log || "(vazio)"); }}>Ver log</button>
        <button className="btn danger" onClick={remove}>Excluir</button>
        <span className="hint-inline">{msg}</span>
      </div>
      {log !== null && <pre className="log">{log}</pre>}
    </div>
  );
}


/**
 * Empresas: criar, escrever as regras e dizer de quem é cada bot.
 * O conhecimento é universal; o que separa por empresa são os bots, as conversas
 * e a memória curta.
 */
function EmpresasDialog({ empresas, bots, onClose }: { empresas: Array<{ id: string; nome: string; regras: string; idioma?: string; bots: number }>; bots: BotSummary[]; onClose: () => void }) {
  const [lista, setLista] = useState(empresas);
  const [nome, setNome] = useState("");
  // A ficha sugerida pela análise do site/redes. É sugestão: ele lê, corrige e só então cria.
  const [site, setSite] = useState("");
  const [insta, setInsta] = useState("");
  const [sugestao, setSugestao] = useState<{ resumo: string; regras: string; fontes: string[]; avisos: string[] } | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [sel, setSel] = useState<string | null>(empresas[0]?.id ?? null);
  const [regras, setRegras] = useState(empresas[0]?.regras ?? "");
  const [err, setErr] = useState("");
  // WhatsApp da empresa escolhida: o painel pergunta o estado de 3 em 3 segundos
  // enquanto a janela está aberta — é assim que o QR aparece sozinho.
  const [whats, setWhats] = useState<{ estado: string; qr?: string; numero?: string; erro?: string }>({ estado: "desligado" });
  const [teste, setTeste] = useState({ para: "", texto: "Teste do MyBots ✅" });
  const [legal, setLegal] = useState<string | null>(null);
  const [creditos, setCreditos] = useState<string | null>(null);
  const [verPc, setVerPc] = useState<string | null>(null);
  const [verCelular, setVerCelular] = useState(false);
  const [verMac, setVerMac] = useState(false);
  useEffect(() => {
    if (!sel) return;
    let vivo = true;
    const ler = async () => { try { const r = await api(`/empresas/${sel}/whatsapp`); if (r.ok && vivo) setWhats(await r.json()); } catch {} };
    void ler();
    const t = setInterval(ler, 3000);
    return () => { vivo = false; clearInterval(t); };
  }, [sel]);
  const recarregar = async () => { const r = await api("/empresas"); if (r.ok) setLista(await r.json()); };
  const escolher = (id: string) => { setSel(id); setRegras(lista.find((e) => e.id === id)?.regras ?? ""); };
  const analisar = async () => {
    setAnalisando(true); setErr("");
    const r = await api("/empresas/sugerir", { method: "POST", body: JSON.stringify({ nome, site, instagram: insta }) });
    setAnalisando(false);
    if (!r.ok) { setErr((await r.json()).error ?? "não consegui analisar"); return; }
    const f = await r.json();
    if (f.nome && !nome.trim()) setNome(f.nome);
    setSugestao({ resumo: f.resumo, regras: f.regras, fontes: f.fontes ?? [], avisos: f.avisos ?? [] });
  };
  const criar = async () => {
    if (!nome.trim()) return;
    const r = await api("/empresas", { method: "POST", body: JSON.stringify({ nome, regras: sugestao?.regras ?? "" }) });
    if (!r.ok) { setErr((await r.json()).error ?? "erro"); return; }
    const e = await r.json();
    setNome(""); setSite(""); setInsta(""); setSugestao(null);
    setErr(e.aviso ? e.aviso : e.medico ? "Empresa criada. O Gerente Geral dela já está subindo e vai se apresentar na conversa dele." : "");
    await recarregar(); escolher(e.id);
  };
  const salvarRegras = async () => {
    if (!sel) return;
    await api(`/empresas/${sel}`, { method: "PATCH", body: JSON.stringify({ regras }) });
    await recarregar();
  };
  const apagar = async (id: string) => {
    const r = await api(`/empresas/${id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json()).error ?? "erro"); return; }
    setErr(""); setSel(null); await recarregar();
  };
  const mover = async (botId: string, empresa: string, ponte: boolean) => {
    await api(`/bots/${botId}/empresa`, { method: "POST", body: JSON.stringify({ empresa: empresa || null, ponte }) });
    await recarregar();
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Empresas</h3>
        <p className="muted">Cada empresa tem os seus bots, os seus gerentes e as suas regras. O conhecimento da casa continua sendo um só, universal: toda empresa lê a mesma base.</p>
        <div className="emp-nova">
          <input placeholder="Nome da nova empresa" value={nome} onChange={(e) => setNome(e.target.value)} />
          <input placeholder="site (ex.: exemplo.com.br)" value={site} onChange={(e) => setSite(e.target.value)} />
          <input placeholder="@instagram" value={insta} onChange={(e) => setInsta(e.target.value)} />
          <button className="btn" disabled={analisando || (!site.trim() && !insta.trim())} onClick={() => void analisar()}>{analisando ? "Lendo o site…" : "Analisar e sugerir regras"}</button>
          <button className="btn primary" disabled={!nome.trim()} onClick={() => void criar()}>Criar empresa</button>
        </div>
        {analisando ? <LendoSite alvo={site.trim() || insta.trim()} /> : null}
        {sugestao && (
          <div className="sugestao">
            <b>Sugestão da análise</b> <small className="muted">leia e corrija antes de criar — é sugestão, não verdade</small>
            {sugestao.resumo && <p className="muted">{sugestao.resumo}</p>}
            <textarea rows={8} value={sugestao.regras} onChange={(e) => setSugestao({ ...sugestao, regras: e.target.value })} />
            {!!sugestao.fontes.length && <small className="muted">Lido de: {sugestao.fontes.join(" · ")}</small>}
            {sugestao.avisos.map((a, i) => <small key={i} className="muted">⚠ {a}</small>)}
          </div>
        )}
        <div className="emp-lista">
          {lista.map((e) => (
            <button key={e.id} className={"emp-item" + (sel === e.id ? " on" : "")} onClick={() => escolher(e.id)}>
              <b>{e.nome}</b><small>{e.bots} bot(s)</small>
            </button>
          ))}
          {!lista.length && <p className="muted">Nenhuma empresa ainda.</p>}
        </div>
        {sel && (
          <>
            <label>Idioma da empresa</label>
            <select value={lista.find((e) => e.id === sel)?.idioma ?? "pt"} onChange={async (ev) => {
              await api(`/empresas/${sel}`, { method: "PATCH", body: JSON.stringify({ idioma: ev.target.value }) });
              await recarregar();
            }}>
              <option value="pt">Português (Brasil)</option>
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
            <label>Regras desta empresa <small className="muted">(vão no prompt de todo bot dela)</small></label>
            <textarea rows={6} value={regras} onChange={(e) => setRegras(e.target.value)} placeholder={"Ex.: Toda proposta vai com 10% de margem mínima.\nCliente desta empresa fala por WhatsApp, nunca por e-mail."} />
            <div className="card-actions">
              <button className="btn primary" onClick={() => void salvarRegras()}>Salvar regras</button>
              <button className="btn" disabled={analisando} onClick={async () => {
                setAnalisando(true); setErr("");
                const r = await api("/empresas/sugerir", { method: "POST", body: JSON.stringify({ nome: lista.find((e) => e.id === sel)?.nome, site, instagram: insta }) });
                setAnalisando(false);
                if (!r.ok) { setErr((await r.json()).error ?? "não consegui analisar"); return; }
                const f = await r.json(); setRegras(regras ? `${regras}\n${f.regras}` : f.regras);
              }}>{analisando ? "Lendo…" : "Sugerir pelo site acima"}</button>
              <button className="btn" onClick={() => setLegal(sel)}>Leis e consentimentos</button>
              <button className="btn" onClick={() => setVerPc(sel)}>🖥️ Ver o PC da empresa</button>
              <button className="btn" onClick={() => setVerCelular(true)}>📱 Ver o celular</button>
              <button className="btn" onClick={() => setVerMac(true)}>🍎 Tela do Mac</button>
              <button className="btn" onClick={() => setCreditos(sel)}>Créditos e Pix</button>
              <button className="btn perigo" onClick={() => void apagar(sel)}>Apagar empresa</button>
            </div>
            <div className="wa-caixa">
              <div className="wa-topo">
                <b>WhatsApp desta empresa</b>
                <span className={"wa-estado wa-" + whats.estado}>
                  {whats.estado === "conectado" ? `conectado${whats.numero ? ` · ${whats.numero}` : ""}`
                    : whats.estado === "qr" ? "esperando você escanear"
                    : whats.estado === "conectando" ? "conectando…" : "desligado"}
                </span>
              </div>
              <p className="muted">Cada empresa fala pelo seu próprio número. Escaneie uma vez: a sessão fica guardada e volta sozinha quando o Hub reinicia.</p>
              {whats.estado === "qr" && whats.qr && (
                <div className="wa-qr">
                  <img src={whats.qr} alt="QR code do WhatsApp" />
                  <ol className="muted">
                    <li>Abra o WhatsApp no celular desta empresa</li>
                    <li>Menu ⋮ → <b>Aparelhos conectados</b></li>
                    <li>Conectar um aparelho e aponte para o código</li>
                  </ol>
                </div>
              )}
              {whats.erro && <div className="muted">último aviso: {whats.erro}</div>}
              <div className="card-actions">
                {whats.estado === "conectado"
                  ? <>
                      <button className="btn" onClick={async () => { await api(`/empresas/${sel}/whatsapp/desligar`, { method: "POST", body: JSON.stringify({}) }); setWhats({ estado: "desligado" }); }}>Desligar</button>
                      <button className="btn perigo" onClick={async () => { await api(`/empresas/${sel}/whatsapp/desligar`, { method: "POST", body: JSON.stringify({ esquecer: true }) }); setWhats({ estado: "desligado" }); }}>Esquecer este número</button>
                    </>
                  : <button className="btn primary" onClick={async () => { setWhats({ estado: "conectando" }); await api(`/empresas/${sel}/whatsapp/conectar`, { method: "POST", body: "{}" }); }}>Gerar QR e conectar</button>}
              </div>
              {whats.estado === "conectado" && (
                <div className="wa-teste">
                  <input placeholder="número com DDD" value={teste.para} onChange={(e) => setTeste({ ...teste, para: e.target.value })} />
                  <input placeholder="mensagem de teste" value={teste.texto} onChange={(e) => setTeste({ ...teste, texto: e.target.value })} />
                  <button className="btn" onClick={async () => {
                    const r = await api(`/empresas/${sel}/whatsapp/enviar`, { method: "POST", body: JSON.stringify(teste) });
                    setErr(r.ok ? "" : ((await r.json()).error ?? "erro"));
                    if (r.ok) setErr("enviado ✓");
                  }}>Mandar teste</button>
                </div>
              )}
            </div>
            <label>De quem é cada bot</label>
            <div className="emp-bots">
              {bots.map((b) => (
                <div key={b.id} className="emp-bot">
                  <b>{b.avatar || "·"} {b.name}</b>
                  <select value={b.empresaId ?? ""} onChange={(ev) => void mover(b.id, ev.target.value, !!b.ponte)}>
                    <option value="">sistema (todas)</option>
                    {lista.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                  <label className="linha-check"><input type="checkbox" checked={!!b.ponte} onChange={(ev) => void mover(b.id, b.empresaId ?? "", ev.target.checked)} /> ponte</label>
                </div>
              ))}
            </div>
          </>
        )}
        {verCelular && <CelularDaEmpresa onFechar={() => setVerCelular(false)} />}
      {verMac && <TelaDoMac onFechar={() => setVerMac(false)} />}
      {verPc && <PcDaEmpresa empresaId={verPc} nome={lista.find((e) => e.id === verPc)?.nome ?? verPc} onFechar={() => setVerPc(null)} />}
      {creditos && <TelaCreditos empresaId={creditos} empresaNome={lista.find((e) => e.id === creditos)?.nome ?? creditos} onClose={() => setCreditos(null)} />}
        {legal && <TelaLegal empresaId={legal} empresaNome={lista.find((e) => e.id === legal)?.nome ?? legal} onClose={() => setLegal(null)} />}
        {err && <div className="err">{err}</div>}
        <div className="modal-foot"><button className="btn" onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  );
}


/** Excluir um bot: pergunta dentro do painel e mostra o motivo quando o Hub recusa. */
function ExcluirBotDialog({ bot, onClose }: { bot: BotSummary; onClose: () => void }) {
  const [erro, setErro] = useState("");
  const [indo, setIndo] = useState(false);
  const excluir = async (purge: boolean) => {
    setIndo(true); setErro("");
    try {
      const r = await api(`/managed/${bot.id}${purge ? "?purge=1" : ""}`, { method: "DELETE" });
      if (!r.ok) { const j = await r.json().catch(() => ({} as any)); setErro(j?.error ?? `o Hub respondeu ${r.status}`); setIndo(false); return; }
      void desintegrarAvatar(bot.id);
      onClose();
    } catch (e) { setErro((e as Error).message); setIndo(false); }
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Excluir “{bot.name}”?</h3>
        <p className="muted">
          O processo dele é desligado e ele some do painel. A pasta com o workspace e os arquivos
          continua no disco, a não ser que você peça para apagar junto.
        </p>
        {erro && <div className="err">{erro}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn" disabled={indo} onClick={() => void excluir(true)}>Excluir e apagar a pasta</button>
          <button className="btn danger" disabled={indo} onClick={() => void excluir(false)}>{indo ? "Excluindo…" : "Excluir bot"}</button>
        </div>
      </div>
    </div>
  );
}

/** Aumenta ou diminui a casa inteira.
 *  POR QUE ZOOM E NAO "tamanho da fonte": o CSS daqui e todo em pixels — mexer so na
 *  fonte deixaria caixas do tamanho antigo com texto maior dentro, e ai vaza. O zoom
 *  reflui o layout de verdade: tudo cresce junto e nada estoura.
 *  A abertura e as telas de cadastro cancelam o zoom no CSS (elas se medem pela
 *  janela), senao a tela de particulas sairia maior que o monitor. */
function Tamanho() {
  const [escala, setEscala] = useState<number>(() => {
    const g = Number(localStorage.getItem("mybots.escala"));
    return Number.isFinite(g) && g >= 0.8 && g <= 1.5 ? g : 1;
  });
  useEffect(() => {
    document.documentElement.style.setProperty("--escala", String(escala));
    localStorage.setItem("mybots.escala", String(escala));
  }, [escala]);
  const muda = (d: number) => setEscala((v) => Math.min(1.5, Math.max(0.8, Math.round((v + d) * 100) / 100)));
  return (
    <div className="tema tamanho" role="group" aria-label="Tamanho da letra">
      <button onClick={() => muda(-0.05)} title="Diminuir tudo" aria-label="Diminuir">A&#8722;</button>
      <button className="valor" onClick={() => setEscala(1)} title="Voltar ao padrao">{Math.round(escala * 100)}%</button>
      <button onClick={() => muda(0.05)} title="Aumentar tudo" aria-label="Aumentar">A+</button>
    </div>
  );
}

/** Configuracao da casa: o que decide SE o sistema consegue pensar — motor, contas e
 *  IA local — mais o reset de fabrica. Fica fora do menu de cada bot de proposito:
 *  isto vale para a casa inteira, nao para um bot so. */
function Configuracao() {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button className="tema-cfg" title="Configuracao do MyBots" aria-label="Configuracao" onClick={() => setAberto(true)}>&#9881;</button>
      {aberto && <ConfiguracaoDialog onClose={() => setAberto(false)} />}
    </>
  );
}

function ConfiguracaoDialog({ onClose }: { onClose: () => void }) {
  const [provs, setProvs] = useState<any[]>([]);
  const [local, setLocal] = useState<any>(null);
  const [pref, setPref] = useState("nuvem");
  const [testes, setTestes] = useState<Record<string, any>>({});
  const [frase, setFrase] = useState("");
  const [recado, setRecado] = useState("");

  useEffect(() => {
    void (async () => {
      try { setProvs(await (await api("/config/provedores")).json()); } catch { /* sem rede */ }
      try { setLocal(await (await api("/config/local")).json()); } catch { /* idem */ }
      try { setPref(((await (await api("/config/preferencia")).json()) as any).ordem ?? "nuvem"); } catch { /* idem */ }
    })();
  }, []);

  // chave "salva" nao e chave "funcionando": o teste faz uma chamada de verdade
  const testar = async (id: string) => {
    setTestes((t) => ({ ...t, [id]: { testando: true } }));
    try {
      const r = await api(`/config/provedores/${id}/testar`, { method: "POST", body: "{}" });
      const j = await r.json();
      setTestes((t) => ({ ...t, [id]: j }));
    } catch (e) {
      setTestes((t) => ({ ...t, [id]: { ok: false, erro: (e as Error).message } }));
    }
  };

  const salvarPref = async (o: string) => {
    setPref(o);
    try { await api("/config/preferencia", { method: "PUT", body: JSON.stringify({ ordem: o }) }); } catch { /* best effort */ }
  };

  const resetar = async () => {
    setRecado("");
    try {
      const r = await api("/config/reset", { method: "POST", body: JSON.stringify({ confirmacao: frase }) });
      const j = await r.json() as any;
      if (!r.ok) { setRecado(j.error ?? "nao deu"); return; }
      setRecado(`Apagados: ${j.bots} bot(s) e ${j.empresas} empresa(s). Recarregando...`);
      setTimeout(() => location.reload(), 1400);
    } catch (e) { setRecado((e as Error).message); }
  };

  const ligadas = provs.filter((p) => p.configurada).length;

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Configuracao do MyBots</h3>

        <p className="hint">
          {ligadas === 0 ? "Nenhuma chave ligada: a casa so pensa com a IA local." :
           ligadas === 1 ? "Uma chave ligada. Com uma so nao existe roleta: se ela recusar, nao ha para onde desviar." :
           `${ligadas} chaves ligadas — a roleta tem para onde desviar.`}
        </p>

        <h4>Motor &middot; contas de IA</h4>
        <div className="cfg-lista">
          {provs.map((p) => {
            const t = testes[p.id];
            return (
              <div key={p.id} className="cfg-item">
                <div className="cfg-nome">
                  <b>{p.nome}</b>
                  <small>{p.modelo} &middot; contexto {p.contextoK}K &middot; chave: {p.env}</small>
                  {p.aviso && <small className="cfg-aviso">{p.aviso}</small>}
                </div>
                <div className="cfg-acao">
                  <span className={"cfg-tag " + (p.configurada ? "on" : "off")}>{p.configurada ? "chave no .env" : "sem chave"}</span>
                  <button onClick={() => void testar(p.id)} disabled={!!t?.testando}>{t?.testando ? "testando..." : "testar"}</button>
                </div>
                {t && !t.testando && (
                  <div className={"cfg-res " + (t.ok ? "ok" : "ruim")}>
                    {t.ok ? `respondeu em ${t.ms} ms: "${t.resposta}"` : t.erro}
                  </div>
                )}
              </div>
            );
          })}
          {!provs.length && <div className="hint">Carregando...</div>}
        </div>

        <h4>IA local</h4>
        {local ? (
          <div className="cfg-local">
            <div>Placa: <b>{local.vram ? `${local.vram.nome} (${local.vram.totalGb} GB)` : "nenhuma NVIDIA detectada"}</b></div>
            <div>Memoria: <b>{local.ram?.totalGb} GB</b> &middot; reserva do sistema: {local.reserva?.ramGb} GB / {local.reserva?.vramGb} GB de video</div>
            <div>Ollama: <b className={local.ollama?.ok ? "cfg-ok" : "cfg-ruim"}>{local.ollama?.ok ? "no ar" : (local.ollama?.erro ?? "fora do ar")}</b></div>
            {local.ollama?.ok && <div className="hint">Modelos: {local.ollama.modelos.join(", ") || "nenhum instalado"}</div>}
          </div>
        ) : <div className="hint">Lendo a maquina...</div>}

        <h4>Quem atende primeiro</h4>
        <div className="cfg-pref">
          {[["nuvem", "Nuvem primeiro"], ["local", "Local primeiro"], ["so-nuvem", "So nuvem"], ["so-local", "So local"]].map(([v, rotulo]) => (
            <button key={v} className={pref === v ? "on" : ""} onClick={() => void salvarPref(v)}>{rotulo}</button>
          ))}
        </div>
        <p className="hint">Sem placa de video, "local primeiro" deixa a casa lenta. Com placa, ela economiza cota.</p>

        <h4 className="cfg-perigo-titulo">Zona de perigo</h4>
        <p className="hint">Apaga <b>todas as empresas, todos os bots e as preferencias</b>. As conversas e os arquivos dos bots vao junto. Nao ha lixeira e nao tem volta.</p>
        <div className="cfg-reset">
          <input value={frase} onChange={(e) => setFrase(e.target.value)} placeholder="digite APAGAR TUDO" />
          <button className="btn danger" disabled={frase.trim().toUpperCase() !== "APAGAR TUDO"} onClick={() => void resetar()}>Resetar o MyBots</button>
        </div>
        {recado && <p className="hint">{recado}</p>}

        <div className="acoes"><button onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  );
}
