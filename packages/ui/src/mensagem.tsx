import { useEffect, useRef, useState } from "react";
import type { PendingApproval, PendingQuestion, StoredMessage } from "@mybots/shared";
import { useToqueLongo } from "./ContextMenu";
import type { ToolInfo } from "./hub";

/** Raciocínio do modelo: letra de máquina atrás de um vidro azul, fechado por padrão.
 *  Nunca é lido em voz alta — a fala usa só a resposta. */
export function Thought({ text }: { text: string }) {
  const [aberto, setAberto] = useState(false);
  const linhas = text.split("\n").filter((l) => l.trim());
  const PREVIA = 4;
  const resto = linhas.length - PREVIA;
  const mostrar = aberto ? linhas : linhas.slice(0, PREVIA);
  return (
    <div className={"thought" + (aberto ? " aberto" : "")} onClick={() => setAberto(!aberto)}
      title={aberto ? "Clique para fechar o raciocínio" : "Clique para ver o raciocínio"}>
      <div className="thought-cabeca">💭 pensando<span>{aberto ? "fechar" : "abrir"}</span></div>
      <pre>{mostrar.join("\n")}{!aberto && resto > 0 ? `\n… (${resto} ${resto === 1 ? "linha" : "linhas"} a mais)` : ""}</pre>
    </div>
  );
}

export function Message({ m, tools, answer, showName, onSpeak, onAbrirArquivo, onMenu, editando, onSalvarEdicao, onCancelarEdicao }: { m: StoredMessage; tools?: ToolInfo[]; answer?: string; showName: boolean; onSpeak?: () => void; onAbrirArquivo?: (f: ArquivoDoChat) => void; onMenu?: (m: StoredMessage, x: number, y: number) => void; editando?: boolean; onSalvarEdicao?: (texto: string) => void; onCancelarEdicao?: () => void }) {
  if (m.sender.kind === "system" && !m.sender.id.startsWith("routine:")) return <div className={"sys" + (m.meta?.error ? " err" : "")}>{m.text}</div>;
  const mine = m.sender.kind === "user" && m.sender.id === "user";
  const files = (m.meta?.files as Array<{ id: string; name: string; url: string; mime: string }> | undefined) ?? [];
  const routine = m.sender.id.startsWith("routine:");
  const toqueLongo = useToqueLongo((x, y) => onMenu?.(m, x, y));
  if (editando) return <EdicaoDoPedido m={m} onSalvar={onSalvarEdicao!} onCancelar={onCancelarEdicao!} />;
  return (
    <div className={"msg " + (m.meta?.marcador ? "marcador" : mine ? "mine" : "theirs")}
      onContextMenu={(e) => { if (!onMenu || e.shiftKey) return; e.preventDefault(); onMenu(m, e.clientX, e.clientY); }}
      {...(onMenu ? toqueLongo : {})}>
      {tools?.length ? <div className="tools">{tools.map((t) => <ToolChip key={t.callId} t={t} />)}</div> : null}
      {(m.text || files.length) ? (
        <div className={"bubble" + (m.meta?.notify ? " notify" : "") + (routine ? " routine" : "")}>
          {(showName && !mine) || routine || (m.sender.kind === "user" && !mine) ? <div className="who">{routine ? "⏰ " : ""}{m.sender.name}</div> : null}
          {m.meta?.thought ? <Thought text={String(m.meta.thought)} /> : null}
          <Markdownish text={m.text} />
          {files.map((f) => <Arquivo key={f.id} f={f} onAbrir={onAbrirArquivo} />)}
          {answer && <div className="answered">Você respondeu: <b>{answer}</b></div>}
          {onSpeak && m.text ? <button className="speak-btn" title="Ler a mensagem inteira em voz alta" onClick={onSpeak}>🔊</button> : null}
          {onMenu && (
            <button className="msg-menu-btn" title="Opções desta mensagem"
              onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onMenu(m, r.left, r.bottom); }}>⋯</button>
          )}
          <time>{m.pinned ? "📌 " : ""}{m.meta?.interrompido ? "interrompido · " : ""}{m.editOf ? "editado · " : ""}{new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time>
        </div>
      ) : null}
    </div>
  );
}

