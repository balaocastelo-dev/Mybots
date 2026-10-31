import { useEffect, useState } from "react";
import { AbaGeral } from "./Geral";
import { AbaComputadores } from "./Computadores";
import { AbaCofre } from "./CofrePainel";

export type AbaConfig = "geral" | "computadores" | "cofre";

const ABAS: { id: AbaConfig; nome: string; detalhe: string }[] = [
  { id: "geral", nome: "Geral", detalhe: "Tema, escala, voz e idioma" },
  { id: "computadores", nome: "Computadores", detalhe: "PC, celular e pareamento" },
  { id: "cofre", nome: "Cofre", detalhe: "Chaves, logins e cartões" },
];

export function TelaConfiguracoes({
  bots, empresas, onClose, tts, setTts, handsFree, setHandsFree, avisos, setAvisos, abaInicial,
}: {
  bots: { id: string; name: string; empresaId?: string | null; online?: boolean }[];
  empresas: { id: string; nome: string }[];
  onClose: () => void;
  tts: boolean;
  setTts: (v: boolean) => void;
  handsFree: boolean;
  setHandsFree: (v: boolean) => void;
  avisos: boolean;
  setAvisos: (v: boolean) => void;
  abaInicial?: AbaConfig;
}) {
  const [aba, setAba] = useState<AbaConfig>(abaInicial ?? "geral");

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", tecla);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", tecla);
      document.body.style.overflow = antes;
    };
  }, [onClose]);

  return (
    <div className="ajustes" role="dialog" aria-modal="true" aria-label="Configurações">
      <div className="ajustes-folha">
        <header className="ajustes-topo">
          <div>
            <p className="ajustes-olho">MyBots</p>
            <h2>Configurações</h2>
          </div>
          <button type="button" className="ajustes-fechar" onClick={onClose} aria-label="Fechar configurações">×</button>
        </header>
        <div className="ajustes-miolo">
          <nav className="ajustes-nav" aria-label="Seções">
            {ABAS.map((a) => (
              <button key={a.id} type="button" className={aba === a.id ? "on" : ""} aria-current={aba === a.id ? "page" : undefined} onClick={() => setAba(a.id)}>
                <b>{a.nome}</b>
                <small>{a.detalhe}</small>
              </button>
            ))}
          </nav>
          <div className="ajustes-corpo">
            {aba === "geral" && (
              <AbaGeral
                empresas={empresas.length}
                botsOnline={bots.filter((b) => b.online).length}
                botsTotal={bots.length}
                tts={tts} setTts={setTts}
                handsFree={handsFree} setHandsFree={setHandsFree}
                avisos={avisos} setAvisos={setAvisos}
              />
            )}
            {aba === "computadores" && <AbaComputadores bots={bots} empresas={empresas} />}
            {aba === "cofre" && <AbaCofre bots={bots} />}
          </div>
        </div>
      </div>
    </div>
  );
}
