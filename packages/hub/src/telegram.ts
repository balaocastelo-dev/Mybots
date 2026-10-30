// Ponte do Telegram: o chefe fala com os bots pelo celular, por texto ou áudio.
// - Só responde a chat_id autorizado (TELEGRAM_ALLOWED_CHAT_IDS). Sem isso, não sobe.
// - Áudio entra pelo STT do Hub; a resposta volta em texto e, se ligado, em voz.
// - O pensamento do modelo vai como citação recolhível e NUNCA é falado.
import { toSpeech } from "@mybots/shared";
import { config } from "./config.js";
import type { Hub } from "./hub.js";
import { pickVoice, synthesize, transcribe } from "./voice.js";

const API = (metodo: string) => `https://api.telegram.org/bot${config.telegram.token}/${metodo}`;
const ARQ = (caminho: string) => `https://api.telegram.org/file/bot${config.telegram.token}/${caminho}`;

type Update = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; first_name?: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
    caption?: string;
    voice?: { file_id: string; duration: number; mime_type?: string };
    audio?: { file_id: string; mime_type?: string; file_name?: string };
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
    photo?: Array<{ file_id: string; file_size?: number }>;
  };
};

const escapaHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class TelegramBridge {
  private rodando = false;
  private offset = 0;
  private falhas = 0;
  /** por chat: com qual bot ele está falando */
  private alvo = new Map<number, string>();

  constructor(private hub: Hub) {}

  get ativo() { return this.rodando; }

  async start(): Promise<void> {
    const { token, allowedChatIds } = config.telegram;
    if (!token) return;
    if (!allowedChatIds.length) {
      console.log("[telegram] TELEGRAM_BOT_TOKEN existe mas TELEGRAM_ALLOWED_CHAT_IDS está vazio — a ponte NÃO vai subir (qualquer pessoa poderia comandar o PC).");
      return;
    }
    try {
      const eu = await this.api<{ username: string; first_name: string }>("getMe", {});
      console.log(`[telegram] ponte ligada como @${eu.username} — liberado para ${allowedChatIds.join(", ")}`);
    } catch (e) {
      console.log(`[telegram] não consegui falar com o Telegram: ${(e as Error).message}`);
      return;
    }
    await this.registraComandos();
    // carrega o último alvo de cada chat
    for (const chat of allowedChatIds) {
      const salvo = this.hub.db.getSetting<string>(`telegram.alvo.${chat}`);
      if (salvo) this.alvo.set(chat, salvo);
    }
    this.hub.onBotReply((conversationId, botId, texto, pensamento) => void this.saida(conversationId, botId, texto, pensamento));
    this.rodando = true;
    void this.laco();
  }

  stop() { this.rodando = false; }

  /** Lista que o Telegram mostra quando o chefe digita "/" — em português. */
  private async registraComandos() {
    const comandos = [
      { command: "bots", description: "Ver a equipe e quem está online" },
      { command: "falar", description: "Trocar de bot — ex.: /falar João" },
      { command: "voz", description: "Ligar ou desligar a resposta em áudio" },
      { command: "parar", description: "Interromper o que o bot está fazendo" },
      { command: "reiniciar", description: "Reiniciar o bot (quando ele travar)" },
      { command: "status", description: "Como estão as coisas agora" },
      { command: "ajuda", description: "Como usar o MyBots" },
    ];
    // cada chamada vai sozinha: se o Telegram recusar uma (código de idioma, por exemplo),
    // as outras continuam valendo.
    const tenta = async (metodo: string, corpo: Record<string, unknown>) => {
      try { await this.api(metodo, corpo); } catch (e) { console.log(`[telegram] ${metodo} falhou: ${(e as Error).message}`); }
    };
    await tenta("setMyCommands", { commands: comandos });                               // padrão, vale para todo idioma
    await tenta("setMyCommands", { commands: comandos, language_code: "pt" });          // português
    await tenta("setMyDescription", { description: "Sua equipe de bots do sua empresa. Fale por texto ou áudio: eles trabalham no seu PC e respondem aqui." });
    await tenta("setMyShortDescription", { short_description: "Comande sua equipe de bots por texto ou áudio." });
  }

  // ---------- entrada ----------

  private async laco() {
    while (this.rodando) {
      try {
        const updates = await this.api<Update[]>("getUpdates", { offset: this.offset, timeout: 30, allowed_updates: ["message"] }, 40_000);
        this.falhas = 0;
        for (const u of updates) {
          this.offset = u.update_id + 1;
          try { await this.entrada(u); } catch (e) { console.log(`[telegram] erro tratando mensagem: ${(e as Error).message}`); }
        }
      } catch (e) {
        if (!this.rodando) return;
        this.falhas++;
        const espera = Math.min(60_000, 2000 * this.falhas);
        console.log(`[telegram] polling falhou (${this.falhas}): ${(e as Error).message} — tentando de novo em ${espera / 1000}s`);
        await new Promise((r) => setTimeout(r, espera));
      }
    }
  }

  private async entrada(u: Update) {
    const m = u.message;
    if (!m) return;
    const chat = m.chat.id;
    if (!config.telegram.allowedChatIds.includes(chat)) {
      this.hub.db.audit(null, "telegram.negado", { chat, de: m.from?.username ?? m.from?.id });
      return; // silêncio: não damos pista de que o bot existe
    }

    let texto = (m.text ?? m.caption ?? "").trim();
    const anexos: Array<{ name: string; mime: string; dataBase64: string }> = [];

    // áudio vira texto pelo STT do Hub
    if (m.voice || m.audio) {
      const fid = (m.voice ?? m.audio)!.file_id;
      const mime = (m.voice ?? m.audio)!.mime_type ?? "audio/ogg";
      await this.api("sendChatAction", { chat_id: chat, action: "typing" });
      try {
        const audio = await this.baixa(fid);
        const transcrito = (await transcribe(audio, mime, m.voice ? "voz.ogg" : "audio.mp3")).trim();
        if (!transcrito) { await this.diz(chat, "Não entendi o áudio. Pode repetir ou escrever?"); return; }
        texto = texto ? `${texto}\n${transcrito}` : transcrito;
        await this.diz(chat, `🎤 <i>${escapaHtml(transcrito)}</i>`);
      } catch (e) {
        await this.diz(chat, `Não consegui transcrever o áudio: ${escapaHtml((e as Error).message)}`);
        return;
      }
    }

    // arquivos e fotos viram anexo da mensagem
    const arquivo = m.document ?? (m.photo?.length ? m.photo[m.photo.length - 1] : undefined);
    if (arquivo) {
      const doc = m.document;
      if ((doc?.file_size ?? 0) > 20 * 1024 * 1024) { await this.diz(chat, "Arquivo grande demais (limite 20 MB pelo Telegram)."); return; }
      try {
        const dados = await this.baixa(arquivo.file_id);
        anexos.push({ name: doc?.file_name ?? "foto.jpg", mime: doc?.mime_type ?? "image/jpeg", dataBase64: dados.toString("base64") });
        if (!texto) texto = `Segue o arquivo ${doc?.file_name ?? "foto.jpg"}.`;
      } catch (e) {
        await this.diz(chat, `Não consegui baixar o arquivo: ${escapaHtml((e as Error).message)}`);
        return;
      }
    }

    if (!texto && !anexos.length) return;
    if (texto.startsWith("/")) { await this.comando(chat, texto); return; }

    const bot = this.alvoDe(chat);
    if (!bot) { await this.diz(chat, "Nenhum bot disponível agora. Use /bots para ver a equipe."); return; }
    await this.api("sendChatAction", { chat_id: chat, action: "typing" });
    this.hub.sendUserMessage(`dm:${bot}`, texto, anexos.length ? anexos : undefined);
    this.hub.db.audit(bot, "telegram.recebido", { chat, chars: texto.length, anexos: anexos.length });
  }

  private async comando(chat: number, linha: string) {
    const [cmd, ...resto] = linha.split(/\s+/);
    const arg = resto.join(" ").trim();
    const base = cmd.toLowerCase().replace(/@.*$/, "");
    switch (base) {
      case "/start":
      case "/ajuda":
      case "/help":
        await this.diz(chat, [
          "<b>MyBots</b> — sua equipe pelo Telegram.",
          "",
          "Escreva ou mande um áudio que eu entrego ao bot escolhido.",
          "",
          "<b>/bots</b> — quem está na equipe",
          "<b>/falar &lt;nome&gt;</b> — trocar de bot",
          "<b>/voz</b> — ligar/desligar resposta em áudio",
          "<b>/parar</b> — interromper o que o bot está fazendo",
          "<b>/reiniciar</b> — reiniciar o bot quando ele travar",
          "<b>/status</b> — como estão as coisas",
        ].join("\n"));
        return;
      case "/bots": {
        const bots = this.hub.summaries();
        if (!bots.length) { await this.diz(chat, "Nenhum bot cadastrado."); return; }
        const atual = this.alvo.get(chat);
        await this.diz(chat, ["<b>Equipe</b>", ...bots.map((b) => `${b.id === atual ? "▶️" : b.online ? "🟢" : "⚪"} <b>${escapaHtml(b.name)}</b> — ${escapaHtml(b.role || "")}${b.online ? "" : " (offline)"}`), "", "Troque com <code>/falar nome</code>."].join("\n"));
        return;
      }
      case "/falar":
      case "/b": {
        if (!arg) { await this.diz(chat, "Diga com quem: <code>/falar João</code>"); return; }
        const busca = arg.toLowerCase();
        const achado = this.hub.summaries().find((b) => b.id === busca || b.name.toLowerCase().includes(busca) || b.id.includes(busca));
        if (!achado) { await this.diz(chat, `Não achei "${escapaHtml(arg)}". Veja /bots.`); return; }
        this.alvo.set(chat, achado.id);
        this.hub.db.setSetting(`telegram.alvo.${chat}`, achado.id);
        await this.diz(chat, `Agora você fala com <b>${escapaHtml(achado.name)}</b>${achado.online ? "" : " (está offline no momento)"}.`);
        return;
      }
      case "/voz": {
        const ligado = this.hub.db.getSetting<boolean>(`telegram.voz.${chat}`) ?? true;
        const novo = arg ? /^(on|1|sim|lig)/i.test(arg) : !ligado;
        this.hub.db.setSetting(`telegram.voz.${chat}`, novo);
        await this.diz(chat, novo ? "Resposta em áudio <b>ligada</b>." : "Resposta em áudio <b>desligada</b>.");
        return;
      }
      case "/reiniciar":
      case "/restart": {
        const bot = this.alvoDe(chat);
        if (!bot) { await this.diz(chat, "Nenhum bot selecionado."); return; }
        const nome = this.hub.summaries().find((b) => b.id === bot)?.name ?? bot;
        const ok = this.hub.restartBot(bot);
        await this.diz(chat, ok
          ? `Reiniciando <b>${escapaHtml(nome)}</b>… ele volta em uns 20 segundos.`
          : `<b>${escapaHtml(nome)}</b> não é hospedado neste PC, então não dá para reiniciar daqui.`);
        return;
      }
      case "/parar": {
        const bot = this.alvoDe(chat);
        if (bot) { this.hub.abortBot(bot); await this.diz(chat, "Mandei parar."); }
        return;
      }
      case "/status": {
        const bots = this.hub.summaries();
        const online = bots.filter((b) => b.online);
        const ocupados = online.filter((b) => b.busy);
        await this.diz(chat, [
          `<b>${online.length}</b> de <b>${bots.length}</b> online${ocupados.length ? `, ${ocupados.length} trabalhando` : ""}.`,
          ...ocupados.map((b) => `⏳ ${escapaHtml(b.name)}: ${escapaHtml(b.status)}`),
          `Controle: <b>${this.hub.control().global ?? "por bot"}</b>`,
        ].join("\n"));
        return;
      }
      default:
        await this.diz(chat, "Não conheço esse comando. Veja /ajuda.");
    }
  }

  // ---------- saída ----------

  private async saida(conversationId: string, botId: string, texto: string, pensamento?: string) {
    if (!this.rodando || !conversationId.startsWith("dm:")) return;
    const chats = [...this.alvo.entries()].filter(([, b]) => b === botId).map(([c]) => c);
    if (!chats.length) return;
    const bot = this.hub.summaries().find((b) => b.id === botId);
    const nome = bot?.name ?? botId;
    for (const chat of chats) {
      try {
        const partes: string[] = [];
        if (pensamento) partes.push(`<blockquote expandable><code>${escapaHtml(pensamento.slice(0, 3000))}</code></blockquote>`);
        if (texto) partes.push(escapaHtml(texto));
        if (partes.length) await this.diz(chat, `<b>${escapaHtml(nome)}</b>\n${partes.join("\n")}`);
        const querVoz = this.hub.db.getSetting<boolean>(`telegram.voz.${chat}`) ?? true;
        if (querVoz && texto) {
          const fala = toSpeech(texto).lead;        // nunca o pensamento
          if (fala) await this.mandaVoz(chat, fala, pickVoice(botId, bot?.voice));
        }
      } catch (e) {
        console.log(`[telegram] falha ao responder ${chat}: ${(e as Error).message}`);
      }
    }
  }

  private async mandaVoz(chat: number, texto: string, voz: string) {
    try {
      const { audio, mime } = await synthesize(texto.slice(0, 1200), voz);
      const form = new FormData();
      form.append("chat_id", String(chat));
      form.append("voice", new Blob([new Uint8Array(audio)], { type: mime }), "resposta.mp3");
      const r = await fetch(API("sendVoice"), { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) {
        const form2 = new FormData();
        form2.append("chat_id", String(chat));
        form2.append("audio", new Blob([new Uint8Array(audio)], { type: mime }), "resposta.mp3");
        await fetch(API("sendAudio"), { method: "POST", body: form2, signal: AbortSignal.timeout(60_000) });
      }
    } catch (e) {
      console.log(`[telegram] TTS falhou: ${(e as Error).message}`);
    }
  }

  /** Manda texto em HTML, quebrando em pedaços de 4000 caracteres. */
  private async diz(chat: number, html: string) {
    for (let i = 0; i < html.length; i += 4000) {
      await this.api("sendMessage", { chat_id: chat, text: html.slice(i, i + 4000), parse_mode: "HTML", disable_web_page_preview: true });
    }
  }

  private alvoDe(chat: number): string | undefined {
    const atual = this.alvo.get(chat);
    if (atual && this.hub.summaries().some((b) => b.id === atual)) return atual;
    // sem alvo: prefere o gerente, senão o primeiro online
    const bots = this.hub.summaries();
    const escolhido = bots.find((b) => b.online && b.manages?.length) ?? bots.find((b) => b.online) ?? bots[0];
    if (escolhido) { this.alvo.set(chat, escolhido.id); this.hub.db.setSetting(`telegram.alvo.${chat}`, escolhido.id); }
    return escolhido?.id;
  }

  private async baixa(fileId: string): Promise<Buffer> {
    const info = await this.api<{ file_path: string }>("getFile", { file_id: fileId });
    const r = await fetch(ARQ(info.file_path), { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`download ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }

  private async api<T>(metodo: string, corpo: Record<string, unknown>, timeout = 20_000): Promise<T> {
    const r = await fetch(API(metodo), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(timeout),
    });
    const j = (await r.json()) as { ok: boolean; result: T; description?: string };
    if (!j.ok) throw new Error(j.description ?? `erro em ${metodo}`);
    return j.result;
  }
}
