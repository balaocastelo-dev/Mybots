import { useEffect, useRef, useState } from "react";
import type { BotSummary } from "@mybots/shared";
import { dmConversation } from "@mybots/shared";
import { api } from "./api";
import { Avatar } from "./avatar";
import type { PrefDoBot } from "./painel";

/** Menu do botão direito num bot da lista. Só mostra o que o Hub realmente sabe fazer. */
/** O que fazer com um arquivo trazido de fora: qual bot lê e para quê. */
export const IMPORT_ACTIONS = [
  { id: "ler", titulo: "Só ler e me resumir", desc: "O bot lê e responde o que é e para que serve.",
    texto: (n: string) => `Leia o arquivo anexo (${n}) inteiro e me diga em até 5 linhas: o que é, o que dá para fazer com isso e se vale a pena você guardar. Não instale nada ainda.` },
  { id: "skill", titulo: "Instalar como skill", desc: "Vira uma habilidade que ele passa a usar sozinho.",
    texto: (n: string) => `Leia o arquivo anexo (${n}) e INSTALE como skill sua: crie a pasta .opencode/skills/<nome-curto-em-minusculas>/ dentro do seu workspace e grave o conteúdo em SKILL.md. Se o arquivo não tiver frontmatter, acrescente no topo um bloco --- com name e description (uma linha dizendo quando usar). Depois confirme em 2 linhas o que você passou a saber fazer.` },
  { id: "alma", titulo: "Incorporar à alma", desc: "Entra na persona dele, muda como ele é e responde.",
    texto: (n: string) => `Leia o arquivo anexo (${n}) e incorpore à sua alma: acrescente ao seu persona.md o que for permanente sobre quem você é, como fala e o que valoriza. NÃO apague o que já está lá, só acrescente. Depois me diga em 2 linhas o que mudou em você.` },
] as const;

