// Teste do engine "opencode": um Bot rodando no OpenCode de verdade (opencode serve), com o modelo de mentira
// como provedor OpenAI-compatível e as ferramentas da equipe via MCP do Hub. Precisa do `opencode` no PATH.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { startMockLlm } from "./mock-llm.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const HUB_PORT = 18788, LLM_PORT = 14991, OC_PORT = 14096, TOKEN = "token-de-teste";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-oc-"));
const procs: ChildProcess[] = [];
let failures = 0, passed = 0;
const verbose = !!process.env.E2E_VERBOSE;

if (spawnSync(os.platform() === "win32" ? "where" : "which", ["opencode"]).status !== 0) {
  console.log("opencode não está no PATH — pulando teste do engine opencode (npm i -g opencode-ai)");
  process.exit(0);
}

function spawnTs(name: string, cwd: string, script: string, env: Record<string, string>, args: string[] = []) {
  const p = spawn(process.execPath, ["--import", "tsx", script, ...args], { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", (d) => verbose && process.stdout.write(`[${name}] ${d}`));
  p.stderr.on("data", (d) => process.stdout.write(`[${name}:err] ${d}`));
  procs.push(p);
  return p;
}

function makeNode(id: string, name: string, cfg: Record<string, unknown>) {
  const dir = path.join(tmp, id);
  fs.mkdirSync(path.join(dir, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(dir, "persona.md"), `Você é ${name}, bot de teste.`);
  fs.writeFileSync(path.join(dir, "workspace", "arquivo-de-teste.txt"), "conteúdo");
  fs.writeFileSync(path.join(dir, "mybots-node.json"), JSON.stringify({ hub: `ws://127.0.0.1:${HUB_PORT}`, token: TOKEN, bot: { id, name, role: "Bot de teste" }, workspace: "./workspace", personaFile: "./persona.md", approval: { shell: "sh" }, ...cfg }, null, 2));
  const nodeDir = path.join(ROOT, "packages/node");
  return spawnTs(id, nodeDir, path.join(nodeDir, "src/index.ts"), { MYBOTS_CACHE: "0", MYBOTS_ROTA_RAPIDA: "0" }, [path.join(dir, "mybots-node.json")]);
}

class UiClient {
  ws!: WebSocket; events: any[] = []; waiters: Array<{ pred: (e: any) => boolean; resolve: (e: any) => void }> = [];
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${HUB_PORT}/ws/ui`);
      this.ws.on("open", () => { this.ws.send(JSON.stringify({ type: "subscribe" })); resolve(); });
      this.ws.on("error", reject);
      this.ws.on("message", (raw) => {
        const e = JSON.parse(raw.toString());
        if (verbose) console.log("   <-", JSON.stringify(e).slice(0, 160));
        this.events.push(e);
        for (const w of [...this.waiters]) if (w.pred(e)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(e); }
      });
    });
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  wait(pred: (e: any) => boolean, ms = 60_000, label = "evento"): Promise<any> {
    const found = this.events.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout esperando ${label}`)), ms);
      this.waiters.push({ pred, resolve: (e) => { clearTimeout(t); resolve(e); } });
    });
  }
  clear() { this.events = []; }
}
const botText = (botId: string) => (e: any) => e.type === "message" && e.message.sender.id === botId && e.message.meta?.streaming !== true && e.message.text;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`✔ ${name}`); }
  catch (e) { failures++; console.log(`✖ ${name}\n    ${(e as Error).message}`); }
}
function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitHttp(url: string, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await sleep(300); }
  throw new Error(`não subiu: ${url}`);
}

