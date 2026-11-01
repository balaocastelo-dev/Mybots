import { useMemo, useState, useEffect } from "react";
import type { BotSummary } from "@mybots/shared";
import { ArteDoBot, lerAparencia } from "./aparencia";
import { amebaV2Url, sortearAmebaV2 } from "./amebasV2";
import { caminhoDaBolha } from "./mensagem";

// ---------------------------------------------------------------------------
// Retrato do bot. Em vez de iniciais ou emoji, cada bot ganha um rosto
// desenhado a partir do próprio identificador: sempre o mesmo rosto para o
// mesmo bot, sem internet, sem arquivo, nítido em qualquer tamanho.
// Se o bot tiver uma foto (URL) ou um emoji escolhido, isso tem prioridade.
// ---------------------------------------------------------------------------

/** Números estáveis a partir de um texto (mesmo id = mesmo rosto, sempre). */
export function sorteios(id: string) {
  let h = 2166136261;
  for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  let x = h >>> 0;
  return (max: number) => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x % max; };
}

export const PELE = ["#f2d3b6", "#e8bd96", "#d19d72", "#b07a52", "#8a5a3b", "#6b4430"];
export const CABELO = ["#2b2118", "#4a2f1d", "#7b4a24", "#b5763b", "#d9ae6a", "#8c8c94", "#1f1b1b"];
export const ROUPA = ["#2b6cb0", "#2f855a", "#9b2c2c", "#4c51bf", "#2c7a7b", "#744210", "#4a5568", "#97266d"];
export const FUNDO = ["#dbeafe", "#dcfce7", "#fee2e2", "#ede9fe", "#ccfbf1", "#fef3c7", "#e2e8f0", "#fce7f3"];

/**
 * Tons da equipe inteira, repartidos de uma vez.
 *
 * Sortear a cor de cada bot em separado juntava dois vizinhos a 6 graus um do
 * outro — no olho, a mesma cor. Empurrar quem cai perto também não resolve: com
 * dez bots, cada um exigindo folga dos dois lados, a conta passa de 360 graus e o
 * último não acha lugar. Então os lugares são fixos e igualmente espaçados (com
 * dez bots, 36 graus entre vizinhos) e o sorteio só decide QUEM fica em qual —
 * pelo id, não pela ordem da tela, para a cor não dançar quando a lista se mexe.
 * O anel começa meio passo depois do vermelho do logo, que assim fica no maior
 * buraco possível entre dois bots.
 */
let TONS: Record<string, number> = {};
let versaoDosTons = 0;
export const TOM_DO_LOGO = 356;

export function definirTonsDaEquipe(ids: string[]) {
  const lista = [...new Set(ids)].sort();
  const novo: Record<string, number> = {};
  if (lista.length) {
    const passo = 360 / lista.length;
    const inicio = (TOM_DO_LOGO + passo / 2) % 360;
    lista
      .map((id) => ({ id, chave: sorteios(id + "#tom")(3600) }))
      .sort((a, b) => a.chave - b.chave || a.id.localeCompare(b.id))
      .forEach((x, i) => { novo[x.id] = Math.round((inicio + i * passo) % 360); });
  }
  const mudou = Object.keys(novo).length !== Object.keys(TONS).length
    || Object.keys(novo).some((id) => TONS[id] !== novo[id]);
  if (mudou) { TONS = novo; versaoDosTons++; }
}

/**
 * A ameba de um bot. Forma, cor, ritmo do loop e tempo da piscada saem todos do id:
 * dois bots nunca ficam iguais, e o mesmo bot é sempre o mesmo — dá para reconhecer
 * de longe, que é o ponto de ter avatar.
 */
export function amebaDe(id: string) {
  const r = sorteios(id);
  // O tom sai do id e anda pelos 360 graus do círculo: numa paleta fechada de 12
  // cores três bots da mesma lista saíam iguais. O logo da casa não sorteia nada:
  // é o vermelho da empresa.
  const tom = id === "mybots" ? TOM_DO_LOGO : TONS[id] ?? r(360);
  const clara = `hsl(${tom} 78% 62%)`;
  const escura = `hsl(${tom} 72% 34%)`;
  const gordura = 30 + r(7);
  const base = Array.from({ length: 8 }, () => gordura + r(9) - 4);
  const semente = r(100) / 10;
  // Os quadros são o mesmo corpo respirando, não formas sorteadas: por isso o loop
  // fica mole e contínuo em vez de pular de uma forma para outra.
  const formas = [0, 1, 2, 3].map((f) => base.map((v, i) => Math.max(18, v + Math.sin(semente + f * 1.9 + i * 2.3) * 5)));
  return {
    inicial: caminhoDaBolha(formas[0]),
    passos: [...formas, formas[0]].map(caminhoDaBolha).join(";"),
    dur: (6 + r(50) / 10).toFixed(1) + "s",
    atraso: (r(70) / 10).toFixed(1) + "s",
    clara,
    escura,
    olhar: r(5) - 2,
  };
}

