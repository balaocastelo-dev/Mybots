import { UI_BASE } from "./api";
/**
 * Trabalhos feitos.
 *
 * Tudo que os bots produziram num lugar só, separado por tipo. A ideia é que ele
 * não precise caçar arquivo dentro de conversa antiga: entra aqui, escolhe o
 * tipo, e pega. Imagem e site mostram prévia; o resto mostra ícone, tamanho,
 * quem fez e quando.
 *
 * O botão "Abrir a pasta no Windows" copia tudo para a Área de Trabalho com
 * nome legível — no disco do Hub os arquivos têm o identificador colado no nome.
 */
import { useEffect, useMemo, useState } from "react";
import type { BotSummary } from "@mybots/shared";
import { Avatar } from "./avatar";

export type Trabalho = {
  id: string; nome: string; mime: string; tamanho: number; botId: string;
  quando: number; tipo: string; url: string;
};

const TIPOS: Array<{ id: string; nome: string; icone: string }> = [
  { id: "", nome: "Tudo", icone: "📦" },
  { id: "imagem", nome: "Imagens", icone: "🖼️" },
  { id: "video", nome: "Vídeos", icone: "🎬" },
  { id: "audio", nome: "Áudios", icone: "🎵" },
  { id: "pdf", nome: "PDFs", icone: "📕" },
  { id: "site", nome: "Sites HTML", icone: "🌐" },
  { id: "texto", nome: "Textos e .md", icone: "📝" },
  { id: "planilha", nome: "Planilhas", icone: "📊" },
  { id: "documento", nome: "Documentos", icone: "📄" },
  { id: "pacote", nome: "Zips", icone: "🗜️" },
  { id: "codigo", nome: "Código", icone: "⌨️" },
  { id: "outro", nome: "Outros", icone: "📎" },
];

const ICONE: Record<string, string> = Object.fromEntries(TIPOS.map((t) => [t.id, t.icone]));

