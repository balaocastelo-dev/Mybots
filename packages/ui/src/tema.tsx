import { useEffect, useState } from "react";
import { api } from "./api";

// ---------------- tema: Balcao (claro) e Bancada (escuro) ----------------

/** O tema nao segue o sistema operacional: quem manda e este botao, e a
 *  escolha fica guardada no navegador. Claro e o padrao. */
export function Tema() {
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

/** Aumenta ou diminui a casa inteira.
 *  POR QUE ZOOM E NAO "tamanho da fonte": o CSS daqui e todo em pixels — mexer so na
 *  fonte deixaria caixas do tamanho antigo com texto maior dentro, e ai vaza. O zoom
 *  reflui o layout de verdade: tudo cresce junto e nada estoura.
 *  A abertura e as telas de cadastro cancelam o zoom no CSS (elas se medem pela
 *  janela), senao a tela de particulas sairia maior que o monitor. */
export function Tamanho() {
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
export function Configuracao() {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button className="tema-cfg" title="Configuracao do MyBots" aria-label="Configuracao" onClick={() => setAberto(true)}>&#9881;</button>
      {aberto && <ConfiguracaoDialog onClose={() => setAberto(false)} />}
    </>
  );
}

export function ConfiguracaoDialog({ onClose }: { onClose: () => void }) {
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
