/**
 * Celular do bot — só o gancho.
 *
 * O aparelho principal é um telefone de verdade no Wi-Fi. Outro módulo, à parte
 * deste, faz `adb pair` / `adb connect` no PC host (IP, porta e código ficam no
 * cadastro daquele módulo) e registra um provedor. Redroid, se existir, é só
 * fallback: outro provedor, com prioridade menor.
 *
 * Este arquivo não cria container, não chama o Docker e não chama o adb.
 * Sem provedor que resolva o bot, a rota /android/<botId>/ responde 503.
 */

export type AlvoAparelho = {
  tipo: "aparelho";
  serial: string;
  host: string;
  porta: number;
};

export type AlvoContainer = {
  tipo: "container";
  nome: string;
  host: string;
  porta: number;
};

/** Para onde o stream do celular deve ir. Quem resolve é o provedor, não esta rota. */
export type AlvoAndroid = AlvoAparelho | AlvoContainer;

export type ProvedorAndroid = {
  id: string;
  /** Maior ganha. O aparelho real registra acima do redroid. */
  prioridade: number;
  /** `null` = este provedor não atende o bot; tenta o próximo. */
  resolver(botId: string): Promise<AlvoAndroid | null>;
};

export type ContextoAndroid = { botId: string; alvo: AlvoAndroid };

/**
 * Quem for implementar o stream registra isto. Se devolver `{ status, corpo }`,
 * a rota usa essa resposta. Se não houver tratador, a rota só descreve o alvo
 * — não abre socket e não liga container.
 */
export type TratadorAndroid = (ctx: ContextoAndroid) => Promise<{ status: number; corpo: unknown } | void> | { status: number; corpo: unknown } | void;

const provedores = new Map<string, ProvedorAndroid>();
let tratador: TratadorAndroid | null = null;

const ID_PROVEDOR = /^[a-zA-Z0-9_.-]{1,40}$/;

export function registrarProvedorAndroid(p: ProvedorAndroid): void {
  if (!ID_PROVEDOR.test(p.id)) throw new Error("id de provedor android inválido");
  if (!Number.isFinite(p.prioridade)) throw new Error("prioridade de provedor android inválida");
  provedores.set(p.id, p);
}

export function removerProvedorAndroid(id: string): void {
  provedores.delete(id);
}

/** Só para teste: o processo do Hub não chama isto. */
export function limparProvedoresAndroid(): void {
  provedores.clear();
  tratador = null;
}

export function listarProvedoresAndroid(): Array<{ id: string; prioridade: number }> {
  return [...provedores.values()]
    .map((p) => ({ id: p.id, prioridade: p.prioridade }))
    .sort((a, b) => b.prioridade - a.prioridade || a.id.localeCompare(b.id));
}

export function definirTratadorAndroid(fn: TratadorAndroid | null): void {
  tratador = fn;
}

export function tratadorAndroid(): TratadorAndroid | null {
  return tratador;
}

function alvoAceito(alvo: AlvoAndroid): boolean {
  const porta = alvo.porta;
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) return false;
  if (porta === 8787 || porta === 8791) return false;
  if (!alvo.host || alvo.host.length > 200 || /[\s/\\]/.test(alvo.host)) return false;
  if (alvo.tipo === "aparelho") return !!alvo.serial && alvo.serial.length < 200 && !alvo.serial.includes("..");
  if (alvo.tipo === "container") return !!alvo.nome && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(alvo.nome);
  return false;
}

/**
 * Primeiro provedor, por prioridade, que devolver um alvo válido. Provedor que
 * lança ou devolve lixo é pulado — o fallback (se alguém registrou) ainda corre.
 * Lista vazia devolve null. Não liga nada.
 */
export async function resolverAlvoAndroid(botId: string): Promise<AlvoAndroid | null> {
  const ordem = [...provedores.values()].sort((a, b) => b.prioridade - a.prioridade || a.id.localeCompare(b.id));
  for (const p of ordem) {
    let alvo: AlvoAndroid | null = null;
    try { alvo = await p.resolver(botId); } catch { continue; }
    if (!alvo) continue;
    if (!alvoAceito(alvo)) continue;
    return alvo;
  }
  return null;
}

export function rotaAndroid(botId: string) {
  return `/android/${botId}/`;
}

/** Id numa URL /android/<id>/... — null se o caminho não for esse. */
export function idDoAndroid(url: string): string | null {
  const bruto = String(url ?? "");
  if (bruto.includes("..") || bruto.toLowerCase().includes("%2e%2e")) return null;
  let pathname = bruto.split("?")[0];
  try { pathname = new URL(bruto, "http://127.0.0.1").pathname; } catch { /* fica o corte cru */ }
  if (pathname.includes("..")) return null;
  const m = /^\/android\/([a-zA-Z0-9_.-]{1,60})(?:\/|$)/.exec(pathname);
  return m ? m[1] : null;
}
