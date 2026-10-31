// Preenche um campo no Chrome da empresa pela porta de depuração.
// O valor vai no argumento do CDP e a resposta que volta é só { ok: true }.
// Não clica em pagar, enviar ou comprar — isso continua com o chefe.
import WebSocket from "ws";
import { enderecoDoDepurador, portaCdpPermitida } from "./gravacao.js";
import { estadoDa } from "./maquinas.js";

const RESERVADAS = new Set([8787, 8791]);

const DICAS: Record<string, string[]> = {
  usuario: ["email", "e-mail", "user", "username", "login", "usuario", "usuário"],
  senha: ["password", "senha", "pass", "pwd"],
  notas: ["nota", "notes", "comment", "obs", "observa"],
  titular: ["cardholder", "cc-name", "titular", "nome no cartao", "nome no cartão"],
  numero: ["cc-number", "cardnumber", "card-number", "numero", "número", "pan"],
  validade: ["cc-exp", "expiry", "validade", "expiration", "vencimento"],
  cvv: ["cc-csc", "cvv", "cvc", "cvv2"],
};

export function hostDe(s: string): string {
  const t = String(s ?? "").trim().toLowerCase();
  if (!t) return "";
  try {
    const u = new URL(t.includes("://") ? t : `https://${t}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return t.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split(":")[0];
  }
}

export function mesmoSite(a: string, b: string): boolean {
  const ha = hostDe(a);
  const hb = hostDe(b);
  if (!ha || !hb) return false;
  return ha === hb || ha.endsWith("." + hb) || hb.endsWith("." + ha);
}

/** Nome do container quando o PC passar a ser por bot. Hoje o Chrome é o da empresa. */
export function nomeContainerDoBot(botId: string): string {
  const limpo = String(botId ?? "").replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 40);
  return `mybots-bot-${limpo}`;
}

/**
 * Porta de depuração do bot.
 * Hoje: o PC da empresa (container mybots-<empresaId>, porta publicada em portaCdp).
 * Quando existir o container mybots-bot-<botId>, troque só portaDoContainerDoBot.
 */
export async function portaDoContainerDoBot(_botId: string): Promise<{ porta: number } | null> {
  return null;
}

export async function alvoDoNavegador(botId: string, empresaId: string | null): Promise<{ porta: number } | { erro: string }> {
  const doBot = await portaDoContainerDoBot(botId);
  if (doBot) {
    if (RESERVADAS.has(doBot.porta) || !portaCdpPermitida(doBot.porta)) return { erro: "a porta do navegador deste bot não é desta casa" };
    return doBot;
  }
  if (!empresaId) return { erro: "este bot não tem empresa e não tem navegador" };
  const m = await estadoDa(empresaId);
  if (m.estado !== "ligada") return { erro: "o navegador da empresa está desligado" };
  if (RESERVADAS.has(m.portaCdp) || !portaCdpPermitida(m.portaCdp)) return { erro: "a porta do navegador está fora da faixa" };
  return { porta: m.portaCdp };
}

/** A expressão que ACHA o campo. Não contém o segredo. */
export function expressaoDoCampo(campo: string): string {
  const dicas = DICAS[campo] ?? [campo];
  return `(() => {
    const campo = ${JSON.stringify(campo)};
    const dicas = ${JSON.stringify(dicas)};
    const els = [...document.querySelectorAll("input, textarea")];
    const rotulo = (el) => {
      const id = el.id || "";
      let label = "";
      if (id) {
        const l = document.querySelector("label[for='" + CSS.escape(id) + "']");
        if (l) label = l.textContent || "";
      }
      return [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.getAttribute("autocomplete"), el.type, label].join(" ").toLowerCase();
    };
    let melhor = null, nota = 0;
    for (const el of els) {
      if (el.disabled || el.type === "hidden" || el.type === "submit" || el.type === "button") continue;
      const t = rotulo(el);
      let n = 0;
      for (const d of dicas) if (t.includes(d)) n += 2;
      if (campo === "senha" && el.type === "password") n += 5;
      if (campo === "usuario" && (el.type === "email" || el.autocomplete === "username")) n += 3;
      if (campo === "numero" && (el.autocomplete === "cc-number" || /cc-number|cardnumber/.test(t))) n += 4;
      if (campo === "cvv" && (el.autocomplete === "cc-csc" || /cvv|cvc/.test(t))) n += 4;
      if (campo === "validade" && /cc-exp|expir/.test(t)) n += 4;
      if (campo === "titular" && el.autocomplete === "cc-name") n += 4;
      if (n > nota) { nota = n; melhor = el; }
    }
    if (!melhor || nota <= 0) return false;
    document.querySelectorAll("[data-mybots-alvo]").forEach((e) => e.removeAttribute("data-mybots-alvo"));
    melhor.setAttribute("data-mybots-alvo", "1");
    return true;
  })()`;
}

const FUNCAO_PREENCHER = `function(valor) {
  const el = this;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc && desc.set) desc.set.call(el, String(valor ?? ""));
  else el.value = String(valor ?? "");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.removeAttribute("data-mybots-alvo");
  return { ok: true };
}`;

type Sessao = { pedir: (method: string, params?: object) => Promise<any>; fechar: () => void };

function abrirSessao(url: string): Promise<Sessao> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: 4000, maxPayload: 2 * 1024 * 1024 });
    const espera = new Map<number, (v: any) => void>();
    let seq = 0;
    const timer = setTimeout(() => { try { ws.close(); } catch { /* ok */ } reject(new Error("navegador não aceitou")); }, 5000);
    ws.on("message", (raw) => {
      let m: any;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      const fn = m.id ? espera.get(m.id) : undefined;
      if (!fn) return;
      espera.delete(m.id);
      fn(m);
    });
    ws.once("open", () => {
      clearTimeout(timer);
      resolve({
        pedir: (method, params) => new Promise((ok, ruim) => {
          const id = ++seq;
          const t = setTimeout(() => { espera.delete(id); ruim(new Error("o navegador não respondeu")); }, 8000);
          espera.set(id, (v) => { clearTimeout(t); ok(v); });
          try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { clearTimeout(t); espera.delete(id); ruim(e); }
        }),
        fechar: () => { try { ws.close(); } catch { /* ok */ } },
      });
    });
    ws.once("error", () => { clearTimeout(timer); reject(new Error("não consegui abrir o navegador")); });
  });
}

/**
 * Digita o valor no campo da aba deste site. A resposta não traz o valor,
 * mesmo que o Chrome ecoe o argumento no resultado.
 */
export async function preencherNoNavegador(porta: number, site: string, campo: string, valor: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (RESERVADAS.has(porta) || !portaCdpPermitida(porta)) return { ok: false, erro: "a porta do navegador está fora da faixa" };
  let lista: Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>;
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/json/list`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { ok: false, erro: "o navegador da empresa não respondeu" };
    lista = await r.json();
  } catch {
    return { ok: false, erro: "não consegui falar com o navegador da empresa" };
  }
  const pagina = lista.find((t) => t.type === "page" && t.webSocketDebuggerUrl && mesmoSite(String(t.url ?? ""), site));
  if (!pagina?.webSocketDebuggerUrl) return { ok: false, erro: "não há aba deste site no navegador" };
  const url = enderecoDoDepurador(pagina.webSocketDebuggerUrl, porta);
  if (!url) return { ok: false, erro: "o endereço de depuração do navegador não é confiável" };

  let sessao: Sessao;
  try { sessao = await abrirSessao(url); } catch {
    return { ok: false, erro: "não consegui abrir a aba do navegador" };
  }
  try {
    const achou = await sessao.pedir("Runtime.evaluate", { expression: expressaoDoCampo(campo), returnByValue: true });
    if (achou?.result?.result?.value !== true) return { ok: false, erro: "não achei o campo nesta página" };
    const el = await sessao.pedir("Runtime.evaluate", { expression: `document.querySelector('[data-mybots-alvo="1"]')`, returnByValue: false });
    const objectId = el?.result?.result?.objectId;
    if (!objectId) return { ok: false, erro: "não achei o campo nesta página" };
    const posto = await sessao.pedir("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: FUNCAO_PREENCHER,
      arguments: [{ value: valor }],
      returnByValue: true,
    });
    // Só o ok. Qualquer outro campo do resultado (o Chrome pode ecoar o argumento) fica aqui.
    if (posto?.result?.result?.value?.ok === true) return { ok: true };
    return { ok: false, erro: "não consegui preencher o campo" };
  } catch {
    return { ok: false, erro: "não consegui preencher o campo" };
  } finally {
    try { await sessao.pedir("Runtime.evaluate", { expression: `document.querySelectorAll('[data-mybots-alvo]').forEach((e) => e.removeAttribute('data-mybots-alvo'))`, returnByValue: true }); } catch { /* a aba pode ter caído */ }
    sessao.fechar();
  }
}
