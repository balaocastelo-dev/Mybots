import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { type BotInfo, type ControlMode, isControlMode } from "@mybots/shared";

export type ProviderKind = "gemini" | "anthropic" | "openai";

/** Atalhos para provedores compatíveis com a API da OpenAI. */
export const OPENAI_COMPAT_PRESETS: Record<string, { baseURL: string; keyEnv: string; label: string }> = {
  nous: { baseURL: "https://inference-api.nousresearch.com/v1", keyEnv: "NOUS_API_KEY", label: "Nous Portal" },
  ollama: { baseURL: "http://127.0.0.1:11434/v1", keyEnv: "OLLAMA_API_KEY", label: "Ollama" },
  openrouter: { baseURL: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", label: "OpenRouter" },
  "opencode-zen": { baseURL: "https://opencode.ai/zen/v1", keyEnv: "OPENCODE_API_KEY", label: "OpenCode Zen (pago)" },
  openai: { baseURL: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", label: "OpenAI" },
  groq: { baseURL: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", label: "Groq" },
  lmstudio: { baseURL: "http://127.0.0.1:1234/v1", keyEnv: "LMSTUDIO_API_KEY", label: "LM Studio" },
  zai: { baseURL: "https://api.z.ai/api/paas/v4", keyEnv: "ZAI_API_KEY", label: "Z.ai (GLM Flash)" },
  cerebras: { baseURL: "https://api.cerebras.ai/v1", keyEnv: "CEREBRAS_API_KEY", label: "Cerebras" },
  mistral: { baseURL: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY", label: "Mistral" },
};

export type NodeConfig = {
  hub: string;                 // ws://192.168.0.10:8787
  token: string;
  bot: BotInfo;
  engine: "direct" | "opencode";
  workspace: string;
  personaFile: string;
  provider: {
    /** gemini | anthropic | openai | nous | ollama | openrouter | opencode-zen | groq | lmstudio */
    kind: string;
    model: string;
    apiKey?: string;
    baseURL?: string;
    maxTokens?: number;
    temperature?: number;
    /** modelo que enxerga imagens quando o principal é só texto (padrão no Ollama: qwen2.5vl:7b) */
    visionModel?: string;
    visionBaseURL?: string;
  };
  opencode: {
    bin: string;               // "opencode"
    port: number;
    password?: string;
    spawn: boolean;            // true = o nó inicia o opencode serve; false = já está rodando
    manageConfig: boolean;     // true = o nó escreve/atualiza opencode.json no workspace
    model?: string;            // ex.: "opencode/big-pickle", "google/gemini-2.5-flash", "anthropic/claude-sonnet-4-5"
    agent?: string;            // nome do agente (padrão = id do bot)
    hubHttp?: string;          // http://192.168.0.10:8787 (para o MCP); deduzido do hub se vazio
  };
  approval: {
    /** padrões (regex) de comandos que rodam sem pedir aprovação */
    autoAllow: string[];
    /** padrões sempre negados */
    deny: string[];
    /** minutos que um "sempre permitir" vale */
    rememberMinutes: number;
    shell: "cmd" | "powershell" | "sh";
    commandTimeoutMs: number;
    /** nível de controle: supervisionado (padrão) | autonomo | deus — o Hub pode sobrescrever globalmente */
    mode: ControlMode;
  };
  maxToolRounds: number;
  historyMessages: number;
};

const DEFAULTS: NodeConfig = {
  hub: "ws://127.0.0.1:8787",
  token: "",
  bot: { id: "bot", name: "Bot", role: "Assistente", avatar: "🤖" },
  engine: "direct",
  workspace: "./workspace",
  personaFile: "./persona.md",
  provider: { kind: "ollama", model: "qwen3:30b" },
  opencode: { bin: "opencode", port: 4096, spawn: true, manageConfig: true },
  approval: {
    autoAllow: ["^(dir|ls|git status|git log|git diff|type|cat|echo|whoami|hostname|ipconfig|ifconfig|pwd|cd)\\b"],
    deny: ["\\b(format|diskpart|shutdown|bcdedit|reg\\s+delete)\\b", "rm\\s+-rf\\s+/(\\s|$)", "Remove-Item\\s+.*-Recurse.*(C:\\\\|/)\\s*$"],
    rememberMinutes: 24 * 60,
    shell: os.platform() === "win32" ? "powershell" : "sh",
    commandTimeoutMs: 120_000,
    mode: "supervisionado",
  },
  maxToolRounds: 15,
  historyMessages: 40,
};

function loadDotEnv(dir: string) {
  for (const file of [path.join(dir, ".env"), path.resolve(dir, "../../.env")]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m || line.trim().startsWith("#")) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

export function loadConfig(argPath?: string): NodeConfig & { configDir: string } {
  const file = path.resolve(argPath ?? process.env.MYBOTS_NODE_CONFIG ?? "mybots-node.json");
  const configDir = path.dirname(file);
  loadDotEnv(configDir);
  let raw: any = {};
  if (fs.existsSync(file)) raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  else console.warn(`[node] aviso: ${file} não existe; usando padrões + variáveis de ambiente`);

  const cfg: NodeConfig = {
    ...DEFAULTS,
    ...raw,
    bot: { ...DEFAULTS.bot, ...(raw.bot ?? {}) },
    provider: { ...DEFAULTS.provider, ...(raw.provider ?? {}) },
    opencode: { ...DEFAULTS.opencode, ...(raw.opencode ?? {}) },
    approval: { ...DEFAULTS.approval, ...(raw.approval ?? {}) },
  };
  // variáveis de ambiente sobrepõem o arquivo
  cfg.hub = process.env.MYBOTS_HUB ?? cfg.hub;
  cfg.token = process.env.MYBOTS_NODE_TOKEN ?? cfg.token;
  cfg.engine = (process.env.MYBOTS_ENGINE as any) ?? cfg.engine;
  cfg.provider.kind = process.env.MYBOTS_PROVIDER ?? cfg.provider.kind;
  cfg.provider.model = process.env.MYBOTS_MODEL ?? cfg.provider.model;
  cfg.provider.apiKey = process.env.MYBOTS_API_KEY ?? cfg.provider.apiKey ?? keyFromEnv(cfg.provider.kind);
  cfg.provider.baseURL = process.env.MYBOTS_BASE_URL ?? cfg.provider.baseURL ?? OPENAI_COMPAT_PRESETS[cfg.provider.kind]?.baseURL
    ?? (cfg.provider.kind === "gemini" ? "https://generativelanguage.googleapis.com/v1beta" : cfg.provider.kind === "anthropic" || cfg.provider.kind === "claude" ? "https://api.anthropic.com" : undefined);
  cfg.opencode.password = process.env.OPENCODE_SERVER_PASSWORD ?? cfg.opencode.password;
  const envMode = process.env.MYBOTS_CONTROL_MODE;
  if (isControlMode(envMode)) cfg.approval.mode = envMode;
  if (!isControlMode(cfg.approval.mode)) cfg.approval.mode = "supervisionado";
  cfg.workspace = path.resolve(configDir, cfg.workspace);
  cfg.personaFile = path.resolve(configDir, cfg.personaFile);
  fs.mkdirSync(cfg.workspace, { recursive: true });
  return { ...cfg, configDir };
}

function keyFromEnv(kind: string): string | undefined {
  if (kind === "gemini") return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (kind === "anthropic") return process.env.ANTHROPIC_API_KEY;
  const preset = OPENAI_COMPAT_PRESETS[kind];
  if (preset) return process.env[preset.keyEnv];
  // provedores com cliente proprio (sem baseURL de preset) tambem precisam achar a chave
  const extras: Record<string, string> = { gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY", claude: "ANTHROPIC_API_KEY" };
  const nome = extras[kind];
  return nome ? process.env[nome] : process.env.OPENAI_API_KEY;
}

export function readPersona(cfg: NodeConfig): string {
  if (fs.existsSync(cfg.personaFile)) return fs.readFileSync(cfg.personaFile, "utf8").replace(/^\uFEFF/, "");
  return `Você é ${cfg.bot.name}, ${cfg.bot.role}. Fale em português, de forma direta e curta.`;
}
