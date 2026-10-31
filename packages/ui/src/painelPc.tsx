import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { BotSummary, HubToUi, UsoDoPc } from "@mybots/shared";
import { Icone } from "./icones";
import { TelaDoMac } from "./mac";
import { TelasDoBot } from "./telasBot";
import { Trabalhos } from "./trabalhos";

/**
 * O PC da empresa, do lado do chat.
 *
 * Um Linux por empresa, compartilhado pelos bots dela. A tela vem pelo Hub
 * (a GUI do container em /pc/<empresa>/), com senha da interface. Por padrão
 * só se vê: o desktop entra em modo compartilhado e uma camada segura o mouse.
 * "Assumir o controle" tira as duas.
 */

type EstadoPc = "ligada" | "desligada" | "sem-docker" | "nao-criada";
type Maquina = {
  empresaId: string;
  container: string;
  portaTela: number;
  portaCdp: number;
  estado: EstadoPc;
  telaNoPainel?: boolean;
  erro?: string;
};

const usoVazio: UsoDoPc = { usando: null, historico: [] };

function comChave(caminho: string) {
  const s = location.search;
  if (!s || s === "?") return caminho;
  return caminho + (caminho.includes("?") ? "&" + s.slice(1) : s);
}

function hora(ms: number) {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function haQuanto(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 15) return "agora";
  if (s < 60) return `há ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  return `há ${Math.round(m / 60)} h`;
}

export function TelaDaEmpresa({
  empresaId, nome, onEvent, compacto, conversationId,
}: {
  empresaId: string;
  nome: string;
  onEvent?: (l: (m: HubToUi) => void) => () => void;
  compacto?: boolean;
  conversationId?: string;
}) {
  const [m, setM] = useState<Maquina | null>(null);
  const [uso, setUso] = useState<UsoDoPc>(usoVazio);
  const [pronto, setPronto] = useState(false);
  const [indo, setIndo] = useState(false);
  const [controle, setControle] = useState(false);
  const [grav, setGrav] = useState<{ gravando: boolean; desde?: number; nome?: string }>({ gravando: false });
  const [gravErro, setGravErro] = useState("");
  const [agora, setAgora] = useState(Date.now());
  const iframe = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      try {
        const [rm, ru, rg] = await Promise.all([
          fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/maquina`)),
          fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/maquina/uso`)),
          fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/maquina/gravacao`)),
        ]);
        if (!vivo) return;
        if (rm.ok) setM(await rm.json());
        if (ru.ok) setUso(await ru.json());
        if (rg.ok) setGrav(await rg.json());
      } catch { /* o Hub volta no próximo ciclo */ }
      if (vivo) setPronto(true);
    };
    void ler();
    const t = setInterval(ler, 5000);
    return () => { vivo = false; clearInterval(t); };
  }, [empresaId]);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  useEffect(() => {
    const ouvir = onEventRef.current;
    if (!ouvir) return;
    return ouvir((ev) => {
      if (ev.type === "pc.uso" && ev.empresaId === empresaId) setUso(ev.uso);
      if (ev.type === "pc.gravacao" && ev.empresaId === empresaId && ev.onde !== "celular") setGrav({ gravando: ev.gravando, desde: ev.desde, nome: ev.nome });
    });
  }, [empresaId]);

  useEffect(() => {
    const el = iframe.current;
    if (el) el.inert = !controle;
  }, [controle, m?.estado, m?.telaNoPainel]);

  useEffect(() => {
    if (!grav.gravando) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [grav.gravando]);

  const gravar = async () => {
    setGravErro("");
    setIndo(true);
    try {
      const r = await fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/maquina/gravacao`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acao: grav.gravando ? "parar" : "iniciar", conversationId, legenda: grav.gravando ? "Gravação da tela do PC" : undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false || d.erro) setGravErro(d.erro || d.error || "não consegui gravar");
      else if (d.gravando || d.desde) setGrav({ gravando: true, desde: d.desde, nome: "você" });
      else setGrav({ gravando: false });
    } catch {
      setGravErro("o Hub não respondeu");
    } finally { setIndo(false); }
  };

  const acao = async (qual: "ligar" | "desligar" | "recriar") => {
    setIndo(true);
    try {
      const r = await fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/maquina/${qual}`), { method: "POST" });
      if (r.ok) setM(await r.json());
    } finally { setIndo(false); }
  };

  const ligada = m?.estado === "ligada";
  const noPainel = !!m?.telaNoPainel;
  const mostrarTela = pronto && ligada && noPainel;
  const quente = !!uso.usando && Date.now() - uso.usando.quando < 120_000;
  const historico = uso.historico.slice(0, compacto ? 4 : 8);
  // O Hub tira o /pc/<empresa> e pede a raiz do container. No Selkies 2.1.0 o desktop mora aí;
  // com SUBFOLDER a raiz era a página "Welcome to nginx!".
  const src = `/pc/${encodeURIComponent(empresaId)}/${controle ? "" : "#shared"}`;

  return (
    <div className={"pc-vivo" + (compacto ? " compacto" : "")}>
      <div className="pc-comandos">
        <button className={"btn" + (controle ? "" : " primary")} type="button" disabled={!mostrarTela}
          onClick={() => setControle((v) => !v)}>
          {controle ? "Só olhar" : "Assumir o controle"}
        </button>
        <button className={"btn" + (grav.gravando ? " gravando" : "")} type="button"
          disabled={indo || (!grav.gravando && m?.estado !== "ligada")}
          onClick={() => void gravar()}>
          {grav.gravando
            ? `Parar ${Math.floor(Math.max(0, agora - (grav.desde ?? agora)) / 1000 / 60)}:${String(Math.floor(Math.max(0, agora - (grav.desde ?? agora)) / 1000) % 60).padStart(2, "0")}`
            : "Gravar"}
        </button>
        {m?.estado === "ligada"
          ? <button className="btn" type="button" disabled={indo} onClick={() => void acao("desligar")}>{indo ? "Desligando…" : "Desligar"}</button>
          : <button className="btn primary" type="button" disabled={indo || m?.estado === "sem-docker" || !m} onClick={() => void acao("ligar")}>
              {indo ? "Ligando…" : m?.estado === "nao-criada" ? "Criar o PC" : "Ligar"}
            </button>}
      </div>

      <div className={"pc-selo" + (quente ? " quente" : "")} title="Quem fez a última ação de navegador ou de tela neste PC">
        <i className={"pc-luz" + (quente ? " on" : uso.usando ? " frio" : "")} />
        {uso.usando
          ? <span><b>{uso.usando.nome}</b> está no PC · {uso.usando.resumo} <small>{haQuanto(uso.usando.quando)}</small></span>
          : <span>Ninguém usou o PC ainda.</span>}
      </div>

      {m?.estado === "sem-docker" && (
        <div className="pc-aviso">
          O Docker não está no ar nesta máquina. O PC da empresa roda em container — abra o Docker Desktop e tente de novo.
        </div>
      )}
      {m?.erro && m.estado !== "sem-docker" && <div className="pc-aviso">{m.erro}</div>}
      {gravErro && <div className="pc-aviso">{gravErro}</div>}
      {ligada && !noPainel && (
        <div className="pc-aviso">
          Este PC foi criado antes da tela passar pelo painel. Atualizar mantém os logins do navegador e passa a imagem por aqui.
          <button className="btn" type="button" disabled={indo} onClick={() => void acao("recriar")}>{indo ? "Atualizando…" : "Atualizar a tela"}</button>
        </div>
      )}

      <div className={"pc-visor" + (mostrarTela && !controle ? " sover" : "")}>
        {mostrarTela
          ? <>
              <iframe key={`${empresaId}-${controle ? "c" : "v"}`} ref={iframe} src={src}
                title={`Tela do PC da ${nome || empresaId}`} allow="clipboard-read; clipboard-write" />
              {!controle && <div className="pc-sover" aria-hidden>só vendo</div>}
            </>
          : <div className="pc-vazia">
              {!pronto ? "lendo o PC da empresa…"
                : indo ? "ligando o PC da empresa…"
                : m?.estado === "nao-criada" ? "Esta empresa ainda não tem PC. Crie e os bots dela passam a dividir o mesmo Linux."
                : m?.estado === "desligada" ? "O PC está desligado."
                : m?.estado === "sem-docker" ? "Sem Docker, o PC não sobe."
                : ligada && !noPainel ? "A tela ainda não passa pelo painel."
                : "lendo o estado…"}
            </div>}
      </div>

      <div className="pc-hist">
        <b>Últimas ações</b>
        {historico.length
          ? <ul>
              {historico.map((a, i) => (
                <li key={`${a.quando}-${a.botId}-${i}`}>
                  <b>{a.nome}</b>
                  <span>{a.resumo}</span>
                  <time>{hora(a.quando)}</time>
                </li>
              ))}
            </ul>
          : <p className="muted">Quando um bot abrir o navegador ou fotografar a tela, aparece aqui.</p>}
      </div>
    </div>
  );
}