/** Ameba com olhinhos. É o retrato de todo bot e também o logo da casa. */
export function Ameba({ id, size = 44 }: { id: string; size?: number }) {
  const a = useMemo(() => amebaDe(id), [id, versaoDosTons]);
  const grad = "ameba-" + id.replace(/[^a-zA-Z0-9_-]/g, "") ;
  return (
    <svg className="retrato ameba" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" style={{ display: "block", ["--atraso" as any]: a.atraso }}>
      <defs>
        <linearGradient id={grad} x1="0.1" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={a.clara} />
          <stop offset="1" stopColor={a.escura} />
        </linearGradient>
      </defs>
      <path d={a.inicial} fill={`url(#${grad})`}>
        <animate attributeName="d" dur={a.dur} repeatCount="indefinite" values={a.passos}
          calcMode="spline" keyTimes="0;0.25;0.5;0.75;1"
          keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1" />
      </path>
      {/* brilho: dá volume sem precisar de sombra */}
      <ellipse cx="37" cy="31" rx="9" ry="5.5" fill="#fff" opacity=".2" transform="rotate(-22 37 31)" />
      <g className="r-olhos">
        <ellipse cx="41" cy="45" rx="7.2" ry="7.6" fill="#fff" />
        <ellipse cx="59" cy="45" rx="7.2" ry="7.6" fill="#fff" />
        <circle cx={41 + a.olhar} cy="46" r="3.3" fill="#16202c" />
        <circle cx={59 + a.olhar} cy="46" r="3.3" fill="#16202c" />
        <circle cx={39.5 + a.olhar} cy="44.2" r="1.1" fill="#fff" opacity=".9" />
        <circle cx={57.5 + a.olhar} cy="44.2" r="1.1" fill="#fff" opacity=".9" />
      </g>
      <g className="r-boca">
        <path d="M44 57q6 5.5 12 0" stroke="#16202c" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".8" />
      </g>
    </svg>
  );
}

