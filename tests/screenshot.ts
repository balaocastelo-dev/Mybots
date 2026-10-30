// Sobe hub + modelo de mentira + 2 nós e fotografa a interface (para conferir o visual).
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { startMockLlm } from "./mock-llm.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const HUB_PORT = 18789, LLM_PORT = 14992, TOKEN = "t";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-shot-"));
const procs: ChildProcess[] = [];
const out = process.argv[2] ?? path.join(ROOT, "docs", "screenshot.png");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function spawnTs(cwd: string, script: string, env: Record<string, string>, args: string[] = []) {
  const p = spawn(process.execPath, ["--import", "tsx", script, ...args], { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "pipe"] });
  p.stderr.on("data", (d) => process.stdout.write(`[err] ${d}`));
  procs.push(p);
}
function makeNode(id: string, name: string, role: string, avatar: string, provider: any) {
  const dir = path.join(tmp, id);
  fs.mkdirSync(path.join(dir, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(dir, "persona.md"), `Você é ${name}.`);
  fs.writeFileSync(path.join(dir, "mybots-node.json"), JSON.stringify({ hub: `ws://127.0.0.1:${HUB_PORT}`, token: TOKEN, bot: { id, name, role, avatar }, engine: "direct", workspace: "./workspace", personaFile: "./persona.md", provider, approval: { shell: "sh" } }));
  const nodeDir = path.join(ROOT, "packages/node");
  spawnTs(nodeDir, path.join(nodeDir, "src/index.ts"), {}, [path.join(dir, "mybots-node.json")]);
}

async function main() {
  await startMockLlm(LLM_PORT);
  const hubDir = path.join(ROOT, "packages/hub");
  spawnTs(hubDir, path.join(hubDir, "src/index.ts"), { MYBOTS_HUB_PORT: String(HUB_PORT), MYBOTS_HUB_TOKEN: TOKEN, MYBOTS_DB: path.join(tmp, "hub.sqlite"), MYBOTS_UI_DIST: path.join(ROOT, "packages/ui/dist") });
  await sleep(2500);
  makeNode("joao-videomaker", "João Videomaker", "Videomaker da empresa", "🎬", { kind: "nous", model: "hermes-4", baseURL: `http://127.0.0.1:${LLM_PORT}/v1`, apiKey: "k" });
  makeNode("robertinho-auditor", "Robertinho Auditor", "Auditor do o ERP", "🧾", { kind: "anthropic", model: "claude-sonnet-5-5", baseURL: `http://127.0.0.1:${LLM_PORT}`, apiKey: "k" });
  makeNode("kenlinho-corretor", "Kenlinho Corretor", "Corretor de imóveis", "🏠", { kind: "gemini", model: "gemini-2.5-flash", baseURL: `http://127.0.0.1:${LLM_PORT}/v1beta`, apiKey: "k" });
  await sleep(3500);
  // conversa de exemplo via API
  const post = (url: string, body: unknown) => fetch(`http://127.0.0.1:${HUB_PORT}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await post("/api/send", { conversationId: "dm:joao-videomaker", text: "Bom dia! Me diz como está o vídeo do corretor." });
  await sleep(1500);
  await post("/api/send", { conversationId: "dm:joao-videomaker", text: "liste a pasta" });
  await sleep(1500);
  await post("/api/send", { conversationId: "dm:joao-videomaker", text: "consulte o bot robertinho-auditor sobre o estoque" });
  await sleep(2500);
  await post("/api/send", { conversationId: "dm:joao-videomaker", text: "rode o comando" });
  await sleep(1500);

  await post("/api/send", { conversationId: "dm:joao-videomaker", text: "mande o arquivo" });
  const g = await (await post("/api/groups", { name: "Equipe de vídeo", members: ["joao-videomaker", "robertinho-auditor", "kenlinho-corretor"] })).json() as any;
  await post("/api/routines", { botId: "joao-videomaker", name: "Reels da semana", cron: "0 9 * * 1", prompt: "Planeje os 3 Reels da semana e mande o roteiro para aprovação." });
  await post("/api/send", { conversationId: `group:${g.id}`, text: "Bom dia, equipe! Como estamos para o lançamento?" });
  await sleep(4000);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(`http://127.0.0.1:${HUB_PORT}/`);
  await page.waitForSelector(".bots li");
  await page.click("text=João Videomaker");
  await sleep(1200);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(`screenshot salvo em ${out}`);
  await page.click("text=Equipe de vídeo");
  await sleep(1200);
  const out2 = out.replace(/\.png$/, "-grupo.png");
  await page.screenshot({ path: out2 });
  console.log(`screenshot salvo em ${out2}`);
  await page.click("text=João Videomaker");
  await sleep(800);
  await page.click("button[title='Rotinas agendadas']");
  await sleep(600);
  const out3 = out.replace(/\.png$/, "-rotinas.png");
  await page.screenshot({ path: out3 });
  console.log(`screenshot salvo em ${out3}`);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { for (const p of procs) p.kill(); setTimeout(() => process.exit(), 500); });
