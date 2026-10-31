// Campos que a tela pode guardar e mostrar. Qualquer outra chave que venha
// no JSON (senha, número completo, cvv, token) é descartada aqui, antes de
// chegar no estado do React e antes de qualquer log.

export const ESTADOS_MAQUINA = ["ligado", "desligado", "ligando", "erro", "sem-provedor"] as const;
export type EstadoMaquina = (typeof ESTADOS_MAQUINA)[number];
export type TipoMaquina = "pc" | "android";

export interface Maquina {
  botId: string;
  empresaId: string;
  tipo: TipoMaquina;
  estado: EstadoMaquina;
  porta: number | null;
  ultimoUso: number | null;
  acessoLiberado: boolean;
}

export type TipoItemCofre = "login" | "cartao";

/** O que a lista mostra. Não tem senha, número completo nem cvv. */
/** O que a lista mostra. Igual ao item público do PR #16: sem senha, número nem cvv. */
export interface ItemCofre {
  id: string;
  tipo: TipoItemCofre;
  nome: string;
  site: string;
  usuario: string;
  senhaMascarada: string;
  titular: string;
  finalNumero: string;
  validade: string;
  criadoEm: number;
  atualizadoEm: number;
}

/** O que o formulário manda uma vez. A camada cliente não devolve estes campos. */
/** O formulário manda uma vez. `notas`, `senha`, `numero` e `cvv` não voltam na resposta. */
export interface GravacaoCofre {
  tipo: TipoItemCofre;
  nome: string;
  site?: string;
  usuario?: string;
  senha?: string;
  notas?: string;
  titular?: string;
  numero?: string;
  validade?: string;
  cvv?: string;
}

export interface PermissaoCofre {
  botId: string;
  liberado: boolean;
}

export interface LinhaAuditoria {
  id: string;
  itemId: string;
  nome: string;
  acao: string;
  resultado: string;
  quem: string;
  em: number;
}

const ACOES = new Set(["criar", "editar", "apagar", "permissao", "preencher", "criou", "editou", "apagou", "leu"]);
const MASCARA = "••••••••";

export function ehEstado(v: unknown): v is EstadoMaquina {
  return typeof v === "string" && (ESTADOS_MAQUINA as readonly string[]).includes(v);
}

export function normalizarMaquina(bruto: unknown): Maquina | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const botId = texto(o.botId, 80);
  const tipo: TipoMaquina | null = o.tipo === "pc" || o.tipo === "android" ? o.tipo : null;
  if (!botId || !tipo || !ehEstado(o.estado)) return null;
  const porta = typeof o.porta === "number" && Number.isFinite(o.porta) && o.porta > 0 && o.porta < 65536 ? Math.trunc(o.porta) : null;
  const ultimoUso = typeof o.ultimoUso === "number" && Number.isFinite(o.ultimoUso) ? o.ultimoUso : null;
  return {
    botId,
    empresaId: texto(o.empresaId, 80),
    tipo,
    estado: o.estado,
    porta,
    ultimoUso,
    acessoLiberado: o.acessoLiberado === true,
  };
}

/** Quatro finais só quando o número tem tamanho de cartão. Um número curto não vaza inteiro. */
export function finalDoNumero(numero: unknown): string {
  if (typeof numero !== "string") return "";
  const digitos = numero.replace(/\D/g, "");
  if (digitos.length < 12 || digitos.length > 19) return "";
  return digitos.slice(-4);
}

export function itemSeguro(bruto: unknown, idFallback?: string): ItemCofre | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const tipo: TipoItemCofre | null = o.tipo === "login" || o.tipo === "cartao" ? o.tipo : null;
  const nome = texto(o.nome, 120) || texto(o.titulo, 120);
  if (!tipo || !nome) return null;
  const id = texto(o.id, 80) || idFallback || "";
  if (!id) return null;
  const agora = Date.now();
  const finalInformado = typeof o.finalNumero === "string" && /^\d{4}$/.test(o.finalNumero) ? o.finalNumero : "";
  const finalNumero = finalInformado || finalDoNumero(o.numero);
  const senhaMascarada = tipo === "login"
    ? (typeof o.senhaMascarada === "string" && o.senhaMascarada && !pareceSegredo(o.senhaMascarada) ? MASCARA : (o.senha || o.senhaMascarada ? MASCARA : ""))
    : "";
  return {
    id,
    tipo,
    nome,
    site: tipo === "login" ? siteSeguro(o.site ?? o.url) : "",
    usuario: tipo === "login" ? texto(o.usuario, 200) : "",
    senhaMascarada,
    titular: tipo === "cartao" ? texto(o.titular, 120) || texto(o.nomeNoCartao, 120) : "",
    finalNumero: tipo === "cartao" ? finalNumero : "",
    validade: tipo === "cartao" ? validadeSegura(o.validade) : "",
    criadoEm: typeof o.criadoEm === "number" && Number.isFinite(o.criadoEm) ? o.criadoEm : agora,
    atualizadoEm: typeof o.atualizadoEm === "number" && Number.isFinite(o.atualizadoEm) ? o.atualizadoEm : agora,
  };
}

