/**
 * A tela do Android entra por /android/<botId>/. O upstream é sempre
 * 127.0.0.1, numa porta que o Hub escolheu. O navegador não escolhe host
 * nem porta. A 8787 e a 8791 não são destinos desta ponte.
 */
import http from "node:http";
import WebSocket from "ws";
import type { FastifyReply, FastifyRequest } from "fastify";

const LOOPBACK = "127.0.0.1";
const PROIBIDAS = new Set([8787, 8791]);

export function portaAndroidPermitida(porta: number): boolean {
  return Number.isInteger(porta) && porta > 0 && porta < 65536 && !PROIBIDAS.has(porta);
}

function caminhoSuspeito(url: string): boolean {
  const bruto = String(url ?? "");
  return bruto.includes("..") || bruto.toLowerCase().includes("%2e%2e");
}

/** Id do bot numa URL /android/<id>/... — null se o caminho não for esse. */
export function idDoAndroid(url: string): string | null {
  if (caminhoSuspeito(url)) return null;
  const bruto = String(url ?? "");
  let pathname = bruto.split("?")[0];
  try { pathname = new URL(bruto, "http://127.0.0.1").pathname; } catch { /* fica o corte cru */ }
  if (pathname.includes("..")) return null;
  const m = /^\/android\/([a-zA-Z0-9_.-]{1,60})(?:\/|$)/.exec(pathname);
  return m ? m[1] : null;
}

/** O que o servidor de tela recebe. A pasta /android/<id>/ fica só no Hub. A senha (k) não vai junto. */
export function caminhoNoAndroid(url: string): string | null {
  if (caminhoSuspeito(url)) return null;
  const id = idDoAndroid(url);
  if (!id) return null;
  try {
    const u = new URL(url, "http://127.0.0.1");
    if (u.pathname.includes("..")) return null;
    u.searchParams.delete("k");
    const prefixo = `/android/${id}`;
    let path = u.pathname;
    if (path === prefixo || path === prefixo + "/") path = "/";
    else if (path.startsWith(prefixo + "/")) path = path.slice(prefixo.length) || "/";
    else return null;
    if (!path.startsWith("/")) path = "/" + path;
    return path + u.search;
  } catch {
    return null;
  }
}

export function encaminharHttpAndroid(req: FastifyRequest, reply: FastifyReply, porta: number, caminho: string): Promise<void> {
  if (!portaAndroidPermitida(porta)) {
    reply.code(404).send({ ok: false, erro: "tela do Android indisponível" });
    return Promise.resolve();
  }
  // O hijack tem que ser agora. Se esperar a resposta do upstream, o Fastify
  // vê a rota sem handler e devolve 404 vazio por cima da tela.
  reply.hijack();
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: `${LOOPBACK}:${porta}` };
  delete headers["x-mybots-key"];
  delete headers.cookie;
  return new Promise((resolve) => {
    const upstream = http.request(
      { hostname: LOOPBACK, port: porta, method: req.method, path: caminho, headers },
      (res) => {
        const h: http.OutgoingHttpHeaders = { ...res.headers };
        delete h["x-frame-options"];
        delete h["content-security-policy"];
        reply.raw.writeHead(res.statusCode || 502, h);
        res.pipe(reply.raw);
        res.on("end", () => resolve());
        reply.raw.on("close", () => resolve());
      },
    );
    upstream.on("error", () => {
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(502, { "content-type": "application/json; charset=utf-8" });
        reply.raw.end(JSON.stringify({ ok: false, erro: "a tela do Android não respondeu" }));
      } else {
        try { reply.raw.destroy(); } catch { /* o cliente já foi */ }
      }
      resolve();
    });
    const body = (req as { body?: unknown }).body;
    if (Buffer.isBuffer(body) || typeof body === "string") upstream.end(body);
    else if (body && typeof body === "object" && String(req.headers["content-type"] ?? "").includes("json")) upstream.end(JSON.stringify(body));
    else req.raw.pipe(upstream);
  });
}

/**
 * Liga o WebSocket do navegador no WebSocket da tela. `enviar` é o que o
 * handler chama para cada mensagem que chegar — o ouvinte registra antes
 * de saber a porta, senão o primeiro toque se perde.
 */
export function abrirWsAndroid(
  socket: { send: (d: Buffer | string) => void; close: () => void; on: (ev: string, fn: (...a: any[]) => void) => void },
  porta: number,
  caminho: string,
  jaChegaram: Buffer[],
  protocolos?: string[],
): (b: Buffer) => void {
  const largar = () => { try { socket.close(); } catch { /* ok */ } };
  if (!portaAndroidPermitida(porta)) { largar(); return () => {}; }
  let morto = false;
  const up = new WebSocket(
    `ws://${LOOPBACK}:${porta}${caminho}`,
    protocolos && protocolos.length ? protocolos : undefined,
    { perMessageDeflate: false, maxPayload: 8 * 1024 * 1024 },
  );
  const pendente = [...jaChegaram];
  let aberto = false;
  const fim = () => {
    if (morto) return;
    morto = true;
    try { up.close(); } catch { /* ok */ }
    largar();
  };
  up.on("open", () => {
    aberto = true;
    for (const b of pendente) { try { up.send(b); } catch { /* caiu */ } }
    pendente.length = 0;
  });
  up.on("message", (data, isBinary) => {
    try { socket.send(isBinary ? Buffer.from(data as Buffer) : data.toString()); } catch { /* caiu */ }
  });
  up.on("close", fim);
  up.on("error", fim);
  socket.on("close", fim);
  socket.on("error", fim);
  return (b: Buffer) => {
    if (morto) return;
    if (aberto) { try { up.send(b); } catch { /* caiu */ } }
    else pendente.push(b);
  };
}
