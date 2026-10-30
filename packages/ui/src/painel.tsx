// ---------------------------------------------------------------------------
// Peças do painel que vieram do app de celular (Grok Bot), analisadas no vídeo
// de 30/10: preferências de lista (fixar, esconder, seção, apelido), o rodapé
// "Mensageou N bots" embaixo da resposta, a folha "Abrir troca com" e a
// conversa entre bots em SOMENTE LEITURA.
//
// Por que somente leitura: a troca entre dois bots é o trabalho deles. O chefe
// precisa VER, não entrar no meio — se ele escrevesse ali, a conversa deixaria
// de ser entre eles e nenhum dos dois saberia com quem está falando.
//
// O `Avatar` chega por propriedade em vez de ser importado do App.tsx: o App
// importa este arquivo, então importar de volta fecharia um ciclo.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import type { BotSummary, StoredMessage } from "@mybots/shared";

export type Troca = { conversationId: string; outro: string; nome: string; quantas: number; ultima: number };
export type PrefDoBot = { fixado?: boolean; escondido?: boolean; secao?: string; apelido?: string };
export type AvatarComp = (p: { bot: BotSummary; size?: number }) => JSX.Element;

const api = (path: string, init?: RequestInit) =>
  fetch(`/api${path}${location.search}`, { headers: { "content-type": "application/json" }, ...init });

// ---------------------------------------------------------------------------
// Preferências de lista. Ficam no Hub (não no navegador) para o celular e o PC
// mostrarem a mesma lista.
// ---------------------------------------------------------------------------

export function usePainelPrefs() {
  const [prefs, setPrefs] = useState<Record<string, PrefDoBot>>({});
  const [secoes, setSecoes] = useState<string[]>([]);

  const recarregar = async () => {
    try {
      const r = await api("/painel/prefs");
      if (!r.ok) return;
      const d = (await r.json()) as { bots: Record<string, PrefDoBot>; secoes: string[] };
      setPrefs(d.bots ?? {});
      setSecoes(d.secoes ?? []);
    } catch { /* painel velho ou hub reiniciando: segue com o que tem */ }
  };
  useEffect(() => { void recarregar(); }, []);

  const salvar = async (botId: string, patch: PrefDoBot) => {
    // otimista: a lista reage na hora e o Hub confirma depois
    setPrefs((p) => ({ ...p, [botId]: { ...(p[botId] ?? {}), ...patch } }));
    const r = await api(`/painel/prefs/${encodeURIComponent(botId)}`, { method: "POST", body: JSON.stringify(patch) });
    if (!r.ok) void recarregar();
  };
  const criarSecao = async (nome: string) => {
    const r = await api("/painel/secoes", { method: "POST", body: JSON.stringify({ nome }) });
    if (r.ok) { const d = await r.json(); setSecoes(d.secoes ?? []); }
  };
  const apagarSecao = async (nome: string) => {
    const r = await api(`/painel/secoes/${encodeURIComponent(nome)}`, { method: "DELETE" });
    if (r.ok) { const d = await r.json(); setSecoes(d.secoes ?? []); void recarregar(); }
  };

  return { prefs, secoes, salvar, criarSecao, apagarSecao, recarregar };
}

/** Nome que aparece na tela: o apelido do chefe ganha do nome do bot. */
export const nomeNaTela = (b: BotSummary, prefs: Record<string, PrefDoBot>) => prefs[b.id]?.apelido || b.name;

// ---------------------------------------------------------------------------
// Rodapé "Mensageou N bots" — embaixo da resposta, como no app.
// ---------------------------------------------------------------------------

