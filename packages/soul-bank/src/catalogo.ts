import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Allowlist, Alma, ArquivoPinado, ItemAllowlist, NivelPermissao, Permissoes, Segredo } from "./tipos.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

export function raizDoBanco(): string {
  return path.resolve(AQUI, "..");
}

export function repoRoot(): string {
  return path.resolve(raizDoBanco(), "..", "..");
}

/** WhatsApp Web e pontes não oficiais. O canal da Meta usa underscore, então não cai aqui. */
export const PADROES_PROIBIDOS: RegExp[] = [
  /baileys/i,
  /whatsapp-web/i,
  /wwebjs/i,
  /whiskeysockets/i,
  /lharries\/whatsapp-mcp/i,
  /@open-wa\b/i,
];

const ACOES_QUE_PEDEM_OK = ["enviarMensagens", "gravarDados", "gastarDinheiro", "apagar", "publicar"] as const;

const VAZAMENTO = /(?:sk-[a-zA-Z0-9]{10,}|ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9]{10,}|xox[baprs]-|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9\-._]{20,})/;

export function sha256Arquivo(arquivo: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(arquivo)).digest("hex");
}

export function sha256Texto(texto: string): string {
  return crypto.createHash("sha256").update(texto).digest("hex");
}

function lerJson<T>(rel: string): T {
  const abs = path.join(raizDoBanco(), rel);
  return JSON.parse(fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, "")) as T;
}

export function carregarAllowlist(): Allowlist {
  return lerJson<Allowlist>("allowlist.json");
}

function personaDe(bruto: { persona: string | string[] }): string {
  return Array.isArray(bruto.persona) ? bruto.persona.join("\n") : String(bruto.persona ?? "");
}

export function carregarAlmas(): Alma[] {
  const dir = path.join(raizDoBanco(), "almas");
  return fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort().map((nome) => {
    const bruto = lerJson<Alma & { persona: string | string[] }>(path.join("almas", nome));
    return { ...bruto, persona: personaDe(bruto) };
  });
}

export function itemPorId(id: string, allow = carregarAllowlist()): ItemAllowlist | undefined {
  return allow.itens.find((i) => i.id === id);
}

export function textoProibido(texto: string): string | null {
  for (const r of PADROES_PROIBIDOS) {
    if (r.test(texto)) return r.source;
  }
  return null;
}

export function temLatest(texto: string): boolean {
  return /(^|[^a-z])latest([^a-z]|$)/i.test(texto) || /@\*|@\^|@~/.test(texto);
}

function caminhar(dir: string): string[] {
  const saida: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) saida.push(...caminhar(abs));
    else saida.push(abs);
  }
  return saida.sort();
}

export function arquivosDaPasta(pastaVendor: string): ArquivoPinado[] {
  const abs = path.join(raizDoBanco(), pastaVendor);
  return caminhar(abs).map((arquivo) => ({
    caminho: path.relative(abs, arquivo).split(path.sep).join("/"),
    sha256: sha256Arquivo(arquivo),
  }));
}

function vazar(valor: unknown, caminho: string, erros: string[]) {
  if (typeof valor === "string") {
    if (VAZAMENTO.test(valor)) erros.push(`${caminho} parece segredo`);
    return;
  }
  if (Array.isArray(valor)) {
    valor.forEach((v, i) => vazar(v, `${caminho}[${i}]`, erros));
    return;
  }
  if (!valor || typeof valor !== "object") return;
  for (const [k, v] of Object.entries(valor)) {
    if (/^(apiKey|token|senha|secret|password|accessToken)$/i.test(k) && typeof v === "string" && v && !v.startsWith("{env:") && !v.startsWith("{cofre:")) {
      erros.push(`${caminho}.${k} guarda um valor; use o id do cofre`);
    }
    vazar(v, `${caminho}.${k}`, erros);
  }
}

function segredoValido(s: Segredo, onde: string, erros: string[]) {
  if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(s.cofreId)) erros.push(`${onde}: cofreId inválido (${s.cofreId})`);
  if (!s.uso?.trim()) erros.push(`${onde}: segredo sem uso`);
  if (s.env && !/^[A-Z][A-Z0-9_]+$/.test(s.env)) erros.push(`${onde}: env inválida`);
  const extra = s as Segredo & { valor?: string };
  if (extra.valor) erros.push(`${onde}: segredo não pode ter valor`);
}

function nivelOk(v: string): v is NivelPermissao {
  return v === "nao" || v === "sim" || v === "confirma";
}

function checarPermissoes(p: Permissoes, onde: string, erros: string[]) {
  for (const chave of ["rede", ...ACOES_QUE_PEDEM_OK] as const) {
    const v = p[chave];
    if (!nivelOk(v)) erros.push(`${onde}: permissão ${chave} inválida`);
    else if (chave !== "rede" && v === "sim") erros.push(`${onde}: ${chave} não pode nascer ligado; use "confirma" ou "nao"`);
  }
}

