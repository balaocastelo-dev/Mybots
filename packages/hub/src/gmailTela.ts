// Login do Gmail na tela do PC do bot.
//
// O dono digita e-mail e senha no Chromium que ele está vendo. Este módulo só
// abre a página e, depois, olha o endereço da aba. Não lê campos, não lê o
// HTML e não guarda a senha. "Feito" é a caixa de entrada, não a tela de login.

export const URL_LOGIN_GMAIL =
  "https://accounts.google.com/ServiceLogin?service=mail&continue=https%3A%2F%2Fmail.google.com%2Fmail%2F&hl=pt-BR";

const PORTAS_INTOCADAS = new Set([8787, 8790, 8791]);

/** A caixa abriu de verdade. Login, desafio e senha na URL não contam. */
export function gmailConfirmado(url: string): boolean {
  let u: URL;
  try { u = new URL(String(url ?? "").trim()); } catch { return false; }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "mail.google.com") return false;
  if (!u.pathname.toLowerCase().startsWith("/mail")) return false;
  const caminho = (u.pathname + u.search + u.hash).toLowerCase();
  if (/servicelogin|signin|accountchooser|challenge|identifier|password|pwd/.test(caminho)) return false;
  return true;
}

function portaUsavel(porta: number): boolean {
  return Number.isInteger(porta) && porta > 0 && porta < 65536 && !PORTAS_INTOCADAS.has(porta);
}

/** Abre uma aba no Chromium do PC deste bot. A resposta não traz o conteúdo da página. */
export async function abrirLoginNoNavegador(porta: number, url = URL_LOGIN_GMAIL): Promise<{ ok: boolean; motivo: string }> {
  if (!portaUsavel(porta)) return { ok: false, motivo: "A tela do PC deste bot não está numa porta desta casa." };
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/json/new?${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { ok: false, motivo: "O navegador da tela do PC não abriu o login." };
    return { ok: true, motivo: "Login do Gmail aberto na tela do PC." };
  } catch {
    return { ok: false, motivo: "A tela do PC não respondeu." };
  }
}

/** Só os endereços das abas. Sem título, sem HTML, sem o que foi digitado. */
export async function urlsDaPorta(porta: number): Promise<string[]> {
  if (!portaUsavel(porta)) return [];
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/json/list`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return [];
    const lista = await r.json() as Array<{ type?: string; url?: string }>;
    return lista.filter((t) => t.type === "page" && t.url).map((t) => String(t.url));
  } catch {
    return [];
  }
}
