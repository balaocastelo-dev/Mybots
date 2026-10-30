import { useState } from "react";
// ---------------------------------------------------------------------------
// A APARENCIA DOS BOTS
//
// Cem bots prontos, e um menu para montar o seu: corpo, cor, olhos, cabelo e
// roupa. Tres decisoes que vale explicar:
//
// 1. Nenhuma forma e desenhada a mao. Cada corpo e uma funcao de raio por
//    angulo, amostrada e costurada com Catmull-Rom. Por construcao a curva e
//    continua: estrela, triangulo e octogono saem GORDOS e sem ponta nenhuma,
//    que foi o pedido. Mexer num corpo e mexer numa linha de matematica.
// 2. A aparencia viaja dentro do campo "avatar" que o bot ja tinha, como um
//    codigo curto ("mb:12.3.4.5.6"). Nenhuma tabela nova, nenhuma migracao:
//    quem tiver emoji ou foto continua com emoji ou foto.
// 3. As cores vem em par (clara/escura) para o corpo ter volume com um gradiente
//    so, sem sombra e sem imagem.
// ---------------------------------------------------------------------------

export type Aparencia = { cor: number; forma: number; olhos: number; cabelo: number; roupa: number };

export const MARCA = "mb:";

export function escreverAparencia(a: Aparencia): string {
  return MARCA + [a.cor, a.forma, a.olhos, a.cabelo, a.roupa].join(".");
}

export function lerAparencia(s?: string | null): Aparencia | null {
  if (!s || !s.startsWith(MARCA)) return null;
  const p = s.slice(MARCA.length).split(".").map((n) => parseInt(n, 10));
  if (p.length !== 5 || p.some((n) => !Number.isFinite(n))) return null;
  return {
    cor: mod(p[0], CORES.length), forma: mod(p[1], FORMAS.length), olhos: mod(p[2], OLHOS.length),
    cabelo: mod(p[3], CABELOS.length), roupa: mod(p[4], ROUPAS.length),
  };
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Numeros estaveis a partir do id: o mesmo bot sempre nasce com a mesma cara. */
function semente(id: string) {
  let h = 2166136261;
  for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  let x = h >>> 0;
  return (max: number) => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x % max; };
}

/** A cara que o bot teria sem ninguem escolher nada. */
export function aparenciaDe(id: string): Aparencia {
  const r = semente(id);
  return { cor: r(CORES.length), forma: r(FORMAS.length), olhos: r(OLHOS.length), cabelo: r(CABELOS.length), roupa: r(ROUPAS.length) };
}

