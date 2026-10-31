import { useEffect, useState } from "react";
import { api } from "./api";

// ---------------- tema: Balcao (claro) e Bancada (escuro) ----------------

export type TemaNome = "claro" | "escuro";

/** Grava o tema e avisa quem mais mostra o mesmo controle (a engrenagem e o
 *  botão do topo). Se o valor já está aplicado, não dispara de novo. */
export function gravarTema(tema: TemaNome) {
  const igual = document.documentElement.dataset.tema === tema;
  document.documentElement.dataset.tema = tema;
  try { localStorage.setItem("mybots.tema", tema); } catch { /* navegador privado */ }
  if (!igual) window.dispatchEvent(new CustomEvent("mybots-tema", { detail: tema }));
}

export function lerTema(): TemaNome {
  try { return localStorage.getItem("mybots.tema") === "escuro" ? "escuro" : "claro"; } catch { return "claro"; }
}

/** O tema nao segue o sistema operacional: quem manda e este botao, e a
 *  escolha fica guardada no navegador. Claro e o padrao. */
export function Tema() {
  const [tema, setTema] = useState<TemaNome>(lerTema);
  useEffect(() => { gravarTema(tema); }, [tema]);
  useEffect(() => {
    const ouvir = (e: Event) => {
      const t = (e as CustomEvent<string>).detail;
      if ((t === "claro" || t === "escuro") && t !== tema) setTema(t);
    };
    window.addEventListener("mybots-tema", ouvir);
    return () => window.removeEventListener("mybots-tema", ouvir);
  }, [tema]);
  return (
    <div className="tema" role="group" aria-label="Tema do painel">
      <button className={tema === "claro" ? "on" : ""} onClick={() => setTema("claro")} aria-pressed={tema === "claro"} title="Tema claro" aria-label="Tema claro">&#9728;</button>
      <button className={tema === "escuro" ? "on" : ""} onClick={() => setTema("escuro")} aria-pressed={tema === "escuro"} title="Tema escuro" aria-label="Tema escuro">&#9790;</button>
    </div>
  );
}

/** Aumenta ou diminui a casa inteira.
 *  POR QUE ZOOM E NAO "tamanho da fonte": o CSS daqui e todo em pixels — mexer so na
 *  fonte deixaria caixas do tamanho antigo com texto maior dentro, e ai vaza. O zoom
 *  reflui o layout de verdade: tudo cresce junto e nada estoura.
 *  A abertura e as telas de cadastro cancelam o zoom no CSS (elas se medem pela
 *  janela), senao a tela de particulas sairia maior que o monitor. */
export function lerEscala(): number {
  try {
    const g = Number(localStorage.getItem("mybots.escala"));
    return Number.isFinite(g) && g >= 0.8 && g <= 1.5 ? g : 1;
  } catch { return 1; }
}

export function gravarEscala(escala: number) {
  const proxima = String(escala);
  const igual = document.documentElement.style.getPropertyValue("--escala") === proxima;
  document.documentElement.style.setProperty("--escala", proxima);
  try { localStorage.setItem("mybots.escala", proxima); } catch { /* navegador privado */ }
  if (!igual) window.dispatchEvent(new CustomEvent("mybots-escala", { detail: escala }));
}

