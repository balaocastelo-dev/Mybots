import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { HubToUi, UsoDoPc } from "@mybots/shared";

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
      if (ev.type === "pc.gravacao" && ev.empresaId === empresaId) setGrav({ gravando: ev.gravando, desde: ev.desde, nome: ev.nome });
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

export function PainelDoPc({
  empresaId, nome, onFechar, onEvent, conversationId,
}: {
  empresaId: string | null;
  nome: string;
  onFechar: () => void;
  onEvent?: (l: (m: HubToUi) => void) => () => void;
  conversationId?: string;
}) {
  const [largura, setLargura] = useState(() => {
    try { const n = Number(localStorage.getItem("mybots-pc-largura")); return n >= 300 && n <= 760 ? n : 400; } catch { return 400; }
  });
  const larguraRef = useRef(largura);
  larguraRef.current = largura;

  const aoPuxar = (e: ReactPointerEvent) => {
    e.preventDefault();
    const inicioX = e.clientX;
    const inicioW = larguraRef.current;
    const mover = (ev: PointerEvent) => {
      const teto = Math.min(760, Math.max(320, window.innerWidth * 0.62));
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
    <aside className="pc-lado" style={{ width: largura }} aria-label="Computer, tela do PC da empresa">
      <div className="pc-pega" role="separator" aria-orientation="vertical" title="Arraste para alargar" onPointerDown={aoPuxar} />
      <header className="pc-lado-topo">
        <div>
          <b>Computer</b>
          <small>{empresaId ? (nome || "PC da empresa") : "sem empresa"}</small>
        </div>
        <button className="icon-btn" type="button" title="Recolher a tela" onClick={onFechar}>›</button>
      </header>
      {empresaId
        ? <TelaDaEmpresa empresaId={empresaId} nome={nome} onEvent={onEvent} conversationId={conversationId} compacto />
        : <p className="pc-sem-empresa">Este bot não está numa empresa. O PC é um só por empresa, compartilhado por todos os bots dela.</p>}
    </aside>
  );
}