/** A bolha vira caixa de texto no lugar. Enter manda, Shift+Enter quebra linha, Esc desiste. */
export function EdicaoDoPedido({ m, onSalvar, onCancelar }: { m: StoredMessage; onSalvar: (t: string) => void; onCancelar: () => void }) {
  const [texto, setTexto] = useState(m.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.setSelectionRange(texto.length, texto.length); }, []);
  return (
    <div className="msg mine editando">
      <div className="bubble">
        <textarea ref={ref} value={texto} rows={Math.min(10, texto.split("\n").length + 1)}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); onCancelar(); }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (texto.trim()) onSalvar(texto.trim()); }
          }} />
        <div className="card-actions">
          <button className="btn primary" disabled={!texto.trim()} onClick={() => onSalvar(texto.trim())}>Enviar de novo</button>
          <button className="btn" onClick={onCancelar}>Cancelar</button>
          <span className="hint-inline">o que veio depois deste pedido sai da conversa</span>
        </div>
      </div>
    </div>
  );
}

/** O bichinho que fica trabalhando: uma estrela gorda que muda de forma sem
 *  parar, como a do app que o chefe quis copiar.
 *
 *  POR QUE ASSIM E NAO COM TRES DESENHOS TROCANDO: a primeira versão era três
 *  caminhos aparecendo e sumindo por opacidade — dava um piscado no ponto da
 *  troca e não parecia um loop, parecia um corte. Aqui é UM caminho só, e o
 *  próprio navegador interpola a forma de um estado ao outro. Todas as formas
 *  têm o mesmo número de pontos (é por isso que a interpolação funciona) e a
 *  última é igual à primeira, então a volta é invisível: dá loop de verdade.
 */
export const CENTRO = 50;

/** Caminho fechado e redondo a partir de N raios. Catmull-Rom virando Bézier:
 *  os pontos ficam com curva suave e sem bico. */
export function caminhoDaBolha(raios: number[]): string {
  const n = raios.length;
  const ponto = (k: number): [number, number] => {
    const i = ((k % n) + n) % n;
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [CENTRO + Math.cos(a) * raios[i], CENTRO + Math.sin(a) * raios[i]];
  };
  const nd = (v: number) => v.toFixed(2);
  let d = "";
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ponto(i), [x1, y1] = ponto(i + 1);
    const [xa, ya] = ponto(i - 1), [xb, yb] = ponto(i + 2);
    const c1x = x0 + (x1 - xa) / 6, c1y = y0 + (y1 - ya) / 6;
    const c2x = x1 - (xb - x0) / 6, c2y = y1 - (yb - y0) / 6;
    if (i === 0) d += `M${nd(x0)} ${nd(y0)}`;
    d += `C${nd(c1x)} ${nd(c1y)} ${nd(c2x)} ${nd(c2y)} ${nd(x1)} ${nd(y1)}`;
  }
  return d + "Z";
}

// Oito raios por forma — estrela cheia, estrela magra, estrela virada, bolha
// gorda — e a quinta é a cópia da primeira, para fechar a volta.
export const FORMAS = [
  [44, 19, 44, 19, 44, 19, 44, 19],
  [40, 25, 46, 16, 38, 27, 45, 18],
  [21, 43, 18, 45, 22, 42, 17, 44],
  [46, 20, 36, 29, 44, 22, 38, 26],
  [33, 33, 33, 33, 33, 33, 33, 33],
];
export const PASSOS = [...FORMAS, FORMAS[0]].map(caminhoDaBolha).join(";");

export function Bolha({ size = 40 }: { size?: number }) {
  return (
    <svg className="bolha" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <path d={caminhoDaBolha(FORMAS[0])}>
        <animate attributeName="d" dur="5.4s" repeatCount="indefinite" values={PASSOS}
          calcMode="spline" keyTimes="0;0.2;0.4;0.6;0.8;1"
          keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1" />
      </path>
    </svg>
  );
}

export type ArquivoDoChat = { id: string; name: string; url: string; mime: string };

export const ehPdf = (f: ArquivoDoChat) => f.mime === "application/pdf" || /\.pdf$/i.test(f.name);
export const ehImagem = (f: ArquivoDoChat) => f.mime.startsWith("image/");
export const ehVideo = (f: ArquivoDoChat) => f.mime.startsWith("video/");
export const ehAudio = (f: ArquivoDoChat) => f.mime.startsWith("audio/");

