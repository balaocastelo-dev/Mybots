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
export interface ItemCofre {
  id: string;
  tipo: TipoItemCofre;
  titulo: string;
  usuario: string;
  url: string;
  senhaMascarada: string;
  bandeira: string;
  nomeNoCartao: string;
  finalNumero: string;
  validade: string;
  atualizadoEm: number;
}

/** O que o formulário manda uma vez. A camada cliente não devolve estes campos. */
export interface GravacaoCofre {
  tipo: TipoItemCofre;
  titulo: string;
  usuario?: string;
  url?: string;
  senha?: string;
  bandeira?: string;
  nomeNoCartao?: string;
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
  titulo: string;
  acao: string;
  quem: string;
  em: number;
}

const ACOES = new Set(["criou", "editou", "apagou", "permissao", "leu"]);
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
  const titulo = texto(o.titulo, 120);
  if (!tipo || !titulo) return null;
  const id = texto(o.id, 80) || idFallback || "";
  if (!id) return null;
  const finalInformado = typeof o.finalNumero === "string" && /^\d{4}$/.test(o.finalNumero) ? o.finalNumero : "";
  const finalNumero = finalInformado || finalDoNumero(o.numero);
  const senhaMascarada = tipo === "login"
    ? (typeof o.senhaMascarada === "string" && o.senhaMascarada && !pareceSegredo(o.senhaMascarada) ? MASCARA : (o.senha || o.senhaMascarada ? MASCARA : ""))
    : "";
  return {
    id,
    tipo,
    titulo,
    usuario: texto(o.usuario, 160),
    url: urlSegura(o.url),
    senhaMascarada,
    bandeira: texto(o.bandeira, 40),
    nomeNoCartao: texto(o.nomeNoCartao, 80),
    finalNumero,
    validade: validadeSegura(o.validade),
    atualizadoEm: typeof o.atualizadoEm === "number" && Number.isFinite(o.atualizadoEm) ? o.atualizadoEm : Date.now(),
  };
}

/** Monta o item que a lista guarda a partir do que a pessoa digitou. O retorno não carrega segredo. */
export function mascararGravacao(g: GravacaoCofre, id: string, anterior?: ItemCofre | null): ItemCofre {
  const titulo = g.titulo.trim().slice(0, 120);
  const tipo = g.tipo === "cartao" ? "cartao" : "login";
  const finalNovo = finalDoNumero(g.numero);
  return {
    id,
    tipo,
    titulo,
    usuario: tipo === "login" ? (g.usuario ?? anterior?.usuario ?? "").trim().slice(0, 160) : "",
    url: tipo === "login" ? urlSegura(g.url ?? anterior?.url ?? "") : "",
    senhaMascarada: tipo === "login" ? (g.senha && g.senha.trim() ? MASCARA : (anterior?.senhaMascarada ?? "")) : "",
    bandeira: tipo === "cartao" ? (g.bandeira ?? anterior?.bandeira ?? "").trim().slice(0, 40) : "",
    nomeNoCartao: tipo === "cartao" ? (g.nomeNoCartao ?? anterior?.nomeNoCartao ?? "").trim().slice(0, 80) : "",
    finalNumero: tipo === "cartao" ? (finalNovo || anterior?.finalNumero || "") : "",
    validade: tipo === "cartao" ? (validadeSegura(g.validade) || anterior?.validade || "") : "",
    atualizadoEm: Date.now(),
  };
}

export function linhaAuditoriaSegura(bruto: unknown): LinhaAuditoria | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const id = texto(o.id, 80);
  const acao = typeof o.acao === "string" && ACOES.has(o.acao) ? o.acao : "";
  if (!id || !acao) return null;
  return {
    id,
    itemId: texto(o.itemId, 80),
    titulo: texto(o.titulo, 120),
    acao,
    quem: texto(o.quem, 80) || "painel",
    em: typeof o.em === "number" && Number.isFinite(o.em) ? o.em : Date.now(),
  };
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

function urlSegura(v: unknown): string {
  const s = texto(v, 300);
  if (!s) return "";
  if (/^(https?:\/\/|\/)/i.test(s)) return s;
  return "";
}

function validadeSegura(v: unknown): string {
  const s = texto(v, 7);
  return /^(0[1-9]|1[0-2])\/\d{2}$/.test(s) ? s : "";
}

/** Máscara que ainda contém letra ou dígito não entra na tela. */
function pareceSegredo(s: string): boolean {
  return /[A-Za-z0-9]/.test(s);
}
