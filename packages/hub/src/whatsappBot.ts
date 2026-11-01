// WhatsApp de cada bot, por aparelho conectado (QR).
//
// A casa já usa Baileys (@whiskeysockets/baileys) com useMultiFileAuthState
// para a conta da empresa (dados/whatsapp/<empresa>/). Aqui é a mesma biblioteca
// e o mesmo formato, numa pasta por bot: bots/<botId>/whatsapp/ (creds.json e
// as chaves de sessão). Reiniciar o Hub não desloga: se creds.json existe, a
// sessão religa sozinha.
//
// Limite do aparelho conectado: o WhatsApp exige que o celular principal entre
// na internet de vez em quando. Na prática, cerca de 14 dias offline derruba
// a sessão e o próximo passo é escanear o QR de novo. Não há como a biblioteca
// impedir isso — é regra do WhatsApp, não desta pasta.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

export type EstadoWhatsBot = {
  botId: string;
  estado: "desligado" | "qr" | "conectando" | "conectado";
  qr?: string;
  numero?: string;
  desde?: number;
  erro?: string;
};

export type RecadoWhats = { id: string; de: string; texto: string; em: number; deMim: boolean };

export type SockMinimo = {
  ev: { on: (ev: string, fn: (u: any) => void) => void };
  user?: { id?: string };
  end: (e?: unknown) => void;
  logout: () => Promise<void>;
  sendMessage: (jid: string, msg: any) => Promise<unknown>;
  onWhatsApp: (n: string) => Promise<Array<{ exists?: boolean; jid?: string }>>;
};

type Sessao = { sock: SockMinimo; estado: EstadoWhatsBot; parando?: boolean; inbox: RecadoWhats[] };

const MAX_INBOX = 40;

export function pastaDosBots(): string {
  if (process.env.MYBOTS_BOTS_DIR) return process.env.MYBOTS_BOTS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "bots");
}

export function idDePasta(id: string): string {
  const limpo = String(id ?? "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);
  return limpo || "bot";
}

/** Pasta da sessão deste bot. Fica junto da persona e do workspace. */
export function pastaDaSessao(raiz: string, botId: string): string {
  return path.join(raiz, idDePasta(botId), "whatsapp");
}

function erroCurto(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? "");
  return m.replace(/(password|senha|passwd)\s*[:=]\s*\S+/gi, "$1=••••").slice(0, 180);
}

function textoDaMensagem(m: any): string {
  const msg = m?.message ?? {};
  const bruto = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.documentMessage?.caption || "";
  return String(bruto).replace(/\s+/g, " ").trim().slice(0, 2000);
}

export class WhatsAppDosBots {
  private sessoes = new Map<string, Sessao>();
  private ligando = new Map<string, Promise<EstadoWhatsBot>>();

  constructor(
    private raiz: string,
    private aoMudar: (e: EstadoWhatsBot) => void,
    private op?: { fabrica?: (pasta: string) => Promise<SockMinimo> | SockMinimo },
  ) {}

  pasta(botId: string): string {
    const p = pastaDaSessao(this.raiz, botId);
    fs.mkdirSync(p, { recursive: true });
    return p;
  }

  estado(botId: string): EstadoWhatsBot {
    return this.sessoes.get(botId)?.estado ?? { botId, estado: "desligado" };
  }

  /** Bots com sessão gravada. O creds.json é o que o Baileys usa para não pedir QR de novo. */
  salvas(): string[] {
    if (!fs.existsSync(this.raiz)) return [];
    const ids: string[] = [];
    for (const nome of fs.readdirSync(this.raiz)) {
      if (fs.existsSync(path.join(this.raiz, nome, "whatsapp", "creds.json"))) ids.push(nome);
    }
    return ids;
  }

  private muda(botId: string, patch: Partial<EstadoWhatsBot>) {
    const s = this.sessoes.get(botId);
    if (!s) return;
    s.estado = { ...s.estado, ...patch, botId };
    this.aoMudar(s.estado);
  }

