// Menu de botão direito do chat. Um componente só, usado pela bolha da mensagem e por
// quem mais precisar: ele cuida de abrir no cursor, não sair da tela, fechar no Esc e
// no clique fora, e de funcionar no celular (toque longo → folha compacta embaixo).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

export type ItemMenu = {
  label: string;
  icone?: string;
  atalho?: string;
  perigo?: boolean;
  /** linha separando do grupo anterior */
  separar?: boolean;
  onClick: () => void;
};

function eToqueGrosso() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: none), (pointer: coarse)").matches || window.innerWidth <= 520;
}

export function ContextMenu({ x, y, itens, onClose }: { x: number; y: number; itens: ItemMenu[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const folha = eToqueGrosso();
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (folha) {
      const maxW = Math.min(360, window.innerWidth - 16);
      const nx = Math.max(8, Math.min(x - maxW / 2, window.innerWidth - maxW - 8));
      const abaixo = y + 12;
      let ny = abaixo + r.height <= window.innerHeight - 8
        ? abaixo
        : Math.max(8, Math.min(y - r.height - 8, window.innerHeight - r.height - 8));
      if (window.innerWidth <= 520 && r.height < window.innerHeight * 0.55) {
        setPos({ x: 8, y: Math.max(8, window.innerHeight - r.height - 8) });
      } else {
        setPos({ x: nx, y: ny });
      }
      el.focus();
      return;
    }
    const altura = Math.min(r.height, window.innerHeight - 16);
    const folgaAbaixo = window.innerHeight - y - 8;
    const ny = altura <= folgaAbaixo ? y : Math.max(8, y - altura);
    const nx = x + r.width + 8 <= window.innerWidth ? x : Math.max(8, window.innerWidth - r.width - 8);
    setPos({ x: nx, y: Math.min(ny, window.innerHeight - altura - 8) });
    el.focus();
  }, [x, y, folha, itens.length]);

  useEffect(() => {
    const fecha = () => onClose();
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("resize", fecha);
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("resize", fecha); window.removeEventListener("keydown", tecla); };
  }, [onClose]);

  const estilo: CSSProperties = {
    left: pos.x,
    top: pos.y,
    height: "auto",
    maxHeight: folha ? "min(70vh, calc(100vh - 16px))" : "calc(100vh - 16px)",
    overflowY: "auto",
  };
  if (folha && typeof window !== "undefined" && window.innerWidth <= 520) {
    estilo.width = "calc(100vw - 16px)";
  }

  return (
    <div className="ctx-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} onWheel={onClose}>
      <div
        ref={ref}
        className={"ctx-menu ctx-msg" + (folha ? " ctx-folha" : "")}
        tabIndex={-1}
        role="menu"
        style={estilo}
        onClick={(e) => e.stopPropagation()}
      >
        {itens.map((it, i) => (
          <div key={i}>
            {it.separar && <hr />}
            <button role="menuitem" className={it.perigo ? "danger" : ""} onClick={() => { onClose(); it.onClick(); }}>
              <span>{it.icone ? `${it.icone} ` : ""}{it.label}</span>
              {it.atalho && !folha && <small className="atalho">{it.atalho}</small>}
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
