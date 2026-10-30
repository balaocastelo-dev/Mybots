import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

/**
 * A PREVIA DE UM ENDERECO
 *
 * Na tela de cadastro, digitar o site e so texto: a pessoa nao tem certeza de que
 * acertou. Aqui o Hub abre o endereco de verdade e devolve o que da para mostrar
 * numa janelinha de navegador: o print da pagina (Chrome sem janela, o mesmo que
 * ja gera os PDFs) e as metas que o site publica de si (og:title, og:description,
 * og:image).
 *
 * Duas escolhas que valem explicar:
 * - O print e melhor que a og:image porque mostra a pagina COMO ELA E hoje. Mas o
 *   Chrome pode nao existir ou demorar: entao ele tem teto de tempo e, se falhar,
 *   a og:image assume. Nunca ficamos sem nada por causa do print.
 * - Instagram nao se deixa fotografar sem login (a pagina vira muro de entrada).
 *   Para ele pedimos so as metas, que o perfil publico ainda entrega.
 */

export type Previa = {
  ok: boolean;
  url: string;
  titulo?: string;
  descricao?: string;
  imagem?: string;   // og:image (url absoluta)
  captura?: string;  // data:image/png;base64,... do print
  erro?: string;
};

const CACHE = new Map<string, { quando: number; previa: Previa }>();
const VALE_POR = 10 * 60 * 1000;

/** Aceita "balao.info", "www.balao.info", "https://balao.info/x" e devolve url inteira. */
export function enderecoDe(bruto: string): string {
  const t = (bruto ?? "").trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return "https://" + t.replace(/^\/+/, "");
}