// ---------------------------------------------------------------------------
// 50 cores
// ---------------------------------------------------------------------------
export const CORES: { nome: string; clara: string; escura: string }[] = [
  { nome: "verde-limo", clara: "#9ae6b4", escura: "#38a169" },
  { nome: "verde-mar", clara: "#81e6d9", escura: "#2c7a7b" },
  { nome: "menta", clara: "#c6f6d5", escura: "#48bb78" },
  { nome: "musgo", clara: "#a7c957", escura: "#52734d" },
  { nome: "abacate", clara: "#cde990", escura: "#6a8d3c" },
  { nome: "jade", clara: "#7ee8c0", escura: "#1f7a5c" },
  { nome: "oliva", clara: "#d6d58e", escura: "#7a7f3a" },
  { nome: "pinheiro", clara: "#8fd2a8", escura: "#20553a" },
  { nome: "azul-ceu", clara: "#90cdf4", escura: "#2b6cb0" },
  { nome: "azul-noite", clara: "#7f9cf5", escura: "#2a4365" },
  { nome: "turquesa", clara: "#76e4f7", escura: "#0987a0" },
  { nome: "anil", clara: "#a3bffa", escura: "#434190" },
  { nome: "petroleo", clara: "#81cfe0", escura: "#1b4f5c" },
  { nome: "gelo", clara: "#d6f0ff", escura: "#6b9cc4" },
  { nome: "cobalto", clara: "#8ab6f9", escura: "#1a4fa0" },
  { nome: "lavanda", clara: "#d6bcfa", escura: "#6b46c1" },
  { nome: "uva", clara: "#b794f4", escura: "#44337a" },
  { nome: "lilas", clara: "#e9d8fd", escura: "#805ad5" },
  { nome: "ametista", clara: "#c3a6f0", escura: "#53327a" },
  { nome: "violeta", clara: "#cbb2fe", escura: "#5b21b6" },
  { nome: "rosa-cha", clara: "#fbb6ce", escura: "#b83280" },
  { nome: "magenta", clara: "#f6a8e0", escura: "#97266d" },
  { nome: "algodao-doce", clara: "#ffd6e7", escura: "#d53f8c" },
  { nome: "framboesa", clara: "#f8a0b3", escura: "#9b2247" },
  { nome: "coral", clara: "#feb2b2", escura: "#c53030" },
  { nome: "tomate", clara: "#fca5a5", escura: "#991b1b" },
  { nome: "tijolo", clara: "#e8a08a", escura: "#8c3a1f" },
  { nome: "salmao", clara: "#ffc0ad", escura: "#c05621" },
  { nome: "laranja", clara: "#fbd38d", escura: "#c05621" },
  { nome: "tangerina", clara: "#ffd0a1", escura: "#b45309" },
  { nome: "mel", clara: "#fbe3a0", escura: "#b7791f" },
  { nome: "mostarda", clara: "#f6e05e", escura: "#975a16" },
  { nome: "milho", clara: "#faf089", escura: "#a9821a" },
  { nome: "areia", clara: "#f0e2c6", escura: "#a08030" },
  { nome: "caramelo", clara: "#e8c39e", escura: "#8a5a2b" },
  { nome: "cafe", clara: "#d3b494", escura: "#5a3b22" },
  { nome: "chocolate", clara: "#c69c7b", escura: "#45291a" },
  { nome: "cacau", clara: "#b89b85", escura: "#3d2b22" },
  { nome: "cinza-azul", clara: "#cbd5e0", escura: "#4a5568" },
  { nome: "grafite", clara: "#b8c0c8", escura: "#2d3748" },
  { nome: "chumbo", clara: "#a0aec0", escura: "#1a202c" },
  { nome: "prata", clara: "#e2e8f0", escura: "#718096" },
  { nome: "neve", clara: "#f7fafc", escura: "#a0aec0" },
  { nome: "carvao", clara: "#9aa5b1", escura: "#16202c" },
  { nome: "bronze", clara: "#e3bb8f", escura: "#7b4b1e" },
  { nome: "ouro-velho", clara: "#eacf8c", escura: "#8a6d1f" },
  { nome: "esmeralda", clara: "#6ee7b7", escura: "#065f46" },
  { nome: "safira", clara: "#93c5fd", escura: "#1e3a8a" },
  { nome: "rubi", clara: "#fda4af", escura: "#881337" },
  { nome: "perola", clara: "#fdf6e3", escura: "#b9a88a" },
];
// ---------------------------------------------------------------------------
// Os corpos. Raio por angulo -> pontos -> curva fechada e lisa (Catmull-Rom).
// Nenhuma aresta sobrevive a esse caminho: toda "ponta" vira barriga redonda.
// ---------------------------------------------------------------------------
function curvaFechada(pts: [number, number][]): string {
  const n = pts.length;
  const em = (i: number) => pts[((i % n) + n) % n];
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = em(i - 1), p1 = em(i), p2 = em(i + 1), p3 = em(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(2)} ${c1y.toFixed(2)},${c2x.toFixed(2)} ${c2y.toFixed(2)},${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d + "Z";
}

/** raio(t) em volta do centro, t em radianos. ex (escala vertical) deixa ovo/gota. */
function corpo(raio: (t: number) => number, ex = 1, cy = 50, n = 56): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = 40 * raio(t);
    pts.push([50 + r * Math.cos(t), cy + r * ex * Math.sin(t)]);
  }
  return curvaFechada(pts);
}

