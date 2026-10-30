// WhatsApp próprio de cada empresa.
//
// Cada empresa tem a SUA conta: a sessão fica em dados/whatsapp/<empresa>/, o QR code é
// gerado na hora de criar e, uma vez escaneado, a sessão se mantém sozinha entre
// reinícios. Bot de uma empresa só manda pela conta da empresa dele — é o mesmo
// princípio das conversas e da memória: empresa é empresa.
//
// Isto NÃO substitui o servidor do CRM (o painel do CRM), que continua sendo o caminho
// da loja. É a saída própria de cada empresa nova.
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import QRCode from "qrcode";

export type EstadoWhats = {
  empresaId: string;
  estado: "desligado" | "qr" | "conectando" | "conectado";
  /** QR em PNG (data URL), pronto para <img src>. Só existe enquanto espera a leitura. */
  qr?: string;
  /** número conectado, quando já escaneou */
  numero?: string;
  desde?: number;
  erro?: string;
};

type Sessao = { sock: any; estado: EstadoWhats; parando?: boolean };

export class WhatsAppDasEmpresas {
  private sessoes = new Map<string, Sessao>();
  constructor(private raiz: string, private aoMudar: (e: EstadoWhats) => void) {}

  private pasta(empresaId: string) {
    const p = path.join(this.raiz, "whatsapp", empresaId.replace(/[^a-z0-9_-]/gi, "_"));
    fs.mkdirSync(p, { recursive: true });
    return p;
  }

  estado(empresaId: string): EstadoWhats {
    return this.sessoes.get(empresaId)?.estado ?? { empresaId, estado: "desligado" };
  }

  todos(): EstadoWhats[] {
    return [...this.sessoes.values()].map((s) => s.estado);
  }

  /** Empresas que já têm sessão gravada em disco — para religar sozinho quando o Hub sobe. */
  salvas(): string[] {
    const base = path.join(this.raiz, "whatsapp");
    if (!fs.existsSync(base)) return [];
    return fs.readdirSync(base).filter((d) => fs.existsSync(path.join(base, d, "creds.json")));
  }

  private muda(empresaId: string, patch: Partial<EstadoWhats>) {
    const s = this.sessoes.get(empresaId);
    if (!s) return;
    s.estado = { ...s.estado, ...patch, empresaId };
    this.aoMudar(s.estado);
  }

