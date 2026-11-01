/**
 * Um servidor de tela por bot, só em 127.0.0.1, na faixa 8201–8400.
 * O Hub publica isso em /android/<botId>/. O navegador não fala com o aparelho.
 */
import http from "node:http";
import net from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import type { CadastroAndroid } from "./androidBot.js";
import type { AdbFn } from "./androidBot.js";
import { htmlDaTela } from "./androidPlayer.js";
import { abrirSessao, type SessaoAndroid } from "./androidSessao.js";
import { mensagemRolar, mensagemTecla, mensagemTexto, mensagemToque, mensagemVoltar } from "./androidScrcpy.js";

export const FAIXA_TELA_ANDROID = { min: 8201, max: 8400 };

type Estado = {
  porta: number;
  server: http.Server;
  wss: WebSocketServer;
  clientes: Set<WebSocket>;
  sessao: SessaoAndroid | null;
  abrindo: Promise<void> | null;
  largura: number;
  altura: number;
  parar: () => void;
};

export class TelasAndroid {
  private porBot = new Map<string, Estado>();

  constructor(private deps: {
    ler: (botId: string) => CadastroAndroid | null;
    adb: AdbFn;
    adbBin: () => string | null;
    servidorScrcpy: () => string | null;
    abrirWhatsapp: (serial: string) => Promise<unknown>;
  }) {}

