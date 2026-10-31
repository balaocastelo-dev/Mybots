import { instalarRedacao } from "./redacao.js";
import { config } from "./config.js";
import { Hub } from "./hub.js";
import { startServer } from "./server.js";
import { startSttIfNeeded } from "./stt.js";
import { TelegramBridge } from "./telegram.js";
import { checarChaveDaCasa } from "./chaves.js";

instalarRedacao();
const hub = new Hub(config.dbFile);
await startServer(hub);

await startSttIfNeeded(process.env.MYBOTS_STT_URL ?? "");

// Todo bot nasce no Claude: o veredito da chave da casa sai no boot, não num bot mudo.
void checarChaveDaCasa().then((e) => {
  console.log(`[hub] chave da casa (Claude): ${e}`);
  hub.db.audit("hub", "chave.checada", { estado: e });
});

const telegram = new TelegramBridge(hub);
await telegram.start();

const cofre = hub.cofre.status();
console.log(cofre.ativo ? "[hub] cofre ativo" : `[hub] ${cofre.motivo}`);

const authMode = config.nodeTokens.size ? `tokens por bot (${config.nodeTokens.size})` : config.hubToken ? "token único do hub" : "SEM TOKEN (só para testes na LAN)";
console.log(`[hub] MyBots Hub ${config.version} em http://${config.host}:${config.port}  —  auth dos nós: ${authMode}`);
console.log(`[hub] banco: ${config.dbFile}`);
if (!config.uiPassword) console.log(`[hub] interface sem senha (defina MYBOTS_UI_PASSWORD para proteger)`);