async function main() {
  console.log(`MyBots · teste do engine opencode · ${tmp}`);
  await startMockLlm(LLM_PORT);
  const hubDir = path.join(ROOT, "packages/hub");
  spawnTs("hub", hubDir, path.join(hubDir, "src/index.ts"), { MYBOTS_HUB_PORT: String(HUB_PORT), MYBOTS_HUB_TOKEN: TOKEN, MYBOTS_DB: path.join(tmp, "hub.sqlite"), MYBOTS_STREAM_DELTAS: "1", MYBOTS_SEM_CHECAR_CHAVE: "1" });
  await waitHttp(`http://127.0.0.1:${HUB_PORT}/api/health`);

  makeNode("robertinho-auditor", "Robertinho Auditor", { engine: "direct", provider: { kind: "anthropic", model: "claude-mock", baseURL: `http://127.0.0.1:${LLM_PORT}`, apiKey: "k" } });
  makeNode("joao-opencode", "João OpenCode", {
    engine: "opencode",
    provider: { kind: "mock", model: "mock-1", baseURL: `http://127.0.0.1:${LLM_PORT}/v1`, apiKey: "k-mock" },
    opencode: { port: OC_PORT, password: "segredo", spawn: true, manageConfig: true },
  });

  const ui = new UiClient();

  await test("bot OpenCode fica online (opencode serve iniciado pelo nó)", async () => {
    const end = Date.now() + 120_000;
    for (;;) {
      const bots = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/bots`)).json() as any[];
      const oc = bots.find((b) => b.id === "joao-opencode");
      if (oc?.online && bots.find((b) => b.id === "robertinho-auditor")?.online) { console.log(`  ${oc.engine} ${oc.provider}/${oc.model}`); break; }
      if (Date.now() > end) throw new Error(`não ficou online: ${JSON.stringify(bots)}`);
      await sleep(500);
    }
    const ocjson = JSON.parse(fs.readFileSync(path.join(tmp, "joao-opencode/workspace/opencode.json"), "utf8"));
    assert(ocjson.mcp?.mybots?.url.endsWith("/mcp"), "opencode.json sem MCP mybots");
    assert(ocjson.agent?.["joao-opencode"], "opencode.json sem agente");
    await ui.connect();
  });

  await test("mensagem → resposta pelo OpenCode (streaming do modelo → interface)", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-opencode", text: "olá" });
    const e = await ui.wait(botText("joao-opencode"), 120_000, "resposta do joao-opencode");
    assert(e.message.text.includes("Você disse: olá"), `texto: ${e.message.text}`);
    assert(ui.events.some((x) => x.type === "message.delta"), "não houve streaming (message.delta)");
  });

  await test("bash do OpenCode pede permissão → Permitir → roda → resposta", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-opencode", text: "rode o comando" });
    const ap = await ui.wait((e) => e.type === "approval.request" && e.approval.botId === "joao-opencode", 90_000, "approval.request");
    assert(ap.approval.tool === "bash", `ferramenta: ${ap.approval.tool}`);
    ui.send({ type: "approval.response", requestId: ap.approval.id, allow: true });
    const done = await ui.wait((e) => e.type === "tool" && e.phase === "done" && e.tool === "bash" && e.conversationId === "dm:joao-opencode", 60_000, "tool.done");
    assert(done.ok && String(done.output).includes("ola-mybots"), `saída: ${done.output}`);
    await ui.wait((e) => botText("joao-opencode")(e) && /comando executado/.test(e.message.text), 60_000, "resposta final");
  });

  await test("bash negado → OpenCode recebe a recusa e o bot explica", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-opencode", text: "rode o comando" });
    const ap = await ui.wait((e) => e.type === "approval.request" && e.approval.botId === "joao-opencode", 90_000, "approval.request");
    ui.send({ type: "approval.response", requestId: ap.approval.id, allow: false });
    await ui.wait((e) => botText("joao-opencode")(e) && /negado/.test(e.message.text), 60_000, "resposta final");
  });

  await test("mybots_ask_user via MCP → botões na interface → resposta volta ao OpenCode", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-opencode", text: "me pergunte" });
    const q = await ui.wait((e) => e.type === "question" && e.question.botId === "joao-opencode", 90_000, "question");
    assert(q.question.options.includes("Sim"), "opções erradas");
    ui.send({ type: "question.answer", questionId: q.question.id, answer: "Sim" });
    await ui.wait((e) => botText("joao-opencode")(e) && e.message.text.includes('"Sim"'), 60_000, "resposta final");
  });

  await test("mybots_ask_bot via MCP: OpenCode consulta o bot direct e usa a resposta", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-opencode", text: "consulte o bot robertinho-auditor sobre o estoque" });
    await ui.wait((e) => e.type === "message" && e.message.conversationId === "pair:joao-opencode:robertinho-auditor" && e.message.sender.id === "robertinho-auditor" && e.message.text, 90_000, "resposta do robertinho");
    const final = await ui.wait((e) => botText("joao-opencode")(e) && /colega respondeu/.test(e.message.text), 60_000, "resposta final");
    assert(final.message.text.includes("42"), `texto: ${final.message.text}`);
  });

  await test("mybots-local_send_file via MCP local (stdio) iniciado pelo OpenCode: arquivo chega ao chat", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-opencode", text: "mande o arquivo" });
    const fm = await ui.wait((e) => e.type === "message" && e.message.sender.id === "joao-opencode" && e.message.meta?.files?.length, 120_000, "mensagem com arquivo");
    assert(fm.message.meta.files[0].name === "arquivo-de-teste.txt", `nome: ${fm.message.meta.files[0].name}`);
    const body = await (await fetch(`http://127.0.0.1:${HUB_PORT}${fm.message.meta.files[0].url}`)).text();
    assert(body === "conteúdo", `conteúdo: ${body}`);
    await ui.wait((e) => botText("joao-opencode")(e) && /arquivo enviado/.test(e.message.text), 60_000, "resposta final");
  });

  await test("grupo com bot OpenCode: fala do colega entra como noReply (sem resposta dupla)", async () => {
    const g = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/groups`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Equipe", members: ["joao-opencode", "robertinho-auditor"] }) })).json() as any;
    ui.clear();
    ui.send({ type: "send", conversationId: `group:${g.id}`, text: "olá grupo" });
    await ui.wait((e) => botText("joao-opencode")(e) && e.message.conversationId === `group:${g.id}`, 120_000, "joao no grupo");
    await ui.wait((e) => botText("robertinho-auditor")(e) && e.message.conversationId === `group:${g.id}`, 60_000, "robertinho no grupo");
    await sleep(6000);
    const msgs = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/conversations/group:${g.id}/messages`)).json() as any[];
    const botMsgs = msgs.filter((m) => m.sender.kind === "bot" && m.text);
    assert(botMsgs.length === 2, `esperava 2 respostas, veio ${botMsgs.length}`);
  });

  console.log(`\n${passed} passaram, ${failures} falharam`);
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  for (const p of procs) p.kill();
  setTimeout(() => { if (os.platform() !== "win32") spawnSync("pkill", ["-f", `[o]pencode.* --port ${OC_PORT}`]); process.exit(); }, 1500);
});