/** Retrato em SVG, desenhado na hora. */
export function Retrato({ id, size = 44 }: { id: string; size?: number }) {
  const r = sorteios(id);
  // Cada bot pisca no seu tempo. Nove rostos piscando juntos parecem um robô só.
  const atraso = (r(70) / 10).toFixed(1) + "s";
  const pele = PELE[r(PELE.length)];
  const cabelo = CABELO[r(CABELO.length)];
  const roupa = ROUPA[r(ROUPA.length)];
  const fundo = FUNDO[r(FUNDO.length)];
  const penteado = r(6);
  const olhos = r(3);
  const boca = r(4);
  const oculos = r(5) === 0;
  const barba = r(6) === 0;
  const sobrancelha = 36 + r(3);

  return (
    <svg className="retrato" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" style={{ display: "block", borderRadius: "50%", ["--atraso" as any]: atraso }}>
      <rect width="100" height="100" fill={fundo} />
      {/* ombros e colarinho: faz ler como retrato, não como bola */}
      <path d="M12 100c0-20 17-28 38-28s38 8 38 28z" fill={roupa} />
      <path d="M43 73l7 9 7-9-7-4z" fill="#fff" opacity=".9" />
      {/* orelhas */}
      <ellipse cx="27" cy="48" rx="4.5" ry="6" fill={pele} />
      <ellipse cx="73" cy="48" rx="4.5" ry="6" fill={pele} />
      {/* cabeça */}
      <path d="M50 16c-14 0-23 11-23 25 0 16 10 28 23 28s23-12 23-28c0-14-9-25-23-25z" fill={pele} />
      {/* cabelo */}
      {penteado === 0 && <path d="M27 40c0-15 10-24 23-24s23 9 23 24c0-8-10-12-23-12s-23 4-23 12z" fill={cabelo} />}
      {penteado === 1 && <path d="M26 42c-1-17 10-27 24-27s25 10 24 27c-2-11-7-16-12-13-6 4-18 4-24 0-5-3-10 2-12 13z" fill={cabelo} />}
      {penteado === 2 && <path d="M27 38c2-14 11-22 23-22s21 8 23 22c-3-9-9-14-14-11-5 3-13 3-18 0-5-3-11 2-14 11z" fill={cabelo} />}
      {penteado === 3 && <><path d="M27 41c0-16 10-25 23-25s23 9 23 25c-1-9-9-14-23-14s-22 5-23 14z" fill={cabelo} /><path d="M24 44c-2 12 0 22 4 27-5-9-5-21-4-27zM76 44c2 12 0 22-4 27 5-9 5-21 4-27z" fill={cabelo} /></>}
      {penteado === 4 && <path d="M28 36c4-13 11-20 22-20s18 7 22 20c-4-6-9-9-15-9-8 0-11 2-14 5-3 3-8 1-15 4z" fill={cabelo} />}
      {penteado === 5 && <><path d="M27 39c1-15 11-23 23-23s22 8 23 23c-2-10-10-15-23-15s-21 5-23 15z" fill={cabelo} /><circle cx="50" cy="13" r="6" fill={cabelo} /></>}
      {/* sobrancelhas */}
      <path d={`M38 ${sobrancelha}q5-2.5 10 0`} stroke={cabelo} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d={`M52 ${sobrancelha}q5-2.5 10 0`} stroke={cabelo} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      {/* olhos — no grupo, para a piscada fechar os dois juntos */}
      <g className="r-olhos">
        {olhos === 0 && <><circle cx="42" cy="45" r="2.6" fill="#2d3748" /><circle cx="58" cy="45" r="2.6" fill="#2d3748" /></>}
        {olhos === 1 && <><ellipse cx="42" cy="45" rx="3.2" ry="2.2" fill="#2d3748" /><ellipse cx="58" cy="45" rx="3.2" ry="2.2" fill="#2d3748" /></>}
        {olhos === 2 && <><path d="M39 45q3-3 6 0" stroke="#2d3748" strokeWidth="2.2" fill="none" strokeLinecap="round" /><path d="M55 45q3-3 6 0" stroke="#2d3748" strokeWidth="2.2" fill="none" strokeLinecap="round" /></>}
      </g>
      {/* nariz */}
      <path d="M50 48v5" stroke={pele} strokeWidth="2.4" strokeLinecap="round" opacity=".55" />
      {/* boca — no grupo, para mexer quando o bot fala */}
      <g className="r-boca">
        {boca === 0 && <path d="M44 57q6 5 12 0" stroke="#9b4a4a" strokeWidth="2.2" fill="none" strokeLinecap="round" />}
        {boca === 1 && <path d="M45 58h10" stroke="#9b4a4a" strokeWidth="2.2" fill="none" strokeLinecap="round" />}
        {boca === 2 && <ellipse cx="50" cy="58" rx="4" ry="2.6" fill="#9b4a4a" />}
        {boca === 3 && <path d="M44 57q6 4 12 0" stroke="#9b4a4a" strokeWidth="2" fill="none" strokeLinecap="round" />}
      </g>
      {/* barba */}
      {barba && <path d="M33 50c0 14 8 22 17 22s17-8 17-22c-2 10-8 15-17 15s-15-5-17-15z" fill={cabelo} opacity=".85" />}
      {/* óculos */}
      {oculos && <g stroke="#2d3748" strokeWidth="1.8" fill="none"><circle cx="42" cy="45" r="6.5" /><circle cx="58" cy="45" r="6.5" /><path d="M48.5 45h3M27 44l8.5 1M73 44l-8.5 1" /></g>}
    </svg>
  );
}

// O tamanho padrão vale para a lista da esquerda: o chefe pediu as amebas no dobro.
/** Um emoji só, no balão de pensamento, dizendo o que o bot faz AGORA.
 *  Sai do status curto que ele mesmo escreve com set_status ("Lendo o site",
 *  "Gravando o áudio"), então acompanha o trabalho de verdade em vez de ser um
 *  enfeite fixo. Sem status reconhecido e estando ocupado, fica o pensar genérico. */
