/**
 * O Android do bot, visto pelo Hub.
 *
 * Pareamento: adb pair + adb connect no PC onde o Hub roda (no da loja, o Windows).
 * Tela: /android/<botId>/ encaminha para um ws-scrcpy nosso em 127.0.0.1.
 * O ciclo do PC passa pelo registro de provedores (aparelho prioridade 10,
 * redroid prioridade 1), não por um import do maquinas.ts.
 */
import fs from "node:fs";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { raizDoProjeto } from "./config.js";
import { binarioDoAdb, executarAdb } from "./celular.js";
import { PareamentoAndroid, idDeBotValido, type AdbFn, type CadastroAndroid, type PedidoParear } from "./androidBot.js";
import { TelasAndroid } from "./androidStream.js";
import { argumentosDocker, avaliarEsteHost, modoFallbackDoAmbiente, nomeDoContainerAndroid } from "./androidFallback.js";
import { instalarProvedores, type FonteDoProvedor } from "./androidProvedor.js";
import { listarProvedoresAndroid, resolverAlvoAndroid } from "./android.js";
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

export class ServicoAndroid implements FonteDoProvedor {
  private pareamento: PareamentoAndroid;
  private telas: TelasAndroid;
  private portasFallback = new Map<string, number>();
  private usos = new Map<string, number>();

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

  cadastro(botId: string) { return this.pareamento.ler(botId); }

  conectado(botId: string) { return this.pareamento.conectado(botId); }

  uso(botId: string): number | null {
    return this.usos.get(botId) ?? this.cadastro(botId)?.pareadoEm ?? null;
  }

  marcarUso(botId: string) { this.usos.set(botId, Date.now()); }

  async reconectar(botId: string) { await this.pareamento.reconectar(botId); }

  async abrirWhatsapp(botId: string) {
    const c = this.cadastro(botId);
    if (c) await this.pareamento.abrirWhatsapp(c.serial);
  }

  pararTela(botId: string) { this.telas.parar(botId); }

  /** Entra no registro oficial: aparelho (10) e redroid (1). */
  registrar() {
    instalarProvedores(this);
  }

  async parear(botId: string, body: PedidoParear) {
    if (!idDeBotValido(botId)) return { ok: false as const, erro: "id inválido" };
    if (!this.deps.botExiste(botId)) return { ok: false as const, erro: "bot não encontrado" };
    return this.pareamento.parear(botId, body);
  }

  async status(botId: string) {
    return this.pareamento.status(botId);
  }

  /** O provedor redroid chama isto. Aparelho já cadastrado não é substituído. */
  async subirFallback(botId: string) {
    const modo = modoFallbackDoAmbiente();
    if (!modo) return;
    await this.subirContainer(botId, modo);
  }

  /**
   * Container mybots-android-<botId>, publicado só em 127.0.0.1.
   * Não baixa imagem nenhuma se o host não aguenta — e o padrão é nem tentar.
   */
  private async subirContainer(botId: string, modo: "redroid" | "emulador") {
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
    const alvo = await resolverAlvoAndroid(id);
    if (!alvo) return reply.code(503).send({ error: "nenhum provedor de celular resolveu este bot", botId: id, provedores: listarProvedoresAndroid() });
    this.marcarUso(id);
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
      if (!id || !caminho) { try { socket.close(); } catch { /* ok */ } return; }
      if (!(await resolverAlvoAndroid(id))) { try { socket.close(); } catch { /* ok */ } return; }
      this.marcarUso(id);
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