  async portaDe(botId: string): Promise<number> {
    const ja = this.porBot.get(botId);
    if (ja) return ja.porta;
    const porta = await this.reservar();
    const clientes = new Set<WebSocket>();
    const estado: Estado = {
      porta, server: null as unknown as http.Server, wss: null as unknown as WebSocketServer,
      clientes, sessao: null, abrindo: null, largura: 0, altura: 0, parar: () => {},
    };
    const server = http.createServer((req, res) => {
      const caminho = (req.url ?? "/").split("?")[0];
      if (caminho !== "/" && caminho !== "") {
        res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ ok: false, erro: "não encontrado" }));
        return;
      }
      const html = htmlDaTela(botId);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
    });
    const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 1024 * 1024 });
    wss.on("connection", (sock) => {
      clientes.add(sock);
      sock.on("close", () => {
        clientes.delete(sock);
        if (!clientes.size) this.encerrarSessao(estado);
      });
      sock.on("message", (data, isBinary) => {
        if (isBinary) return;
        this.comando(botId, estado, String(data));
      });
      void this.garantirSessao(botId, estado);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(porta, "127.0.0.1", () => resolve());
    });
    estado.server = server;
    estado.wss = wss;
    estado.parar = () => {
      this.encerrarSessao(estado);
      try { wss.close(); } catch { /* ok */ }
      try { server.close(); } catch { /* ok */ }
    };
    this.porBot.set(botId, estado);
    return porta;
  }

  parar(botId: string) {
    const e = this.porBot.get(botId);
    if (!e) return;
    e.parar();
    this.porBot.delete(botId);
  }

  pararTudo() {
    for (const id of [...this.porBot.keys()]) this.parar(id);
  }

  private avisar(estado: Estado, texto: string) {
    const msg = JSON.stringify({ tipo: "aviso", texto });
    for (const c of estado.clientes) { try { c.send(msg); } catch { /* caiu */ } }
  }

  private enviar(estado: Estado, dados: string | Buffer) {
    for (const c of estado.clientes) { try { c.send(dados); } catch { /* caiu */ } }
  }

  private encerrarSessao(estado: Estado) {
    try { estado.sessao?.fechar(); } catch { /* ok */ }
    estado.sessao = null;
    // Nao zera abrindo aqui: o iframe remonta e, se limpar no meio, sobe 2 scrcpy e a tela fecha.
  }

  private async garantirSessao(botId: string, estado: Estado) {
    if (estado.sessao || estado.abrindo) return estado.abrindo ?? Promise.resolve();
    const cadastro = this.deps.ler(botId);
    if (!cadastro) {
      this.avisar(estado, "Este bot ainda não tem celular pareado. Na depuração sem fio, anote o IP, a porta do código e a porta de conexão.");
      return;
    }
    const bin = this.deps.adbBin();
    const servidor = this.deps.servidorScrcpy();
    if (!bin || !servidor) {
      this.avisar(estado, "Não achei o adb ou o scrcpy-server em ferramentas/scrcpy. No PC da loja os dois vêm nessa pasta.");
      return;
    }
    estado.abrindo = (async () => {
      this.avisar(estado, `Conectando em ${cadastro.serial}…`);
      await this.deps.adb(["connect", `${cadastro.ip}:${cadastro.portaConexao}`], 15000);
      // WhatsApp Web so sobe apos o primeiro frame — em paralelo derrubava o handshake do scrcpy.
      const sessao = await abrirSessao({
        adbBin: bin,
        adb: this.deps.adb,
        serial: cadastro.serial,
        servidor,
        onAviso: (texto) => this.avisar(estado, texto),
        onMeta: (m) => {
          estado.largura = m.largura;
          estado.altura = m.altura;
          this.enviar(estado, JSON.stringify({ tipo: "meta", ...m }));
          void this.deps.abrirWhatsapp(cadastro.serial);
        },
        onConfig: (m) => this.enviar(estado, JSON.stringify({ tipo: "config", codec: m.codec, description: m.description })),
        onQuadro: (q) => {
          const pacote = Buffer.alloc(1 + q.dados.length);
          pacote[0] = q.chave ? 1 : 0;
          q.dados.copy(pacote, 1);
          this.enviar(estado, pacote);
        },
      });
      if (!estado.clientes.size) {
        try { sessao.fechar(); } catch { /* ok */ }
        return;
      }
      estado.sessao = sessao;
    })().catch((e) => {
      this.avisar(estado, (e as Error).message || "não abri a tela");
      estado.sessao = null;
    }).finally(() => { estado.abrindo = null; });
    return estado.abrindo;
  }

  private comando(botId: string, estado: Estado, bruto: string) {
    let m: any;
    try { m = JSON.parse(bruto); } catch { return; }
    const tipo = String(m?.tipo ?? "");
    if (tipo === "whatsapp") {
      const c = this.deps.ler(botId);
      if (!c) { this.avisar(estado, "Pareie o aparelho antes de abrir o WhatsApp Web."); return; }
      void this.deps.abrirWhatsapp(c.serial);
      return;
    }
    const w = estado.largura || 1080;
    const h = estado.altura || 2400;
    const x = Number(m?.x);
    const y = Number(m?.y);
    const px = Number.isFinite(x) ? (x <= 1 && x >= 0 ? x * w : x) : w / 2;
    const py = Number.isFinite(y) ? (y <= 1 && y >= 0 ? y * h : y) : h / 2;
    const sessao = estado.sessao;
    if (!sessao) return;
    if (tipo === "toque") {
      const acao = m.acao === "up" ? 1 : m.acao === "move" ? 2 : 0;
      sessao.controle(mensagemToque(acao, px, py, w, h));
    } else if (tipo === "rolar") {
      sessao.controle(mensagemRolar(px, py, w, h, Number(m.unidades) || 0));
    } else if (tipo === "voltar") {
      sessao.controle(mensagemVoltar(0));
      sessao.controle(mensagemVoltar(1));
    } else if (tipo === "inicio") {
      sessao.controle(mensagemTecla(3, 0));
      sessao.controle(mensagemTecla(3, 1));
    } else if (tipo === "texto") {
      sessao.controle(mensagemTexto(String(m.texto ?? "")));
    }
  }

  private reservar(): Promise<number> {
    const ocupadas = new Set([...this.porBot.values()].map((e) => e.porta));
    const tentar = (porta: number) => new Promise<boolean>((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(false));
      s.listen(porta, "127.0.0.1", () => s.close(() => resolve(true)));
    });
    return (async () => {
      for (let p = FAIXA_TELA_ANDROID.min; p <= FAIXA_TELA_ANDROID.max; p++) {
        if (p === 8787 || p === 8791 || p === 8790 || ocupadas.has(p)) continue;
        if (await tentar(p)) return p;
      }
      throw new Error("não há porta livre para a tela do Android");
    })();
  }
}
