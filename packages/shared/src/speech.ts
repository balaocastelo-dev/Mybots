// Preparo de texto para a fala (TTS). Usado pela interface e pelo Hub.
// Objetivo: o bot pode responder com roteiro, bullets, tabelas, emojis e hashtags,
// mas a voz lê só o essencial, sem "gaguejar" em símbolos.

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu;

/** Limpa markdown, bullets, emojis, URLs, hashtags e tempos tipo "(0–3s)". Mantém o conteúdo. */
export function cleanForSpeech(text: string): string {
  let t = text ?? "";
  t = t.replace(/\r/g, "");
  t = dinheiroPorExtenso(t);                                    // R$ 3058,00 -> três mil e cinquenta e oito reais
  t = t.replace(/```[\s\S]*?```/g, " (trecho de código omitido) ");
  t = t.replace(/`([^`\n]*)`/g, "$1");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");                 // imagens
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");               // links [texto](url)
  t = t.replace(/https?:\/\/\S+|www\.\S+/gi, " link ");
  t = t.replace(/^\s*\|.*\|\s*$/gm, (row) => row.split("|").map((c) => c.trim()).filter((c) => c && !/^:?-{2,}:?$/.test(c)).join(", "));
  t = t.replace(/^\s{0,3}#{1,6}\s*/gm, "");                     // títulos
  t = t.replace(/^\s*>\s?/gm, "");                               // citações
  t = t.replace(/^\s*(?:[-*•▪◦‣]|\d+[.)]|[a-z][.)])\s+/gim, ""); // bullets e numeração
  t = t.replace(/^\s*[-*_]{3,}\s*$/gm, "");                     // linhas horizontais
  t = t.replace(/(\*\*|__)(.*?)\1/g, "$2").replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, "$2");
  t = t.replace(/[*_#>~|]/g, " ");
  t = t.replace(/\((?:[^()]*?\d\s*[–\-a]\s*\d+\s*(?:s|seg|segundos|min)|[^()]*?\d+\s*(?:s|seg|segundos|min))\)/gi, " "); // (0–3s), (15s)
  t = t.replace(/\b\d{1,2}\s*[–-]\s*\d{1,2}\s*s\b/g, " ");      // 0–3s solto
  t = t.replace(/#[\p{L}\p{N}_]+/gu, " ");                      // hashtags
  t = t.replace(/@[\p{L}\p{N}_.]+/gu, " ");                     // @menções
  t = t.replace(/\s*(→|->|=>|➜|➔)\s*/g, ", ");
  t = t.replace(EMOJI_RE, " ");
  t = t.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "");                // tons de pele
  t = t.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'");
  t = shortenSpecs(t);                                          // encurta ficha técnica longa
  t = t.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
  t = t.replace(/\s+([,.;:!?])/g, "$1").replace(/([,;:])\1+/g, "$1").replace(/,\s*\./g, ".");
  // frases que terminam sem pontuação viram pausa curta ao juntar linhas
  t = t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => (/[.!?:;,]$/.test(l) ? l : l + ".")).join(" ");
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Encurta especificação técnica para a voz não virar ladainha.
 * "computador com processador Intel i9-14900K 3.2GHz 24 núcleos 64GB DDR5 RTX 4090 24GB"
 *   -> "computador com processador Intel i9 e mais especificações"
 * Mantém a marca/modelo que identifica a coisa e corta a enxurrada de números.
 */
const UNIDADE = "gb|tb|mb|kb|ghz|mhz|hz|fps|px|rpm|wh|w|v|mah|dpi|nm|cl|ms|bits?|núcleos?|nucleos?|threads?|canais?";
const ehSpec = (tk: string) => {
  const t = tk.replace(/[(),;]/g, "").replace(/[.!?]+$/, "");
  if (!t) return false;
  if (new RegExp(`^\\d+([.,]\\d+)?\\s*(${UNIDADE})$`, "i").test(t)) return true;  // 3.2GHz, 64GB
  if (new RegExp(`^(${UNIDADE})$`, "i").test(t)) return true;                        // GB solto
  // número solto NÃO conta sozinho ("Cena 1", "3500 reais"); só quando encostado noutra spec
  if (/\d/.test(t) && /[a-z]/i.test(t) && /[-_/:]/.test(t)) return true;             // i9-14900K, DDR5-6000
  if (/^[A-Z]{2,}\d+$/.test(t)) return true;                                          // RTX4090, DDR5
  return false;
};

export function shortenSpecs(text: string): string {
  // 1) parênteses que são só ficha técnica somem: (Windows 11, RTX 4090 + 32GB RAM)
  const base = (text ?? "").replace(/\(([^()]{4,80})\)/g, (todo, dentro: string) => {
    const tk = dentro.split(/[\s,+]+/).filter(Boolean);
    // dentro de parênteses a régua é mais frouxa: número solto e sigla também contam
    const tecnico = (w: string) => ehSpec(w) || /^\d+([.,]\d+)?$/.test(w) || /^[A-Z]{2,5}$/.test(w);
    return tk.length >= 2 && tk.filter(tecnico).length / tk.length >= 0.6 ? " " : todo;
  });

  // 2) frase a frase: com 3+ termos técnicos, fala só o primeiro e resume o resto.
  //    (o ponto de "3.2GHz" não pode ser confundido com fim de frase)
  const SEP = "\u0001";
  // ponto no meio de palavra não é fim de frase: "3.2GHz", "LOG.md", "arquivo.json"
  const protegido = base.replace(/(\w)\.(\w)/g, `$1${SEP}$2`);
  const frases = (protegido.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [protegido]).map((f) => f.split(SEP).join("."));
  const prontas = frases.map((frase) => {
    const palavras = frase.split(/(\s+)/);
    const spec = palavras.map((w) => !/^\s*$/.test(w) && ehSpec(w));
    const vizinhoSpec = (k: number, passo: number) => {
      let n = k + passo;
      while (n >= 0 && n < palavras.length && /^\s+$/.test(palavras[n])) n += passo;
      return n >= 0 && n < palavras.length && spec[n];
    };
    // sigla solta ("RTX 4090") e número solto ("24 núcleos") entram quando encostados numa spec
    for (let volta = 0; volta < 2; volta++) {
      for (let k = 0; k < palavras.length; k++) {
        if (spec[k] || /^\s*$/.test(palavras[k])) continue;
        const limpo = palavras[k].replace(/[(),;.!?]/g, "");
        const sigla = /^[A-Z]{2,5}$/.test(limpo);
        const numero = /^\d+([.,]\d+)?$/.test(limpo);
        if (!sigla && !numero) continue;
        if ((sigla && vizinhoSpec(k, 1)) || (numero && (vizinhoSpec(k, 1) || vizinhoSpec(k, -1)))) spec[k] = true;
      }
    }
    const idx = spec.map((v, k) => (v ? k : -1)).filter((k) => k >= 0);
    if (idx.length < 3) return frase;
    const cauda = frase.match(/\s*$/)?.[0] ?? "";
    const primeiroK = idx[0];
    const fim = /[.!?]$/.test(frase.trimEnd()) ? frase.trimEnd().slice(-1) : "";
    const out: string[] = [];
    for (let k = 0; k < palavras.length; k++) {
      if (k === primeiroK) {
        out.push(palavras[k].replace(/[-_/:].*$/, "").replace(/[(),;.]+$/, ""), " e mais especificações");
      } else if (idx.includes(k)) {
        continue; // some
      } else {
        out.push(palavras[k]);
      }
    }
    return out.join("")
      .replace(/\s+(e|com|de|da|do|em)\s*(?=[.!?]|$)/gi, "")
      .replace(/\s*,\s*(?=,|[.!?]|$)/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/[.!?\s]*$/, "") + fim + cauda;
  });

  // 3) caminhos de modelo: upstage/solar-mini4:free -> solar mini4
  return prontas.join("")
    .replace(/\b[\w.-]+\/([\w.-]+)(?::[\w.-]+)?\b/g, (todo, nome: string) => (todo.includes(" ") ? todo : String(nome).replace(/[-_]/g, " ")))
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Tem estrutura (títulos, listas, tabelas, várias seções)? */
export function isStructured(text: string): boolean {
  const t = text ?? "";
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^(?:[-*•▪◦‣]|\d+[.)])\s+/.test(l)).length;
  const headings = lines.filter((l) => /^#{1,6}\s/.test(l) || /^\*\*[^*]{2,60}\*\*:?$/.test(l)).length;
  const tables = lines.filter((l) => /^\|.*\|$/.test(l)).length;
  const hashtags = (t.match(/(^|\s)#[\p{L}\p{N}_]{2,}/gu) ?? []).length;
  const timeMarks = (t.match(/\(\s*\d+\s*[–-]?\s*\d*\s*s\s*\)/gi) ?? []).length;
  return bullets >= 2 || headings >= 1 || tables >= 2 || hashtags >= 3 || timeMarks >= 2 || /```/.test(t) || lines.length >= 6;
}

