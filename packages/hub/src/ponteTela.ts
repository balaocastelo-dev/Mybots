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
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: `${LOOPBACK}:${porta}` };
  delete headers["x-mybots-key"];
  delete headers.cookie;
  const upstream = http.request(
    { hostname: LOOPBACK, port: porta, method: req.method, path: caminho, headers },
    (res) => {
      const h: http.OutgoingHttpHeaders = { ...res.headers };
      delete h["x-frame-options"];
      delete h["content-security-policy"];
      reply.hijack();
      reply.raw.writeHead(res.statusCode || 502, h);
      res.pipe(reply.raw);
    },
  );
  upstream.on("error", () => {
    if (reply.sent || reply.raw.headersSent) {
      try { reply.raw.destroy(); } catch { /* o cliente já foi */ }
      return;
    }
    reply.code(502).send({ error: "a tela da empresa não respondeu" });
  });
  const body = (req as { body?: unknown }).body;
  if (Buffer.isBuffer(body) || typeof body === "string") upstream.end(body);
  else if (body && typeof body === "object" && String(req.headers["content-type"] ?? "").includes("json")) upstream.end(JSON.stringify(body));
  else req.raw.pipe(upstream);
}

/**
 * Liga o WebSocket do navegador no WebSocket do container. `enviar` é o que o
 * handler da rota chama para cada mensagem que chegar — o handler registra o
 * ouvinte ANTES de saber a porta, senão o primeiro quadro da tela se perde.
 */
export function abrirWsDaTela(
  socket: { send: (d: Buffer | string) => void; close: () => void; on: (ev: string, fn: () => void) => void },
  porta: number,
  caminho: string,
  jaChegaram: Buffer[],
  protocolos?: string[],
): (b: Buffer) => void {
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