function tamanhoLegivel(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

function quandoLegivel(ts: number) {
  const d = new Date(ts);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return mesmoDia ? `hoje ${hora}` : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hora}`;
}

export function Trabalhos({ bots, onClose, botInicial = "", embutido = false, filtroBotPadrao = false, onAbrirBot }: {
  bots: BotSummary[];
  onClose?: () => void;
  botInicial?: string;
  embutido?: boolean;
  /** Quando true (aba Trabalho do chat), começa filtrando o bot atual com toggle. */
  filtroBotPadrao?: boolean;
  onAbrirBot?: (botId: string) => void;
}) {
  const [itens, setItens] = useState<Trabalho[] | null>(null);
  const [contagem, setContagem] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [tipo, setTipo] = useState(() => { try { return localStorage.getItem("mybots.trab-tipo") ?? ""; } catch { return ""; } });
  const [soDesteBot, setSoDesteBot] = useState(() => {
    if (!filtroBotPadrao || !botInicial) return false;
    try {
      const v = localStorage.getItem("mybots.trab-so-bot");
      return v === null ? true : v === "1";
    } catch { return true; }
  });
  const [bot, setBot] = useState(() => (filtroBotPadrao && botInicial ? botInicial : ""));
  const [busca, setBusca] = useState("");
  const [recado, setRecado] = useState("");

  const carregar = async () => {
    const p = new URLSearchParams();
    if (tipo) p.set("tipo", tipo);
    if (bot) p.set("bot", bot);
    if (busca.trim()) p.set("q", busca.trim());
    const r = await fetch(`${UI_BASE}/api/trabalhos?` + p.toString());
    if (!r.ok) { setItens([]); return; }
    const d = await r.json();
    setItens(d.itens); setContagem(d.contagem ?? {}); setTotal(d.total ?? 0);
  };
  useEffect(() => {
    if (filtroBotPadrao) setBot(soDesteBot ? botInicial : "");
  }, [soDesteBot, botInicial, filtroBotPadrao]);
  useEffect(() => { void carregar(); }, [tipo, bot, busca]);
  useEffect(() => { try { localStorage.setItem("mybots.trab-tipo", tipo); } catch { /* privado */ } }, [tipo]);
  useEffect(() => { try { localStorage.setItem("mybots.trab-so-bot", soDesteBot ? "1" : "0"); } catch { /* privado */ } }, [soDesteBot]);

  const nomeDoBot = useMemo(() => {
    const m: Record<string, string> = { user: "você" };
    for (const b of bots) m[b.id] = b.name;
    return m;
  }, [bots]);

  const levarParaAPasta = async () => {
    setRecado("Copiando…");
    const r = await fetch(`${UI_BASE}/api/trabalhos/pasta`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tipo: tipo || undefined, abrir: true }),
    });
    const d = await r.json().catch(() => ({}));
    setRecado(r.ok ? `${d.copiados} copiados para ${d.pasta}${d.pulados ? ` · ${d.pulados} já estavam lá` : ""}` : (d.error ?? "não deu"));
    setTimeout(() => setRecado(""), 9000);
  };

  return (
    <div className={"trabalhos" + (embutido ? " embutido" : "")}>
      <header className="trab-head">
        <div>
          <h2>📂 Trabalho</h2>
          <small>{total} {total === 1 ? "arquivo" : "arquivos"}{soDesteBot && botInicial ? " deste bot" : " de todos os bots"}</small>
        </div>
        <div className="trab-acoes">
          <button className="btn primary" onClick={() => void levarParaAPasta()} title="Copia com nome legível para a Área de Trabalho e abre a pasta">
            📁 Abrir a pasta no Windows
          </button>
          {onClose && <button className="link" onClick={onClose}>fechar</button>}
        </div>
      </header>

      {recado && <div className="trab-recado">{recado}</div>}

      <div className="trab-filtros">
        {filtroBotPadrao && botInicial && (
          <button
            type="button"
            className={"trab-tipo" + (soDesteBot ? " on" : "")}
            aria-pressed={soDesteBot}
            onClick={() => setSoDesteBot((v) => !v)}
            title="Mostra só os arquivos produzidos pelo bot desta conversa"
          >
            Trabalhos desse bot
          </button>
        )}
        {TIPOS.map((t) => {
          const n = t.id ? (contagem[t.id] ?? 0) : total;
          if (t.id && !n) return null;
          return (
            <button key={t.id} type="button" className={"trab-tipo" + (tipo === t.id ? " on" : "")} aria-pressed={tipo === t.id} onClick={() => setTipo(t.id)}>
              <span aria-hidden="true">{t.icone}</span> {t.nome} <b>{n}</b>
            </button>
          );
        })}
        <select value={bot} onChange={(e) => setBot(e.target.value)} className="trab-bot">
          <option value="">Qualquer bot</option>
          {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input className="trab-busca" placeholder="Buscar pelo nome…" aria-label="Buscar trabalho pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {itens === null && <div className="hint">Carregando…</div>}
      {itens?.length === 0 && (
        <div className="trab-vazio">
          <span className="trab-vazio-icone" aria-hidden>📂</span>
          <p>Nada aqui ainda{tipo || bot || busca ? " com esse filtro" : ""}. O que os bots gerarem — imagem, vídeo, PDF, .md, zip, página — aparece nesta tela sozinho.</p>
        </div>
      )}

      <div className="trab-grade">
        {itens?.map((f) => (
          <figure key={f.id} className="trab-item">
            <a className="trab-previa" href={f.url} target="_blank" rel="noopener" title={`Abrir ${f.nome}`}>
              {f.tipo === "imagem"
                ? <img src={f.url} alt={f.nome} loading="lazy" />
                : f.tipo === "video"
                  ? <video src={f.url} preload="metadata" muted />
                  : <span className="trab-icone" aria-hidden="true">{ICONE[f.tipo] ?? "📎"}</span>}
            </a>
            <figcaption>
              <b title={f.nome}>{f.nome}</b>
              <small>{quandoLegivel(f.quando)} · {tamanhoLegivel(f.tamanho)}</small>
              <div className="trab-origem">
                {bots.find((b) => b.id === f.botId) ? <Avatar bot={bots.find((b) => b.id === f.botId)!} size={18} /> : <span className="trab-vazio-icone" aria-hidden style={{ fontSize: 18 }}>📎</span>}
                <span>{nomeDoBot[f.botId] ?? f.botId}</span>
                {onAbrirBot && f.botId && f.botId !== "user" && <button type="button" className="link" onClick={() => onAbrirBot(f.botId)}>Ver conversa</button>}
              </div>
              <div className="trab-botoes">
                <a className="btn fraco" href={f.url} download={f.nome}>Baixar</a>
                <a className="btn fraco" href={f.url} target="_blank" rel="noopener">Abrir</a>
                <button className="btn fraco" onClick={() => void navigator.clipboard?.writeText(location.origin + f.url)}>Copiar link</button>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

