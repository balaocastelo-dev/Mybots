import fs from "node:fs";
import path from "node:path";

/** LÃª .env simples (sem dependÃªncia) a partir da pasta do hub ou da raiz do repo. */
function loadDotEnv() {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m || line.trim().startsWith("#")) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadDotEnv();

/**
 * A raiz do repositÃ³rio, achada subindo atÃ© encontrar o package.json de cima.
 *
 * O Hub roda com a pasta de trabalho em packages/hub (Ã© assim que o npm workspace
 * inicia), entÃ£o `process.cwd()` NÃƒO Ã© a raiz. Quem usou cwd para achar scripts/ e .env
 * procurou em packages/hub/scripts e nunca encontrou â€” o PDF da demonstraÃ§Ã£o ficou
 * quebrado assim, em silÃªncio, atÃ© a mensagem de erro passar a dizer o caminho.
 */
export function raizDoProjeto(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, "scripts")) && fs.existsSync(path.join(dir, "packages"))) return dir;
    const acima = path.dirname(dir);
    if (acima === dir) break;
    dir = acima;
  }
  return process.cwd();
}

export const config = {
  host: process.env.MYBOTS_HUB_HOST ?? "0.0.0.0",
  port: Number(process.env.MYBOTS_HUB_PORT ?? 8790),
  /** Token aceito de qualquer nÃ³ (uso simples na LAN). */
  hubToken: process.env.MYBOTS_HUB_TOKEN ?? "",
  /** Tokens por bot: "joao-videomaker:abc,robertinho-auditor:def" */
  nodeTokens: parseNodeTokens(process.env.MYBOTS_NODE_TOKENS ?? ""),
  /** Senha opcional da interface (vazia = sem senha; use sÃ³ na LAN). */
  uiPassword: process.env.MYBOTS_UI_PASSWORD ?? "",
  /** Login online (e-mail). Com MYBOTS_SENHA_HASH, a interface exige sessao. */
  usuarioOnline: process.env.MYBOTS_USUARIO ?? "",
  /** Hash scrypt da senha online (nunca a senha em claro). */
  senhaHash: process.env.MYBOTS_SENHA_HASH ?? "",
  /** Segredo HMAC dos cookies de sessao. */
  sessionSecret: process.env.MYBOTS_SESSION_SECRET ?? process.env.MYBOTS_HUB_TOKEN ?? "dev-inseguro",
  dbFile: process.env.MYBOTS_DB ?? path.resolve(process.cwd(), "data", "mybots.sqlite"),
  uiDist: process.env.MYBOTS_UI_DIST ?? path.resolve(process.cwd(), "../ui/dist"),
  version: "0.1.0",
  /** Tempo mÃ¡ximo que um ask_bot espera a resposta do outro Bot (ms). */
  askBotTimeoutMs: Number(process.env.MYBOTS_ASK_BOT_TIMEOUT_MS ?? 180_000),
  /** URL pÃºblica do Hub, usada em links de arquivos enviados aos bots (ex.: http://192.168.0.10:8790). */
  publicUrl: (process.env.MYBOTS_PUBLIC_URL ?? `http://127.0.0.1:${process.env.MYBOTS_HUB_PORT ?? 8790}`).replace(/\/$/, ""),
  /** Webhook de saÃ­da para canais externos (WhatsApp via CRM): recebe {channel, to, botId, text}. */
  channelWebhook: process.env.MYBOTS_CHANNEL_WEBHOOK_URL ?? "",
  channelWebhookKey: process.env.MYBOTS_CHANNEL_WEBHOOK_KEY ?? "",
  /** Token que o CRM/canal usa para postar em /api/channels/incoming (vazio = usa o token do hub). */
  channelInboundKey: process.env.MYBOTS_CHANNEL_INBOUND_KEY ?? "",
  /** Ponte do Telegram. Sem allowedChatIds a ponte nÃ£o sobe (bot aberto seria comandar o PC de fora). */
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN ?? "",
    username: process.env.TELEGRAM_BOT_USERNAME ?? "",
    allowedChatIds: (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n !== 0),
  },
};

function parseNodeTokens(s: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of s.split(",")) {
    const [bot, token] = part.split(":").map((x) => x?.trim());
    if (bot && token) m.set(bot, token);
  }
  return m;
}

/** Verifica se o token serve para o bot informado. */
export function tokenAllows(botId: string, token: string): boolean {
  if (!token) return false;
  const perBot = config.nodeTokens.get(botId);
  if (perBot) return perBot === token;
  if (config.hubToken) return config.hubToken === token;
  // Sem nenhum token configurado: aceita (modo de desenvolvimento) e avisa.
  return !config.hubToken && config.nodeTokens.size === 0;
}

/** Descobre o bot dono de um token (para o MCP). */
export function botForToken(token: string): string | null {
  for (const [bot, t] of config.nodeTokens) if (t === token) return bot;
  return null;
}