export const SPEECH_LEAD_MAX = 280;
export const SPEECH_SHORT_MAX = 300;
export const SPEECH_DETAILS_HINT = "Os detalhes estão no chat.";

export type Speech = {
  /** o que falar por padrão */
  lead: string;
  /** texto inteiro limpo (botão 🔊) */
  full: string;
  /** true quando o lead é um resumo e não o texto todo */
  truncated: boolean;
};

/** Pega as 1–2 primeiras frases (até max caracteres). */
export function leadSentences(clean: string, max = SPEECH_LEAD_MAX): string {
  const sentences = clean.match(/[^.!?]+[.!?]+["')]?|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (!sentences.length) return clean.slice(0, max).trim();
  let out = "";
  for (const s of sentences.slice(0, 2)) {
    const candidate = out ? `${out} ${s}` : s;
    if (candidate.length > max) break;
    out = candidate;
  }
  if (!out) {
    // primeira frase já é longa: corta na última palavra que cabe
    const cut = sentences[0].slice(0, max);
    const sp = cut.lastIndexOf(" ");
    out = (sp > 40 ? cut.slice(0, sp) : cut).replace(/[,;:\-–\s]+$/, "") + ".";
  }
  return out;
}

/** Decide o que vai pra voz: mensagem curta e simples → inteira; estruturada ou longa → só o lead + aviso. */
export function toSpeech(text: string): Speech {
  const full = cleanForSpeech(text);
  if (!full) return { lead: "", full: "", truncated: false };
  const structured = isStructured(text);
  if (!structured && full.length <= SPEECH_SHORT_MAX) return { lead: full, full, truncated: false };
  const lead = leadSentences(full);
  if (lead.length >= full.length - 2) return { lead: full, full, truncated: false };
  return { lead: `${lead} ${SPEECH_DETAILS_HINT}`, full, truncated: true };
}

// ---------------------------------------------------------------------------
// Fala em tempo real (chamada de voz): o bot começa a falar antes de terminar
// de escrever. O texto chega aos poucos; aqui se decide o que já pode virar som.
// ---------------------------------------------------------------------------

/** O primeiro pedaço é curto de propósito: é ele que decide quanto tempo o chefe espera o 1º som. */
export const FALA_PRIMEIRO = 90;
/** Os seguintes são maiores: menos idas ao TTS, e chegam enquanto o anterior toca. */
export const FALA_DEPOIS = 320;

/** Posição do último fim de frase (. ! ? … : ; ou quebra de linha) do texto, ou -1. */
function ultimoFimDeFrase(s: string): number {
  for (let i = s.length - 1; i >= 0; i--) if (".!?…\n:;".includes(s[i])) return i;
  return -1;
}

/**
 * Corta do texto acumulado o que já pode ser falado.
 *
 * Só sai daqui frase inteira: metade de frase vira som truncado e a voz "gagueja".
 * Enquanto houver um bloco de código aberto (``` sem par), o texto fica segurado —
 * senão a limpeza não reconhece o bloco e o bot começa a soletrar código.
 *
 * @param buffer  texto ainda não falado
 * @param primeiro true enquanto nada foi falado nesta resposta (pedaço curto, som mais cedo)
 * @param fim     true quando a resposta acabou: leva o resto, mesmo sem ponto final
 */
export function cortarFala(buffer: string, primeiro: boolean, fim = false): { pedacos: string[]; resto: string } {
  let completo = buffer;
  let resto = "";
  if (!fim) {
    const fences = (buffer.match(/```/g) ?? []).length;
    const ateAqui = fences % 2 === 1 ? buffer.lastIndexOf("```") : buffer.length;
    const corte = ultimoFimDeFrase(buffer.slice(0, ateAqui));
    if (corte < 0) return { pedacos: [], resto: buffer };
    completo = buffer.slice(0, corte + 1);
    resto = buffer.slice(corte + 1);
  }
  const frases = completo.match(/[^.!?…\n]+[.!?…\n]*/g) ?? [];
  const pedacos: string[] = [];
  let buf = "";
  let limite = primeiro ? FALA_PRIMEIRO : FALA_DEPOIS;
  for (const f of frases) {
    const t = f.trim();
    if (!t) continue;
    if (!buf) buf = t;
    else if ((buf + " " + t).length <= limite) buf += " " + t;
    else { pedacos.push(buf); buf = t; limite = FALA_DEPOIS; }
    if (buf.length >= limite) { pedacos.push(buf); buf = ""; limite = FALA_DEPOIS; }
  }
  if (buf) pedacos.push(buf);
  return { pedacos: pedacos.map((p) => p.trim()).filter(Boolean), resto };
}

/** Frases que o Whisper inventa quando ouve silêncio ou só o ruído da sala. */
const RUIDO_WHISPER = [
  "legendas pela comunidade", "amara.org", "legendado por", "obrigado por assistir",
  "inscreva-se no canal", "até a próxima", "ate a proxima", "tchau tchau", "...", "música", "musica",
];

const palavras = (s: string) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);

/** Transcrição que não é fala de verdade: vazia, uma letra solta ou alucinação conhecida do Whisper. */
export function ehRuido(texto: string): boolean {
  const t = (texto ?? "").trim();
  if (t.length < 2) return true;
  const baixo = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (RUIDO_WHISPER.some((r) => baixo.includes(r.normalize("NFD").replace(/[\u0300-\u036f]/g, "")))) return true;
  return !/[a-zà-ú]{2,}/i.test(t);
}

/**
 * O microfone fica aberto enquanto o bot fala, então o alto-falante volta pelo microfone.
 * O cancelamento de eco do navegador pega quase tudo; o que escapa chega como um pedaço
 * curto feito das palavras que o bot acabou de dizer. Frase longa nunca é eco: é o chefe falando.
 */
export function pareceEco(transcrito: string, faladoAgora: string): boolean {
  const t = palavras(transcrito);
  if (!t.length) return true;
  if (t.length > 14) return false;
  const f = new Set(palavras(faladoAgora));
  if (!f.size) return false;
  const iguais = t.filter((w) => f.has(w)).length;
  return iguais / t.length >= 0.6;
}

// ---------------------------------------------------------------------------
// Dinheiro por extenso. "R$ 3058,00" lido como número vira "três reais zero
// cinquenta e oito mil" — numa loja isso é pior que não falar. Aqui vira
// "três mil e cinquenta e oito reais".
// ---------------------------------------------------------------------------

const UNI = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
  "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CEM = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ate999(n: number): string {
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CEM[c]);
  if (r) {
    if (r < 20) partes.push(UNI[r]);
    else { const d = Math.floor(r / 10), u = r % 10; partes.push(u ? `${DEZ[d]} e ${UNI[u]}` : DEZ[d]); }
  }
  return partes.join(" e ");
}

/** Número inteiro por extenso, em português do Brasil. */
export function numeroPorExtenso(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  n = Math.floor(n);
  if (n < 1000) return ate999(n);
  const escalas: Array<[number, string, string]> = [
    [1_000_000_000, "bilhão", "bilhões"],
    [1_000_000, "milhão", "milhões"],
    [1000, "mil", "mil"],
  ];
  for (const [valor, sing, plur] of escalas) {
    if (n < valor) continue;
    const q = Math.floor(n / valor), r = n % valor;
    const cabeca = valor === 1000 && q === 1 ? "mil" : `${numeroPorExtenso(q)} ${q === 1 ? sing : plur}`;
    if (!r) return cabeca;
    // "três mil e cinquenta e oito" (resto pequeno) · "três mil duzentos e dez" (resto grande)
    return cabeca + (r < 100 || r % 100 === 0 ? " e " : " ") + numeroPorExtenso(r);
  }
  return ate999(n);
}

function valorPorExtenso(num: string): string {
  const [inteiro, centavos = ""] = num.replace(/\./g, "").split(",");
  if (inteiro.length > 12) return num;
  const i = parseInt(inteiro || "0", 10);
  const c = centavos ? parseInt(centavos.padEnd(2, "0").slice(0, 2), 10) : 0;
  if (!Number.isFinite(i)) return num;
  const partes: string[] = [];
  if (i || !c) partes.push(`${numeroPorExtenso(i)} ${i === 1 ? "real" : "reais"}`);
  if (c) partes.push(`${numeroPorExtenso(c)} ${c === 1 ? "centavo" : "centavos"}`);
  return partes.join(" e ");
}

/** Troca "R$ 1.299,90", "3058 reais" e "12x" por como se fala. */
export function dinheiroPorExtenso(texto: string): string {
  return (texto ?? "")
    .replace(/R\$\s*(\d[\d.]*(?:,\d{1,2})?)/g, (_m, n: string) => valorPorExtenso(n))
    .replace(/(\d[\d.]*(?:,\d{1,2})?)\s+reais\b/gi, (_m, n: string) => valorPorExtenso(n))
    .replace(/\b(\d+)\s*x\b(?=\s*(?:de|sem|com|$|\s))/gi, "$1 vezes");
}
