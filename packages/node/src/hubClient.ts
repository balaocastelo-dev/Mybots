import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { type BotEvent, type HubToNode, type NodeToHub, newId, PROTOCOL_VERSION } from "@mybots/shared";
import type { NodeConfig } from "./config.js";

/** ConexÃ£o de saÃ­da com o Hub, com reconexÃ£o automÃ¡tica e chamadas com resposta (callId). */
export class HubClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private waiters = new Map<string, { resolve: (v: { ok: boolean; data: unknown }) => void; timer: NodeJS.Timeout }>();
  private queue: NodeToHub[] = [];
  private backoff = 1000;
  private heartbeat: NodeJS.Timeout | null = null;
  private closed = false;
  connected = false;

  constructor(private cfg: NodeConfig, private meta: { engine: "direct" | "opencode"; provider: string; model: string; version: string }) {
    super();
  }

  start() {
    this.closed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.ws?.close();
  }

  private connect() {
    const url = this.cfg.hub.replace(/\/$/, "") + "/ws/node";
    // Auth online exige Bearer no upgrade; o hello ainda identifica o bot.
    // So no loopback o Hub aceita MYBOTS_HUB_TOKEN (hubTokenLoopbackOk).
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        "x-mybots-bot": this.cfg.bot.id,
      },
    });
    this.ws = ws;
    ws.on("open", () => {
      this.backoff = 1000;
      this.sendRaw({
        type: "hello", protocol: PROTOCOL_VERSION, token: this.cfg.token, bot: this.cfg.bot,
        engine: this.meta.engine, provider: this.meta.provider, model: this.meta.model, version: this.meta.version,
        controlMode: this.cfg.approval.mode,
      });
    });
    ws.on("message", (raw) => {
      let msg: HubToNode;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === "hello.ok") {
        this.connected = true;
        console.log(`[node] conectado ao hub ${this.cfg.hub} como ${msg.botId} (hub ${msg.hubVersion})`);
        for (const q of this.queue.splice(0)) this.sendRaw(q);
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => this.sendRaw({ type: "heartbeat" }), 20_000);
        // o hello.ok carrega a heranÃ§a da casa (base de conhecimento): o motor escuta por ele,
        // entÃ£o precisa ser emitido, nÃ£o sÃ³ o "connected".
        this.emit("hello.ok", msg);
        this.emit("connected");
        return;
      }
      if (msg.type === "result") {
        const w = this.waiters.get(msg.callId);
        if (w) { clearTimeout(w.timer); this.waiters.delete(msg.callId); w.resolve({ ok: msg.ok, data: msg.data }); }
        return;
      }
      if (msg.type === "error") {
        console.error(`[node] hub: ${msg.message}`);
        // Erro fatal (bot excluÃ­do, token recusado) nÃ£o melhora tentando de novo: o nÃ³
        // encerra. Sem isto, o nÃ³ de um bot excluÃ­do ficava reconectando para sempre â€”
        // e era assim que o bot voltava a aparecer no painel.
        if (msg.fatal) { this.stop(); setTimeout(() => process.exit(0), 200); }
        return;
      }
      this.emit(msg.type, msg);
    });
    ws.on("close", () => {
      this.connected = false;
      if (this.heartbeat) clearInterval(this.heartbeat);
      if (this.closed) return;
      console.log(`[node] hub desconectado; tentando de novo em ${this.backoff / 1000}s`);
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    });
    ws.on("error", (e) => { if (!this.connected) console.log(`[node] falha ao conectar: ${(e as Error).message}`); });
  }

  private sendRaw(msg: NodeToHub) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (msg.type !== "heartbeat" && msg.type !== "hello") this.queue.push(msg);
  }

  send(msg: NodeToHub) { this.sendRaw(msg); }

  event(conversationId: string, event: BotEvent) { this.sendRaw({ type: "event", conversationId, event }); }

  status(text: string, busy: boolean) { this.sendRaw({ type: "status", text, busy }); }

  /** Envia e espera o `result` do hub. */
  call(build: (callId: string) => NodeToHub, timeoutMs = 190_000): Promise<{ ok: boolean; data: unknown }> {
    const callId = newId("c");
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiters.delete(callId); resolve({ ok: false, data: "sem resposta do hub" }); }, timeoutMs);
      this.waiters.set(callId, { resolve, timer });
      this.sendRaw(build(callId));
    });
  }
}
