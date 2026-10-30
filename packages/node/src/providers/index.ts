import { OPENAI_COMPAT_PRESETS, type NodeConfig } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAICompatProvider } from "./openaiCompat.js";
import type { Provider } from "./types.js";

export function createProvider(cfg: NodeConfig): Provider {
  const p = cfg.provider;
  switch (p.kind) {
    case "gemini":
      if (!p.apiKey) throw new Error("Gemini precisa de GEMINI_API_KEY (ou provider.apiKey)");
      return new GeminiProvider(p.model, p.apiKey, p.baseURL || undefined);
    case "anthropic":
    case "claude":
      if (!p.apiKey) throw new Error("Claude precisa de ANTHROPIC_API_KEY (ou provider.apiKey)");
      return new AnthropicProvider(p.model, p.apiKey, p.baseURL || undefined);
    case "opencode":
      throw new Error('Os modelos grátis do OpenCode só funcionam dentro do OpenCode: use "engine": "opencode" (ou provider "opencode-zen" com chave paga).');
    default: {
      const preset = OPENAI_COMPAT_PRESETS[p.kind];
      const baseURL = p.baseURL ?? preset?.baseURL;
      if (!baseURL) throw new Error(`Provedor "${p.kind}" desconhecido. Use gemini, anthropic, ${Object.keys(OPENAI_COMPAT_PRESETS).join(", ")} ou informe provider.baseURL.`);
      if (!p.apiKey && p.kind !== "ollama" && p.kind !== "lmstudio" && !baseURL.includes("127.0.0.1") && !baseURL.includes("localhost")) {
        throw new Error(`${preset?.label ?? p.kind} precisa de chave: defina ${preset?.keyEnv ?? "MYBOTS_API_KEY"}`);
      }
      const headers: Record<string, string> = {};
      if (p.kind === "openrouter") { headers["HTTP-Referer"] = "https://exemplo.com.br"; headers["X-Title"] = "MyBots"; }
      return new OpenAICompatProvider(p.kind, p.model, baseURL, p.apiKey, headers);
    }
  }
}

export type { Provider } from "./types.js";
