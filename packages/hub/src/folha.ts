// Folha de apresentação de uma empresa — a peça que o Gerente entrega no onboarding.
//
// POR QUE HTML + CHROME. gerar_pdf já imprime HTML pelo Chrome sem janela
// (scripts/documento.py, modelo "nenhum"). wkhtmltopdf, pandoc e LibreOffice
// não existem no PC de produção, e uma biblioteca nova de PDF pesa e ainda
// desenha pior. O miolo é HTML nosso: o papel timbrado do documento.py
// (--modelo balao / orcamento) traz dados fixos de uma instalação antiga e
// NÃO pode vestir a folha de uma empresa nova.
//
// O QUE ENTRA. Só o que a casa tem desta empresa: ficha (nome, site, Instagram,
// segmento, resumo, contatos), o que o Gerente anotou (anotar_empresa) e a
// equipe de bots. Campo vazio não vira seção vazia. Logo: o arquivo cadastrado,
// senão o do site ou do Instagram; sem imagem, um monograma das iniciais.
// A cor da capa sai do logo quando dá para ler os pixels.
import { spawn } from "node:child_process";
import { readFile, unlink, mkdtemp } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import QRCode from "qrcode";
import { enderecoDe, enderecoDoInsta } from "./previa.js";
import { raizDoProjeto } from "./config.js";

export type PessoaTime = { nome: string; funcao?: string };
export type AnotacaoEmpresa = { titulo: string; texto?: string; tipo?: string };
export type ContatosEmpresa = {
  email?: string;
  telefone?: string;
  whatsapp?: string;
  endereco?: string;
  horario?: string;
};
export type MemoriaEmpresa = { chave: string; valor: string };

/** Tudo o que a folha pode receber. Tudo é opcional menos o nome. */
export type FichaApresentacao = {
  nome: string;
  site?: string;
  instagram?: string;
  facebook?: string;
  segmento?: string;
  resumo?: string;
  regras?: string;
  contatos?: ContatosEmpresa;
  time?: PessoaTime[];
  anotacoes?: AnotacaoEmpresa[];
  memoria?: MemoriaEmpresa[];
  /** Caminho, data URL ou http(s) do logo já cadastrado. */
  logo?: string;
  /** Imagem da demo, se já existir: vira arte da capa. Data URL, caminho ou http(s). */
  arte?: string;
  quando?: Date;
};

export type Paleta = {
  cover: string;
  coverTexto: string;
  coverMudo: string;
  acentoCapa: string;
  acento: string;
  tinta: string;
  papel: string;
  fio: string;
  origem: "logo" | "padrao";
};

type RGB = [number, number, number];

const PAPEL: RGB = [246, 241, 232];
const TINTA: RGB = [28, 25, 21];
const QUASE_PRETO: RGB = [12, 11, 10];

export const PALETA_PADRAO: Paleta = {
  cover: "#171512",
  coverTexto: "#f6f1e8",
  coverMudo: "rgba(246,241,232,.64)",
  acentoCapa: "#d7b07a",
  acento: "#8a6434",
  tinta: "#1c1915",
  papel: "#f6f1e8",
  fio: "#e4dccf",
  origem: "padrao",
};

const PARADA = new Set(["da", "de", "do", "das", "dos", "e", "a", "o", "y", "em", "para", "com", "the", "of", "and"]);
/** Regra de operação do bot, não diferencial da empresa. Não vai para a folha. */
const INTERNO = /(\bbots?\b|\bprompt\b|\btokens?\b|\bsenha\b|chave de api|\bapi[_ -]?key\b|\bmybots\b|learn_knowledge|anotar_empresa|\bhub\b|nunca (invente|exponha|imprima|repita))/i;
const SEGREDO = /(token|senha|password|api[_ -]?key|secret|chave)/i;

export type LinhaContato = { rotulo: string; valor: string; href?: string };
export type ConteudoFolha = {
  nome: string;
  segmento?: string;
  /** Frase da capa. */
  lead?: string;
  /** Texto de "Quem somos" só quando diz mais do que a capa já disse. */
  quemSomos?: string;
  diferenciais: string[];
  time: PessoaTime[];
  contatos: LinhaContato[];
  qrSite?: string;
  qrWhats?: string;
  temMiolo: boolean;
};

export function iniciais(nome: string): string {
  const palavras = nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const uteis = palavras.filter((p) => !PARADA.has(p.toLowerCase()));
  const base = uteis.length ? uteis : palavras;
  if (!base.length) return "•";
  if (base.length === 1) return base[0].slice(0, 2).toUpperCase();
  return base.slice(0, 3).map((p) => p[0]!.toUpperCase()).join("");
}

function espaco(s: string | undefined): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function cortar(s: string, n: number): string {
  const t = espaco(s);
  if (t.length <= n) return t;
  const pedaco = t.slice(0, n);
  const sp = pedaco.lastIndexOf(" ");
  return ((sp > n * 0.6 ? pedaco.slice(0, sp) : pedaco).trim()) + "…";
}

function primeiraFrase(s: string, max = 240): string {
  const t = espaco(s);
  const m = t.match(/^(.{40,240}?[.!?])(?:\s|$)/);
  if (m && m[1].length <= max) return m[1];
  return cortar(t, max);
}

function limparNota(s: string | undefined): string {
  return espaco(String(s ?? "").replace(/\s*\(fonte:[^)]*\)\s*$/i, ""));
}

function linhasRegras(regras: string | undefined): string[] {
  return String(regras ?? "").split(/\n+/).map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
}

function soDigitos(s: string): string {
  return s.replace(/\D+/g, "");
}

/** Número com DDD vira wa.me. Sem dígito bastante, não vira QR. */
export function linkWhats(bruto: string | undefined): string | undefined {
  const d = soDigitos(bruto ?? "");
  if (d.length < 10 || d.length > 13) return undefined;
  const com = d.startsWith("55") ? d : "55" + d;
  if (com.length < 12 || com.length > 13) return undefined;
  return "https://wa.me/" + com;
}