export const FORMAS: { nome: string; d: string }[] = [
  { nome: "bolha", d: corpo((t) => 1 + 0.11 * Math.cos(3 * t + 0.7) + 0.06 * Math.sin(5 * t), 1.02) },
  { nome: "ovo", d: corpo(() => 1, 1.14, 48) },
  { nome: "gota", d: corpo((t) => 1 + 0.1 * Math.cos(t + Math.PI / 2), 1.08, 52) },
  { nome: "estrela gorda", d: corpo((t) => 1 + 0.19 * Math.cos(5 * t + Math.PI), 1) },
  { nome: "triangulo", d: corpo((t) => 1 + 0.17 * Math.cos(3 * t + Math.PI), 1) },
  { nome: "octogono", d: corpo((t) => 1 + 0.075 * Math.cos(8 * t), 1) },
  { nome: "hexagono", d: corpo((t) => 1 + 0.1 * Math.cos(6 * t), 1) },
  { nome: "flor", d: corpo((t) => 1 + 0.15 * Math.cos(6 * t + Math.PI), 1) },
  { nome: "nuvem", d: corpo((t) => 1 + 0.12 * Math.abs(Math.cos(2 * t)) - 0.05, 0.86, 54) },
  { nome: "capsula", d: corpo((t) => 1 / Math.sqrt(1 - 0.55 * Math.cos(t) * Math.cos(t)) * 0.82, 1.05) },
  { nome: "feijao", d: corpo((t) => 1 + 0.13 * Math.cos(2 * t) + 0.08 * Math.sin(t), 1.0) },
  { nome: "coracao", d: corpo((t) => 1 + 0.17 * Math.cos(2 * t + Math.PI) + 0.08 * Math.sin(t), 1.04, 52) },
  { nome: "trevo", d: corpo((t) => 1 + 0.14 * Math.cos(4 * t + Math.PI), 1) },
  { nome: "pedra", d: corpo((t) => 1 + 0.07 * Math.cos(4 * t + 1.2) + 0.05 * Math.cos(7 * t), 0.98) },
];

