/**
 * O Android do bot, visto pelo Hub.
 *
 * Pareamento: adb pair + adb connect no PC onde o Hub roda (no da loja, o Windows).
 * Tela: /android/<botId>/ encaminha para um ws-scrcpy nosso em 127.0.0.1.
 * O gancho é o que maquinas.ts chama quando o PC do bot liga ou desliga.
 */
import fs from "node:fs";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { raizDoProjeto } from "./config.js";
import { binarioDoAdb, executarAdb } from "./celular.js";
import { PareamentoAndroid, idDeBotValido, type AdbFn, type CadastroAndroid, type PedidoParear } from "./androidBot.js";
import { TelasAndroid } from "./androidStream.js";
import { argumentosDocker, avaliarEsteHost, modoFallbackDoAmbiente, nomeDoContainerAndroid } from "./androidFallback.js";
import { registrarGanchoAndroid, type GanchoAndroid } from "./androidHook.js";
import { abrirWsAndroid, caminhoNoAndroid, encaminharHttpAndroid, idDoAndroid } from "./ponteAndroid.js";
import { execFile } from "node:child_process";

export type LojaAndroid = {
  ler(botId: string): CadastroAndroid | null;
  gravar(botId: string, c: CadastroAndroid | null): void;
};

function docker(args: string[], ms = 180000): Promise<{ ok: boolean; saida: string }> {
  return new Promise((resolve) => {
    execFile("docker", args, { timeout: ms, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (e, out, err) => {
      resolve({ ok: !e, saida: String(out ?? "") + String(err ?? "") });
    });
  });
}

export class ServicoAndroid {
  private pareamento: PareamentoAndroid;
  private telas: TelasAndroid;
  private portasFallback = new Map<string, number>();

  constructor(private deps: { loja: LojaAndroid; botExiste: (id: string) => boolean; adb?: AdbFn }) {
    const adb: AdbFn = deps.adb ?? ((args, ms) => executarAdb(args, ms));
    this.pareamento = new PareamentoAndroid({ adb, ler: (id) => deps.loja.ler(id), gravar: (id, c) => deps.loja.gravar(id, c) });
    this.telas = new TelasAndroid({
      ler: (id) => this.pareamento.ler(id),
      adb,
      adbBin: () => binarioDoAdb(),
      servidorScrcpy: () => {
        const p = path.join(raizDoProjeto(), "ferramentas", "scrcpy", "scrcpy-server");
        return fs.existsSync(p) ? p : null;
      },
      abrirWhatsapp: (serial) => this.pareamento.abrirWhatsapp(serial),
    });
  }

  gancho(): GanchoAndroid {
    return {
      caminho: (botId) => `/android/${botId}/`,
      aoLigarPc: (botId) => this.aoLigarPc(botId),
      aoDesligarPc: (botId) => this.aoDesligarPc(botId),
    };
  }

  registrar() {
    registrarGanchoAndroid(this.gancho());
  }

  async parear(botId: string, body: PedidoParear) {
    if (!idDeBotValido(botId)) return { ok: false as const, erro: "id inválido" };
    if (!this.deps.botExiste(botId)) return { ok: false as const, erro: "bot não encontrado" };
    return this.pareamento.parear(botId, body);
  }

  async status(botId: string) {
    return this.pareamento.status(botId);
  }

  async aoLigarPc(botId: string) {
    await this.pareamento.reconectar(botId);
    const st = await this.pareamento.status(botId);
    if (st.conectado) return;
    const modo = modoFallbackDoAmbiente();
    if (!modo || st.cadastrado) return;
    await this.subirFallback(botId, modo);
  }

  async aoDesligarPc(botId: string) {
    this.telas.parar(botId);
  }

  /**
   * Container mybots-android-<botId>, publicado só em 127.0.0.1.
   * Não baixa imagem nenhuma se o host não aguenta — e o padrão é nem tentar.
   */
  async subirFallback(botId: string, modo: "redroid" | "emulador") {
    const v = await avaliarEsteHost();
    const item = modo === "redroid" ? v.redroid : v.emulador;
    if (!item.serve) return { ok: false as const, erro: item.motivo };
    const porta = 8501 + (Math.abs(hash(botId)) % 80);
    if (porta === 8787 || porta === 8791 || porta === 8790) return { ok: false as const, erro: "porta reservada" };
    const nome = nomeDoContainerAndroid(botId);
    await docker(["rm", "-f", nome], 30000);
    const args = argumentosDocker(modo, botId, porta);
    const r = await docker(args);
    if (!r.ok) return { ok: false as const, erro: r.saida.replace(/\s+/g, " ").trim().slice(0, 300) || "o container não subiu" };
    this.portasFallback.set(botId, porta);
    const serial = `127.0.0.1:${porta}`;
    this.deps.loja.gravar(botId, { modo, ip: "127.0.0.1", portaConexao: porta, serial, pareadoEm: Date.now() });
    await new Promise((res) => setTimeout(res, 1500));
    await executarAdb(["connect", serial], 20000);
    return { ok: true as const };
  }

  async http(req: FastifyRequest, reply: FastifyReply) {
    const url = String((req.raw as { url?: string })?.url || req.url || "");
    const id = idDoAndroid(url);
    const caminho = caminhoNoAndroid(url);
    if (!id || !caminho) return reply.code(404).send({ ok: false, erro: "tela indisponível" });
    if (!idDeBotValido(id) || !this.deps.botExiste(id)) return reply.code(404).send({ ok: false, erro: "bot não encontrado" });
    let porta: number;
    try { porta = await this.telas.portaDe(id); }
    catch (e) { return reply.code(503).send({ ok: false, erro: (e as Error).message }); }
    await encaminharHttpAndroid(req, reply, porta, caminho);
  }

  ws(socket: { send: (d: Buffer | string) => void; close: () => void; on: (ev: string, fn: (...a: any[]) => void) => void }, req: { raw?: { url?: string }; url?: string; headers?: Record<string, string> }) {
    const fila: Buffer[] = [];
    let enviar: ((b: Buffer) => void) | null = null;
    let morto = false;
    socket.on("message", (m: Buffer | string) => {
      if (morto) return;
      const b = Buffer.isBuffer(m) ? m : Buffer.from(m);
      if (enviar) enviar(b);
      else fila.push(b);
    });
    socket.on("close", () => { morto = true; });
    void (async () => {
      const url = String(req.raw?.url || req.url || "");
      const id = idDoAndroid(url);
      const caminho = caminhoNoAndroid(url);
      if (morto) return;
      if (!id || !caminho || !this.deps.botExiste(id)) { try { socket.close(); } catch { /* ok */ } return; }
      let porta: number;
      try { porta = await this.telas.portaDe(id); }
      catch { try { socket.close(); } catch { /* ok */ } return; }
      if (morto) return;
      const prot = String(req.headers?.["sec-websocket-protocol"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      enviar = abrirWsAndroid(socket, porta, caminho, fila, prot);
    })();
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function lojaDoHub(ler: (k: string) => unknown, gravar: (k: string, v: unknown) => void): LojaAndroid {
  const chave = (id: string) => `android.bot.${id}`;
  return {
    ler(id) {
      const v = ler(chave(id));
      if (!v || typeof v !== "object") return null;
      return v as CadastroAndroid;
    },
    gravar(id, c) { gravar(chave(id), c); },
  };
}