/** "@loja", "instagram.com/loja", "loja" -> https://www.instagram.com/loja/ */
export function enderecoDoInsta(bruto: string): string {
  const t = (bruto ?? "").trim().replace(/^@/, "");
  if (!t) return "";
  const m = t.match(/instagram\.com\/([^/?#]+)/i);
  const user = (m ? m[1] : t).replace(/[^A-Za-z0-9._]/g, "");
  return user ? `https://www.instagram.com/${user}/` : "";
}

function acharChrome(): string | null {
  const tentativas = [
    process.env.MYBOTS_CHROME,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean) as string[];
  for (const p of tentativas) if (fs.existsSync(p)) return p;
  return null;
}

/** Print da pagina. Devolve data URL, ou null se o Chrome nao existir ou demorar. */
async function capturar(url: string, msTeto = 20000): Promise<string | null> {
  const chrome = acharChrome();
  if (!chrome) return null;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-previa-"));
  const arq = path.join(pasta, "tela.png");
  const perfil = path.join(pasta, "perfil");
  const args = [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--mute-audio",
    `--user-data-dir=${perfil}`,
    "--window-size=1200,760",
    "--virtual-time-budget=6000",
    `--screenshot=${arq}`,
    url,
  ];
  try {
    await new Promise<void>((ok, ruim) => {
      const p = execFile(chrome, args, { timeout: msTeto, windowsHide: true }, (e) => (e ? ruim(e) : ok()));
      p.on("error", ruim);
    });
    if (!fs.existsSync(arq)) return null;
    const b = fs.readFileSync(arq);
    if (b.length < 1000) return null; // pagina em branco nao e previa
    return "data:image/png;base64," + b.toString("base64");
  } catch {
    return null;
  } finally {
    try { fs.rmSync(pasta, { recursive: true, force: true }); } catch { /* temp some depois */ }
  }
}

function metasDe(html: string, base: string) {
  const meta = (p: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, "i");
    return html.match(re)?.[1] ?? html.match(re2)?.[1];
  };
  const absoluta = (u?: string) => {
    if (!u) return undefined;
    try { return new URL(u, base).toString(); } catch { return undefined; }
  };
  return {
    titulo: meta("og:title") ?? html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim(),
    descricao: meta("og:description") ?? meta("description"),
    imagem: absoluta(meta("og:image")),
  };
}

export async function previaDe(url: string, opcoes: { print?: boolean } = {}): Promise<Previa> {
  if (!url) return { ok: false, url, erro: "endereco vazio" };
  const guardado = CACHE.get(url);
  if (guardado && Date.now() - guardado.quando < VALE_POR) return guardado.previa;

  let previa: Previa = { ok: false, url };
  try {
    const r = await fetch(url, {
      headers: {
        // sem um user-agent de gente, muito site devolve pagina capada ou 403
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        "accept-language": "pt-BR,pt;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(14000),
    });
    const html = await r.text();
    const m = metasDe(html, r.url || url);
    previa = { ok: r.ok, url: r.url || url, ...m };
    if (!r.ok) previa.erro = `o site respondeu ${r.status}`;
  } catch (e) {
    previa = { ok: false, url, erro: (e as Error).name === "TimeoutError" ? "o site demorou demais" : "nao consegui abrir o endereco" };
  }

  if (opcoes.print !== false) {
    // CDP primeiro: ele espera carregar e tira a cortina de cadastro antes da foto.
    const foto = (await capturarComCDP(url)) ?? (await capturar(url));
    if (foto) { previa.captura = foto; previa.ok = true; }
  }
  if (previa.captura || previa.imagem || previa.titulo) previa.ok = true;

  CACHE.set(url, { quando: Date.now(), previa });
  return previa;
}
// ---------------------------------------------------------------------------
// Print pelo protocolo de depuracao do Chrome
//
// O --screenshot da linha de comando fotografa a pagina como ela cai na tela, e
// no Instagram isso e um muro de cadastro por cima do perfil -- o perfil esta
// ali, so coberto. Falando CDP conseguimos esperar carregar, TIRAR a cortina e
// so entao fotografar. E o mesmo caminho que o Chrome usa para si; nao instala
// nada novo, o ws o Hub ja tem.
// ---------------------------------------------------------------------------
import { WebSocket } from "ws";
import { spawn } from "node:child_process";

const LIMPEZA = `
  (() => {
    const fora = (el) => el && el.remove();
    document.querySelectorAll('[role="dialog"], [role="presentation"]').forEach(fora);
    document.querySelectorAll('div[class*="overlay" i], div[id*="overlay" i]').forEach(fora);
    // o Instagram escurece o fundo e trava a rolagem enquanto o modal existe
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
    // a cortina escura e um elemento fixo do tamanho da tela; tirar so o modal
    // deixava a pagina legivel porem toda apagada, como se fosse noite.
    const lv = window.innerWidth, la = window.innerHeight;
    Array.prototype.slice.call(document.querySelectorAll("body *")).forEach((el) => {
      const s = getComputedStyle(el);
      if (s.position !== "fixed") return;
      const r = el.getBoundingClientRect();
      if (r.width < lv * 0.8 || r.height < la * 0.8) return;
      // SO a cortina: camada do tamanho da tela, pintada e praticamente sem texto.
      // Sem esta guarda eu apagava o proprio container da pagina -- o print voltava
      // com 5 kb, em branco.
      const pintada = s.backgroundColor && s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent";
      const vazia = (el.textContent || "").trim().length < 40;
      if (pintada && vazia) el.remove();
    });
    document.documentElement.style.filter = "none";
    document.body.style.filter = "none";
    document.body.style.opacity = "1";
    return true;
  })()
`;

async function esperarPorta(pasta: string, ms: number): Promise<number | null> {
  const arq = path.join(pasta, "DevToolsActivePort");
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    try {
      const linhas = fs.readFileSync(arq, "utf8").split("\n");
      const porta = parseInt(linhas[0], 10);
      if (porta > 0) return porta;
    } catch { /* ainda nao escreveu */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  return null;
}

export async function capturarComCDP(url: string, msTeto = 25000): Promise<string | null> {
  const chrome = acharChrome();
  if (!chrome) return null;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-cdp-"));
  const proc = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--mute-audio",
    "--remote-debugging-port=0", `--user-data-dir=${pasta}`,
    "--window-size=1200,780", "about:blank",
  ], { windowsHide: true, stdio: "ignore" });

  const encerrar = () => { try { proc.kill(); } catch { /* ja morreu */ } try { fs.rmSync(pasta, { recursive: true, force: true }); } catch { /* temp some depois */ } };

  try {
    const porta = await esperarPorta(pasta, 10000);
    if (!porta) { encerrar(); return null; }
    const lista = await (await fetch(`http://127.0.0.1:${porta}/json/list`, { signal: AbortSignal.timeout(5000) })).json() as any[];
    const alvo = lista.find((t) => t.type === "page");
    if (!alvo?.webSocketDebuggerUrl) { encerrar(); return null; }

    const ws = new WebSocket(alvo.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise<void>((ok, ruim) => { ws.once("open", () => ok()); ws.once("error", ruim); });

    let id = 0;
    const esperando = new Map<number, (v: any) => void>();
    let carregou = false;
    ws.on("message", (raw) => {
      let m: any; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.id && esperando.has(m.id)) { esperando.get(m.id)!(m.result); esperando.delete(m.id); }
      if (m.method === "Page.loadEventFired") carregou = true;
    });
    const mandar = (method: string, params: any = {}) => new Promise<any>((ok) => {
      const meu = ++id;
      esperando.set(meu, ok);
      ws.send(JSON.stringify({ id: meu, method, params }));
      setTimeout(() => { if (esperando.delete(meu)) ok(null); }, msTeto);
    });

    await mandar("Page.enable");
    await mandar("Page.navigate", { url });
    const ateCarregar = Date.now() + 15000;
    while (!carregou && Date.now() < ateCarregar) await new Promise((r) => setTimeout(r, 150));
    await new Promise((r) => setTimeout(r, 1400));           // deixa a pagina pintar
    await mandar("Runtime.evaluate", { expression: LIMPEZA }); // fora a cortina
    await new Promise((r) => setTimeout(r, 350));
    const foto = await mandar("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    try { ws.close(); } catch { /* ja fechou */ }
    encerrar();
    if (!foto?.data || foto.data.length < 2000) return null;
    return "data:image/png;base64," + foto.data;
  } catch {
    encerrar();
    return null;
  }
}
