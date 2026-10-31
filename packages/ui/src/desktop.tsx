import { useEffect, useRef, useState } from "react";
import type { BotSummary } from "@mybots/shared";
import { Avatar } from "./avatar";

const TECLAS = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "a", "s", "d", "f", "g", "h", "j", "k", "l", "z", "x", "c", "v", "b", "n", "m"];

/**
 * Toque na miniatura da tela: primeiro o aviso, depois o desktop de verdade.
 * O teclado virtual manda a tecla para a página da tela (mesmo origem).
 */
export function DesktopAoVivo({ bot, empresaId, nome, onFechar }: {
  bot: BotSummary;
  empresaId: string | null;
  nome: string;
  onFechar: () => void;
}) {
  const [fase, setFase] = useState<"iniciando" | "conectando" | "aberto">("iniciando");
  const [teclado, setTeclado] = useState(true);
  const iframe = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const a = window.setTimeout(() => setFase("conectando"), 700);
    const b = window.setTimeout(() => setFase("aberto"), 1500);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, []);

  useEffect(() => {
    const t = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", t);
    return () => window.removeEventListener("keydown", t);
  }, [onFechar]);

  const tecla = (key: string) => {
    const doc = iframe.current?.contentDocument;
    const alvo = (doc?.querySelector("canvas, video, input, textarea") ?? doc?.body) as HTMLElement | null;
    if (!alvo) return;
    try { alvo.focus(); } catch { /* a tela pode recusar o foco */ }
    alvo.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    if (key.length === 1) alvo.dispatchEvent(new InputEvent("beforeinput", { data: key, bubbles: true, cancelable: true, inputType: "insertText" }));
    alvo.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
  };

  const aviso = fase === "iniciando" ? "Iniciando o desktop..." : "Conectando...";

  return (
    <div className="desktop-fundo" role="dialog" aria-label={`Desktop de ${bot.name}`} onClick={onFechar}>
      <div className="desktop-folha" onClick={(e) => e.stopPropagation()}>
      <header className="desktop-topo">
        <button className="icon-btn" type="button" title="Fechar" aria-label="Fechar o desktop" onClick={onFechar}>×</button>
        <Avatar bot={bot} size={28} />
        <b>{bot.name}</b>
        <span className="desktop-casa">{nome || "PC da empresa"}</span>
        <button className={"icon-btn" + (teclado ? " on" : "")} type="button" title="Teclado" aria-label="Teclado" aria-pressed={teclado} onClick={() => setTeclado((v) => !v)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>
        </button>
      </header>
      <div className="desktop-corpo">
        {fase !== "aberto" && (
          <div className="desktop-aviso">
            <Avatar bot={bot} size={144} />
            <strong>{bot.name}</strong>
            <span className="gira-lento" aria-hidden />
            <p>{aviso}</p>
          </div>
        )}
        {fase === "aberto" && empresaId && (
          <iframe ref={iframe} src={`/pc/${encodeURIComponent(empresaId)}/`} title={`Desktop de ${bot.name}`} allow="clipboard-read; clipboard-write" />
        )}
        {fase === "aberto" && !empresaId && (
          <div className="desktop-aviso">
            <p>Este bot não está numa empresa, então não há um PC compartilhado para abrir.</p>
          </div>
        )}
      </div>
      {teclado && fase === "aberto" && (
        <div className="desktop-teclado" role="group" aria-label="Teclado virtual">
          {TECLAS.map((k) => <button key={k} type="button" onClick={() => tecla(k)}>{k}</button>)}
          <button type="button" className="larga" onClick={() => tecla(" ")}>espaço</button>
          <button type="button" onClick={() => tecla("Backspace")}>⌫</button>
          <button type="button" onClick={() => tecla("Enter")}>↵</button>
        </div>
      )}
      </div>
    </div>
  );
}
