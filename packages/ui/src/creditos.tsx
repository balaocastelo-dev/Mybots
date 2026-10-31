import { UI_BASE } from "./api";
// CrÃ©ditos: mensalidade, franquia, saldo e recarga por Pix.
// O cliente vÃª mensagens e reais; o custo em tokens aparece sÃ³ para o dono, do lado,
// porque Ã© ele que precisa enxergar a margem.
import { useEffect, useState } from "react";

const api = (path: string, init?: RequestInit) =>
  fetch(`${UI_BASE}/api${path}${location.search}`, { credentials: "include", headers: { "content-type": "application/json" }, ...init });
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function TelaCreditos({ empresaId, empresaNome, onClose }: { empresaId: string; empresaNome: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [pix, setPix] = useState<any>({ chave: "", nome: "", cidade: "", configurado: false });
  const [cobranca, setCobranca] = useState<any>(null);
  const [valor, setValor] = useState(10000);
  const [err, setErr] = useState("");

  const ler = async () => {
    const a = await api(`/empresas/${empresaId}/creditos`); if (a.ok) setD(await a.json());
    const b = await api("/pix"); if (b.ok) setPix(await b.json());
  };
  useEffect(() => { void ler(); }, [empresaId]);

  const salvarPlano = async (campo: string, v: number) => {
    const r = await api(`/empresas/${empresaId}/plano`, { method: "POST", body: JSON.stringify({ [campo]: v }) });
    if (r.ok) void ler(); else setErr((await r.json()).error ?? "erro");
  };
  const salvarPix = async () => {
    const r = await api("/pix", { method: "POST", body: JSON.stringify({ chave: pix.chave, nome: pix.nome, cidade: pix.cidade }) });
    if (r.ok) setPix(await r.json());
  };
  const pedirRecarga = async () => {
    setErr("");
    const r = await api(`/empresas/${empresaId}/recarga`, { method: "POST", body: JSON.stringify({ valorCentavos: valor }) });
    if (!r.ok) { setErr((await r.json()).error ?? "erro"); return; }
    setCobranca(await r.json());
  };
  const confirmar = async (id: string) => {
    const r = await api(`/recargas/${id}/confirmar`, { method: "POST", body: "{}" });
    if (r.ok) { setCobranca(null); void ler(); } else setErr((await r.json()).error ?? "erro");
  };

  if (!d) return null;
  const p = d.plano;
  const custo = Math.round(d.ciclo.custoMilesimos / 1000);
  const margem = custo > 0 ? (d.ciclo.cobradoCentavos / custo) : null;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>CrÃ©ditos â€” {empresaNome}</h3>

        <div className={"cred-saldo " + (d.pode.ok ? "ok" : "bloq")}>
          <div><b>{reais(p.saldoCentavos)}</b><small>saldo</small></div>
          <div><b>{p.usadasNoCiclo}/{p.franquiaMensagens}</b><small>mensagens do ciclo</small></div>
          <div><b>{reais(p.precoMensagemCentavos)}</b><small>por mensagem acima da franquia</small></div>
          <div><b>{reais(p.mensalidadeCentavos)}</b><small>mensalidade</small></div>
        </div>
        {!d.pode.ok && <div className="legal-estado bloq">{(d.pode as any).motivo}</div>}
        {p.carenciaAte && p.carenciaAte > Date.now() && <div className="muted">CarÃªncia concedida atÃ© {new Date(p.carenciaAte).toLocaleString("pt-BR")}.</div>}

        <label className="linha-check" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={!!p.cobranca} onChange={async (e) => {
            const r = await api(`/empresas/${empresaId}/plano`, { method: "POST", body: JSON.stringify({ cobranca: e.target.checked }) });
            if (r.ok) void ler();
          }} />
          <b>Cobrar desta empresa</b> â€” desligado, os bots trabalham sem trava (Ã© como a sua prÃ³pria empresa deve ficar)
        </label>
        <label>O plano desta empresa</label>
        <div className="cred-plano">
          <label>Mensalidade (R$)<input type="number" defaultValue={p.mensalidadeCentavos / 100}
            onBlur={(e) => void salvarPlano("mensalidadeCentavos", Math.round(Number(e.target.value) * 100))} /></label>
          <label>Franquia (mensagens)<input type="number" defaultValue={p.franquiaMensagens}
            onBlur={(e) => void salvarPlano("franquiaMensagens", Math.round(Number(e.target.value)))} /></label>
          <label>PreÃ§o por mensagem (R$)<input type="number" step="0.01" defaultValue={p.precoMensagemCentavos / 100}
            onBlur={(e) => void salvarPlano("precoMensagemCentavos", Math.round(Number(e.target.value) * 100))} /></label>
        </div>

        <div className="cred-margem">
          <b>Ciclo:</b> {d.ciclo.mensagens} mensagens Â· vocÃª cobrou {reais(d.ciclo.cobradoCentavos)} Â· custou {reais(custo)}
          {margem ? <> Â· margem <b>{margem.toFixed(1)}Ã—</b></> : null}
          <br /><small className="muted">Cache de prompt lido no ciclo: {d.ciclo.cacheLido.toLocaleString("pt-BR")} tokens â€” Ã© o que derruba o custo.</small>
        </div>

        {!pix.configurado && (
          <div className="cred-pix-config">
            <b>Antes de cobrar, cadastre o seu Pix</b>
            <div className="cred-plano">
              <label>Chave Pix<input value={pix.chave} onChange={(e) => setPix({ ...pix, chave: e.target.value })} /></label>
              <label>Nome do recebedor<input value={pix.nome} onChange={(e) => setPix({ ...pix, nome: e.target.value })} /></label>
              <label>Cidade<input value={pix.cidade} onChange={(e) => setPix({ ...pix, cidade: e.target.value })} /></label>
            </div>
            <button className="btn" onClick={() => void salvarPix()}>Salvar Pix</button>
          </div>
        )}

        <label>Recarregar</label>
        <div className="cred-valores">
          {[5000, 10000, 30000, 100000].map((v) => (
            <button key={v} className={"btn" + (valor === v ? " primary" : "")} onClick={() => setValor(v)}>{reais(v)}</button>
          ))}
          <input type="number" step="1" value={valor / 100} onChange={(e) => setValor(Math.round(Number(e.target.value) * 100))} />
          <button className="btn primary" disabled={!pix.configurado} onClick={() => void pedirRecarga()}>Gerar Pix</button>
        </div>

        {cobranca && (
          <div className="cred-cobranca">
            {cobranca.qr && <img src={cobranca.qr} alt="QR do Pix" />}
            <div>
              <b>{reais(cobranca.valorCentavos)} Â· recarga {cobranca.id}</b>
              <textarea readOnly rows={3} value={cobranca.copiaECola} onFocus={(e) => e.currentTarget.select()} />
              <div className="card-actions">
                <button className="btn" onClick={() => navigator.clipboard?.writeText(cobranca.copiaECola)}>Copiar cÃ³digo</button>
                <button className="btn primary" onClick={() => void confirmar(cobranca.id)}>JÃ¡ caiu â€” creditar</button>
              </div>
              <small className="muted">Confirme sÃ³ quando o Pix aparecer na sua conta. Depois dÃ¡ para ligar um provedor e creditar sozinho.</small>
            </div>
          </div>
        )}

        {!!d.recargas.length && (
          <>
            <label>Recargas</label>
            <div className="cred-recargas">
              {d.recargas.map((r: any) => (
                <div key={r.id} className="cred-recarga">
                  <b>{reais(r.valorCentavos)}</b>
                  <span className={r.status === "paga" ? "pago" : "pendente"}>{r.status}</span>
                  <small>{new Date(r.pedidaEm).toLocaleString("pt-BR")}</small>
                  {r.status !== "paga" && <button className="link" onClick={() => void confirmar(r.id)}>creditar</button>}
                </div>
              ))}
            </div>
          </>
        )}

        {err && <div className="err">{err}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={async () => { await api(`/empresas/${empresaId}/carencia`, { method: "POST", body: JSON.stringify({ horas: 24 }) }); void ler(); }}>
            Conceder 24h de carÃªncia
          </button>
          <button className="btn" onClick={async () => { await api(`/empresas/${empresaId}/ciclo`, { method: "POST", body: "{}" }); void ler(); }}>Fechar ciclo</button>
          <button className="btn" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}