// ---------------------------------------------------------------------------
// Olhos. cx/cy fixos para a cara nao escorregar entre os corpos.
// ---------------------------------------------------------------------------
const E = 40, D = 60, Y = 46;
export const OLHOS: { nome: string; render: (p: { olhar: number; iris: string }) => JSX.Element }[] = [
  { nome: "redondos", render: ({ olhar, iris }) => (<g>
      <ellipse cx={E} cy={Y} rx="7.4" ry="7.8" fill="#fff" /><ellipse cx={D} cy={Y} rx="7.4" ry="7.8" fill="#fff" />
      <circle cx={E + olhar} cy={Y + 1} r="3.5" fill={iris} /><circle cx={D + olhar} cy={Y + 1} r="3.5" fill={iris} />
      <circle cx={E + olhar - 1.4} cy={Y - 1.6} r="1.2" fill="#fff" opacity=".9" /><circle cx={D + olhar - 1.4} cy={Y - 1.6} r="1.2" fill="#fff" opacity=".9" />
    </g>) },
  { nome: "grandes", render: ({ olhar, iris }) => (<g>
      <ellipse cx={E - 1} cy={Y} rx="9.2" ry="9.6" fill="#fff" /><ellipse cx={D + 1} cy={Y} rx="9.2" ry="9.6" fill="#fff" />
      <circle cx={E - 1 + olhar} cy={Y + 1.5} r="4.6" fill={iris} /><circle cx={D + 1 + olhar} cy={Y + 1.5} r="4.6" fill={iris} />
      <circle cx={E - 2.6 + olhar} cy={Y - 1.4} r="1.7" fill="#fff" opacity=".92" /><circle cx={D - 0.6 + olhar} cy={Y - 1.4} r="1.7" fill="#fff" opacity=".92" />
    </g>) },
  { nome: "espertos", render: ({ olhar, iris }) => (<g>
      <path d={`M${E - 7} ${Y}q7 -6.5 14 0q-7 6.5 -14 0`} fill="#fff" /><path d={`M${D - 7} ${Y}q7 -6.5 14 0q-7 6.5 -14 0`} fill="#fff" />
      <circle cx={E + olhar} cy={Y} r="2.9" fill={iris} /><circle cx={D + olhar} cy={Y} r="2.9" fill={iris} />
    </g>) },
  { nome: "sonolentos", render: ({ olhar, iris }) => (<g>
      <ellipse cx={E} cy={Y} rx="7.2" ry="7.4" fill="#fff" /><ellipse cx={D} cy={Y} rx="7.2" ry="7.4" fill="#fff" />
      <circle cx={E + olhar} cy={Y + 1} r="3.2" fill={iris} /><circle cx={D + olhar} cy={Y + 1} r="3.2" fill={iris} />
      <path d={`M${E - 7.6} ${Y - 1.5}q7.6 -3 15.2 0`} fill="#16202c" opacity=".9" stroke="#16202c" strokeWidth="3.4" strokeLinecap="round" />
      <path d={`M${D - 7.6} ${Y - 1.5}q7.6 -3 15.2 0`} fill="#16202c" opacity=".9" stroke="#16202c" strokeWidth="3.4" strokeLinecap="round" />
    </g>) },
  { nome: "felizes", render: () => (<g stroke="#16202c" strokeWidth="2.8" fill="none" strokeLinecap="round">
      <path d={`M${E - 6} ${Y + 1.5}q6 -7 12 0`} /><path d={`M${D - 6} ${Y + 1.5}q6 -7 12 0`} />
    </g>) },
  { nome: "decididos", render: ({ olhar, iris }) => (<g>
      <ellipse cx={E} cy={Y + 1} rx="7.2" ry="7.4" fill="#fff" /><ellipse cx={D} cy={Y + 1} rx="7.2" ry="7.4" fill="#fff" />
      <circle cx={E + olhar} cy={Y + 2} r="3.3" fill={iris} /><circle cx={D + olhar} cy={Y + 2} r="3.3" fill={iris} />
      <path d={`M${E - 8} ${Y - 7}l15 3.4`} stroke="#16202c" strokeWidth="2.6" strokeLinecap="round" />
      <path d={`M${D + 8} ${Y - 7}l-15 3.4`} stroke="#16202c" strokeWidth="2.6" strokeLinecap="round" />
    </g>) },
  { nome: "oculos", render: ({ olhar, iris }) => (<g>
      <ellipse cx={E} cy={Y} rx="7.2" ry="7.4" fill="#fff" /><ellipse cx={D} cy={Y} rx="7.2" ry="7.4" fill="#fff" />
      <circle cx={E + olhar} cy={Y + 1} r="3.2" fill={iris} /><circle cx={D + olhar} cy={Y + 1} r="3.2" fill={iris} />
      <g fill="none" stroke="#16202c" strokeWidth="2" opacity=".85">
        <circle cx={E} cy={Y} r="9.4" /><circle cx={D} cy={Y} r="9.4" /><path d={`M${E + 9.4} ${Y}h${D - E - 18.8}`} />
      </g>
    </g>) },
  { nome: "visor", render: ({ olhar }) => (<g>
      <rect x="29" y={Y - 7.5} width="42" height="15" rx="7.5" fill="#16202c" opacity=".92" />
      <circle cx={E + olhar} cy={Y} r="2.6" fill="#7ee8c0" /><circle cx={D + olhar} cy={Y} r="2.6" fill="#7ee8c0" />
    </g>) },
  { nome: "um olho", render: ({ olhar, iris }) => (<g>
      <ellipse cx="50" cy={Y} rx="12" ry="12.4" fill="#fff" />
      <circle cx={50 + olhar} cy={Y + 1} r="5.4" fill={iris} />
      <circle cx={48 + olhar} cy={Y - 2} r="2" fill="#fff" opacity=".9" />
    </g>) },
  { nome: "brilhantes", render: ({ olhar, iris }) => (<g>
      <ellipse cx={E} cy={Y} rx="8" ry="8.4" fill="#fff" /><ellipse cx={D} cy={Y} rx="8" ry="8.4" fill="#fff" />
      <circle cx={E + olhar} cy={Y + 1} r="4" fill={iris} /><circle cx={D + olhar} cy={Y + 1} r="4" fill={iris} />
      <circle cx={E - 2 + olhar} cy={Y - 2} r="1.8" fill="#fff" /><circle cx={D - 2 + olhar} cy={Y - 2} r="1.8" fill="#fff" />
      <circle cx={E + 2.4 + olhar} cy={Y + 3} r="0.9" fill="#fff" opacity=".8" /><circle cx={D + 2.4 + olhar} cy={Y + 3} r="0.9" fill="#fff" opacity=".8" />
    </g>) },
];

