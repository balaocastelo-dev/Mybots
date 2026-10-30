// Menu de botão direito do chat. Um componente só, usado pela bolha da mensagem e por
// quem mais precisar: ele cuida de abrir no cursor, não sair da tela, fechar no Esc e
// no clique fora, e de funcionar no celular (toque longo).
import { useEffect, useRef, useState } from "react";

export type ItemMenu = {
  label: string;
  icone?: string;
  atalho?: string;
  perigo?: boolean;
  /** linha separando do grupo anterior */
  separar?: boolean;
  onClick: () => void;
};

export function ContextMenu({ x, y, itens, onClose }: { x: number; y: number; itens: ItemMenu[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // O menu ENCOSTA no cursor. A regra antiga prendia o canto de baixo na borda da
    // janela: numa janela baixa, ou num menu alto, isso jogava o menu la para cima,
    // longe de onde a pessoa clicou. Agora abre para baixo quando ha espaco e sobe
    // (o fim dele no cursor) quando nao ha — que e como todo menu de sistema se comporta.
    const folgaAbaixo = window.innerHeight - y - 8;
    const alturaOk = Math.min(r.height, window.innerHeight - 16);
    const ny = alturaOk <= folgaAbaixo ? y : Math.max(8, y - alturaOk);
    const nx = x + r.width + 8 <= window.innerWidth ? x : Math.max(8, x - r.width);
    setPos({ x: nx, y: ny });
    el.focus();
  }, []);
  useEffect(() => {
    const fecha = () => onClose();
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("resize", fecha);
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("resize", fecha); window.removeEventListener("keydown", tecla); };
  }, [onClose]);
  return (
    <div className="ctx-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} onWheel={onClose}>
      <div ref={ref} className="ctx-menu chat" tabIndex={-1} role="menu" style={{ left: pos.x, top: pos.y, maxHeight: "calc(100vh - 16px)", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        {itens.map((it, i) => (
          <div key={i}>
            {it.separar && <hr />}
            <button role="menuitem" className={it.perigo ? "danger" : ""} onClick={() => { onClose(); it.onClick(); }}>
              <span>{it.icone ? `${it.icone} ` : ""}{it.label}</span>
              {it.atalho && <small className="atalho">{it.atalho}</small>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Abre o mesmo menu no toque longo (celular). Cancela se o dedo andar: senão o menu
 * aparece no meio de uma rolagem, que é o jeito mais rápido de tornar a lista
 * insuportável.
 */
export function useToqueLongo(abrir: (x: number, y: number) => void, ms = 550) {
  const t = useRef<number | null>(null);
  const inicio = useRef({ x: 0, y: 0 });
  const cancelar = () => { if (t.current) { clearTimeout(t.current); t.current = null; } };
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const p = e.touches[0];
      inicio.current = { x: p.clientX, y: p.clientY };
      t.current = window.setTimeout(() => abrir(p.clientX, p.clientY), ms);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const p = e.touches[0];
      if (Math.abs(p.clientX - inicio.current.x) > 10 || Math.abs(p.clientY - inicio.current.y) > 10) cancelar();
    },
    onTouchEnd: cancelar,
    onTouchCancel: cancelar,
  };
}