export function formatarFone(bruto: string): string {
  const d = soDigitos(bruto);
  const n = d.startsWith("55") ? d : d.length >= 10 ? "55" + d : d;
  if (n.length === 13) return `+${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 9)}-${n.slice(9)}`;
  if (n.length === 12) return `+${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 8)}-${n.slice(8)}`;
  return bruto.trim();
}

function urlSite(bruto: string | undefined): string | undefined {
  const u = enderecoDe(bruto ?? "");
  if (!u || !/^https?:\/\//i.test(u)) return undefined;
  try {
    const url = new URL(u);
    if (url.port === "8787") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function arroba(bruto: string | undefined): { rotulo: string; href: string } | undefined {
  const href = enderecoDoInsta(bruto ?? "");
  if (!href) return undefined;
  const user = href.match(/instagram\.com\/([^/?#]+)/i)?.[1];
  if (!user) return undefined;
  return { rotulo: "@" + user, href };
}

function emailDe(s: string): string | undefined {
  return s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}

function foneDe(s: string): string | undefined {
  const m = s.match(/(?:\+?\s*55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[\s.-]?\d{4}/);
  if (!m) return undefined;
  const d = soDigitos(m[0]);
  if (d.length < 10 || d.length > 13) return undefined;
  return m[0].trim();
}

function ordenarTime(time: PessoaTime[]): PessoaTime[] {
  return [...time]
    .map((p) => ({ nome: espaco(p.nome), funcao: cortar(p.funcao ?? "", 160) || undefined }))
    .filter((p) => p.nome)
    .sort((a, b) => {
      const ga = /gerente/i.test(a.nome + " " + (a.funcao ?? "")) ? 0 : 1;
      const gb = /gerente/i.test(b.nome + " " + (b.funcao ?? "")) ? 0 : 1;
      return ga - gb || a.nome.localeCompare(b.nome, "pt");
    })
    .slice(0, 16);
}

/**
 * Decide o que a folha tem para mostrar. Seção sem matéria não existe:
 * é aqui que some o buraco, antes do HTML.
 */
export function conteudoDaFolha(ficha: FichaApresentacao): ConteudoFolha {
  const nome = espaco(ficha.nome) || "Empresa";
  const anotacoes = ficha.anotacoes ?? [];
  const memoria = (ficha.memoria ?? []).filter((m) => m.chave && m.valor && !SEGREDO.test(m.chave) && !SEGREDO.test(m.valor));
  const valorMem = (re: RegExp) => espaco(memoria.find((m) => re.test(m.chave))?.valor);

  let segmento: string | undefined = espaco(ficha.segmento) || valorMem(/segmento|ramo/i) || undefined;
  const notaSegmento = anotacoes.find((a) => /^(segmento|ramo)$/i.test(espaco(a.titulo)));
  if (!segmento && notaSegmento) segmento = limparNota(notaSegmento.texto || notaSegmento.titulo);
  segmento = segmento ? cortar(segmento, 80) : undefined;

  const regrasJuntas = normalizar(linhasRegras(ficha.regras).join(" "));
  let quem = espaco(ficha.resumo) || valorMem(/^resumo$|^sobre$/i);
  if (quem && regrasJuntas && normalizar(quem) === regrasJuntas) quem = "";
  if (!quem) {
    const sobre = anotacoes.find((a) => a.tipo === "identidade" || a.tipo === "historia" || /quem somos|sobre a empresa|^sobre$|a empresa/i.test(a.titulo));
    if (sobre) quem = limparNota(sobre.texto);
  }
  quem = quem ? cortar(quem, 900) : "";
  const lead = quem ? primeiraFrase(quem) : undefined;
  const quemSomos = quem && lead && quem !== lead ? quem : undefined;

  const diferenciais: string[] = [];
  const vistos = new Set<string>();
  const por = (s: string | undefined) => {
    const t = espaco(s);
    if (!t || t.length < 3 || INTERNO.test(t)) return;
    const k = normalizar(t);
    if (vistos.has(k) || diferenciais.length >= 8) return;
    vistos.add(k);
    diferenciais.push(cortar(t, 180));
  };
  for (const a of anotacoes) {
    if (a.tipo !== "produto" && !/servi[cç]o|diferencial|especialidade|o que (faz|vende|oferece)/i.test(a.titulo)) continue;
    if (notaSegmento && a === notaSegmento) continue;
    const corpo = limparNota(a.texto);
    const titulo = espaco(a.titulo);
    if (corpo && normalizar(corpo) !== normalizar(titulo)) por(`${titulo} — ${corpo}`);
    else por(titulo || corpo);
  }
  for (const m of memoria) if (/servi[cç]o|diferencial|produto/i.test(m.chave)) por(m.valor);
  for (const linha of linhasRegras(ficha.regras)) por(linha);

  const c: ContatosEmpresa = { ...(ficha.contatos ?? {}) };
  const emailsExtras: string[] = [];
  const tomar = (campo: keyof ContatosEmpresa, valor: string | undefined) => {
    const v = espaco(valor);
    if (v && !c[campo]) c[campo] = v;
  };
  const anotarEmail = (valor: string | undefined) => {
    const e = emailDe(valor ?? "");
    if (!e) return;
    if (!c.email) c.email = e;
    else if (e.toLowerCase() !== c.email.toLowerCase() && !emailsExtras.some((x) => x.toLowerCase() === e.toLowerCase())) emailsExtras.push(e);
  };
  for (const a of anotacoes) {
    if (a.tipo !== "contato" && !/contato|endere[cç]o|hor[aá]rio|whats|telefone|e-?mail/i.test(a.titulo + " " + (a.tipo ?? ""))) continue;
    const texto = limparNota(a.texto) || espaco(a.titulo);
    const titulo = a.titulo + " " + texto;
    if (/endere[cç]o/i.test(a.titulo)) tomar("endereco", limparNota(a.texto) || undefined);
    if (/hor[aá]rio/i.test(a.titulo)) tomar("horario", limparNota(a.texto) || undefined);
    anotarEmail(texto);
    const fone = foneDe(texto);
    if (fone && /whats/i.test(titulo)) tomar("whatsapp", fone);
    else if (fone) tomar("telefone", fone);
  }
  anotarEmail(valorMem(/e-?mail/i));
  tomar("whatsapp", foneDe(valorMem(/whats/i) ?? ""));
  tomar("telefone", foneDe(valorMem(/telefone|fone/i) ?? ""));
  tomar("endereco", valorMem(/endere[cç]o/i));
  tomar("horario", valorMem(/hor[aá]rio/i));

  const contatos: LinhaContato[] = [];
  const site = urlSite(ficha.site) || urlSite(valorMem(/^site$|^url$/i));
  const insta = arroba(ficha.instagram) || arroba(valorMem(/instagram/i));
  if (site) {
    let host = site;
    try { host = new URL(site).host.replace(/^www\./, ""); } catch { /* mantém */ }
    contatos.push({ rotulo: "Site", valor: host, href: site });
  }
  if (insta) contatos.push({ rotulo: "Instagram", valor: insta.rotulo, href: insta.href });
  const face = espaco(ficha.facebook);
  if (face) {
    const href = /^https?:\/\//i.test(face) ? face : `https://facebook.com/${face.replace(/^@/, "")}`;
    contatos.push({ rotulo: "Facebook", valor: face.replace(/^https?:\/\/(www\.)?facebook\.com\//i, ""), href });
  }
  if (c.email) contatos.push({ rotulo: "E-mail", valor: c.email, href: "mailto:" + c.email });
  for (const extra of emailsExtras) contatos.push({ rotulo: "E-mail", valor: extra, href: "mailto:" + extra });
  if (c.whatsapp) contatos.push({ rotulo: "WhatsApp", valor: formatarFone(c.whatsapp), href: linkWhats(c.whatsapp) });
  if (c.telefone && soDigitos(c.telefone) !== soDigitos(c.whatsapp ?? "")) contatos.push({ rotulo: "Telefone", valor: formatarFone(c.telefone) });
  if (c.endereco) contatos.push({ rotulo: "Endereço", valor: cortar(c.endereco, 160) });
  if (c.horario) contatos.push({ rotulo: "Horário", valor: cortar(c.horario, 120) });

  const time = ordenarTime(ficha.time ?? []);
  const temMiolo = !!(quemSomos || diferenciais.length || time.length || contatos.length);
  return {
    nome, segmento, lead, quemSomos, diferenciais, time, contatos,
    qrSite: site, qrWhats: linkWhats(c.whatsapp), temMiolo,
  };
}

export function textoDaEmpresa(ficha: FichaApresentacao): string {
  const c = conteudoDaFolha(ficha);
  const soNome = !c.segmento && !c.lead && !c.quemSomos && !c.contatos.length && !c.diferenciais.length;
  if (soNome) {
    return `**${c.nome}.**\n\nPor enquanto só tenho o nome. Se você me passar o site, o Instagram ou me contar o que a casa faz, eu completo a ficha — e a folha sai com isso. Sem esses dados, ela sai limpa, só com o que existe.`;
  }
  const blocos: string[] = [];
  blocos.push(c.segmento ? `**${c.nome}.**\n${c.segmento}` : `**${c.nome}.**`);
  if (c.quemSomos || c.lead) blocos.push(c.quemSomos || c.lead!);
  if (c.contatos.length) blocos.push(c.contatos.map((x) => `${x.rotulo}: ${x.valor}`).join("\n"));
  if (c.diferenciais.length) blocos.push(c.diferenciais.map((d) => "• " + d).join("\n"));
  blocos.push("Se algo estiver torto, me corrige que eu anoto. Sigo com o que está aqui.");
  return blocos.join("\n\n");
}

export function textoDoTime(ficha: FichaApresentacao): string {
  const c = conteudoDaFolha(ficha);
  if (!c.time.length) {
    return "**O time.** Ainda não há bots nesta empresa. A folha sai com a casa; o time entra nela assim que alguém nascer.";
  }
  const linhas = c.time.map((p) => (p.funcao ? `• **${p.nome}** — ${p.funcao}` : `• **${p.nome}**`));
  return "**O time, agora.**\n\n" + linhas.join("\n") + "\n\nA folha de apresentação vai junto: a casa e essa equipe, no mesmo papel que depois vira orçamento e relatório.";
}

// ---------------------------------------------------------------- paleta

function hex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}
function rgbHex(c: RGB): string {
  return "#" + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
}
function hexRgb(h: string): RGB {
  const x = h.replace("#", "");
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}
function misturar(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function lum(c: RGB): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function contraste(a: RGB, b: RGB): number {
  const L1 = lum(a), L2 = lum(b);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}
function hsl(c: RGB): { s: number; l: number } {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}
function ateContraste(cor: RGB, fundo: RGB, minimo: number, clarear: boolean): RGB {
  let c = cor;
  for (let i = 0; i < 10 && contraste(c, fundo) < minimo; i++) {
    c = misturar(c, clarear ? [255, 252, 245] : [20, 16, 12], 0.18);
  }
  return c;
}

/** Uma cor de marca vira capa, acento e papel. Sem cor, fica a paleta padrão. */
export function paletaDasCores(cores: Array<{ rgb: RGB; n: number }>): Paleta {
  const uteis = cores
    .map((c) => ({ ...c, ...hsl(c.rgb) }))
    .filter((c) => c.s >= 0.12 && c.l >= 0.08 && c.l <= 0.94 && c.n > 0);
  if (!uteis.length) return PALETA_PADRAO;
  // Logo com fundo escuro e um dourado pequeno: o dourado é o acento, o escuro é a capa.
  // Sem essa separação, a cor que ocupa mais pixel (o fundo) vencia e a capa ficava sem brilho.
  const pontuar = (c: { n: number; s: number; l: number }) => c.n * c.s * (0.35 + c.l);
  const escuros = uteis.filter((c) => c.l < 0.38);
  const claros = uteis.filter((c) => c.l >= 0.38);
  const melhor = (arr: typeof uteis) => [...arr].sort((a, b) => pontuar(b) - pontuar(a))[0];
  const acentoRgb = (claros.length && escuros.length ? melhor(claros) : melhor(uteis))!;
  const escuro = (claros.length && escuros.length ? [...escuros].sort((a, b) => a.l - b.l)[0] : [...uteis].sort((a, b) => a.l - b.l)[0])!;
  const cover = misturar(escuro.rgb, QUASE_PRETO, escuro.l < 0.22 ? 0.55 : 0.78);
  const papel = misturar(PAPEL, acentoRgb.rgb, 0.05);
  const acentoPapel = ateContraste(acentoRgb.rgb, papel, 4.2, false);
  const acentoCapa = ateContraste(acentoRgb.rgb, cover, 3.1, true);
  const fio = misturar(papel, acentoRgb.rgb, 0.22);
  return {
    cover: rgbHex(cover),
    coverTexto: "#f6f1e8",
    coverMudo: "rgba(246,241,232,.66)",
    acentoCapa: rgbHex(acentoCapa),
    acento: rgbHex(acentoPapel),
    tinta: rgbHex(TINTA),
    papel: rgbHex(papel),
    fio: rgbHex(fio),
    origem: "logo",
  };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Lê um PNG (8 bits, sem entrelaçamento) e devolve amostras de cor. null se não der. */
export function coresDoPng(buf: Buffer): Array<{ rgb: RGB; n: number }> | null {
  if (buf.length < 8 || buf[0] !== 0x89 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  let w = 0, h = 0, depth = 0, tipo = 0, inter = 0;
  let paleta: RGB[] | null = null;
  const idat: Buffer[] = [];
  let o = 8;
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const tag = buf.toString("ascii", o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (tag === "IHDR" && data.length >= 13) {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]!; tipo = data[9]!; inter = data[12]!;
    } else if (tag === "PLTE") {
      paleta = [];
      for (let i = 0; i + 2 < data.length; i += 3) paleta.push([data[i]!, data[i + 1]!, data[i + 2]!]);
    } else if (tag === "IDAT") idat.push(data);
    else if (tag === "IEND") break;
    o += 12 + len;
  }
  if (!w || !h || depth !== 8 || inter !== 0 || ![0, 2, 3, 4, 6].includes(tipo)) return null;
  if (w * h > 6_000_000) return null;
  const bpp = tipo === 2 ? 3 : tipo === 6 ? 4 : tipo === 4 ? 2 : 1;
  let raw: Buffer;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  const stride = w * bpp;
  const linhas: Buffer[] = [];
  let p = 0;
  for (let y = 0; y < h; y++) {
    if (p >= raw.length) return null;
    const filtro = raw[p]!;
    p++;
    const linha = Buffer.alloc(stride);
    const cru = raw.subarray(p, p + stride);
    if (cru.length < stride) return null;
    const prev = linhas[y - 1];
    for (let i = 0; i < stride; i++) {
      const x = cru[i]!;
      const esq = i >= bpp ? linha[i - bpp]! : 0;
      const cima = prev ? prev[i]! : 0;
      const diag = prev && i >= bpp ? prev[i - bpp]! : 0;
      if (filtro === 0) linha[i] = x;
      else if (filtro === 1) linha[i] = (x + esq) & 255;
      else if (filtro === 2) linha[i] = (x + cima) & 255;
      else if (filtro === 3) linha[i] = (x + Math.floor((esq + cima) / 2)) & 255;
      else if (filtro === 4) linha[i] = (x + paeth(esq, cima, diag)) & 255;
      else return null;
    }
    linhas.push(linha);
    p += stride;
  }
  const baldes = new Map<string, { rgb: RGB; n: number }>();
  const passo = Math.max(1, Math.floor(Math.sqrt((w * h) / 4000)));
  for (let y = 0; y < h; y += passo) {
    const linha = linhas[y]!;
    for (let x = 0; x < w; x += passo) {
      const i = x * bpp;
      let rgb: RGB;
      let a = 255;
      if (tipo === 0) rgb = [linha[i]!, linha[i]!, linha[i]!];
      else if (tipo === 2) rgb = [linha[i]!, linha[i + 1]!, linha[i + 2]!];
      else if (tipo === 4) { rgb = [linha[i]!, linha[i]!, linha[i]!]; a = linha[i + 1]!; }
      else if (tipo === 6) { rgb = [linha[i]!, linha[i + 1]!, linha[i + 2]!]; a = linha[i + 3]!; }
      else {
        const idx = paleta?.[linha[i]!];
        if (!idx) continue;
        rgb = idx;
      }
      if (a < 128) continue;
      const q: RGB = [rgb[0] & 0xf0, rgb[1] & 0xf0, rgb[2] & 0xf0];
      const k = q.join(",");
      const ja = baldes.get(k);
      if (ja) ja.n++;
      else baldes.set(k, { rgb: q, n: 1 });
    }
  }
  return [...baldes.values()];
}

function coresDoSvg(texto: string): Array<{ rgb: RGB; n: number }> {
  const achados = texto.match(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g) ?? [];
  const baldes = new Map<string, { rgb: RGB; n: number }>();
  for (const h of achados) {
    const cheio = h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h;
    const rgb = hexRgb(cheio);
    const k = rgb.join(",");
    const ja = baldes.get(k);
    if (ja) ja.n++;
    else baldes.set(k, { rgb, n: 1 });
  }
  return [...baldes.values()];
}

/** PNG sólido, para teste e para um logo mínimo quando só há uma cor. */
export function pngSolido(w: number, h: number, rgb: RGB): Buffer {
  const cru = Buffer.alloc((1 + w * 3) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (1 + w * 3);
    cru[o] = 0;
    for (let x = 0; x < w; x++) {
      cru[o + 1 + x * 3] = rgb[0];
      cru[o + 2 + x * 3] = rgb[1];
      cru[o + 3 + x * 3] = rgb[2];
    }
  }
  const idat = zlib.deflateSync(cru);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const chunk = (tag: string, data: Buffer) => {
    const tipo = Buffer.from(tag);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([tipo, data])) >>> 0, 0);
    return Buffer.concat([len, tipo, data, crc]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function coresViaFfmpeg(buf: Buffer, ext: string): Promise<Array<{ rgb: RGB; n: number }> | null> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mybots-cor-"));
  const entrada = path.join(dir, "logo" + ext);
  try {
    await fs.promises.writeFile(entrada, buf);
    const raw = await new Promise<Buffer | null>((ok) => {
      const p = spawn("ffmpeg", ["-v", "error", "-i", entrada, "-vf", "scale=18:18:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { windowsHide: true });
      const pedacos: Buffer[] = [];
      p.stdout.on("data", (d) => pedacos.push(d as Buffer));
      p.on("error", () => ok(null));
      p.on("close", (c) => ok(c === 0 ? Buffer.concat(pedacos) : null));
    });
    if (!raw || raw.length < 18 * 18 * 3) return null;
    const baldes = new Map<string, { rgb: RGB; n: number }>();
    for (let i = 0; i + 2 < raw.length; i += 3) {
      const q: RGB = [raw[i]! & 0xf0, raw[i + 1]! & 0xf0, raw[i + 2]! & 0xf0];
      const k = q.join(",");
      const ja = baldes.get(k);
      if (ja) ja.n++;
      else baldes.set(k, { rgb: q, n: 1 });
    }
    return [...baldes.values()];
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function paletaDoLogo(buf: Buffer, ext: string): Promise<Paleta> {
  if (ext === ".svg" || buf.subarray(0, 200).toString("utf8").includes("<svg")) {
    return paletaDasCores(coresDoSvg(buf.toString("utf8")));
  }
  const png = coresDoPng(buf);
  if (png?.length) return paletaDasCores(png);
  const via = await coresViaFfmpeg(buf, ext === ".jpg" ? ".jpg" : ext || ".img");
  if (via?.length) return paletaDasCores(via);
  return PALETA_PADRAO;
}

// ---------------------------------------------------------------- logo

const EXT_OK = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);

export function logoNaPasta(dir: string): string | undefined {
  if (!dir || !fs.existsSync(dir)) return undefined;
  for (const nome of ["logo.svg", "logo.png", "logo.webp", "logo.jpg", "logo.jpeg"]) {
    const p = path.join(dir, nome);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return undefined;
}

function magia(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return ".png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return ".jpg";
  if (buf.length >= 6 && buf.toString("ascii", 0, 4) === "GIF8") return ".gif";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return ".webp";
  const inicio = buf.subarray(0, 300).toString("utf8").trimStart().toLowerCase();
  if (inicio.startsWith("<svg") || (inicio.startsWith("<?xml") && buf.toString("utf8").includes("<svg"))) return ".svg";
  return null;
}

function mimeDe(ext: string): string {
  return { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" }[ext] || "application/octet-stream";
}

function dataUrlDe(buf: Buffer, ext: string): string {
  if (ext === ".svg") {
    const limpo = buf.toString("utf8").replace(/<script[\s\S]*?<\/script>/gi, "");
    return "data:image/svg+xml;base64," + Buffer.from(limpo, "utf8").toString("base64");
  }
  return `data:${mimeDe(ext)};base64,` + buf.toString("base64");
}

type Buscar = typeof fetch;

function urlOk(u: string): boolean {
  try {
    const url = new URL(u);
    return /^https?:$/.test(url.protocol) && url.port !== "8787";
  } catch { return false; }
}

async function baixar(buscar: Buscar, url: string, teto = 2_500_000): Promise<Buffer | null> {
  if (!urlOk(url)) return null;
  try {
    const r = await buscar(url, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", "accept": "image/*,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 40 || buf.length > teto) return null;
    return buf;
  } catch { return null; }
}

function lerLogoLocal(p: string): Buffer | null {
  try {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) return null;
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size < 40 || st.size > 2_500_000) return null;
    if (!EXT_OK.has(path.extname(abs).toLowerCase())) return null;
    return fs.readFileSync(abs);
  } catch { return null; }
}

function candidatosNoHtml(html: string, base: string): string[] {
  const itens: Array<{ s: number; href: string }> = [];
  const por = (tag: string, bonus: number) => {
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1] || /src=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || href.startsWith("data:")) return;
    let s = bonus;
    if (/logo|brand|marca/i.test(tag + href)) s += 2;
    if (/\.svg(\?|$)/i.test(href)) s += 1;
    if (/\.ico(\?|$)/i.test(href)) s -= 3;
    itens.push({ s, href });
  };
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /rel=["']([^"']+)["']/i.exec(m[0])?.[1]?.toLowerCase() ?? "";
    if (rel.includes("apple-touch-icon")) por(m[0], 6);
    else if (rel.includes("icon")) por(m[0], 3);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    if (/logo|brand|marca/i.test(m[0])) por(m[0], 4);
  }
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
  if (og) itens.push({ s: 1, href: og });
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const it of itens.sort((a, b) => b.s - a.s)) {
    if (it.s <= 0) continue;
    let abs = "";
    try { abs = new URL(it.href, base).toString(); } catch { continue; }
    if (vistos.has(abs) || !urlOk(abs)) continue;
    vistos.add(abs);
    saida.push(abs);
    if (saida.length >= 4) break;
  }
  return saida;
}

async function logoRemoto(buscar: Buscar, pagina: string, modo: "site" | "insta"): Promise<{ buf: Buffer; ext: string } | null> {
  if (modo === "insta") {
    const buf = await baixar(buscar, pagina);
    // a página do Instagram é HTML; o que serve é a og:image
    if (buf && magia(buf)) return { buf, ext: magia(buf)! };
    if (!buf) {
      const htmlBuf = await baixar(buscar, pagina, 1_500_000);
      if (!htmlBuf) return null;
      const alvos = candidatosNoHtml(htmlBuf.toString("utf8"), pagina);
      for (const u of alvos) {
        const img = await baixar(buscar, u);
        const ext = img && magia(img);
        if (img && ext && ext !== ".gif") return { buf: img, ext };
      }
      return null;
    }
  }
  const htmlBuf = await baixar(buscar, pagina, 1_500_000);
  if (!htmlBuf) return null;
  if (magia(htmlBuf) && magia(htmlBuf) !== ".gif") return { buf: htmlBuf, ext: magia(htmlBuf)! };
  for (const u of candidatosNoHtml(htmlBuf.toString("utf8"), pagina)) {
    const img = await baixar(buscar, u);
    const ext = img && magia(img);
    if (img && ext) return { buf: img, ext };
  }
  return null;
}

async function bytesDoLogo(ficha: FichaApresentacao, buscar: Buscar): Promise<{ buf: Buffer; ext: string } | null> {
  const declarado = espaco(ficha.logo);
  if (declarado) {
    if (declarado.startsWith("data:")) {
      const m = declarado.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i);
      if (m) {
        const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
        const ext = magia(buf);
        if (ext) return { buf, ext };
      }
    } else if (/^https?:\/\//i.test(declarado)) {
      const buf = await baixar(buscar, declarado);
      const ext = buf && magia(buf);
      if (buf && ext) return { buf, ext };
    } else {
      const buf = lerLogoLocal(declarado);
      const ext = buf && (magia(buf) || path.extname(declarado).toLowerCase());
      if (buf && ext && EXT_OK.has(ext)) return { buf, ext };
    }
  }
  const site = urlSite(ficha.site);
  const insta = enderecoDoInsta(ficha.instagram ?? "");
  const [a, b] = await Promise.all([
    site ? logoRemoto(buscar, site, "site") : Promise.resolve(null),
    insta ? logoRemoto(buscar, insta, "insta") : Promise.resolve(null),
  ]);
  return a || b;
}

function monograma(nome: string, paleta: Paleta): string {
  const letras = esc(iniciais(nome));
  const tam = letras.length >= 3 ? 30 : 38;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
    <text x="48" y="62" text-anchor="middle" font-family="Georgia, 'Noto Serif', serif" font-size="${tam}" fill="${paleta.acento}" letter-spacing="-1">${letras}</text>
  </svg>`;
}

// ---------------------------------------------------------------- html

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function tamanhoNome(nome: string): number {
  const n = nome.length;
  if (n <= 12) return 58;
  if (n <= 18) return 48;
  if (n <= 28) return 38;
  return 30;
}

function dataLonga(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

async function qrSvg(url: string, cor: string): Promise<string> {
  const svg = await QRCode.toString(url, {
    type: "svg", margin: 1, errorCorrectionLevel: "M", width: 240,
    color: { dark: cor, light: "#ffffff" },
  });
  return String(svg).replace(/<\?xml[^>]*>\s*/i, "").replace(/width="[^"]*"/, 'width="100%"').replace(/height="[^"]*"/, 'height="100%"');
}

export async function renderizarFolha(
  ficha: FichaApresentacao,
  visual: { paleta?: Paleta; logoHtml?: string; arteDataUrl?: string } = {},
): Promise<string> {
  const c = conteudoDaFolha(ficha);
  const paleta = visual.paleta ?? PALETA_PADRAO;
  const quando = ficha.quando ?? new Date();
  const marca = visual.logoHtml || monograma(c.nome, paleta);
  const nomeCss = tamanhoNome(c.nome);
  const [qrS, qrW] = await Promise.all([
    c.qrSite ? qrSvg(c.qrSite, paleta.tinta) : Promise.resolve(""),
    c.qrWhats ? qrSvg(c.qrWhats, paleta.tinta) : Promise.resolve(""),
  ]);

  const metaCapa = [c.contatos.find((x) => x.rotulo === "Site")?.valor, c.contatos.find((x) => x.rotulo === "Instagram")?.valor].filter((x): x is string => !!x);
  const olho = c.segmento || "Apresentação";

  const capa = `<section class="capa">
    ${visual.arteDataUrl ? `<div class="arte" style="background-image:url('${esc(visual.arteDataUrl)}')"></div><div class="velo"></div>` : `<div class="brilho"></div>`}
    <div class="capa-miolo">
      <header class="capa-topo"><div class="marca">${marca}</div></header>
      <div class="capa-centro">
        <p class="olho">${esc(olho)}</p>
        <h1>${esc(c.nome)}</h1>
        ${c.lead ? `<i class="traco"></i><p class="lead">${esc(c.lead)}</p>` : ""}
      </div>
      <footer class="capa-pe">
        <span>${metaCapa.map(esc).join("  ·  ")}</span>
        <span>${esc(dataLonga(quando))}</span>
      </footer>
    </div>
  </section>`;

  const blocos: string[] = [];
  if (c.quemSomos) blocos.push(`<section><h2>Quem somos</h2><p class="prosa">${esc(c.quemSomos)}</p></section>`);
  if (c.diferenciais.length) {
    blocos.push(`<section><h2>Serviços e diferenciais</h2><ol class="lista">${c.diferenciais.map((d, i) => `<li><span>${String(i + 1).padStart(2, "0")}</span><p>${esc(d)}</p></li>`).join("")}</ol></section>`);
  }
  if (c.time.length) {
    blocos.push(`<section><h2>A equipe</h2><ul class="time">${c.time.map((p) => `<li><b>${esc(p.nome)}</b>${p.funcao ? `<em>${esc(p.funcao)}</em>` : ""}</li>`).join("")}</ul></section>`);
  }
  if (c.contatos.length || qrS || qrW) {
    const linhas = c.contatos.map((x) => `<div class="ct"><small>${esc(x.rotulo)}</small><b>${x.href ? `<a href="${esc(x.href)}">${esc(x.valor)}</a>` : esc(x.valor)}</b></div>`).join("");
    const qrs = [
      qrS ? `<figure class="qr"><div class="caixa">${qrS}</div><figcaption>Site</figcaption></figure>` : "",
      qrW ? `<figure class="qr"><div class="caixa">${qrW}</div><figcaption>WhatsApp</figcaption></figure>` : "",
    ].join("");
    blocos.push(`<section class="contatos"><h2>Contato</h2><div class="contato-grade"><div class="cts">${linhas}</div>${qrs ? `<div class="qrs">${qrs}</div>` : ""}</div></section>`);
  }

  const miolo = c.temMiolo ? `<section class="miolo">
    <header class="topo"><div class="marca marca-p">${marca}</div><div class="topo-txt"><b>${esc(c.nome)}</b>${c.segmento ? `<small>${esc(c.segmento)}</small>` : ""}</div></header>
    ${blocos.join("\n")}
    <footer class="rodape"><span>${esc(c.nome)}</span><span>MyBots · ${esc(dataLonga(quando))}</span></footer>
  </section>` : "";

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(c.nome)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: ${paleta.tinta}; background: ${paleta.papel}; }
  a { color: inherit; text-decoration: none; }
  .capa { position: relative; height: 297mm; overflow: hidden; background: ${paleta.cover}; color: ${paleta.coverTexto}; ${c.temMiolo ? "break-after: page; page-break-after: always;" : ""} }
  .brilho { position: absolute; inset: 0; background: radial-gradient(130mm 90mm at 110% -10%, ${paleta.acentoCapa}33, transparent 60%), radial-gradient(80mm 80mm at -10% 110%, ${paleta.acentoCapa}22, transparent 55%); }
  .arte { position: absolute; inset: 0; background-size: cover; background-position: center; }
  .velo { position: absolute; inset: 0; background: linear-gradient(100deg, ${paleta.cover} 0%, ${paleta.cover}f2 38%, ${paleta.cover}88 68%, ${paleta.cover}55 100%); }
  .capa-miolo { position: relative; z-index: 1; height: 100%; display: flex; flex-direction: column; padding: 16mm 16mm 13mm; }
  .marca { background: ${paleta.papel}; color: ${paleta.acento}; border-radius: 4mm; padding: 3mm 3.5mm; display: inline-flex; align-items: center; justify-content: center; min-width: 18mm; min-height: 16mm; }
  .marca img, .marca svg { height: 13mm; width: auto; max-width: 46mm; display: block; }
  .capa-centro { margin-top: auto; margin-bottom: auto; max-width: 168mm; padding: 8mm 0 12mm; }
  .olho { margin: 0 0 6mm; font-size: 9.5pt; letter-spacing: .28em; text-transform: uppercase; color: ${paleta.acentoCapa}; font-weight: 600; }
  h1 { margin: 0; font-family: "Iowan Old Style", Palatino, "Palatino Linotype", "Noto Serif", Georgia, serif; font-weight: 560; font-size: ${nomeCss}pt; line-height: .92; letter-spacing: -.03em; max-width: 12em; }
  .traco { display: block; width: 18mm; height: .7mm; background: ${paleta.acentoCapa}; margin: 7mm 0 5mm; }
  .lead { margin: 0; max-width: 148mm; font-family: "Iowan Old Style", Palatino, "Noto Serif", Georgia, serif; font-size: 13.5pt; line-height: 1.45; color: ${paleta.coverMudo}; }
  .capa-pe { display: flex; justify-content: space-between; gap: 8mm; font-size: 9pt; letter-spacing: .04em; color: ${paleta.coverMudo}; }
  .miolo { min-height: 297mm; padding: 16mm 16mm 14mm 18mm; background: ${paleta.papel}; border-left: 3.2mm solid ${paleta.acento}; display: flex; flex-direction: column; }
  .topo { display: flex; align-items: center; gap: 5mm; margin-bottom: 11mm; }
  .marca-p { min-height: 12mm; min-width: 12mm; padding: 1.6mm 2mm; border-radius: 2.5mm; }
  .marca-p img, .marca-p svg { height: 8mm; max-width: 28mm; }
  .topo-txt b { display: block; font-family: "Iowan Old Style", Palatino, "Noto Serif", Georgia, serif; font-size: 13pt; font-weight: 560; letter-spacing: -.01em; }
  .topo-txt small { color: ${paleta.acento}; letter-spacing: .16em; text-transform: uppercase; font-size: 8pt; }
  .miolo section { margin: 0 0 9mm; }
  h2 { margin: 0 0 3.5mm; font-size: 8.5pt; letter-spacing: .22em; text-transform: uppercase; color: ${paleta.acento}; font-weight: 650; }
  .prosa { margin: 0; max-width: 165mm; font-family: "Iowan Old Style", Palatino, "Noto Serif", Georgia, serif; font-size: 12.5pt; line-height: 1.5; }
  .lista { list-style: none; margin: 0; padding: 0; }
  .lista li { display: flex; gap: 5mm; align-items: baseline; padding: 3.2mm 0; border-top: .25mm solid ${paleta.fio}; break-inside: avoid; }
  .lista span { color: ${paleta.acento}; font-size: 9pt; letter-spacing: .08em; width: 8mm; flex: none; font-variant-numeric: tabular-nums; }
  .lista p { margin: 0; font-size: 11pt; line-height: 1.4; }
  .time { list-style: none; margin: 0; padding: 0; }
  .time li { display: flex; justify-content: space-between; gap: 8mm; align-items: baseline; padding: 3.4mm 0; border-bottom: .25mm solid ${paleta.fio}; break-inside: avoid; }
  .time b { font-family: "Iowan Old Style", Palatino, "Noto Serif", Georgia, serif; font-size: 13pt; font-weight: 560; }
  .time em { font-style: normal; color: #6d675f; font-size: 9.5pt; text-align: right; max-width: 105mm; line-height: 1.35; }
  .contato-grade { display: flex; justify-content: space-between; gap: 10mm; align-items: flex-start; }
  .ct { margin: 0 0 3.6mm; }
  .ct small { display: block; letter-spacing: .16em; text-transform: uppercase; font-size: 7.5pt; color: ${paleta.acento}; margin-bottom: .6mm; }
  .ct b { font-weight: 560; font-size: 11.5pt; }
  .qrs { display: flex; gap: 6mm; flex: none; }
  .qr { margin: 0; text-align: center; }
  .caixa { width: 28mm; height: 28mm; background: #fff; border: .3mm solid ${paleta.fio}; padding: 1.4mm; }
  .caixa svg { width: 100%; height: 100%; display: block; }
  .qr figcaption { margin-top: 1.5mm; font-size: 7.5pt; letter-spacing: .14em; text-transform: uppercase; color: #6d675f; }
  .rodape { margin-top: auto; padding-top: 8mm; display: flex; justify-content: space-between; gap: 8mm; font-size: 8pt; letter-spacing: .04em; color: #8a8378; }
</style></head><body>
${capa}
${miolo}
</body></html>`;
}

async function arteDataUrl(arte: string | undefined, buscar: Buscar): Promise<string | undefined> {
  const t = espaco(arte);
  if (!t) return undefined;
  if (t.startsWith("data:image/")) return t.slice(0, 6_000_000);
  let buf: Buffer | null = null;
  let ext = "";
  if (/^https?:\/\//i.test(t)) {
    buf = await baixar(buscar, t, 4_000_000);
    ext = (buf && magia(buf)) || "";
  } else {
    buf = lerLogoLocal(t);
    ext = (buf && (magia(buf) || path.extname(t).toLowerCase())) || "";
  }
  if (!buf || !ext || !EXT_OK.has(ext)) return undefined;
  return dataUrlDe(buf, ext);
}

/** Monta o HTML já com logo, paleta e QR. Não busca rede se o logo veio pronto. */
export async function montarApresentacao(ficha: FichaApresentacao, opcoes: { buscar?: Buscar } = {}): Promise<string> {
  const buscar = opcoes.buscar ?? fetch;
  let paleta = PALETA_PADRAO;
  let logoHtml: string | undefined;
  try {
    const logo = await bytesDoLogo(ficha, buscar);
    if (logo) {
      paleta = await paletaDoLogo(logo.buf, logo.ext);
      logoHtml = `<img src="${dataUrlDe(logo.buf, logo.ext)}" alt="">`;
    }
  } catch { /* sem logo: monograma */ }
  let arte: string | undefined;
  try { arte = await arteDataUrl(ficha.arte, buscar); } catch { /* capa sem foto */ }
  return renderizarFolha(ficha, { paleta, logoHtml, arteDataUrl: arte });
}

/** Recibo curto do fim do onboarding — não é a folha de apresentação. */
export function htmlDoRecap(nome: string, linhas: string[], quando = new Date()): string {
  const itens = linhas.map((l) => espaco(l)).filter(Boolean);
  const p = PALETA_PADRAO;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(nome)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: Inter, "Segoe UI", Arial, sans-serif; color: ${p.tinta}; }
  .folha { min-height: 297mm; padding: 22mm 18mm; background: ${p.papel}; border-left: 3.2mm solid ${p.acento}; }
  p.olho { letter-spacing: .22em; text-transform: uppercase; color: ${p.acento}; font-size: 9pt; margin: 0 0 4mm; }
  h1 { font-family: "Iowan Old Style", Palatino, "Noto Serif", Georgia, serif; font-weight: 560; font-size: 32pt; margin: 0 0 8mm; letter-spacing: -.02em; }
  li { margin: 3mm 0; font-size: 12pt; line-height: 1.4; }
  footer { margin-top: 16mm; color: #8a8378; font-size: 9pt; }
</style></head><body><div class="folha">
  <p class="olho">Primeiros passos</p>
  <h1>${esc(espaco(nome) || "Empresa")}</h1>
  ${itens.length ? `<ul>${itens.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
  <footer>MyBots · ${esc(dataLonga(quando))}</footer>
</div></body></html>`;
}

// ---------------------------------------------------------------- impressão

function rodar(cmd: string, args: string[], entrada?: string): Promise<void> {
  return new Promise((ok, erro) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let saida = "";
    p.stderr.on("data", (d) => { saida += String(d); });
    p.on("error", (e) => erro(e));
    p.on("close", (c) => (c === 0 ? ok() : erro(new Error(saida.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 240) || `codigo ${c}`))));
    if (entrada !== undefined) { p.stdin.write(entrada); p.stdin.end(); }
  });
}

/** Imprime HTML em PDF pelo Chrome, o mesmo caminho de gerar_pdf. */
export async function pdfDeHtml(html: string): Promise<Buffer> {
  const script = path.join(raizDoProjeto(), "scripts", "documento.py");
  const dir = await mkdtemp(path.join(os.tmpdir(), "mybots-folha-"));
  const saida = path.join(dir, "folha.pdf");
  const tentativas = [process.env.MYBOTS_PYTHON, "python", "py", "python3"].filter(Boolean) as string[];
  const falhas: string[] = [];
  let real: Error | null = null;
  try {
    for (const exe of tentativas) {
      try {
        await rodar(exe, [script, "--html", "-", "--saida", saida, "--modelo", "nenhum", "--titulo", "Apresentação"], html);
        const data = await readFile(saida);
        if (data.length < 800 || data.subarray(0, 4).toString() !== "%PDF") throw new Error("o arquivo não é um PDF");
        return data;
      } catch (e) {
        const err = e as Error & { code?: string };
        falhas.push(exe + ": " + (err.code === "ENOENT" ? "não está no PATH" : err.message));
        if (err.code !== "ENOENT") real = err;
      }
    }
    if (real) throw real;
    throw new Error("nenhum Python encontrado pelo Hub (" + falhas.join("; ") + "). Defina MYBOTS_PYTHON no .env com o caminho completo do python.exe.");
  } finally {
    await unlink(saida).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