export const IRIS = ["#16202c", "#2b6cb0", "#2f855a", "#8a5a2b", "#6b46c1", "#0987a0", "#975a16", "#b83280"];

// ---------------------------------------------------------------------------
// Cabelos. Ficam atras/acima do corpo, por isso desenham entre y=4 e y=26.
// ---------------------------------------------------------------------------
export const CABELOS: { nome: string; render: (cor: string) => JSX.Element | null }[] = [
  { nome: "careca", render: () => null },
  { nome: "topete", render: (c) => (<path d="M38 20q4-14 14-13t10 13q-6-6-12-5t-12 5z" fill={c} />) },
  { nome: "franja", render: (c) => (<path d="M28 27q2-16 22-16t22 16q-6-7-22-7t-22 7z" fill={c} />) },
  { nome: "cachos", render: (c) => (<g fill={c}>
      <circle cx="36" cy="20" r="7.5" /><circle cx="50" cy="15" r="8.5" /><circle cx="64" cy="20" r="7.5" /><circle cx="43" cy="14" r="6" /><circle cx="57" cy="14" r="6" />
    </g>) },
  { nome: "moicano", render: (c) => (<path d="M46 22q0-18 4-18t4 18q-4-3-8 0z" fill={c} />) },
  { nome: "rabo", render: (c) => (<g fill={c}>
      <path d="M30 26q3-15 20-15t20 15q-7-7-20-7t-20 7z" /><ellipse cx="74" cy="34" rx="6" ry="9" transform="rotate(18 74 34)" />
    </g>) },
  { nome: "antena", render: (c) => (<g stroke={c} strokeWidth="3" fill="none" strokeLinecap="round">
      <path d="M50 18v-9" /><circle cx="50" cy="7" r="3.4" fill={c} stroke="none" />
    </g>) },
  { nome: "chifrinhos", render: (c) => (<g fill={c}>
      <path d="M36 18q-5-9 1-11t6 9q-4-1-7 2z" /><path d="M64 18q5-9-1-11t-6 9q4-1 7 2z" />
    </g>) },
  { nome: "coque", render: (c) => (<g fill={c}>
      <path d="M31 26q3-15 19-15t19 15q-7-7-19-7t-19 7z" /><circle cx="50" cy="8" r="7" />
    </g>) },
  { nome: "juba", render: (c) => (<g fill={c}>
      <circle cx="29" cy="34" r="8" /><circle cx="33" cy="20" r="8" /><circle cx="50" cy="13" r="9" /><circle cx="67" cy="20" r="8" /><circle cx="71" cy="34" r="8" />
    </g>) },
];

export const COR_CABELO = ["#2b2118", "#4a2f1d", "#7b4a24", "#b5763b", "#d9ae6a", "#8c8c94", "#1f1b1b", "#c53030", "#6b46c1", "#2c7a7b"];