/** Um arquivo dentro da conversa. Documento se vê, não se clica para ver:
 *  o PDF já aparece aberto na primeira página, a imagem já aparece. Link solto
 *  obriga o chefe a abrir outra janela só para saber o que o bot mandou. */
export function Arquivo({ f, onAbrir }: { f: ArquivoDoChat; onAbrir?: (f: ArquivoDoChat) => void }) {
  const src = f.url + location.search;
  const abrir = () => onAbrir?.(f);
  if (ehImagem(f)) {
    return (
      <figure className="arq imagem" onClick={abrir} title="Abrir em tamanho cheio">
        <img src={src} alt={f.name} />
        <figcaption>{f.name}</figcaption>
      </figure>
    );
  }
  if (ehPdf(f)) {
    return (
      <div className="arq pdf">
        <div className="arq-previa" onClick={abrir} title="Abrir o documento inteiro">
          <iframe src={`${src}#toolbar=0&navpanes=0&view=FitH`} title={f.name} tabIndex={-1} />
          <div className="arq-capa" />
        </div>
        <div className="arq-pe">
          <span className="arq-nome" title={f.name}>{f.name}</span>
          <button className="btn" onClick={abrir}>Abrir</button>
          <a className="btn fraco" href={src} download={f.name}>Baixar</a>
        </div>
      </div>
    );
  }
  if (ehVideo(f)) return (
    <div className="arq video">
      <video src={src} controls preload="metadata" />
      <div className="arq-pe">
        <span className="arq-nome" title={f.name}>{f.name}</span>
        <a className="btn fraco" href={src} download={f.name}>Baixar</a>
      </div>
    </div>
  );
  if (ehAudio(f)) return <div className="arq audio"><audio src={src} controls preload="metadata" /><div className="arq-pe"><span className="arq-nome">{f.name}</span></div></div>;
  return <div className="arq outro"><a href={src} target="_blank" rel="noopener">📎 {f.name}</a></div>;
}

/** Tela cheia: o PDF com as miniaturas e a busca do próprio navegador, a imagem
 *  inteira. Esc fecha, clicar no fundo fecha. */
export function Visualizador({ f, onFechar }: { f: ArquivoDoChat; onFechar: () => void }) {
  const src = f.url + location.search;
  useEffect(() => {
    const t = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", t);
    return () => window.removeEventListener("keydown", t);
  }, [onFechar]);
  return (
    <div className="visor-fundo" onClick={onFechar}>
      <div className="visor" onClick={(e) => e.stopPropagation()}>
        <header>
          <span className="visor-nome" title={f.name}>{f.name}</span>
          <a className="btn fraco" href={src} download={f.name}>Baixar</a>
          <a className="btn fraco" href={src} target="_blank" rel="noopener">Nova aba</a>
          <button className="btn" onClick={onFechar}>Fechar</button>
        </header>
        <div className="visor-corpo">
          {ehImagem(f) ? <img src={src} alt={f.name} />
            : ehVideo(f) ? <video src={src} controls autoPlay />
            : ehAudio(f) ? <audio src={src} controls autoPlay />
            : <iframe src={src} title={f.name} />}
        </div>
      </div>
    </div>
  );
}

export function ToolChip({ t }: { t: ToolInfo }) {
  const [open, setOpen] = useState(false);
  const label = t.tool.replace(/^mybots(-local)?_/, "");
  return (
    <div className={"tool" + (t.done ? (t.ok === false ? " fail" : " ok") : " running")} onClick={() => setOpen(!open)}>
      <span className="tool-head">{t.done ? (t.ok === false ? "✖" : "✔") : "⏳"} {label} {!open && t.input ? <em>{summarize(t.input)}</em> : null}</span>
      {open && (
        <div className="tool-body">
          {t.input !== undefined && <pre>{typeof t.input === "string" ? t.input : JSON.stringify(t.input, null, 2)}</pre>}
          {t.output !== undefined && <pre className="out">{t.output}</pre>}
        </div>
      )}
    </div>
  );
}

export function summarize(input: unknown): string {
  if (typeof input === "string") return input.slice(0, 80);
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    const v = o.command ?? o.path ?? o.url ?? o.question ?? o.text ?? o.bot ?? o.action ?? o.key ?? o.name ?? Object.values(o)[0];
    return String(v ?? "").slice(0, 80);
  }
  return "";
}