export function ImportDialog({ file, bots, onClose, onSend }: {
  file: { name: string; mime: string; dataBase64: string };
  bots: BotSummary[];
  onClose: () => void;
  onSend: (botId: string, text: string, file: { name: string; mime: string; dataBase64: string }) => void;
}) {
  const online = bots.filter((b) => b.online);
  const [botId, setBotId] = useState(online[0]?.id ?? bots[0]?.id ?? "");
  const [acao, setAcao] = useState<(typeof IMPORT_ACTIONS)[number]["id"]>("ler");
  const kb = Math.max(1, Math.round((file.dataBase64.length * 3) / 4 / 1024));
  const escolhida = IMPORT_ACTIONS.find((a) => a.id === acao)!;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Importar arquivo</h3>
        <p className="muted">📄 <b>{file.name}</b> · {kb} KB</p>
        {!bots.length ? <p>Nenhum bot cadastrado ainda.</p> : (
          <>
            <label>Qual bot deve ler?</label>
            <select value={botId} onChange={(e) => setBotId(e.target.value)}>
              {bots.map((b) => <option key={b.id} value={b.id} disabled={!b.online}>{b.name}{b.online ? "" : " (offline)"}</option>)}
            </select>
            <label>O que ele faz com isso?</label>
            <div className="import-acoes">
              {IMPORT_ACTIONS.map((a) => (
                <button key={a.id} className={"import-acao" + (acao === a.id ? " on" : "")} onClick={() => setAcao(a.id)}>
                  <b>{a.titulo}</b><small>{a.desc}</small>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!botId || !bots.find((b) => b.id === botId)?.online}
            onClick={() => onSend(botId, escolhida.texto(file.name), file)}>Enviar para o bot</button>
        </div>
      </div>
    </div>
  );
}

export function BotMenu({ bot, x, y, onClose, onOpen, onPanel, pref, secoes, onPref, onRenomear, onNovaSecao, onExcluir, onAparencia }: {
  bot: BotSummary; x: number; y: number; onClose: () => void;
  onOpen: (botId: string) => void; onPanel: (botId: string, panel: "settings" | "routines") => void;
  pref: PrefDoBot; secoes: string[];
  onPref: (p: PrefDoBot) => void; onRenomear: () => void; onNovaSecao: () => void; onExcluir: () => void; onAparencia: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [busy, setBusy] = useState("");
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
    el.focus();
  }, []);
  useEffect(() => {
    const close = () => onClose();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("resize", close); window.removeEventListener("blur", close); window.removeEventListener("keydown", key); };
  }, [onClose]);
  // Antes isto engolia a resposta: um 400 ou 401 do Hub virava "nada aconteceu" na
  // tela, e a gente ficou caçando no escuro um excluir que o servidor nem recebeu.
  const act = async (label: string, run: () => Promise<Response | unknown>) => {
    setBusy(label);
    try {
      const r = await run();
      if (r instanceof Response && !r.ok) {
        const erro = await r.json().catch(() => ({} as any));
        alert(`Não deu para ${label}: ${erro?.error ?? `o Hub respondeu ${r.status}`}`);
      }
    } catch (e) {
      alert(`Não deu para ${label}: ${(e as Error).message}`);
    }
    onClose();
  };
  const managed = !!bot.managed;
  return (
    <div className="ctx-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div ref={ref} className="ctx-menu" tabIndex={-1} style={{ left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()}>
        <div className="ctx-head"><Avatar bot={bot} size={56} /><div><b>{bot.name}</b><small>{bot.online ? (bot.busy ? bot.status + "…" : "Disponível") : "Offline"} · {bot.model ?? bot.provider}</small></div></div>
        <button onClick={() => { onOpen(bot.id); onClose(); }}>💬 Abrir conversa</button>
        <button onClick={() => { onPanel(bot.id, "settings"); onClose(); }}>✏️ Editar bot…</button>
        <button onClick={() => { onAparencia(); onClose(); }}>{"\uD83C\uDFA8"} Aparencia do bot...</button>
        <button onClick={() => { onPanel(bot.id, "routines"); onClose(); }}>⏰ Rotinas…</button>
        {(bot.unread ?? 0) > 0 && (
          <button onClick={() => void act("ler", () => api(`/conversations/${dmConversation(bot.id)}/read`, { method: "POST" }))}>✅ Marcar como lido</button>
        )}
        <button onClick={() => { void api(`/conversations/${dmConversation(bot.id)}/unread`, { method: "POST" }); onClose(); }}>🔵 Marcar como não lido</button>
        <hr />
        <button onClick={() => { onPref({ fixado: !pref.fixado }); onClose(); }}>📌 {pref.fixado ? "Desafixar" : "Fixar"}</button>
        <button onClick={() => { onNovaSecao(); onClose(); }}>🗂️ Nova Seção…</button>
        {secoes.length > 0 && (
          <div className="ctx-sub">
            <small>Mover para</small>
            {secoes.map((s) => (
              <button key={s} className={pref.secao === s ? "on" : ""}
                onClick={() => { onPref({ secao: pref.secao === s ? "" : s }); onClose(); }}>{pref.secao === s ? "✓ " : ""}{s}</button>
            ))}
          </div>
        )}
        <button onClick={() => { onRenomear(); onClose(); }}>✏️ Renomear bot…</button>
        <button onClick={() => { onPref({ escondido: !pref.escondido }); onClose(); }}>🚫 {pref.escondido ? "Mostrar" : "Esconder"}</button>
        <button onClick={() => { window.open(`/api/bots/${bot.id}/modelo${location.search}`, "_blank"); onClose(); }}>📤 Compartilhar como modelo</button>
        {bot.online && <>
          <hr />
          {/* Parar o trabalho é uma coisa; desligar o bot é outra. As duas valem só para
              ESTE bot — o do lado continua como estava. */}
          <button onClick={() => void act("parar", () => api(`/bots/${bot.id}/parar`, { method: "POST" }))}>⏹ Parar o que está fazendo</button>
        </>}
        {managed && <>
          {!bot.online && <hr />}
          {bot.online
            ? <button onClick={() => void act("desligar", () => api(`/managed/${bot.id}/stop`, { method: "POST" }))}>⏻ Desligar o bot</button>
            : <button onClick={() => void act("ligar", () => api(`/managed/${bot.id}/start`, { method: "POST" }))}>▶️ Ligar o bot</button>}
          <button onClick={() => void act("reiniciar", () => api(`/managed/${bot.id}/restart`, { method: "POST" }))}>🔄 Reiniciar</button>
        </>}
        <hr />
        <button onClick={() => { void navigator.clipboard?.writeText(bot.id); onClose(); }}>🏷️ Copiar ID</button>
        {managed && (
          <button className="danger" onClick={() => {
            // Nada de confirm() nativo: ele tira o foco da janela, o menu se desmonta
            // junto e o pedido morria no meio do caminho. Quem pergunta agora é o
            // próprio painel, com uma caixa que não depende do navegador.
            onClose();
            onExcluir();
          }}>🗑️ Excluir bot…</button>
        )}
        {busy && <div className="ctx-busy">{busy}…</div>}
      </div>
    </div>
  );
}