/** Monta o item que a lista guarda a partir do que a pessoa digitou. O retorno não carrega segredo. */
export function mascararGravacao(g: GravacaoCofre, id: string, anterior?: ItemCofre | null): ItemCofre {
  const nome = g.nome.trim().slice(0, 120);
  const tipo = g.tipo === "cartao" ? "cartao" : "login";
  const finalNovo = finalDoNumero(g.numero);
  const agora = Date.now();
  return {
    id,
    tipo,
    nome,
    site: tipo === "login" ? (siteSeguro(g.site ?? "") || anterior?.site || "") : "",
    usuario: tipo === "login" ? (g.usuario ?? anterior?.usuario ?? "").trim().slice(0, 200) : "",
    senhaMascarada: tipo === "login" ? (g.senha && g.senha.trim() ? MASCARA : (anterior?.senhaMascarada ?? "")) : "",
    titular: tipo === "cartao" ? (g.titular ?? anterior?.titular ?? "").trim().slice(0, 120) : "",
    finalNumero: tipo === "cartao" ? (finalNovo || anterior?.finalNumero || "") : "",
    validade: tipo === "cartao" ? (validadeSegura(g.validade) || anterior?.validade || "") : "",
    criadoEm: anterior?.criadoEm ?? agora,
    atualizadoEm: agora,
  };
}

export function linhaAuditoriaSegura(bruto: unknown): LinhaAuditoria | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const id = typeof o.id === "number" && Number.isFinite(o.id) ? String(o.id) : texto(o.id, 80);
  const acaoBruta = typeof o.acao === "string" ? o.acao : "";
  const acao = ACOES.has(acaoBruta) ? acaoBruta : "";
  if (!id || !acao) return null;
  const em = typeof o.quando === "number" ? o.quando : typeof o.em === "number" ? o.em : Date.now();
  return {
    id,
    itemId: o.itemId == null ? "" : texto(o.itemId, 80),
    nome: texto(o.nome, 120) || texto(o.titulo, 120),
    acao,
    resultado: textoSeguro(o.resultado, 40),
    quem: texto(o.quem, 80) || "painel",
    em,
  };
}

export function botIdsSeguros(bruto: unknown): string[] {
  const lista = Array.isArray(bruto)
    ? bruto
    : (bruto && typeof bruto === "object" && Array.isArray((bruto as { botIds?: unknown }).botIds) ? (bruto as { botIds: unknown[] }).botIds : null);
  if (!lista) return [];
  const ids = lista.map((x) => typeof x === "string" ? texto(x, 80) : "").filter((id) => /^[A-Za-z0-9_.-]{1,80}$/.test(id));
  return [...new Set(ids)];
}

export function permissaoSegura(bruto: unknown): PermissaoCofre | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const botId = texto(o.botId, 80);
  if (!botId) return null;
  return { botId, liberado: o.liberado === true };
}

function texto(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
}

function siteSeguro(v: unknown): string {
  const s = texto(v, 300);
  if (!s || /^(javascript|data):/i.test(s)) return "";
  return s;
}

function textoSeguro(v: unknown, max: number): string {
  const s = texto(v, max);
  if (!s || pareceSegredo(s) && /\d{8,}/.test(s)) return "";
  if (/senha|cvv|numero|token|secret/i.test(s) && /[A-Za-z0-9]{8,}/.test(s)) return "";
  return s;
}

function validadeSegura(v: unknown): string {
  const s = texto(v, 7);
  return /^(0[1-9]|1[0-2])\/\d{2}$/.test(s) ? s : "";
}

/** Máscara que ainda contém letra ou dígito não entra na tela. */
function pareceSegredo(s: string): boolean {
  return /[A-Za-z0-9]/.test(s);
}