  /** Liga (ou religa) a conta da empresa. O QR chega pelo evento, não por retorno. */
  async conectar(empresaId: string): Promise<EstadoWhats> {
    const existente = this.sessoes.get(empresaId);
    if (existente && existente.estado.estado !== "desligado") return existente.estado;

    const baileys: any = await import("@whiskeysockets/baileys");
    const makeWASocket = baileys.default ?? baileys.makeWASocket;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;
    const { state, saveCreds } = await useMultiFileAuthState(this.pasta(empresaId));
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
    this.sessoes.set(empresaId, { sock, estado: { empresaId, estado: "conectando" } });
    this.aoMudar(this.estado(empresaId));

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async (u: any) => {
      if (u.qr) {
        // PNG pronto para a tela: o painel só mostra <img src={qr}>.
        const png = await QRCode.toDataURL(u.qr, { margin: 1, width: 320 }).catch(() => undefined);
        this.muda(empresaId, { estado: "qr", qr: png, erro: undefined });
      }
      if (u.connection === "open") {
        const numero = String(sock.user?.id ?? "").split(":")[0];
        this.muda(empresaId, { estado: "conectado", qr: undefined, numero, desde: Date.now(), erro: undefined });
      }
      if (u.connection === "close") {
        const s = this.sessoes.get(empresaId);
        const codigo = u.lastDisconnect?.error?.output?.statusCode;
        const deslogado = codigo === DisconnectReason?.loggedOut;
        if (s?.parando || deslogado) {
          // Deslogado pelo celular: a sessão não serve mais, some o arquivo para o
          // próximo QR nascer limpo em vez de ficar tentando com credencial morta.
          if (deslogado) try { fs.rmSync(this.pasta(empresaId), { recursive: true, force: true }); } catch {}
          this.sessoes.delete(empresaId);
          this.aoMudar({ empresaId, estado: "desligado", erro: deslogado ? "desconectado pelo celular" : undefined });
          return;
        }
        this.muda(empresaId, { estado: "conectando", erro: u.lastDisconnect?.error?.message });
        this.sessoes.delete(empresaId);
        setTimeout(() => void this.conectar(empresaId).catch(() => {}), 4000);
      }
    });
    return this.estado(empresaId);
  }

  async desligar(empresaId: string, esquecer = false) {
    const s = this.sessoes.get(empresaId);
    if (s) {
      s.parando = true;
      try { if (esquecer) await s.sock.logout(); else s.sock.end(undefined); } catch {}
      this.sessoes.delete(empresaId);
    }
    if (esquecer) try { fs.rmSync(this.pasta(empresaId), { recursive: true, force: true }); } catch {}
    this.aoMudar({ empresaId, estado: "desligado" });
  }

  /** O número existe no WhatsApp? Devolve o jid da conta da empresa. */
  private async destino(empresaId: string, numero: string): Promise<{ sock: any; jid: string } | { erro: string }> {
    const s = this.sessoes.get(empresaId);
    if (!s || s.estado.estado !== "conectado") return { erro: "O WhatsApp desta empresa não está conectado. Abra Empresas no painel e escaneie o QR." };
    const so = String(numero).replace(/\D/g, "");
    const cheio = so.startsWith("55") ? so : `55${so}`;
    const [achou] = await s.sock.onWhatsApp(cheio).catch(() => []);
    if (!achou?.exists) return { erro: `O número ${numero} não tem WhatsApp.` };
    return { sock: s.sock, jid: achou.jid };
  }

  /** Foto ou documento pela conta da empresa. PDF vai como documento, nunca como foto. */
  async enviarArquivo(empresaId: string, numero: string, arq: { base64: string; nome: string; mime: string; legenda?: string }): Promise<{ ok: boolean; detalhe: string }> {
    const d = await this.destino(empresaId, numero);
    if ("erro" in d) return { ok: false, detalhe: d.erro };
    let dados = Buffer.from(arq.base64, "base64");
    const ehFoto = /^image\//i.test(arq.mime);
    const ehAudio = /^audio\//i.test(arq.mime);
    if (ehFoto) {
      await d.sock.sendMessage(d.jid, { image: dados, caption: arq.legenda || undefined });
      return { ok: true, detalhe: `Foto ${arq.nome} enviada para ${numero} pela conta da empresa.` };
    }
    if (ehAudio) {
      // Áudio tem que chegar como MENSAGEM DE VOZ, com a bolinha de play — não como
      // arquivo para baixar, que ninguém abre. O WhatsApp só toca assim em OGG/Opus,
      // então o que vier em outro formato passa pelo ffmpeg. Sem ffmpeg, vai como
      // áudio mesmo assim: tocar mal é melhor que virar anexo.
      let mime = arq.mime;
      if (!/ogg|opus/i.test(mime)) {
        const convertido = await paraOpus(dados).catch(() => null);
        if (convertido) { dados = convertido; mime = "audio/ogg; codecs=opus"; }
      }
      await d.sock.sendMessage(d.jid, { audio: dados, mimetype: mime, ptt: true });
      if (arq.legenda) await d.sock.sendMessage(d.jid, { text: arq.legenda });
      return { ok: true, detalhe: `Áudio ${arq.nome} enviado como mensagem de voz para ${numero} pela conta da empresa.` };
    }
    await d.sock.sendMessage(d.jid, { document: dados, mimetype: arq.mime || "application/octet-stream", fileName: arq.nome, caption: arq.legenda || undefined });
    return { ok: true, detalhe: `Arquivo ${arq.nome} enviado para ${numero} pela conta da empresa.` };
  }

  /** Manda texto pela conta da empresa. numero: só dígitos, com DDD (e 55 se faltar). */
  async enviar(empresaId: string, numero: string, texto: string): Promise<{ ok: boolean; detalhe: string }> {
    const s = this.sessoes.get(empresaId);
    if (!s || s.estado.estado !== "conectado") return { ok: false, detalhe: "O WhatsApp desta empresa não está conectado. Abra Empresas no painel e escaneie o QR." };
    const so = String(numero).replace(/\D/g, "");
    const cheio = so.startsWith("55") ? so : `55${so}`;
    const [achou] = await s.sock.onWhatsApp(cheio).catch(() => []);
    if (!achou?.exists) return { ok: false, detalhe: `O número ${numero} não tem WhatsApp.` };
    await s.sock.sendMessage(achou.jid, { text: texto });
    return { ok: true, detalhe: `Enviado para ${numero} pela conta da empresa.` };
  }
}

/** Converte qualquer áudio para OGG/Opus pelo ffmpeg, que é o que o WhatsApp toca como voz. */
function paraOpus(entrada: Buffer): Promise<Buffer<ArrayBuffer>> {
  return new Promise((ok, erro) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-ac", "1", "-f", "ogg", "pipe:1"], { windowsHide: true });
    const saida: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d) => saida.push(Buffer.from(d)));
    p.stderr.on("data", (d) => { err += String(d); });
    p.on("error", (e) => erro(e));
    p.on("close", (c) => {
      if (c !== 0 || !saida.length) return erro(new Error(err.slice(0, 200) || ("ffmpeg código " + c)));
      // Copiar para um Buffer novo em vez de devolver o concat: o tipo que o Baileys
      // aceita é o do Buffer.alloc, e o do concat não casa.
      const junto = Buffer.concat(saida);
      const saidaFinal: Buffer<ArrayBuffer> = Buffer.alloc(junto.length);
      junto.copy(saidaFinal);
      ok(saidaFinal);
    });
    p.stdin.on("error", () => {});
    p.stdin.end(entrada);
  });
}
