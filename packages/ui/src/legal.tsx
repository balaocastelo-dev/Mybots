import { UI_BASE } from "./api";
// Leis e consentimentos: o que a empresa declara antes de falar com cliente.
// A tela não é enfeite — enquanto os obrigatórios não estiverem aceitos na versão
// atual, o WhatsApp daquela empresa recusa enviar.
import { useEffect, useState } from "react";

const api = (path: string, init?: RequestInit) =>
  fetch(`${UI_BASE}/api${path}${location.search}`, { credentials: "include", headers: { "content-type": "application/json" }, ...init });

type Doc = { id: string; titulo: string; obrigatorio: boolean; resumo: string; declaracao: string; corpo: string[] };
type Registro = { doc: string; versao: string; aceito: boolean; quem: string | null; quando: number };

export function TelaLegal({ empresaId, empresaNome, onClose }: { empresaId: string; empresaNome: string; onClose: () => void }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [versao, setVersao] = useState("");
  const [reg, setReg] = useState<Registro[]>([]);
  const [liberado, setLiberado] = useState<{ ok: boolean; falta?: string[] }>({ ok: false });
  const [aberto, setAberto] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  const ler = async () => {
    const a = await api("/legal");
    if (a.ok) { const j = await a.json(); setDocs(j.docs); setVersao(j.versao); }
    const b = await api(`/empresas/${empresaId}/consentimentos`);
    if (b.ok) { const j = await b.json(); setReg(j.registros ?? []); setLiberado(j.liberado ?? { ok: false }); }
  };
  useEffect(() => { void ler(); }, [empresaId]);

  const estado = (id: string) => reg.find((r) => r.doc === id && r.versao === versao);
  const marcar = async (doc: string, aceito: boolean) => {
    const r = await api(`/empresas/${empresaId}/consentimentos`, { method: "POST", body: JSON.stringify({ doc, aceito }) });
    if (!r.ok) { setErro((await r.json()).error ?? "erro"); return; }
    const j = await r.json(); setReg(j.registros); setLiberado(j.liberado); setErro("");
  };
  const aceitarTodosObrigatorios = async () => {
    const itens = docs.filter((d) => d.obrigatorio).map((d) => ({ doc: d.id, aceito: true }));
    const r = await api(`/empresas/${empresaId}/consentimentos`, { method: "POST", body: JSON.stringify({ itens }) });
    if (r.ok) {
      const j = await r.json();
      setReg(j.registros); setLiberado(j.liberado);
      // aceitou o que precisava: nao faz sentido deixar a pessoa na pagina de novo.
      // Fecha so quando os obrigatorios ficaram todos de pe (liberado), senao mostra
      // o erro em vez de sumir sem explicacao.
      if (j.liberado?.ok) onClose();
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide legal" onClick={(e) => e.stopPropagation()}>
        <h3>Leis e consentimentos — {empresaNome}</h3>
        <p className="muted">
          Modelo para você e o seu advogado revisarem, não parecer jurídico. O que o sistema garante é o
          registro: cada aceite fica gravado com a data, quem aceitou e a versão do texto ({versao}).
        </p>

        <div className={"legal-estado " + (liberado.ok ? "ok" : "bloq")}>
          {liberado.ok
            ? "Liberado: esta empresa pode falar com cliente pelo WhatsApp."
            : `Bloqueado: o WhatsApp desta empresa não envia nada enquanto faltar aceitar ${liberado.falta?.length ?? 0} documento(s) obrigatório(s).`}
        </div>

        <div className="legal-lista">
          {docs.map((d) => {
            const e = estado(d.id);
            return (
              <div key={d.id} className={"legal-doc" + (e?.aceito ? " aceito" : "")}>
                <div className="legal-cab">
                  <label className="linha-check">
                    <input type="checkbox" checked={!!e?.aceito} onChange={(ev) => void marcar(d.id, ev.target.checked)} />
                    <b>{d.titulo}</b>
                  </label>
                  <span className="legal-tag">{d.obrigatorio ? "obrigatório" : "só se usar"}</span>
                </div>
                <p className="muted">{d.resumo}</p>
                <p className="legal-declaracao">“{d.declaracao}”</p>
                <button className="link" onClick={() => setAberto(aberto === d.id ? null : d.id)}>
                  {aberto === d.id ? "fechar o texto" : "ler o texto inteiro"}
                </button>
                {aberto === d.id && <ul className="legal-corpo">{d.corpo.map((l, i) => <li key={i}>{l}</li>)}</ul>}
                {e?.aceito && <small className="muted">aceito por {e.quem || "—"} em {new Date(e.quando).toLocaleString("pt-BR")}</small>}
              </div>
            );
          })}
        </div>

        {erro && <div className="err">{erro}</div>}
        <div className="modal-foot">
          <button className="btn primary" onClick={() => void aceitarTodosObrigatorios()}>Aceitar os obrigatórios</button>
          <button className="btn" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}


