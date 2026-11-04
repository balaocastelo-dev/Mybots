import { useEffect, useState } from "react";
import { normalizarFicha, type FichaCasa } from "@mybots/shared";
import { api } from "../api";
import { aplicativoAqui } from "../perfil";
import { AbaGeral } from "./Geral";
import { AbaComputadores } from "./Computadores";
import { AbaCofre } from "./CofrePainel";
import { AbaPermissoes } from "./Permissoes";
import { AbaUso } from "./Uso";
import { AbaAtualizacoes } from "./Atualizacoes";
import { ABAS_CONFIG, type AbaConfig } from "./abas";

export type { AbaConfig };

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
  const [casa, setCasa] = useState<FichaCasa>(() => normalizarFicha(null));
  const noApp = aplicativoAqui();

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await api("/casa");
        if (vivo && r.ok) setCasa(normalizarFicha(await r.json()));
      } catch { /* o padrão grátis continua */ }
    })();
    return () => { vivo = false; };
  }, []);

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
            {ABAS_CONFIG.map((a) => (
              <button key={a.id} type="button" data-aba={a.id} className={aba === a.id ? "on" : ""} aria-current={aba === a.id ? "page" : undefined} onClick={() => setAba(a.id)}>
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
            {aba === "permissoes" && <AbaPermissoes bots={bots} />}
            {aba === "cofre" && <AbaCofre bots={bots} />}
            {aba === "uso" && <AbaUso />}
            {aba === "atualizacoes" && <AbaAtualizacoes casa={casa} noApp={noApp} />}
          </div>
        </div>
      </div>
    </div>
  );
}