  private carregarInbox(botId: string): RecadoWhats[] {
    try {
      const bruto = fs.readFileSync(path.join(this.pasta(botId), "inbox.json"), "utf8");
      const lista = JSON.parse(bruto);
      if (!Array.isArray(lista)) return [];
      return lista.slice(-MAX_INBOX).map((m) => ({
        id: String(m.id ?? ""),
        de: String(m.de ?? ""),
        texto: String(m.texto ?? "").slice(0, 2000),
        em: Number(m.em) || 0,
        deMim: !!m.deMim,
      })).filter((m) => m.texto);
    } catch {
      return [];
    }
  }

  private gravarInbox(botId: string, lista: RecadoWhats[]) {
    const arquivo = path.join(this.pasta(botId), "inbox.json");
    fs.writeFileSync(arquivo, JSON.stringify(lista.slice(-MAX_INBOX)), { mode: 0o600 });
  }

  private guardarRecado(botId: string, recado: RecadoWhats) {
    const s = this.sessoes.get(botId);
    if (!s || !recado.texto) return;
    if (s.inbox.some((m) => m.id && m.id === recado.id)) return;
    s.inbox = [...s.inbox, recado].slice(-MAX_INBOX);
    try { this.gravarInbox(botId, s.inbox); } catch { /* a leitura em memória segue */ }
  }

  ler(botId: string, limite = 15): RecadoWhats[] {
    const n = Math.min(40, Math.max(1, Math.round(limite) || 15));
    const s = this.sessoes.get(botId);
    const lista = s?.inbox?.length ? s.inbox : this.carregarInbox(botId);
    return lista.slice(-n);
  }

  async conectar(botId: string, forcar = false): Promise<EstadoWhatsBot> {
    if (forcar) await this.desligar(botId, false);
    const existente = this.sessoes.get(botId);
    if (existente && existente.estado.estado !== "desligado") return existente.estado;
    const emCurso = this.ligando.get(botId);
    if (emCurso) return emCurso;
    const p = this.conectarAgora(botId).finally(() => this.ligando.delete(botId));
    this.ligando.set(botId, p);
    return p;
  }

  private async conectarAgora(botId: string): Promise<EstadoWhatsBot> {
    if (process.env.MYBOTS_WHATS_QR_DEMO === "1" && !this.op?.fabrica) {
      const png = await QRCode.toDataURL(`mybots-demo:${idDePasta(botId)}`, { margin: 1, width: 320 }).catch(() => undefined);
      this.sessoes.set(botId, { sock: sockMudo(), estado: { botId, estado: "qr", qr: png }, inbox: this.carregarInbox(botId) });
      this.aoMudar(this.estado(botId));
      return this.estado(botId);
    }

    const sock = this.op?.fabrica
      ? await this.op.fabrica(this.pasta(botId))
      : await this.sockBaileys(botId);
    this.sessoes.set(botId, { sock, estado: { botId, estado: "conectando" }, inbox: this.carregarInbox(botId) });
    this.aoMudar(this.estado(botId));
    this.ouvir(botId, sock);
    return this.estado(botId);
  }

