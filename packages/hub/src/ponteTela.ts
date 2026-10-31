/**
 * Encaminha a tela do container para o navegador. O host é o loopback, escrito
 * aqui — esta função não recebe endereço. A porta já passou pela faixa da empresa.
 */
import http from "node:http";
import WebSocket from "ws";
import type { FastifyReply, FastifyRequest } from "fastify";
import { portaDeEmpresaPermitida } from "./ponteVnc.js";

const LOOPBACK = "127.0.0.1";

export function encaminharHttp(req: FastifyRequest, reply: FastifyReply, porta: number, caminho: string) {
  if (!portaDeEmpresaPermitida(porta)) {
    reply.code(404).send({ error: "tela indisponível" });
    return;
  }
  // Hijack antes de voltar do hook. Sem isto o Fastify responde 404 (a rota
  // /pc/:id/* é só WebSocket) e, quando o container responde, o writeHead
  // derruba o Hub inteiro.
  reply.hijack();
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: `${LOOPBACK}:${porta}` };
  delete headers["x-mybots-key"];
  delete headers.cookie;
  delete headers.connection;
  delete headers.upgrade;
  delete headers["transfer-encoding"];
  const upstream = http.request(
    { hostname: LOOPBACK, port: porta, method: req.method, path: caminho, headers },
    (res) => {
      const h: http.OutgoingHttpHeaders = { ...res.headers };
      delete h["x-frame-options"];
      delete h["content-security-policy"];
      delete h.connection;
      delete h["transfer-encoding"];
      reply.raw.writeHead(res.statusCode || 502, h);
      res.pipe(reply.raw);
    },
  );
  upstream.on("error", () => {
    if (reply.raw.headersSent) {
      try { reply.raw.destroy(); } catch { /* o cliente já foi */ }
      return;
    }
    reply.raw.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    reply.raw.end(JSON.stringify({ error: "a tela da empresa não respondeu" }));
  });
  const body = (req as { body?: unknown }).body;
  if (Buffer.isBuffer(body) || typeof body === "string") upstream.end(body);
  else if (body && typeof body === "object" && String(req.headers["content-type"] ?? "").includes("json")) upstream.end(JSON.stringify(body));
  else req.raw.pipe(upstream);
}

/**
 * Um quadro do WebSocket, com o tipo que veio no fio. O Selkies 2.1 só
 * registra o navegador como display se `SETTINGS,{...}` e `START_VIDEO`
 * chegarem como TEXTO. A biblioteca `ws` entrega os dois como Buffer e, se
 * reenviarmos o Buffer cru, o quadro vira binário: o upgrade sobe, o MODE
 * volta, o vídeo nunca começa e a página fica em "Waiting for stream...".
 */
export type QuadroWs = { bin: boolean; data: Buffer };

export function quadroWs(m: unknown, isBinary?: boolean): QuadroWs {
  const um = (p: unknown): Buffer => {
    if (Buffer.isBuffer(p)) return p;
    if (p instanceof ArrayBuffer) return Buffer.from(p);
    if (p instanceof Uint8Array) return Buffer.from(p.buffer, p.byteOffset, p.byteLength);
    return Buffer.from(p as string);
  };
  let data: Buffer;
  if (Array.isArray(m)) data = Buffer.concat(m.map(um));
  else data = um(m);
  const bin = typeof isBinary === "boolean" ? isBinary : typeof m !== "string";
  return { bin, data };
}

/**
 * Liga o WebSocket do navegador no WebSocket do container. `enviar` é o que o
 * handler da rota chama para cada mensagem que chegar — o handler registra o
 * ouvinte ANTES de saber a porta, senão o primeiro quadro da tela se perde.
 */
export function abrirWsDaTela(
  socket: { send: (d: Buffer, opts?: { binary?: boolean }) => void; close: () => void; on: (ev: string, fn: () => void) => void },
  porta: number,
  caminho: string,
  jaChegaram: QuadroWs[],
  protocolos?: string[],
): (q: QuadroWs) => void {
  const largar = () => { try { socket.close(); } catch { /* ok */ } };
  if (!portaDeEmpresaPermitida(porta)) { largar(); return () => {}; }
  let morto = false;
  const up = new WebSocket(
    `ws://${LOOPBACK}:${porta}${caminho}`,
    protocolos && protocolos.length ? protocolos : undefined,
    { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 },
  );
  const pendente = [...jaChegaram];
  let aberto = false;
  const mandar = (q: QuadroWs) => {
    try { up.send(q.data, { binary: q.bin }); } catch { /* caiu */ }
  };
  const fim = () => {
    if (morto) return;
    morto = true;
    try { up.close(); } catch { /* ok */ }
    largar();
  };
  up.on("open", () => {
    aberto = true;
    for (const q of pendente) mandar(q);
    pendente.length = 0;
  });
  up.on("message", (data, isBinary) => {
    try { socket.send(quadroWs(data, isBinary).data, { binary: isBinary }); } catch { /* caiu */ }
  });
  up.on("close", fim);
  up.on("error", fim);
  socket.on("close", fim);
  socket.on("error", fim);
  return (q: QuadroWs) => {
    if (morto) return;
    if (aberto) mandar(q);
    else pendente.push(q);
  };
}