// ---------------------------------------------------------------------------
// Roupas e enfeites. Vao por cima, na altura do "peito" (y>=70) ou da testa.
// As bandeiras sao faixas simples: identificam o time sem copiar brasao nenhum.
// ---------------------------------------------------------------------------
const faixa = (a: string, b: string, c?: string) => (
  <g>
    <path d="M50 97q-21 0-28-9 7-12 28-12t28 12q-7 9-28 9z" fill={a} />
    <path d="M50 97q-11 0-18-3 0-5 18-5t18 5q-7 3-18 3z" fill={b} opacity=".95" />
    {c ? <ellipse cx="50" cy="90" rx="5.5" ry="3.4" fill={c} /> : null}
  </g>
);

export const ROUPAS: { nome: string; render: (p: { corpo: string; claro: string }) => JSX.Element | null }[] = [
  { nome: "sem roupa", render: () => null },
  { nome: "camisa", render: ({ claro }) => (<path d="M50 97q-21 0-28-9 7-12 28-12t28 12q-7 9-28 9z" fill={claro} opacity=".95" />) },
  { nome: "gravata", render: ({ claro }) => (<g>
      <path d="M50 97q-21 0-28-9 7-12 28-12t28 12q-7 9-28 9z" fill={claro} opacity=".95" />
      <path d="M50 78l4 4-4 14-4-14z" fill="#9b2c2c" />
    </g>) },
  { nome: "cachecol", render: () => (<g>
      <path d="M31 80q19 7 38 0 2 6 0 9-19 6-38 0-2-3 0-9z" fill="#c53030" />
      <path d="M66 88q6 3 5 10-5 2-8-1z" fill="#9b2247" />
    </g>) },
  { nome: "bandana", render: () => (<g>
      <path d="M29 26q21-9 42 0-2 7-21 7t-21-7z" fill="#c53030" />
      <path d="M70 27q7 1 9 6-5 3-9 0z" fill="#9b2247" />
    </g>) },
  { nome: "bone", render: () => (<g>
      <path d="M28 25q4-15 22-15t22 15q-22-8-44 0z" fill="#2b6cb0" />
      <path d="M26 25q24-5 48 0 2 4-1 5-23-4-46 0-2-1-1-5z" fill="#1a4fa0" />
    </g>) },
  { nome: "fone", render: () => (<g fill="none" stroke="#2d3748" strokeWidth="4" strokeLinecap="round">
      <path d="M26 46a24 24 0 0 1 48 0" />
      <path d="M26 44v8" stroke="#16202c" strokeWidth="9" /><path d="M74 44v8" stroke="#16202c" strokeWidth="9" />
    </g>) },
  { nome: "coroa", render: () => (<path d="M33 24l3-14 7 7 7-10 7 10 7-7 3 14q-17-5-34 0z" fill="#eacf8c" stroke="#b7791f" strokeWidth="1.5" strokeLinejoin="round" />) },
  { nome: "capa", render: () => (<path d="M22 92q6-16 28-16t28 16q-14 6-28 6t-28-6z" fill="#44337a" opacity=".9" />) },
  { nome: "jaleco", render: () => (<g>
      <path d="M50 97q-21 0-28-9 7-12 28-12t28 12q-7 9-28 9z" fill="#f7fafc" />
      <path d="M50 78v19" stroke="#cbd5e0" strokeWidth="1.6" /><circle cx="59" cy="86" r="2.6" fill="#c53030" />
    </g>) },
  { nome: "colete", render: () => (<g>
      <path d="M50 97q-21 0-28-9 7-12 28-12t28 12q-7 9-28 9z" fill="#2d3748" />
      <path d="M41 78l9 8 9-8" fill="none" stroke="#a0aec0" strokeWidth="2" />
    </g>) },
  { nome: "bandeira BR", render: () => faixa("#2f855a", "#f6e05e", "#2b6cb0") },
  { nome: "bandeira PT", render: () => faixa("#c53030", "#2f855a", "#eacf8c") },
  { nome: "bandeira AR", render: () => faixa("#90cdf4", "#f7fafc", "#f6e05e") },
  { nome: "bandeira US", render: () => faixa("#2a4365", "#c53030", "#f7fafc") },
  { nome: "bandeira ES", render: () => faixa("#c53030", "#f6e05e") },
  { nome: "bandeira IT", render: () => faixa("#2f855a", "#f7fafc", "#c53030") },
  { nome: "bandeira JP", render: () => faixa("#f7fafc", "#f7fafc", "#c53030") },
  { nome: "bandeira MX", render: () => faixa("#2f855a", "#f7fafc", "#c53030") },
  { nome: "bandeira DE", render: () => faixa("#16202c", "#c53030", "#f6e05e") },
];