function VisaoDaEmpresa({ nome, empresaId, rotinas, arquivos }: { nome: string; empresaId: string | null; rotinas: number; arquivos: number }) {
  const [texto, setTexto] = useState("lendo a máquina…");
  useEffect(() => {
    let vivo = true;
    void fetch(comChave("/api/maquina")).then(async (r) => {
      if (!vivo || !r.ok) return;
      const m = await r.json();
      const ram = m?.ram ? `${m.ram.usadaGb?.toFixed?.(1) ?? m.ram.usadaGb} / ${m.ram.totalGb} GB de memória` : "";
      setTexto(ram || "máquina sem leitura agora");
    }).catch(() => { if (vivo) setTexto("a máquina não respondeu"); });
    return () => { vivo = false; };
  }, []);
  return (
    <div className="lado-visao">
      <p><b>{nome || "Sem empresa"}</b></p>
      <p className="muted">Este bot tem o próprio PC e o próprio Android.</p>
      <p className="muted">{texto}</p>
      <p className="muted">{rotinas} rotina(s) · {arquivos} arquivo(s) nesta conversa</p>
    </div>
  );
}

type AbaLado = "pc" | "celular" | "mac" | "trabalhos" | "trabalho";

const ABAS: { id: AbaLado; rotulo: string; icone: "pc" | "celular" | "mac" | "pasta" | "trabalho" }[] = [
  { id: "celular", rotulo: "Celular", icone: "celular" },
  { id: "pc", rotulo: "Tela do PC", icone: "pc" },
  { id: "mac", rotulo: "Tela do Mac", icone: "mac" },
  { id: "trabalhos", rotulo: "Trabalhos", icone: "pasta" },
  { id: "trabalho", rotulo: "Trabalho", icone: "trabalho" },
];

