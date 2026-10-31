/** Ícones de traço fino, no lugar dos emojis da barra. */

const comum = {
  width: 16, height: 16, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

export function Icone({ nome }: { nome: "celular" | "mac" | "pasta" | "alfinete" | "pc" | "trabalho" }) {
  if (nome === "celular") return <svg {...comum}><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></svg>;
  if (nome === "mac" || nome === "pc") return <svg {...comum}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;
  if (nome === "pasta" || nome === "trabalho") return <svg {...comum}><path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
  return <svg {...comum}><path d="M9 4.5l6 1.2-4.2 4.2 4.5 4.5-1.6 1.6-4.5-4.5L5.4 15 4.2 9z" /></svg>;
}
