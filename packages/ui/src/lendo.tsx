import { useEffect, useState } from "react";

/**
 * O que a tela mostra enquanto o bot le o site da empresa.
 *
 * Antes isso era so a palavra "Lendo o site..." no botao: a pessoa nao sabia se
 * tinha travado. Aqui ela ve a pagina sendo varrida linha por linha e o passo em
 * que o bot esta. A varredura e enfeite honesto -- a ordem dos passos e a mesma
 * que o Hub segue de verdade ao abrir o site e montar as regras.
 */
const PASSOS = [
  "abrindo o endereco",
  "lendo as paginas",
  "achando produtos e servicos",
  "pegando contato, horario e endereco",
  "entendendo o jeito de falar da casa",
  "montando as regras",
];

export function LendoSite({ alvo }: { alvo?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1 < PASSOS.length ? n + 1 : n)), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="lendo" role="status" aria-live="polite">
      <div className="lendo-pagina" aria-hidden="true">
        <div className="lendo-barra-topo"><i /><i /><i /><span>{alvo || "site da empresa"}</span></div>
        <div className="lendo-corpo">
          <div className="lendo-bloco" />
          <div className="lendo-linha l1" />
          <div className="lendo-linha l2" />
          <div className="lendo-linha l3" />
          <div className="lendo-cartoes"><span /><span /><span /></div>
          <div className="lendo-linha l2" />
          <div className="lendo-linha l1" />
        </div>
        <div className="lendo-feixe" />
      </div>
      <div className="lendo-lado">
        <ul className="lendo-passos">
          {PASSOS.map((p, n) => (
            <li key={p} className={n < i ? "feito" : n === i ? "agora" : ""}>
              <b aria-hidden="true">{n < i ? "\u2713" : n === i ? "\u25CF" : "\u25CB"}</b>{p}
            </li>
          ))}
        </ul>
        <div className="lendo-progresso"><i /></div>
      </div>
    </div>
  );
}