// ---------------------------------------------------------------------------
// Os cem bots prontos. Passos primos sobre cada lista: cem combinacoes sem
// repetir e sem ninguem ter que escrever cem linhas a mao.
// ---------------------------------------------------------------------------
export const CEM: Aparencia[] = Array.from({ length: 100 }, (_, i) => ({
  cor: (i * 23) % CORES.length,
  forma: (i * 5) % FORMAS.length,
  olhos: (i * 3) % OLHOS.length,
  cabelo: (i * 7) % CABELOS.length,
  roupa: (i * 11) % ROUPAS.length,
}));

// ---------------------------------------------------------------------------
// O desenho
// ---------------------------------------------------------------------------
export function BotArte({ a, id = "", size = 44 }: { a: Aparencia; id?: string; size?: number }) {
  const cor = CORES[mod(a.cor, CORES.length)];
  const forma = FORMAS[mod(a.forma, FORMAS.length)];
  const olhos = OLHOS[mod(a.olhos, OLHOS.length)];
  const cabelo = CABELOS[mod(a.cabelo, CABELOS.length)];
  const roupa = ROUPAS[mod(a.roupa, ROUPAS.length)];
  const r = semente(id || escreverAparencia(a));
  const olhar = r(5) - 2;
  const iris = IRIS[r(IRIS.length)];
  const corCabelo = COR_CABELO[r(COR_CABELO.length)];
  const grad = "ba-" + (id || escreverAparencia(a)).replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg className="retrato ameba bot-arte" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true"
      style={{ display: "block", ["--atraso" as any]: (r(70) / 10).toFixed(1) + "s" }}>
      <defs>
        <linearGradient id={grad} x1="0.1" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={cor.clara} /><stop offset="1" stopColor={cor.escura} />
        </linearGradient>
        <clipPath id={grad + "-c"}><path d={forma.d} /></clipPath>
      </defs>
      {cabelo.render(corCabelo)}
      <path d={forma.d} fill={`url(#${grad})`} />
      <ellipse cx="37" cy="31" rx="9" ry="5.5" fill="#fff" opacity=".2" transform="rotate(-22 37 31)" />
      <g clipPath={`url(#${grad}-c)`}>{roupa.render({ corpo: cor.escura, claro: cor.clara })}</g>
      <g className="r-olhos">{olhos.render({ olhar, iris })}</g>
      <g className="r-boca">
        <path d="M44 60q6 5.5 12 0" stroke="#16202c" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".8" />
      </g>
    </svg>
  );
}

/** Desenha o bot pelo que estiver guardado no avatar; sem codigo, usa o id. */
export function ArteDoBot({ id, avatar, size = 44 }: { id: string; avatar?: string | null; size?: number }) {
  const a = lerAparencia(avatar) ?? aparenciaDe(id);
  return <BotArte a={a} id={id} size={size} />;
}

// ---------------------------------------------------------------------------
// O menu de escolha
// ---------------------------------------------------------------------------
const ABAS = [
  { id: "prontos", titulo: "Os 100" },
  { id: "forma", titulo: "Corpo" },
  { id: "cor", titulo: "Cor" },
  { id: "olhos", titulo: "Olhos" },
  { id: "cabelo", titulo: "Cabelo" },
  { id: "roupa", titulo: "Roupa" },
] as const;

