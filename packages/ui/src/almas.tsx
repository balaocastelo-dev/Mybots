import { useEffect, useState } from "react";
import { api } from "./api";

export type PermissoesAlma = {
  rede: string; enviarMensagens: string; gravarDados: string; gastarDinheiro: string; apagar: string; publicar: string;
};

export type AlmaUi = {
  id: string;
  nome: string;
  avatar: string;
  funcao: string;
  resumo: string;
  persona: string;
  skills: string[];
  mcps: string[];
  permissoes: PermissoesAlma;
  segredos: Array<{ cofreId: string; uso: string }>;
  exigeConfirmacao: boolean;
};

export type ComplementoUi = {
  id: string;
  nome: string;
  descricao: string;
  exigeConfirmacao: boolean;
  permissoes: PermissoesAlma | null;
  segredos: Array<{ cofreId: string; uso: string }>;
};

const ROTULO: Record<string, string> = {
  enviarMensagens: "enviar mensagens",
  gravarDados: "gravar dados",
  gastarDinheiro: "gastar dinheiro",
  apagar: "apagar",
  publicar: "publicar",
};

export function acoesQuePedemOk(permissoes: PermissoesAlma | null | undefined): string[] {
  if (!permissoes) return [];
  return Object.entries(ROTULO).filter(([k]) => permissoes[k as keyof PermissoesAlma] === "confirma").map(([, rotulo]) => rotulo);
}

export function useAlmas() {
  const [almas, setAlmas] = useState<AlmaUi[]>([]);
  const [complementos, setComplementos] = useState<ComplementoUi[]>([]);
  const [erro, setErro] = useState("");
  useEffect(() => {
    api("/almas").then(async (r) => {
      if (!r.ok) throw new Error("falhou");
      const j = await r.json();
      setAlmas(j.almas ?? []);
      setComplementos(j.complementos ?? []);
    }).catch(() => setErro("Não deu para carregar o banco de almas."));
  }, []);
  return { almas, complementos, erro };
}

export function SeletorDeAlma({ almas, complementos, erro, almaId, opcionais, confirmei, onAlma, onOpcionais, onConfirmar }: {
  almas: AlmaUi[];
  complementos: ComplementoUi[];
  erro: string;
  almaId: string | null;
  opcionais: string[];
  confirmei: boolean;
  onAlma: (alma: AlmaUi | null) => void;
  onOpcionais: (ids: string[]) => void;
  onConfirmar: (v: boolean) => void;
}) {
  const alma = almas.find((a) => a.id === almaId) ?? null;
  const extras = complementos.filter((c) => opcionais.includes(c.id));
  const acoes = [...new Set([
    ...(alma ? acoesQuePedemOk(alma.permissoes) : []),
    ...extras.flatMap((c) => acoesQuePedemOk(c.permissoes)),
  ])];
  const cofres = [
    ...(alma?.segredos ?? []),
    ...extras.flatMap((c) => c.segredos),
  ].filter((s, i, arr) => arr.findIndex((x) => x.cofreId === s.cofreId) === i);
  return (
    <div className="almas">
      <b>Nascer com alma</b>
      <p className="muted">A alma traz a persona, as skills e os MCPs já pinados. Segredo fica no cofre, não aqui.</p>
      {erro && <div className="err">{erro}</div>}
      <div className="almas-grade">
        <button type="button" className={"alma-card" + (almaId === null ? " on" : "")} onClick={() => onAlma(null)}>
          <b>Sem alma</b>
          <small>Nasce só com o que você escrever no formulário.</small>
        </button>
        {almas.map((a) => (
          <button type="button" key={a.id} className={"alma-card" + (almaId === a.id ? " on" : "")} onClick={() => onAlma(a)}>
            <b>{a.avatar} {a.nome}</b>
            <small>{a.resumo}</small>
          </button>
        ))}
      </div>
      {complementos.map((c) => (
        <label key={c.id} className="linha-check">
          <input type="checkbox" checked={opcionais.includes(c.id)} onChange={(e) => onOpcionais(e.target.checked ? [...opcionais, c.id] : opcionais.filter((id) => id !== c.id))} />
          {c.nome}: {c.descricao}
        </label>
      ))}
      {cofres.length > 0 && (
        <p className="muted">Cofre: {cofres.map((s) => s.cofreId).join(", ")}. O valor não entra no bot.</p>
      )}
      {acoes.length > 0 && (
        <div className="alma-confirma">
          <label>
            <input type="checkbox" checked={confirmei} onChange={(e) => onConfirmar(e.target.checked)} />
            <span>Confirmo nascer com esta alma. Ela pode {acoes.join(", ")}, e cada vez ainda vai pedir ok.</span>
          </label>
        </div>
      )}
    </div>
  );
}