export function Tamanho() {
  const [escala, setEscala] = useState<number>(lerEscala);
  useEffect(() => { gravarEscala(escala); }, [escala]);
  useEffect(() => {
    const ouvir = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n === "number" && n !== escala) setEscala(n);
    };
    window.addEventListener("mybots-escala", ouvir);
    return () => window.removeEventListener("mybots-escala", ouvir);
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

/** A engrenagem do painel. A tela em si mora em configuracoes/Tela.tsx. */
export function Configuracao({ aberto, onOpen }: { aberto?: boolean; onOpen: () => void }) {
  return (
    <button className={"tema-cfg" + (aberto ? " on" : "")} title="Configurações do MyBots" aria-label="Configurações" aria-expanded={!!aberto} onClick={onOpen}>&#9881;</button>
  );
}

/** Quem atende primeiro. Vale para a casa inteira. */
export function PreferenciaDaCasa() {
  const [local, setLocal] = useState<any>(null);
  const [pref, setPref] = useState("nuvem");

  useEffect(() => {
    void (async () => {
      try { setLocal(await (await api("/config/local")).json()); } catch { /* sem rede */ }
      try { setPref(((await (await api("/config/preferencia")).json()) as any).ordem ?? "nuvem"); } catch { /* idem */ }
    })();
  }, []);

  const salvarPref = async (o: string) => {
    setPref(o);
    try { await api("/config/preferencia", { method: "PUT", body: JSON.stringify({ ordem: o }) }); } catch { /* best effort */ }
  };

  return (
    <div className="cfg-motor">
      {local ? (
        <div className="cfg-local">
          <div>Placa: <b>{local.vram ? `${local.vram.nome} (${local.vram.totalGb} GB)` : "nenhuma NVIDIA detectada"}</b></div>
          <div>Ollama: <b className={local.ollama?.ok ? "cfg-ok" : "cfg-ruim"}>{local.ollama?.ok ? "no ar" : (local.ollama?.erro ?? "fora do ar")}</b></div>
        </div>
      ) : <div className="hint">Lendo a máquina…</div>}
      <div className="cfg-pref">
        {[["nuvem", "Nuvem primeiro"], ["local", "Local primeiro"], ["so-nuvem", "Só nuvem"], ["so-local", "Só local"]].map(([v, rotulo]) => (
          <button key={v} type="button" className={pref === v ? "on" : ""} aria-pressed={pref === v} onClick={() => void salvarPref(v)}>{rotulo}</button>
        ))}
      </div>
      <p className="hint">Sem placa de vídeo, “local primeiro” deixa a casa lenta. Com placa, ela economiza cota.</p>
    </div>
  );
}

/** Apaga a casa inteira. A frase é a trava. */
export function ResetDaCasa() {
  const [frase, setFrase] = useState("");
  const [recado, setRecado] = useState("");
  const resetar = async () => {
    setRecado("");
    try {
      const r = await api("/config/reset", { method: "POST", body: JSON.stringify({ confirmacao: frase }) });
      const j = await r.json() as any;
      if (!r.ok) { setRecado(j.error ?? "não deu"); return; }
      setRecado(`Apagados: ${j.bots} bot(s) e ${j.empresas} empresa(s). Recarregando…`);
      setTimeout(() => location.reload(), 1400);
    } catch (e) { setRecado((e as Error).message); }
  };
  return (
    <div className="cfg-motor">
      <p className="hint">Apaga todas as empresas, todos os bots e as preferências. As conversas vão junto. Não há lixeira.</p>
      <div className="cfg-reset">
        <input value={frase} onChange={(e) => setFrase(e.target.value)} placeholder="digite APAGAR TUDO" aria-label="Confirmação para resetar" />
        <button type="button" className="btn danger" disabled={frase.trim().toUpperCase() !== "APAGAR TUDO"} onClick={() => void resetar()}>Resetar o MyBots</button>
      </div>
      {recado && <p className="hint">{recado}</p>}
    </div>
  );
}

/** Chaves dos provedores. O valor não vem para a tela: só “configurada” ou “sem chave”, e o teste. */
export function ChavesDaCasa() {
  const [provs, setProvs] = useState<Array<{ id: string; nome: string; modelo?: string; contextoK?: number; configurada?: boolean; aviso?: string }>>([]);
  const [testes, setTestes] = useState<Record<string, { testando?: boolean; ok?: boolean; ms?: number; erro?: string }>>({});

  useEffect(() => {
    void (async () => {
      try {
        const lista = await (await api("/config/provedores")).json() as unknown[];
        if (!Array.isArray(lista)) return;
        setProvs(lista.map((p) => {
          const o = p && typeof p === "object" ? p as Record<string, unknown> : {};
          return {
            id: typeof o.id === "string" ? o.id : "",
            nome: typeof o.nome === "string" ? o.nome : "Provedor",
            modelo: typeof o.modelo === "string" ? o.modelo : "",
            contextoK: typeof o.contextoK === "number" ? o.contextoK : undefined,
            configurada: o.configurada === true,
            aviso: typeof o.aviso === "string" ? o.aviso : "",
          };
        }).filter((p) => p.id));
      } catch { /* Hub fora */ }
    })();
  }, []);

  const testar = async (id: string) => {
    setTestes((t) => ({ ...t, [id]: { testando: true } }));
    try {
      const r = await api(`/config/provedores/${id}/testar`, { method: "POST", body: "{}" });
      const j = await r.json() as { ok?: boolean; ms?: number; erro?: string };
      setTestes((t) => ({ ...t, [id]: { ok: j.ok === true, ms: j.ms, erro: j.ok ? undefined : (j.erro ?? "não respondeu") } }));
    } catch (e) {
      setTestes((t) => ({ ...t, [id]: { ok: false, erro: (e as Error).message } }));
    }
  };

  if (!provs.length) return <p className="ajustes-lead">Nenhuma chave para mostrar. Quando o Hub responder, cada uma aparece mascarada.</p>;
  return (
    <div className="cfg-lista">
      {provs.map((p) => {
        const t = testes[p.id];
        return (
          <div key={p.id} className="cfg-item">
            <div className="cfg-nome">
              <b>{p.nome}</b>
              <small>{p.modelo}{p.contextoK ? ` · contexto ${p.contextoK}K` : ""}</small>
              {p.aviso && <small className="cfg-aviso">{p.aviso}</small>}
            </div>
            <div className="cfg-acao">
              <span className={"cfg-tag " + (p.configurada ? "on" : "off")}>{p.configurada ? "••••••••" : "sem chave"}</span>
              <button type="button" onClick={() => void testar(p.id)} disabled={!!t?.testando}>{t?.testando ? "testando…" : "testar"}</button>
            </div>
            {t && !t.testando && (
              <div className={"cfg-res " + (t.ok ? "ok" : "ruim")}>
                {t.ok ? `respondeu em ${t.ms ?? "—"} ms` : t.erro}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
