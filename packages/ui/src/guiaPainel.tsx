import { useEffect, useState } from "react";
import { api } from "./api";
import { alternarMudo, calar, falar, mudo } from "./guia";

export const PASSOS = ["dados", "responsavel", "pc", "celular", "chaves", "canais", "time", "rotina", "pronto"] as const;
export type Passo = (typeof PASSOS)[number];

const TITULOS: Record<Passo, string> = {
  dados: "Dados",
  responsavel: "Responsável",
  pc: "PC",
  celular: "Celular",
  chaves: "Chaves",
  canais: "Canais",
  time: "Time",
  rotina: "Rotina",
  pronto: "PDF",
};

type Item = { status: "aberto" | "ok" | "pulado" | "falhou"; motivo?: string };
type Progresso = { empresaId: string; passo: Passo; itens: Record<Passo, Item> };

export function linkDoPasso(empresaId: string, passo: string) {
  return `#/onboarding/${encodeURIComponent(empresaId)}/${passo}`;
}

export function lerLinkGuia(hash: string): { empresaId: string; passo: Passo } | null {
  const m = /^#\/onboarding\/([^/]+)\/([a-z]+)$/.exec(hash.trim());
  if (!m) return null;
  const passo = m[2] as Passo;
  if (!PASSOS.includes(passo)) return null;
  return { empresaId: decodeURIComponent(m[1]), passo };
}

const CAMPOS: Record<string, Array<{ nome: string; rotulo: string; tipo?: string; modo?: string }>> = {
  dados: [
    { nome: "nome", rotulo: "Nome da empresa" },
    { nome: "cnpj", rotulo: "CNPJ (só números)", modo: "numeric" },
    { nome: "segmento", rotulo: "Ramo" },
    { nome: "cor", rotulo: "Cor, tipo #1A2B3C" },
  ],
  responsavel: [
    { nome: "nome", rotulo: "Nome de quem administra" },
    { nome: "email", rotulo: "E-mail", tipo: "email" },
    { nome: "telefone", rotulo: "Telefone com DDD", modo: "tel" },
  ],
  chaves: [
    { nome: "provedor", rotulo: "Provedor: groq ou anthropic" },
    { nome: "chave", rotulo: "Chave de IA", tipo: "password" },
  ],
  time: [
    { nome: "segmento", rotulo: "Ramo, se ainda não disse" },
  ],
};

export function GuiaCartao({ empresaId, passo, legenda }: { empresaId: string; passo: string; legenda: string }) {
  const camposDef = CAMPOS[passo] ?? [];
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");
  const [indo, setIndo] = useState(false);
  const [semVoz, setSemVoz] = useState(mudo());

  useEffect(() => {
    if (semVoz) return;
    void falar(legenda, `guia-${empresaId}-${passo}`);
    return () => calar();
  }, [legenda, empresaId, passo, semVoz]);

  const aoDigitar = (nome: string, valor: string) => {
    calar();
    setCampos((c) => ({ ...c, [nome]: valor }));
    if (nome === "cnpj" && /[a-zA-Z]/.test(valor)) setErro("CNPJ só tem números. Tem letra aí.");
    else if (nome === "telefone" && /[a-zA-Z]/.test(valor)) setErro("Telefone só com números.");
    else setErro("");
  };

  const enviar = async (acao: "conferir" | "pular" | "tentar") => {
    calar();
    if (acao !== "pular" && erro) return;
    setIndo(true);
    try {
      const r = await api(`/empresas/${encodeURIComponent(empresaId)}/guia/${passo}`, {
        method: "POST",
        body: JSON.stringify({ acao, campos }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) { setErro(j.error || "Não consegui falar com o Hub."); return; }
      setErro("");
      setCampos((c) => ({ ...c, chave: "" }));
      if (j.resultado && !j.resultado.ok && !j.resultado.pular) setErro(j.resultado.motivo || "Não passou.");
      if (j.progresso?.passo && j.progresso.passo !== passo) location.hash = linkDoPasso(empresaId, j.progresso.passo);
    } finally { setIndo(false); }
  };

  return (
    <form className="guia-cartao" onSubmit={(e) => { e.preventDefault(); void enviar("conferir"); }}>
      <p className="guia-legenda">{legenda}</p>
      {camposDef.map((f) => (
        <label key={f.nome}>{f.rotulo}
          <input
            name={f.nome}
            type={f.tipo ?? "text"}
            inputMode={f.modo as any}
            autoComplete="off"
            value={campos[f.nome] ?? ""}
            onFocus={() => calar()}
            onChange={(e) => aoDigitar(f.nome, e.target.value)}
          />
        </label>
      ))}
      {erro && <p className="guia-erro" role="alert">{erro}</p>}
      <div className="guia-acoes">
        <button className="btn primary" type="submit" disabled={indo || !!erro}>Conferir</button>
        <button className="btn" type="button" disabled={indo} onClick={() => void enviar("tentar")}>Tentar de novo</button>
        <button className="btn" type="button" disabled={indo} onClick={() => void enviar("pular")}>Pular</button>
        <button className={"btn" + (semVoz ? "" : " primary")} type="button" onClick={() => { setSemVoz(alternarMudo()); if (!mudo()) calar(); }}>{semVoz ? "Ouvir" : "Calar a voz"}</button>
      </div>
    </form>
  );
}

export function BarraGuia({ empresaId }: { empresaId: string }) {
  const [p, setP] = useState<Progresso | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      const r = await api(`/empresas/${encodeURIComponent(empresaId)}/guia`);
      if (!vivo) return;
      if (!r.ok) { setP(null); return; }
      setP(await r.json());
    };
    void ler();
    const t = setInterval(() => void ler(), 3000);
    return () => { vivo = false; clearInterval(t); };
  }, [empresaId]);

  const abrir = async (passo?: string) => {
    setErro("");
    const r = await api(`/empresas/${encodeURIComponent(empresaId)}/guia/abrir`, {
      method: "POST",
      body: JSON.stringify(passo ? { passo } : {}),
    });
    const j = await r.json().catch(() => ({} as any));
    if (!r.ok) { setErro(j.error || "Não abri o guia."); return; }
    setP(j);
    const alvo = passo || j.passo || "dados";
    location.hash = linkDoPasso(empresaId, alvo);
  };

  const ok = p ? PASSOS.filter((id) => p.itens?.[id]?.status === "ok").length : 0;
  return (
    <section className="guia-barra" aria-label="Guia da empresa">
      <header>
        <b>Guia da empresa</b>
        <span>{ok}/{PASSOS.length}</span>
      </header>
      <div className="guia-trilho" role="list">
        {PASSOS.map((id) => {
          const st = p?.itens?.[id]?.status ?? "aberto";
          return (
            <button key={id} type="button" role="listitem" className={"guia-passo " + st + (p?.passo === id ? " agora" : "")}
              title={p?.itens?.[id]?.motivo || TITULOS[id]}
              onClick={() => void abrir(id)}>
              <i>{st === "ok" ? "✓" : st === "falhou" ? "!" : st === "pulado" ? "–" : ""}</i>
              {TITULOS[id]}
            </button>
          );
        })}
      </div>
      {p?.passo && p.itens?.[p.passo]?.status === "falhou" && <p className="guia-erro">{p.itens[p.passo].motivo}</p>}
      {erro && <p className="guia-erro">{erro}</p>}
      <button className="btn" type="button" onClick={() => void abrir(p?.passo)}>{p ? "Continuar no chat" : "Começar o guia"}</button>
    </section>
  );
}