  private async sockBaileys(botId: string): Promise<SockMinimo> {
    const baileys: any = await import("@whiskeysockets/baileys");
    const makeWASocket = baileys.default ?? baileys.makeWASocket;
    const { useMultiFileAuthState, fetchLatestBaileysVersion } = baileys;
    const { state, saveCreds } = await useMultiFileAuthState(this.pasta(botId));
    let version: any;
    try { ({ version } = await fetchLatestBaileysVersion()); } catch { version = undefined; }
    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      browser: ["MyBots", "Chrome", "1.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    sock.ev.on("creds.update", saveCreds);
    return sock;
  }

  private ouvir(botId: string, sock: SockMinimo) {
    sock.ev.on("messages.upsert", (up: any) => {
      for (const m of up?.messages ?? []) {
        const texto = textoDaMensagem(m);
        if (!texto) continue;
        this.guardarRecado(botId, {
          id: String(m?.key?.id ?? ""),
          de: String(m?.key?.remoteJid ?? "").split("@")[0].split(":")[0],
          texto,
          em: (Number(m?.messageTimestamp) || 0) * 1000 || Date.now(),
          deMim: !!m?.key?.fromMe,
        });
      }
    });
    sock.ev.on("connection.update", async (u: any) => {
      if (u.qr) {
        const png = await QRCode.toDataURL(u.qr, { margin: 1, width: 320 }).catch(() => undefined);
        this.muda(botId, { estado: "qr", qr: png, erro: undefined });
      }
      if (u.connection === "open") {
        const numero = String(sock.user?.id ?? "").split(":")[0].split("@")[0];
        this.muda(botId, { estado: "conectado", qr: undefined, numero: numero || undefined, desde: Date.now(), erro: undefined });
      }
      if (u.connection === "close") {
        const s = this.sessoes.get(botId);
        let deslogado = false;
        try {
          const baileys: any = await import("@whiskeysockets/baileys");
          deslogado = u.lastDisconnect?.error?.output?.statusCode === baileys.DisconnectReason?.loggedOut;
        } catch { deslogado = false; }
        if (s?.parando || deslogado) {
          if (deslogado) try { fs.rmSync(this.pasta(botId), { recursive: true, force: true }); } catch { /* pasta já saiu */ }
          this.sessoes.delete(botId);
          this.aoMudar({ botId, estado: "desligado", erro: deslogado ? "desconectado pelo celular" : undefined });
          return;
        }
        this.muda(botId, { estado: "conectando", qr: undefined, erro: erroCurto(u.lastDisconnect?.error) });
        this.sessoes.delete(botId);
        setTimeout(() => void this.conectar(botId).catch(() => {}), 4000);
      }
    });
  }

  async desligar(botId: string, esquecer = false) {
    const s = this.sessoes.get(botId);
    if (s) {
      s.parando = true;
      try { if (esquecer) await s.sock.logout(); else s.sock.end(undefined); } catch { /* já caiu */ }
      this.sessoes.delete(botId);
    }
    if (esquecer) try { fs.rmSync(pastaDaSessao(this.raiz, botId), { recursive: true, force: true }); } catch { /* sem pasta */ }
    this.aoMudar({ botId, estado: "desligado" });
  }

  private destino(botId: string, numero: string): { sock: SockMinimo; jid: Promise<string> } | { erro: string } {
    const s = this.sessoes.get(botId);
    if (!s || s.estado.estado !== "conectado") {
      return { erro: "O WhatsApp deste bot não está conectado. O QR fica no painel Celular." };
    }
    const so = String(numero).replace(/\D/g, "");
    if (so.length < 10) return { erro: "Diga o número com DDD." };
    const cheio = so.startsWith("55") ? so : `55${so}`;
    return {
      sock: s.sock,
      jid: s.sock.onWhatsApp(cheio).then((lista) => {
        const achou = lista?.[0];
        if (!achou?.exists || !achou.jid) throw new Error(`O número ${numero} não tem WhatsApp.`);
        return achou.jid;
      }),
    };
  }

  async enviar(botId: string, numero: string, texto: string): Promise<{ ok: boolean; detalhe: string }> {
    const d = this.destino(botId, numero);
    if ("erro" in d) return { ok: false, detalhe: d.erro };
    try {
      const jid = await d.jid;
      await d.sock.sendMessage(jid, { text: texto });
      return { ok: true, detalhe: `Enviado para ${numero} pelo WhatsApp deste bot.` };
    } catch (e) {
      return { ok: false, detalhe: erroCurto(e) || "Não consegui enviar." };
    }
  }
}

function sockMudo(): SockMinimo {
  return {
    ev: { on: () => {} },
    end: () => {},
    logout: async () => {},
    sendMessage: async () => {},
    onWhatsApp: async () => [],
  };
}
