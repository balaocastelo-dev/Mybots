import {
  APK_PADRAO,
  USO_GRATIS,
  estaNoAplicativo,
  normalizarFicha,
  type FichaCasa,
  type SinaisApp,
} from "@mybots/shared";

export const CHAVE_NOME = "mybots.conta.nome";
export const AVISO_WINDOWS = "O instalador ainda não foi publicado.";
export const AVISO_SUPORTE = "O canal de suporte ainda não foi publicado nesta casa.";

export type ItemMenu =
  | { id: "uso"; tipo: "info"; rotulo: string }
  | { id: "apk"; tipo: "link"; rotulo: "Baixar para celular"; href: string }
  | { id: "windows"; tipo: "link"; rotulo: "Baixar para Windows"; href: string }
  | { id: "windows"; tipo: "aviso"; rotulo: "Baixar para Windows"; aviso: string }
  | { id: "suporte"; tipo: "link"; rotulo: "Suporte"; href: string }
  | { id: "suporte"; tipo: "acao"; rotulo: "Suporte" }
  | { id: "config"; tipo: "acao"; rotulo: "Configurações" }
  | { id: "sair"; tipo: "acao"; rotulo: "Sair" };

function limpar(v: string | undefined): string {
  return (v ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80);
}

/** Nome do rodapé. O que a pessoa gravou neste navegador vem primeiro. */
export function nomeVisivel(opts: { nome?: string; email?: string; local?: string }): string {
  const local = limpar(opts.local);
  if (local) return local;
  const nome = limpar(opts.nome);
  if (nome && !nome.includes("@")) return nome;
  const email = limpar(opts.email);
  if (email.includes("@")) {
    const parte = email.split("@")[0].replace(/[._-]+/g, " ").trim();
    if (parte) return parte;
  }
  if (nome) return nome.split("@")[0] || "Chefe";
  if (email) return email;
  return "Chefe";
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "MB";
  const letra = (p: string) => Array.from(p)[0] ?? "";
  if (partes.length === 1) return (letra(partes[0]) + (Array.from(partes[0])[1] ?? "")).toUpperCase();
  return (letra(partes[0]) + letra(partes[partes.length - 1])).toUpperCase();
}

export function itensDoMenu(casa: FichaCasa, noApp: boolean): ItemMenu[] {
  const itens: ItemMenu[] = [
    { id: "uso", tipo: "info", rotulo: USO_GRATIS },
    { id: "apk", tipo: "link", rotulo: "Baixar para celular", href: casa.apk || APK_PADRAO },
  ];
  if (!noApp) {
    itens.push(casa.windows
      ? { id: "windows", tipo: "link", rotulo: "Baixar para Windows", href: casa.windows }
      : { id: "windows", tipo: "aviso", rotulo: "Baixar para Windows", aviso: AVISO_WINDOWS });
  }
  itens.push(casa.suporte
    ? { id: "suporte", tipo: "link", rotulo: "Suporte", href: casa.suporte }
    : { id: "suporte", tipo: "acao", rotulo: "Suporte" });
  itens.push({ id: "config", tipo: "acao", rotulo: "Configurações" });
  itens.push({ id: "sair", tipo: "acao", rotulo: "Sair" });
  return itens;
}

export function lerSinaisApp(win: Pick<Window, "navigator" | "matchMedia" | "location"> | null | undefined): SinaisApp {
  if (!win) return {};
  let displayMode = "browser";
  try {
    const modos = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay", "browser"];
    displayMode = modos.find((m) => win.matchMedia?.(`(display-mode: ${m})`).matches) ?? "browser";
  } catch { /* segue no navegador */ }
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav?.userAgent ?? "",
    displayMode,
    iosStandalone: nav?.standalone === true,
    busca: win.location?.search ?? "",
  };
}

export function aplicativoAqui(win?: Pick<Window, "navigator" | "matchMedia" | "location"> | null): boolean {
  return estaNoAplicativo(lerSinaisApp(win ?? (typeof window === "undefined" ? null : window)));
}

export function casaDoJson(bruto: unknown): FichaCasa {
  return normalizarFicha(bruto);
}
