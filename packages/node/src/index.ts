import { loadConfig } from "./config.js";
import { HubClient } from "./hubClient.js";
import { DirectEngine } from "./engines/direct.js";
import { OpenCodeEngine } from "./engines/opencode.js";
import { createProvider } from "./providers/index.js";

const VERSION = "0.1.0";
const cfg = loadConfig(process.argv[2]);

console.log(`[node] MyBots nó ${VERSION} · bot "${cfg.bot.name}" (${cfg.bot.id}) · engine ${cfg.engine}`);

let engine;
let providerLabel = cfg.provider.kind;
let modelLabel = cfg.provider.model;
if (cfg.engine === "opencode") {
  if (cfg.opencode.model) { const [prov, ...rest] = cfg.opencode.model.split("/"); providerLabel = prov; modelLabel = rest.join("/"); }
  const hub = new HubClient(cfg, { engine: "opencode", provider: providerLabel, model: modelLabel, version: VERSION });
  engine = new OpenCodeEngine(cfg, hub);
  await engine.start();
  hub.start();
} else {
  const provider = createProvider(cfg);
  const hub = new HubClient(cfg, { engine: "direct", provider: provider.kind, model: provider.model, version: VERSION });
  engine = new DirectEngine(cfg, hub, provider);
  await engine.start();
  hub.start();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => { console.log(`[node] encerrando (${sig})`); await engine.stop(); process.exit(0); });
}