export function ApprovalCard({ a, botName, onAnswer }: { a: PendingApproval; botName?: string; onAnswer: (allow: boolean, remember?: boolean) => void }) {
  const cmd = (a.input as any)?.command ?? (a.input as any)?.patterns?.join("\n") ?? (a.input as any)?.detail;
  const showCmd = cmd && !a.description.includes(String(cmd));
  return (
    <div className={"card approval risk-" + a.risk}>
      <div className="card-title">🔐 Permitir que {botName ?? "o bot"} execute?</div>
      <div className="card-desc">{a.description}</div>
      {showCmd && <pre>{String(cmd)}</pre>}
      <div className="card-meta">ferramenta {a.tool} · risco {{ low: "baixo", medium: "médio", high: "ALTO" }[a.risk]}</div>
      <div className="card-actions">
        <button className="btn primary" onClick={() => onAnswer(true)}>Permitir</button>
        {a.tool === "run_command" || a.tool === "bash" ? <button className="btn" onClick={() => onAnswer(true, true)}>Permitir sempre</button> : null}
        <button className="btn danger" onClick={() => onAnswer(false)}>Negar</button>
      </div>
    </div>
  );
}

/** Cartão de ação: o bot travou e deixou o caminho pronto. Em vez de devolver o
 *  problema cru ("deu erro"), ele diz o que já preparou e o chefe destrava num
 *  toque. Título à esquerda, "Pular" discreto à direita, botão principal cheio. */
export function CartaoDeAcaoCard({ q, botName, onAnswer }: { q: PendingQuestion; botName?: string; onAnswer: (a: string) => void }) {
  const c = q.cartao!;
  const principal = c.botao || "Terminei";
  return (
    <div className="card acao">
      <div className="acao-topo">
        <span className="acao-titulo">{c.titulo}</span>
        <button className="acao-pular" onClick={() => onAnswer("Pular")}>Pular</button>
      </div>
      <div className="acao-texto">{q.question}</div>
      <div className="acao-botoes">
        <button className="btn primario" onClick={() => onAnswer(principal)}>{principal}</button>
      </div>
      {botName && <div className="acao-quem">{botName} está esperando</div>}
    </div>
  );
}

export function QuestionCard({ q, botName, onAnswer }: { q: PendingQuestion; botName?: string; onAnswer: (a: string) => void }) {
  const [custom, setCustom] = useState("");
  if (q.cartao) return <CartaoDeAcaoCard q={q} botName={botName} onAnswer={onAnswer} />;
  return (
    <div className="card question">
      <div className="card-title">❓ {botName ?? "O bot"} precisa da sua resposta</div>
      <div className="card-desc">{q.question}</div>
      <div className="card-actions wrap">
        {q.options.map((o) => <button key={o} className="btn option" onClick={() => onAnswer(o)}>{o}</button>)}
      </div>
      <div className="card-custom">
        <input placeholder="Ou responda com suas palavras…" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && custom.trim()) onAnswer(custom.trim()); }} />
        <button className="btn" disabled={!custom.trim()} onClick={() => onAnswer(custom.trim())}>Enviar</button>
      </div>
    </div>
  );
}

export const CRON_PRESETS: Array<[string, string]> = [["Todo dia às 8h", "0 8 * * *"], ["Segunda a sexta às 9h", "0 9 * * 1-5"], ["Segundas às 8h", "0 8 * * 1"], ["A cada hora", "0 * * * *"], ["A cada 30 min", "*/30 * * * *"], ["Sexta às 18h", "0 18 * * 5"]];

/** Render mínimo de markdown: blocos de código, negrito, itálico, links, listas e quebras de linha. */
export function Markdownish({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <div className="md">
      {parts.map((p, i) => {
        if (p.startsWith("```")) return <pre key={i}>{p.replace(/^```\w*\n?/, "").replace(/```$/, "")}</pre>;
        return <span key={i} dangerouslySetInnerHTML={{ __html: inline(p) }} />;
      })}
    </div>
  );
}

export function inline(s: string): string {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|\s)\*([^*\n]+)\*/g, "$1<i>$2</i>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/^(\s*)[-•] (.*)$/gm, "$1• $2")
    .replace(/\n/g, "<br/>");
}