export function PainelDoPc({
  botId, empresaId, nome, onFechar, onEvent, conversationId, rotinas = [], arquivos = [], bots = [],
}: {
  botId: string;
  empresaId: string | null;
  nome: string;
  onFechar: () => void;
  onEvent?: (l: (m: HubToUi) => void) => () => void;
  conversationId?: string;
  rotinas?: { id: string; nome: string; cron: string }[];
  arquivos?: { name: string; url: string }[];
  bots?: BotSummary[];
}) {
  const [aba, setAba] = useState<AbaLado>("pc");
  const [largura, setLargura] = useState(() => {
    try { const n = Number(localStorage.getItem("mybots-pc-largura")); return n >= 300 && n <= 860 ? n : 640; } catch { return 640; }
  });
  const larguraRef = useRef(largura);
  larguraRef.current = largura;

  const aoPuxar = (e: ReactPointerEvent) => {
    e.preventDefault();
    const inicioX = e.clientX;
    const inicioW = larguraRef.current;
    const mover = (ev: PointerEvent) => {
      const teto = Math.min(860, Math.max(320, window.innerWidth * 0.58));
      const w = Math.min(teto, Math.max(300, inicioW + (inicioX - ev.clientX)));
      setLargura(w);
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      try { localStorage.setItem("mybots-pc-largura", String(larguraRef.current)); } catch { /* segue sem gravar */ }
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };

  return (
    <aside className="pc-lado" style={{ width: largura }} aria-label="Painel da empresa">
      <div className="pc-pega" role="separator" aria-orientation="vertical" title="Arraste para alargar" onPointerDown={aoPuxar} />
      <header className="pc-lado-topo">
        <div>
          <b>{nome || "Empresa"}</b>
          <small>PC e Android deste bot</small>
        </div>
        <button className="icon-btn" type="button" title="Recolher o painel" onClick={onFechar}>›</button>
      </header>
      <div className="pc-segmento varias" role="tablist" aria-label="O que ver neste painel">
        {ABAS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={aba === item.id} className={aba === item.id ? "on" : ""} onClick={() => setAba(item.id)}>
            <Icone nome={item.icone} />
            <span>{item.rotulo}</span>
          </button>
        ))}
      </div>
      {(aba === "pc" || aba === "celular") && (
        <TelasDoBot botId={botId} nome={nome} mostrarPareamento={aba === "celular"} />
      )}
      {aba === "mac" && <TelaDoMac embutido />}
      {aba === "trabalhos" && <Trabalhos bots={bots} botInicial={botId} embutido />}
      {aba === "trabalho" && (
        <div className="lado-trabalho">
          <VisaoDaEmpresa nome={nome} empresaId={empresaId} rotinas={rotinas.length} arquivos={arquivos.length} />
          <b>Rotinas</b>
          <ul className="pc-hist lado-lista">
            {rotinas.length ? rotinas.map((r) => <li key={r.id}><b>{r.nome}</b><span>{r.cron}</span></li>) : <li className="muted">Nenhuma rotina neste bot.</li>}
          </ul>
          <b>Arquivos</b>
          <ul className="pc-hist lado-lista">
            {arquivos.length ? arquivos.map((a, i) => <li key={a.url + i}><a href={comChave(a.url)}>{a.name}</a></li>) : <li className="muted">Os arquivos desta conversa aparecem aqui.</li>}
          </ul>
        </div>
      )}
    </aside>
  );
}
