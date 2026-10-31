import { useEffect, useRef, useState } from "react";
import type { HubToUi, UsoDoPc } from "@mybots/shared";

/**
 * O celular da empresa: descoberta por ADB, pareamento com o código de 6 dígitos
 * e a tela ao vivo por fotos. O scrcpy é opcional e abre sem áudio.
 */

type Servico = { nome: string; tipo: "connect" | "pairing"; host: string; porta: number };
type Aparelho = { serial: string; modelo: string; estado: string };
type Vinculo = { nomeMdns?: string; modelo: string; serial: string; host?: string; porta?: number };

function comChave(caminho: string) {
  const s = location.search;
  if (!s || s === "?") return caminho;
  return caminho + (caminho.includes("?") ? "&" + s.slice(1) : s);
}

export function CelularDaEmpresaPainel({
  empresaId, nome, conversationId, onEvent, aoVivo,
}: {
  empresaId: string;
  nome: string;
  conversationId?: string;
  onEvent?: (l: (m: HubToUi) => void) => () => void;
  aoVivo?: boolean;
}) {
  const [vinculo, setVinculo] = useState<Vinculo | null>(null);
  const [online, setOnline] = useState(false);
  const [trava, setTrava] = useState<{ nome: string } | null>(null);
  const [lista, setLista] = useState<Aparelho[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [adb, setAdb] = useState(true);
  const [uso, setUso] = useState<UsoDoPc>({ usando: null, historico: [] });
  const [codigo, setCodigo] = useState("");
  const [host, setHost] = useState("");
  const [porta, setPorta] = useState("");
  const [erro, setErro] = useState("");
  const [controle, setControle] = useState(false);
  const [quadro, setQuadro] = useState("");
  const [indo, setIndo] = useState(false);
  const [grav, setGrav] = useState<{ gravando: boolean; desde?: number }>({ gravando: false });
  const [agora, setAgora] = useState(Date.now());
  const img = useRef<HTMLImageElement | null>(null);
  const parar = useRef(false);

  const ler = async () => {
    try {
      const [r, u] = await Promise.all([
        fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/celular`)),
        fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/celular/uso`)),
      ]);
      if (r.ok) {
        const d = await r.json();
        setVinculo(d.vinculo);
        setOnline(!!d.online);
        setTrava(d.trava ? { nome: d.trava.nome } : null);
      }
      if (u.ok) setUso(await u.json());
    } catch { /* o Hub volta */ }
  };
  useEffect(() => { void ler(); const t = setInterval(ler, 4000); return () => clearInterval(t); }, [empresaId]);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  useEffect(() => {
    const ouvir = onEventRef.current;
    if (!ouvir) return;
    return ouvir((ev) => {
      if (ev.type === "celular.uso" && ev.empresaId === empresaId) setUso(ev.uso);
      if (ev.type === "pc.gravacao" && ev.empresaId === empresaId && ev.onde === "celular") {
        setGrav({ gravando: ev.gravando, desde: ev.desde });
      }
    });
  }, [empresaId]);

  const descobrir = async () => {
    setErro("");
    setIndo(true);
    try {
      const r = await fetch(comChave("/api/celulares/descobrir"));
      if (!r.ok) { setErro("não consegui procurar aparelhos"); return; }
      const d = await r.json();
      setAdb(!!d.adb);
      setLista(d.aparelhos ?? []);
      setServicos(d.servicos ?? []);
      const parear = (d.servicos ?? []).find((s: Servico) => s.tipo === "pairing");
      if (parear && !host) { setHost(parear.host); setPorta(String(parear.porta)); }
    } finally { setIndo(false); }
  };

  useEffect(() => {
    if (!aoVivo || !online) { setQuadro(""); return; }
    parar.current = false;
    let anterior = "";
    const laco = async () => {
      while (!parar.current) {
        try {
          const r = await fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/celular/tela?t=${Date.now()}`));
          if (r.ok) {
            const b = await r.blob();
            const u = URL.createObjectURL(b);
            setQuadro(u);
            if (anterior) URL.revokeObjectURL(anterior);
            anterior = u;
          }
        } catch { /* próximo quadro */ }
        await new Promise((res) => setTimeout(res, 800));
      }
      if (anterior) URL.revokeObjectURL(anterior);
    };
    void laco();
    return () => { parar.current = true; };
  }, [aoVivo, online, empresaId]);

  useEffect(() => {
    if (!conversationId) return;
    let vivo = true;
    const lerGrav = async () => {
      try {
        const r = await fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/maquina/gravacao?onde=celular`));
        if (vivo && r.ok) setGrav(await r.json());
      } catch { /* segue */ }
    };
    void lerGrav();
    const t = setInterval(lerGrav, 4000);
    return () => { vivo = false; clearInterval(t); };
  }, [empresaId, conversationId]);

  useEffect(() => {
    if (!grav.gravando) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [grav.gravando]);

  const conectar = async (serial: string) => {
    setErro("");
    setIndo(true);
    try {
      const r = await fetch(comChave("/api/celulares/conectar"), {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ip: serial }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) { setErro(d.msg || "não conectou"); return; }
      await vincular(serial);
    } finally { setIndo(false); }
  };

  const gravar = async () => {
    setErro("");
    const acao = grav.gravando ? "parar" : "iniciar";
    const r = await fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/maquina/gravacao`), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        acao, onde: "celular", conversationId,
        legenda: acao === "parar" ? "Gravação da tela do celular" : undefined,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false || d.erro) setErro(d.erro || d.error || "não consegui gravar");
    else if (d.gravando || d.desde) setGrav({ gravando: true, desde: d.desde });
    else setGrav({ gravando: false });
  };

  const vincular = async (serial: string) => {
    setErro("");
    const r = await fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/celular`), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serial }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) setErro(d.erro || d.error || "não vinculei");
    await ler();
  };

  const parear = async () => {
    setErro("");
    setIndo(true);
    try {
      const r = await fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/celular/parear`), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ host, porta: Number(porta), codigo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) setErro(d.erro || "não pareou");
      else setCodigo("");
      await ler();
    } finally { setIndo(false); }
  };

  return (
    <div className="cel-emp">
      <p className="muted cel-emp-passo">
        No {nome || "celular"}: Depuração sem fio, mesma rede, e o código de 6 dígitos de “Parear dispositivo”.
      </p>
      {vinculo
        ? <div className="pc-selo"><i className={"pc-luz" + (online ? " on" : "")} />
            <span><b>{vinculo.modelo}</b> · {vinculo.serial}{trava ? ` · ${trava.nome} está nele` : ""}</span>
          </div>
        : <p className="muted">Nenhum celular vinculado a esta empresa.</p>}
      {uso.usando && <p className="muted">Última ação: <b>{uso.usando.nome}</b> {uso.usando.resumo}</p>}

      {aoVivo && (
        <div className={"pc-visor cel-visor" + (controle ? "" : " sover")}>
          {quadro
            ? <img ref={img} src={quadro} alt="tela do celular" draggable={false}
                onClick={async (e) => {
                  if (!controle || !img.current) return;
                  const box = img.current.getBoundingClientRect();
                  const x = (e.clientX - box.left) / box.width;
                  const y = (e.clientY - box.top) / box.height;
                  await fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/celular/tocar`), {
                    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x, y }),
                  });
                }} />
            : <div className="pc-vazia">{online ? "pedindo a tela…" : "o aparelho está offline"}</div>}
          {!controle && quadro && <div className="pc-sover">só vendo</div>}
        </div>
      )}

      <div className="pc-comandos">
        {vinculo && <button className={"btn" + (controle ? "" : " primary")} type="button" disabled={!online} onClick={async () => {
          const prox = !controle;
          const r = await fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/celular/assumir`), {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assumir: prox }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || d.ok === false) { setErro(d.nome ? `${d.nome} está no celular` : (d.erro || "não assumi")); return; }
          setControle(prox);
          setErro("");
          await ler();
        }}>{controle ? "Devolver" : "Assumir o celular"}</button>}
        {vinculo && <button className="btn" type="button" onClick={() => void fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/celular/janela`), { method: "POST", body: "{}" })}>Janela (sem áudio)</button>}
        {vinculo && conversationId && <button className={"btn" + (grav.gravando ? " gravando" : "")} type="button" disabled={!online && !grav.gravando} onClick={() => void gravar()}>
          {grav.gravando
            ? `Parar ${Math.floor(Math.max(0, agora - (grav.desde ?? agora)) / 1000 / 60)}:${String(Math.floor(Math.max(0, agora - (grav.desde ?? agora)) / 1000) % 60).padStart(2, "0")}`
            : "Gravar"}
        </button>}
        <button className="btn" type="button" disabled={indo} onClick={() => void descobrir()}>{indo ? "Procurando…" : "Procurar aparelhos"}</button>
        {vinculo && <button className="btn" type="button" onClick={async () => {
          await fetch(comChave(`/api/empresas/${encodeURIComponent(empresaId)}/celular`), { method: "DELETE" });
          setVinculo(null); await ler();
        }}>Desvincular</button>}
      </div>

      {!adb && <div className="pc-aviso">Não achei o adb. Ele vem em ferramentas/scrcpy, ou defina MYBOTS_ADB.</div>}
      {erro && <div className="pc-aviso">{erro}</div>}

      {!!lista.length && (
        <ul className="cel-achados">
          {lista.filter((a) => a.estado === "device" || a.estado === "na-rede").map((a) => (
            <li key={a.serial}>
              <b>{a.modelo}</b> <span className="muted">{a.serial}</span>
              {a.estado === "device"
                ? <button className="btn" type="button" onClick={() => void vincular(a.serial)}>Este é o da empresa</button>
                : <button className="btn" type="button" disabled={indo} onClick={() => void conectar(a.serial)}>Conectar e vincular</button>}
            </li>
          ))}
        </ul>
      )}
      {!!servicos.filter((s) => s.tipo === "connect").length && (
        <ul className="cel-achados">
          {servicos.filter((s) => s.tipo === "connect").map((s) => (
            <li key={`${s.nome}-${s.host}-${s.porta}`}>
              <b>{s.nome}</b> <span className="muted">{s.host}:{s.porta}</span>
              <button className="btn" type="button" disabled={indo} onClick={() => void conectar(`${s.host}:${s.porta}`)}>Conectar este</button>
            </li>
          ))}
        </ul>
      )}

      <form className="cel-parear" onSubmit={(e) => { e.preventDefault(); void parear(); }}>
        <input placeholder="código de 6 dígitos ou texto do QR" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        <input placeholder="IP" value={host} onChange={(e) => setHost(e.target.value)} />
        <input placeholder="porta" value={porta} onChange={(e) => setPorta(e.target.value)} />
        <button className="btn primary" type="submit" disabled={indo || codigo.replace(/\D/g, "").length < 6}>Parear</button>
      </form>
      {!!uso.historico.length && (
        <ul className="pc-hist">
          {uso.historico.slice(0, 4).map((a, i) => <li key={i}><b>{a.nome}</b> <span>{a.resumo}</span></li>)}
        </ul>
      )}
    </div>
  );
}

/** Atalho da barra: o celular da empresa escolhida, ou a única que existe. */
export function AtalhoCelular({
  empresas, ativa, onFechar,
}: {
  empresas: { id: string; nome: string }[];
  ativa: string;
  onFechar: () => void;
}) {
  const inicial = ativa !== "todas" ? ativa : empresas.length === 1 ? empresas[0].id : "";
  const [id, setId] = useState(inicial);
  const nome = empresas.find((e) => e.id === id)?.nome ?? "";
  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Celular da empresa</h3>
        {empresas.length > 1 && (
          <label className="cel-emp-passo">Empresa
            <select value={id} onChange={(e) => setId(e.target.value)}>
              <option value="">escolha</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </label>
        )}
        {id
          ? <CelularDaEmpresaPainel empresaId={id} nome={nome} aoVivo />
          : <p className="muted">Escolha a empresa. Cada uma tem o seu Android.</p>}
        {!empresas.length && <p className="muted">Cadastre a empresa primeiro. O celular é dela.</p>}
        <div className="modal-foot"><button className="btn" type="button" onClick={onFechar}>Fechar</button></div>
      </div>
    </div>
  );
}