export function EscolhaAparencia({ id, valor, onSalvar, onFechar }: {
  id: string; valor?: string | null;
  onSalvar: (codigo: string) => void | Promise<void>;
  onFechar: () => void;
}) {
  const [a, setA] = useState(lerAparencia(valor) ?? aparenciaDe(id));
  const [aba, setAba] = useState<string>("prontos");
  const [salvando, setSalvando] = useState(false);
  const trocar = (k: keyof Aparencia, v: number) => setA({ ...a, [k]: v });
  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal wide ap" onClick={(e) => e.stopPropagation()}>
        <div className="ap-topo">
          <div className="ap-previa"><BotArte a={a} id={id} size={96} /></div>
          <div>
            <h3>Aparencia do bot</h3>
            <p className="muted">Escolha um dos 100 prontos ou monte o seu: corpo, cor, olhos, cabelo e roupa.</p>
            <div className="ap-abas">
              {ABAS.map((t) => (
                <button key={t.id} className={"ap-aba" + (aba === t.id ? " on" : "")} onClick={() => setAba(t.id)}>{t.titulo}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="ap-grade">
          {aba === "prontos" && CEM.map((c, i) => (
            <button key={i} className={"ap-item" + (igual(c, a) ? " on" : "")} title={`bot ${i + 1}`} onClick={() => setA(c)}>
              <BotArte a={c} id={"pronto-" + i} size={52} /><span>{i + 1}</span>
            </button>
          ))}
          {aba === "forma" && FORMAS.map((f, i) => (
            <button key={f.nome} className={"ap-item" + (a.forma === i ? " on" : "")} onClick={() => trocar("forma", i)}>
              <BotArte a={{ ...a, forma: i }} id={id} size={52} /><span>{f.nome}</span>
            </button>
          ))}
          {aba === "cor" && CORES.map((c, i) => (
            <button key={c.nome} className={"ap-item" + (a.cor === i ? " on" : "")} onClick={() => trocar("cor", i)}>
              <span className="ap-bola" style={{ background: `linear-gradient(140deg, ${c.clara}, ${c.escura})` }} /><span>{c.nome}</span>
            </button>
          ))}
          {aba === "olhos" && OLHOS.map((o, i) => (
            <button key={o.nome} className={"ap-item" + (a.olhos === i ? " on" : "")} onClick={() => trocar("olhos", i)}>
              <BotArte a={{ ...a, olhos: i }} id={id} size={52} /><span>{o.nome}</span>
            </button>
          ))}
          {aba === "cabelo" && CABELOS.map((c, i) => (
            <button key={c.nome} className={"ap-item" + (a.cabelo === i ? " on" : "")} onClick={() => trocar("cabelo", i)}>
              <BotArte a={{ ...a, cabelo: i }} id={id} size={52} /><span>{c.nome}</span>
            </button>
          ))}
          {aba === "roupa" && ROUPAS.map((rp, i) => (
            <button key={rp.nome} className={"ap-item" + (a.roupa === i ? " on" : "")} onClick={() => trocar("roupa", i)}>
              <BotArte a={{ ...a, roupa: i }} id={id} size={52} /><span>{rp.nome}</span>
            </button>
          ))}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={() => setA(aparenciaDe(id + ":" + Date.now()))}>Sortear</button>
          <button className="btn" onClick={onFechar}>Cancelar</button>
          <button className="btn primary" disabled={salvando} onClick={async () => {
            setSalvando(true);
            try { await onSalvar(escreverAparencia(a)); onFechar(); } finally { setSalvando(false); }
          }}>{salvando ? "Salvando..." : "Usar esta aparencia"}</button>
        </div>
      </div>
    </div>
  );
}

const igual = (x: Aparencia, y: Aparencia) =>
  x.cor === y.cor && x.forma === y.forma && x.olhos === y.olhos && x.cabelo === y.cabelo && x.roupa === y.roupa;