export function ChipTrocas({ trocas, bots, Avatar, onAbrir }: {
  trocas: Troca[]; bots: BotSummary[]; Avatar: AvatarComp; onAbrir: (t: Troca[]) => void;
}) {
  if (!trocas.length) return null;
  const total = trocas.reduce((s, t) => s + t.quantas, 0);
  const caras = trocas.slice(0, 4);
  return (
    <button className="chip-trocas" onClick={() => onAbrir(trocas)}
      title={"Ver a conversa com " + trocas.map((t) => t.nome).join(", ")}>
      <span className="pilha">
        {caras.map((t) => {
          const b = bots.find((x) => x.id === t.outro);
          return b ? <span key={t.outro} className="pilha-um"><Avatar bot={b} size={36} /></span> : null;
        })}
      </span>
      <span>
        {total === 1 ? "Mensageou" : `${total} mensagens com`}{" "}
        {trocas.length === 1 ? trocas[0].nome : `${trocas.length} bots`}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Folha "Abrir troca com" — sobe de baixo, igual à do app.
// ---------------------------------------------------------------------------

export function FolhaAbrirTroca({ trocas, bots, Avatar, onEscolher, onFechar }: {
  trocas: Troca[]; bots: BotSummary[]; Avatar: AvatarComp;
  onEscolher: (t: Troca) => void; onFechar: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onFechar]);
  return (
    <div className="folha-bg" onClick={onFechar}>
      <div className="folha" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Abrir troca com">
        <div className="folha-alca" aria-hidden="true" />
        <div className="folha-titulo">Abrir troca com</div>
        {trocas.map((t) => {
          const b = bots.find((x) => x.id === t.outro);
          return (
            <button key={t.conversationId} className="folha-item" onClick={() => { onEscolher(t); onFechar(); }}>
              {b ? <Avatar bot={b} size={60} /> : <span className="folha-sem-avatar" />}
              <span className="folha-nome">{t.nome}</span>
              <span className="folha-contagem">{t.quantas}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A conversa entre dois bots, em somente leitura.
// ---------------------------------------------------------------------------

export function TrocaEntreBots({ conversationId, bots, Avatar, onFechar }: {
  conversationId: string; bots: BotSummary[]; Avatar: AvatarComp; onFechar: () => void;
}) {
  const [msgs, setMsgs] = useState<StoredMessage[]>([]);
  const [carregando, setCarregando] = useState(true);
  const fim = useRef<HTMLDivElement>(null);

  const ids = conversationId.replace(/^pair:/, "").split(":");
  const a = bots.find((b) => b.id === ids[0]);
  const b = bots.find((x) => x.id === ids[1]);

  const buscar = async () => {
    try {
      const r = await api(`/conversations/${encodeURIComponent(conversationId)}/messages?limit=300`);
      if (r.ok) setMsgs((await r.json()) as StoredMessage[]);
    } finally { setCarregando(false); }
  };
  useEffect(() => {
    void buscar();
    // eles continuam conversando enquanto a tela está aberta
    const t = setInterval(() => void buscar(), 4000);
    return () => clearInterval(t);
  }, [conversationId]);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);

  return (
    <>
      <header className="chat-head">
        <button className="icon-btn" onClick={onFechar} title="Voltar">←</button>
        <span className="dupla">
          {a && <Avatar bot={a} size={60} />}
          {b && <Avatar bot={b} size={60} />}
        </span>
        <div className="chat-title">
          <b>{[a?.name ?? ids[0], b?.name ?? ids[1]].join(" e ")}</b>
          <small><span className="sub-texto">conversa entre bots</span></small>
        </div>
      </header>

      <div className="messages troca-lista">
        {carregando && !msgs.length && <div className="hint">abrindo a conversa…</div>}
        {!carregando && !msgs.length && <div className="hint">Eles ainda não trocaram nenhuma mensagem.</div>}
        {msgs.map((m) => {
          const quem = bots.find((x) => x.id === m.sender.id);
          const daEsquerda = m.sender.id === ids[0];
          return (
            <div key={m.id} className={"msg troca-msg " + (daEsquerda ? "esq" : "dir")}>
              <div className="troca-quem">{quem && <Avatar bot={quem} size={40} />}<b>{m.sender.name}</b>
                <time>{new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time>
              </div>
              <div className="bubble troca-bolha">{m.text}</div>
            </div>
          );
        })}
        <div ref={fim} />
      </div>

      <footer className="composer somente-leitura">🔒 Somente leitura</footer>
    </>
  );
}

// ---------------------------------------------------------------------------
// Caixinha de texto para "Renomear bot" e "Nova Seção".
// ---------------------------------------------------------------------------

export function DialogoTexto({ titulo, rotulo, valor, placeholder, onOk, onFechar }: {
  titulo: string; rotulo?: string; valor?: string; placeholder?: string;
  onOk: (v: string) => void; onFechar: () => void;
}) {
  const [v, setV] = useState(valor ?? "");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal estreito" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head"><b>{titulo}</b><button className="link" onClick={onFechar}>fechar</button></div>
        {rotulo && <p className="dialogo-rotulo">{rotulo}</p>}
        <input ref={ref} className="search" value={v} placeholder={placeholder}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && v.trim()) { onOk(v.trim()); onFechar(); }
            if (e.key === "Escape") onFechar();
          }} />
        <div className="dialogo-botoes">
          <button className="link" onClick={onFechar}>Cancelar</button>
          <button className="btn" disabled={!v.trim()} onClick={() => { onOk(v.trim()); onFechar(); }}>Salvar</button>
        </div>
      </div>
    </div>
  );
}
