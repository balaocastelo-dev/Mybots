/**
 * A ponte da tela só conhece destinos com nome. O navegador manda "mac" ou
 * "empresa:balao" — nunca um IP, uma porta ou um caminho. O endereço sai daqui.
 *
 * A faixa 7901–8100 é a das telas que o Hub publica em 127.0.0.1. A 8787 é de
 * outro sistema e fica de fora desta conta de propósito.
 */

export const FAIXA_TELA_EMPRESA = { min: 7901, max: 8100 };

export type AlvoVnc = { host: string; porta: number };

const ID_EMPRESA = /^[a-zA-Z0-9_.-]{1,60}$/;

export function idSeguro(id: string): boolean {
  return ID_EMPRESA.test(id);
}

export function portaDeEmpresaPermitida(porta: number): boolean {
  return Number.isInteger(porta) && porta >= FAIXA_TELA_EMPRESA.min && porta <= FAIXA_TELA_EMPRESA.max;
}

function hostDoMac(host: string): boolean {
  return !!host && host.length < 200 && !/[\s/\\@:]/.test(host);
}

function portaSolta(porta: number): boolean {
  return Number.isInteger(porta) && porta > 0 && porta < 65536 && porta !== 8787;
}

/**
 * Resolve o destino da ponte. `portaDaEmpresa` devolve SÓ o número que o Hub
 * atribuiu (ou null). O host da empresa é sempre o loopback — o parâmetro não
 * tem como pedir outro lugar.
 */
export function alvoDaPonte(
  destino: string,
  opcoes: {
    mac: AlvoVnc;
    portaDaEmpresa?: (empresaId: string) => number | null;
  },
): AlvoVnc | null {
  const d = String(destino ?? "").trim() || "mac";
  if (d.includes("..") || /[\s/\\]/.test(d)) return null;
  if (d === "mac") {
    if (!hostDoMac(opcoes.mac.host) || !portaSolta(opcoes.mac.porta)) return null;
    return { host: opcoes.mac.host, porta: opcoes.mac.porta };
  }
  if (!d.startsWith("empresa:")) return null;
  const id = d.slice("empresa:".length);
  if (!idSeguro(id)) return null;
  const porta = opcoes.portaDaEmpresa?.(id) ?? null;
  if (!portaDeEmpresaPermitida(porta ?? NaN)) return null;
  return { host: "127.0.0.1", porta: porta as number };
}

function caminhoSuspeito(url: string): boolean {
  const bruto = String(url ?? "");
  return bruto.includes("..") || bruto.toLowerCase().includes("%2e%2e");
}

/** Id da empresa numa URL /pc/<id>/... — null se o caminho não for esse. */
export function idDaTela(url: string): string | null {
  if (caminhoSuspeito(url)) return null;
  const bruto = String(url ?? "");
  let pathname = bruto.split("?")[0];
  try { pathname = new URL(bruto, "http://127.0.0.1").pathname; } catch { /* fica o corte cru */ }
  if (pathname.includes("..")) return null;
  const m = /^\/pc\/([a-zA-Z0-9_.-]{1,60})(?:\/|$)/.exec(pathname);
  return m ? m[1] : null;
}

/** Caminho que o navegador pediu em /pc/<id>/... A senha da interface (k) não vai junto. */
export function caminhoDaTela(url: string): string | null {
  if (caminhoSuspeito(url) || !idDaTela(url)) return null;
  try {
    const u = new URL(url, "http://127.0.0.1");
    if (u.pathname.includes("..")) return null;
    u.searchParams.delete("k");
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

/**
 * O que o container recebe. O Selkies 2.1.0 serve o desktop na raiz (/) e o
 * websocket em /api/websockets. A subpasta /pc/<id>/ fica só no Hub.
 */
export function caminhoNoContainer(url: string): string | null {
  const cheio = caminhoDaTela(url);
  const id = idDaTela(url);
  if (!cheio || !id) return null;
  try {
    const u = new URL(cheio, "http://127.0.0.1");
    const prefixo = `/pc/${id}`;
    let path = u.pathname;
    if (path === prefixo) path = "/";
    else if (path.startsWith(prefixo + "/")) path = path.slice(prefixo.length) || "/";
    else return null;
    if (!path.startsWith("/")) path = "/" + path;
    return path + u.search;
  } catch {
    return null;
  }
}
