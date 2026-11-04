import { Fragment, useEffect, useRef, useState } from "react";
import { USO_GRATIS, normalizarFicha, type FichaCasa } from "@mybots/shared";
import { api } from "./api";
import {
  AVISO_SUPORTE,
  CHAVE_NOME,
  aplicativoAqui,
  iniciais,
  itensDoMenu,
  nomeVisivel,
  type ItemMenu,
} from "./perfil";

function nomeGuardado(): string {
  try { return localStorage.getItem(CHAVE_NOME) ?? ""; } catch { return ""; }
}

export function MenuPerfil({
  nome, email, onConfig, onSair,
}: {
  nome?: string;
  email?: string;
  onConfig: () => void;
  onSair?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [local, setLocal] = useState(nomeGuardado);
  const [casa, setCasa] = useState<FichaCasa>(() => normalizarFicha(null));
  const [nota, setNota] = useState("");
  const caixa = useRef<HTMLDivElement>(null);
  const noApp = aplicativoAqui();
  const visivel = nomeVisivel({ nome, email, local });
  const itens = itensDoMenu(casa, noApp);

  useEffect(() => {
    const ouvir = (e: Event) => setLocal(String((e as CustomEvent<string>).detail ?? ""));
    window.addEventListener("mybots-conta-nome", ouvir);
    return () => window.removeEventListener("mybots-conta-nome", ouvir);
  }, []);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await api("/casa");
        if (!vivo || !r.ok) return;
        setCasa(normalizarFicha(await r.json()));
      } catch { /* fica no padrão grátis */ }
    })();
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    const fora = (e: PointerEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    window.addEventListener("keydown", tecla);
    window.addEventListener("pointerdown", fora);
    return () => {
      window.removeEventListener("keydown", tecla);
      window.removeEventListener("pointerdown", fora);
    };
  }, [aberto]);

  const fechar = () => { setAberto(false); setNota(""); };

  const agir = (item: ItemMenu) => {
    if (item.tipo === "info" || item.tipo === "aviso") return;
    if (item.id === "config") { fechar(); onConfig(); return; }
    if (item.id === "sair") { fechar(); void (onSair ? onSair() : sairSo()); return; }
    if (item.id === "suporte" && item.tipo === "acao") { setNota(AVISO_SUPORTE); return; }
  };

  return (
    <div className="perfil" ref={caixa}>
      {aberto && (
        <div className="perfil-pop" role="menu" aria-label="Conta" data-menu="perfil">
          {itens.map((item) => {
            if (item.tipo === "info") {
              return (
                <div key={item.id} className="perfil-uso" role="note">
                  <span>Uso</span>
                  <b>{item.rotulo}</b>
                </div>
              );
            }
            if (item.tipo === "link") {
              const externo = item.href.startsWith("http");
              return (
                <a key={item.id} role="menuitem" className="perfil-item" href={item.href}
                  {...(externo ? { target: "_blank", rel: "noreferrer" } : {})}
                  {...(item.id === "apk" ? { download: "MyBots.apk" } : {})}>
                  {item.rotulo}
                </a>
              );
            }
            if (item.tipo === "aviso") {
              return (
                <div key={item.id} className="perfil-item aviso" role="note">
                  <span>{item.rotulo}</span>
                  <small>{item.aviso}</small>
                </div>
              );
            }
            return (
              <Fragment key={item.id}>
                <button type="button" role="menuitem" className={"perfil-item" + (item.id === "sair" ? " sair" : "")}
                  onClick={() => agir(item)}>
                  {item.rotulo}
                </button>
                {item.id === "suporte" && nota && <p className="perfil-nota" role="status">{nota}</p>}
              </Fragment>
            );
          })}
        </div>
      )}
      <button type="button" className="perfil-botao" data-perfil="conta" aria-haspopup="menu" aria-expanded={aberto}
        title={email || visivel} onClick={() => { setNota(""); setAberto((v) => !v); }}>
        <span className="perfil-avatar" aria-hidden="true">{iniciais(visivel)}</span>
        <span className="perfil-textos">
          <b className="perfil-nome">{visivel}</b>
          <small>{USO_GRATIS}</small>
        </span>
      </button>
    </div>
  );
}

async function sairSo() {
  try { await api("/auth/logout", { method: "POST" }); } catch { /* segue */ }
  location.reload();
}
