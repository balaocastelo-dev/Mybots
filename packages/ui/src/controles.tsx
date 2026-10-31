import { useEffect, useRef, useState } from "react";
import type { ControlMode, ControlState } from "@mybots/shared";
import { CONTROL_DESCRIPTIONS, CONTROL_LABELS, CONTROL_MODES } from "@mybots/shared";
import { api } from "./api";

// ---------------- automode: níveis de controle ----------------

/** Pede para digitar DEUS antes de ligar o MODO DEUS EXTREMO. */
export function confirmDeus(): boolean {
  const typed = prompt(`MODO DEUS EXTREMO: os bots vão fazer TUDO sozinhos, sem pedir aprovação nem fazer perguntas, mesmo com riscos.\n\n${CONTROL_DESCRIPTIONS.deus}\n\nDigite DEUS para confirmar:`);
  return typed?.trim().toUpperCase() === "DEUS";
}

/** Seletor global no cabeçalho da sidebar: "Por bot" ou um nível que vale para todos. */
export function GlobalControl({ control }: { control: ControlState }) {
  const [msg, setMsg] = useState("");
  const set = async (value: string) => {
    const g = value === "" ? null : (value as ControlMode);
    if (g === "deus" && !confirmDeus()) return;
    setMsg("…");
    const r = await api("/control", { method: "PUT", body: JSON.stringify({ global: g, confirm: g === "deus" ? "DEUS" : undefined }) });
    setMsg(r.ok ? "" : (await r.json()).error ?? "falhou");
  };
  const cur = control.global ?? "";
  return (
    <div className={"control-bar" + (control.global ? " mode-" + control.global : "")} title={control.global ? CONTROL_DESCRIPTIONS[control.global] : "Cada bot usa o nível configurado nele (⚙️ do bot)."}>
      <label>Controle</label>
      <select value={cur} onChange={(e) => void set(e.target.value)}>
        <option value="">Por bot</option>
        {CONTROL_MODES.map((m) => <option key={m} value={m}>{CONTROL_LABELS[m]}</option>)}
      </select>
      {msg && <small className="err">{msg}</small>}
    </div>
  );
}

/**
 * Aviso que some sozinho em 3 segundos e tem X para fechar na hora.
 * Com o mouse em cima ele espera: aviso que foge no meio da leitura é tão
 * ruim quanto aviso que nunca sai. O relógio reinicia quando o mesmo aviso
 * se repete (o contador sobe no lugar de nascer outro cartão).
 */
export function Aviso({ quem, texto, vezes, em, onFechar }: { quem: string; texto: string; vezes: number; em: number; onFechar: () => void }) {
  const [parado, setParado] = useState(false);
  const fechar = useRef(onFechar);
  fechar.current = onFechar;
  useEffect(() => {
    if (parado) return;
    const t = setTimeout(() => fechar.current(), 3000);
    return () => clearTimeout(t);
  }, [parado, em, vezes]);
  return (
    <div className="toast" onMouseEnter={() => setParado(true)} onMouseLeave={() => setParado(false)}>
      <div className="toast-texto" onClick={() => fechar.current()}>
        <b>{quem}</b> {texto}{vezes > 1 ? ` (${vezes}x)` : ""}
      </div>
      <button className="toast-x" title="Fechar" aria-label="Fechar aviso" onClick={() => fechar.current()}>×</button>
    </div>
  );
}

export function notify(title: string, body: string) {
  try { if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body: body.slice(0, 200) }); } catch {}
}
