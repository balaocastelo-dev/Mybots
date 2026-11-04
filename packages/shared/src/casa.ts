// Ficha pública da casa: uso, downloads e suporte. Sem senha, token ou chave.

export const USO_GRATIS = "Ilimitado, grátis";
export const APK_PADRAO = "/downloads/MyBots.apk";
/** Marca no user agent do aplicativo Android. O navegador comum não a tem. */
export const MARCA_APP = "MyBotsApp";

export type FichaCasa = {
  uso: typeof USO_GRATIS;
  apk: string;
  /** Vazio enquanto o instalador de Windows não for publicado. */
  windows: string;
  suporte: string;
  versao: string;
};

export type SinaisApp = {
  userAgent?: string;
  displayMode?: string;
  iosStandalone?: boolean;
  busca?: string;
};

const VERSAO = /^[0-9][0-9A-Za-z._-]{0,20}$/;

export function urlHttp(bruta: string): string {
  const t = bruta.trim();
  if (!t || /[\s\u0000-\u001f]/.test(t)) return "";
  let u: URL;
  try { u = new URL(t); } catch { return ""; }
  if (u.username || u.password) return "";
  if (u.protocol !== "https:" && u.protocol !== "http:") return "";
  return u.toString();
}

export function caminhoLocal(bruta: string): string {
  const t = bruta.trim();
  if (!t.startsWith("/") || t.startsWith("//") || t.includes("\\") || t.includes("..")) return "";
  if (!/^\/[A-Za-z0-9._~/-]+$/.test(t)) return "";
  return t;
}

export function caminhoOuHttps(bruta: string, fallback: string): string {
  return caminhoLocal(bruta) || urlHttp(bruta) || fallback;
}

export function urlSuporte(bruta: string): string {
  const t = bruta.trim();
  const mailto = t.match(/^mailto:([^\s?]+)$/i);
  if (mailto && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailto[1])) return `mailto:${mailto[1]}`;
  return urlHttp(t);
}

export function fichaDaCasa(env: Record<string, string | undefined> = {}, versao = "0.1.0"): FichaCasa {
  const v = String(env.MYBOTS_VERSAO ?? versao).trim();
  return {
    uso: USO_GRATIS,
    apk: caminhoOuHttps(env.MYBOTS_APK_URL ?? "", APK_PADRAO),
    windows: urlHttp(env.MYBOTS_WINDOWS_URL ?? ""),
    suporte: urlSuporte(env.MYBOTS_SUPORTE_URL ?? ""),
    versao: VERSAO.test(v) ? v : versao,
  };
}

/** A resposta do Hub passa de novo pelo mesmo filtro. URL estranha vira o padrão. */
export function normalizarFicha(bruto: unknown, versao = "0.1.0"): FichaCasa {
  const base = fichaDaCasa({}, versao);
  const o = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : {};
  return {
    uso: USO_GRATIS,
    apk: caminhoOuHttps(typeof o.apk === "string" ? o.apk : "", base.apk),
    windows: urlHttp(typeof o.windows === "string" ? o.windows : ""),
    suporte: urlSuporte(typeof o.suporte === "string" ? o.suporte : ""),
    versao: typeof o.versao === "string" && VERSAO.test(o.versao) ? o.versao : base.versao,
  };
}

/** Aplicativo instalado (Android, PWA ou janela --app). No navegador comum, falso. */
export function estaNoAplicativo(s: SinaisApp = {}): boolean {
  const ua = s.userAgent ?? "";
  if (ua.includes(MARCA_APP) || /;\s*wv\)/.test(ua)) return true;
  if (s.iosStandalone) return true;
  const modo = s.displayMode ?? "browser";
  if (modo === "standalone" || modo === "fullscreen" || modo === "minimal-ui" || modo === "window-controls-overlay") return true;
  const busca = s.busca ?? "";
  const q = busca.startsWith("?") ? busca.slice(1) : busca;
  if (new URLSearchParams(q).get("app") === "1") return true;
  return false;
}