export function emojiDoEstado(bot: BotSummary, falando: boolean): string | undefined {
  if (!bot.online) return "😴";
  if (falando) return "💬";
  const s = String((bot as any).status ?? "").toLowerCase();
  const tabela: [RegExp, string][] = [
    [/liga(ç|c)|chamada|telefone/, "📞"],
    [/grava|áudio|audio|v(í|i)deo|renderiz|edita/, "🎬"],
    [/naveg|site|página|pagina|chrome|web|link/, "🌐"],
    [/busca|pesquis|consult|procur/, "🔎"],
    [/lend|ler |estud|aprend|document|base de|memória|memoria/, "📚"],
    [/escrev|redig|rascunh|roteiro|texto/, "✍️"],
    [/cálcul|calcul|planilha|número|numero|relatório|relatorio|preço|preco/, "📊"],
    [/whatsapp|mensagem|e-?mail|enviand|postand|public/, "📨"],
    [/comando|terminal|instal|executa|rodando|compil/, "⚙️"],
    [/imagem|foto|desenh|arte|capa/, "🎨"],
    [/espera|aprova|aguard/, "✋"],
    [/pens|analis|racioc/, "💭"],
  ];
  for (const [re, e] of tabela) if (re.test(s)) return e;
  if (bot.busy) return "💭";
  // Parado tambem tem sinal: um bot sem balao nenhum parece desligado. Estes giram
  // devagar, so para a tela ter vida — nunca sugerem trabalho que nao esta havendo.
  return PARADO[Math.floor(Date.now() / 6000) % PARADO.length];
}
export const PARADO = ["👀", "🧠", "📋", "☕"];

export type AvatarAnim = "dormindo" | "nascer" | "chave-nova";

export function Avatar({ bot, size = 88, falando = false, cutucadas = 0, forceAnim }: { bot: BotSummary; size?: number; falando?: boolean; cutucadas?: number; forceAnim?: AvatarAnim | null }) {
  // So amebas v2 (PNG). Legado emoji/SVG/arte cai no sorteio estavel por id.
  const url = amebaV2Url(bot.id, bot.avatar) || sortearAmebaV2(bot.id);
  const style = { width: size, height: size, fontSize: size * 0.45, background: "transparent", position: "relative" as const };
  const bravo = cutucadas >= 5;
  const semToken = !!(bot as any).semToken
    || /429|quota|falha no modelo|rate.?limit|sem.?token|chave.*(esgot|recus|inv[aá]lid)|token.*(esgot|expir)/i.test(String(bot.status ?? ""));
  const doHub = (forceAnim ?? (bot as any).avatarAnim ?? null) as AvatarAnim | null;
  const [flash, setFlash] = useState<AvatarAnim | null>(null);
  useEffect(() => {
    if (doHub === "nascer" || doHub === "chave-nova") {
      setFlash(doHub);
      const ms = doHub === "nascer" ? 2600 : 1900;
      const t = window.setTimeout(() => setFlash(null), ms);
      return () => clearTimeout(t);
    }
    if (doHub === "dormindo" || semToken) setFlash("dormindo");
    else setFlash((f) => (f === "dormindo" ? null : f));
  }, [doHub, semToken, bot.id]);
  const animFinal: AvatarAnim | null = forceAnim ?? flash ?? (semToken ? "dormindo" : null);
  const estado = (!bot.online && !animFinal ? " dormindo" : falando ? " falando" : bot.busy ? " ocupado" : "")
    + (bravo ? " bravo" : cutucadas > 0 ? " cutucado" : "")
    + (animFinal === "dormindo" ? " anim-dormindo" : "")
    + (animFinal === "nascer" ? " anim-nascer" : "")
    + (animFinal === "chave-nova" ? " anim-chave" : "");
  return (
    <div className={"avatar" + estado} style={style} data-ameba={bot.id}>
      {animFinal === "nascer" && (<><span className="ovo-casca" aria-hidden /><span className="ovo-casca-baixo" aria-hidden /></>)}
      {animFinal === "chave-nova" && (<><i className="brilho" /><i className="brilho" /><i className="brilho" /><i className="brilho" /><i className="brilho" /></>)}
      <img src={url} alt="" />
      {((bot as any).gerente || (bot as any).manages?.length) ? <span className="coroa-cabeca" aria-hidden>👑</span> : null}
    </div>
  );
}

/** Previa do retrato no formulario: so ameba v2. */
export function RetratoPreview({ id, avatar, size = 56 }: { id: string; avatar?: string; size?: number }) {
  const url = amebaV2Url(id, avatar) || sortearAmebaV2(id || "novo");
  return <img className="retrato-previa" src={url} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }} />;
}

export function colorFor(id: string) {
  const palette = ["#0f766e", "#b45309", "#1d4ed8", "#7c3aed", "#be123c", "#15803d", "#0369a1", "#9333ea", "#c2410c"];
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