/** Conferência do banco inteiro. Lista vazia = pode nascer. */
export function auditar(): string[] {
  const erros: string[] = [];
  const allow = carregarAllowlist();
  if (allow.versao !== 1) erros.push("allowlist com versão inesperada");
  vazar(allow, "allowlist", erros);
  const ids = new Set<string>();
  const commits = new Map<string, string>();
  for (const item of allow.itens) {
    if (ids.has(item.id)) erros.push(`id repetido: ${item.id}`);
    ids.add(item.id);
    const blob = JSON.stringify({ comando: item.comando, url: item.url, versao: item.versao, npm: item.npm, opencode: item.opencode });
    if (temLatest(blob)) erros.push(`${item.id} usa latest ou faixa solta`);
    if (textoProibido(blob) || textoProibido(item.id)) erros.push(`${item.id} cai na lista proibida`);
    if (item.tipo === "mcp" && !item.commit && !item.integridade && !item.contratoSha256) {
      erros.push(`${item.id} sem pin (commit, integridade npm ou checksum de contrato)`);
    }
    if (item.tipo === "skill" && !item.commit && !item.contratoSha256 && !(item.arquivos && item.arquivos.length)) {
      erros.push(`${item.id} sem pin de skill`);
    }
    if (item.repositorio && item.commit) {
      const anterior = commits.get(item.repositorio);
      if (anterior && anterior !== item.commit) erros.push(`${item.repositorio} pinado em dois commits`);
      commits.set(item.repositorio, item.commit);
    }
    if (item.pastaVendor) {
      const disco = arquivosDaPasta(item.pastaVendor);
      const gravado = item.arquivos ?? [];
      if (disco.length !== gravado.length) erros.push(`${item.id}: allowlist tem ${gravado.length} arquivos, a pasta tem ${disco.length}`);
      for (const arq of disco) {
        const achou = gravado.find((g) => g.caminho === arq.caminho);
        if (!achou) erros.push(`${item.id}: falta ${arq.caminho} na allowlist`);
        else if (achou.sha256 !== arq.sha256) erros.push(`${item.id}: checksum de ${arq.caminho} não bate`);
      }
    }
    if (item.contrato) {
      const abs = path.join(raizDoBanco(), item.contrato);
      if (!fs.existsSync(abs)) erros.push(`${item.id}: contrato ausente`);
      else if (sha256Arquivo(abs) !== item.contratoSha256) erros.push(`${item.id}: checksum do contrato não bate`);
    }
    for (const s of item.segredos ?? []) segredoValido(s, item.id, erros);
    if (item.permissoes) checarPermissoes(item.permissoes, item.id, erros);
    if (item.opcional && item.padrao !== false) erros.push(`${item.id} é opcional mas não está desligado por padrão`);
  }
  const documentados = allow.proibidos.flatMap((p) => p.padroes);
  for (const preciso of ["baileys", "whatsapp-web", "wwebjs", "whiskeysockets", "lharries/whatsapp-mcp"]) {
    if (!documentados.some((p) => p.includes(preciso))) erros.push(`lista proibida sem ${preciso}`);
  }
  const almas = carregarAlmas();
  const almaIds = new Set<string>();
  for (const alma of almas) {
    if (almaIds.has(alma.id)) erros.push(`alma repetida: ${alma.id}`);
    almaIds.add(alma.id);
    if (!alma.persona.trim()) erros.push(`${alma.id} sem persona`);
    checarPermissoes(alma.permissoes, alma.id, erros);
    vazar(alma, alma.id, erros);
    for (const s of alma.segredos) segredoValido(s, alma.id, erros);
    for (const id of [...alma.skills, ...alma.mcps]) {
      const item = itemPorId(id, allow);
      if (!item) erros.push(`${alma.id} cita ${id}, que não está na allowlist`);
      else if (textoProibido(id)) erros.push(`${alma.id} cita item proibido ${id}`);
    }
    if (alma.mcps.includes("bling.mcp") || alma.skills.includes("casa.bling-opcional")) {
      erros.push(`${alma.id} liga o Bling sozinho; ele só entra se a pessoa marcar`);
    }
  }
  const bling = itemPorId("bling.mcp", allow);
  if (!bling || bling.padrao !== false || bling.url !== "https://mcp.bling.com.br/mcp") erros.push("Bling precisa existir, desligado, na URL oficial");
  const wa = itemPorId("meta.whatsapp-business-tools", allow);
  if (!wa || wa.url !== "https://mcp.facebook.com/whatsapp_business_tools") erros.push("WhatsApp oficial sem a URL da Meta");
  const financeiro = almas.find((a) => a.id === "financeiro");
  if (!financeiro || financeiro.mcps.some((id) => id !== "balao-sistema")) erros.push("Financeiro tem de usar só o balao-sistema");
  const atendente = almas.find((a) => a.id === "atendente-whatsapp");
  if (!atendente || !atendente.mcps.includes("meta.whatsapp-business-tools")) erros.push("Atendente sem o MCP oficial da Meta");
  return erros;
}

export function exigeConfirmacao(p: Permissoes): boolean {
  return ACOES_QUE_PEDEM_OK.some((k) => p[k] === "confirma");
}

export function fundirPermissoes(a: Permissoes, b: Permissoes): Permissoes {
  const ordem: Record<NivelPermissao, number> = { nao: 0, sim: 1, confirma: 2 };
  const chaves = ["rede", "enviarMensagens", "gravarDados", "gastarDinheiro", "apagar", "publicar"] as const;
  const saida = { ...a };
  for (const k of chaves) saida[k] = ordem[a[k]] >= ordem[b[k]] ? a[k] : b[k];
  return saida;
}

export function unirSegredos(listas: Segredo[][]): Segredo[] {
  const vistos = new Set<string>();
  const saida: Segredo[] = [];
  for (const lista of listas) {
    for (const s of lista) {
      if (vistos.has(s.cofreId)) continue;
      vistos.add(s.cofreId);
      saida.push({ cofreId: s.cofreId, uso: s.uso, ...(s.env ? { env: s.env } : {}) });
    }
  }
  return saida;
}
