// Mede tempo até o primeiro token visível na interface e o tempo até a resposta
// fechar. Sobe Hub + nós + modelo de mentira. Não usa chave real: o mock está
// no bench-* e a base da rota rápida, se existir, aponta para ele.
//
// Uso: node --import tsx scripts/benchmark-latencia.ts [arquivo.json]
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { startMockLlm } from "../tests/mock-llm.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const HUB_PORT = 18990;
const LLM_PORT = 18991;
const TOKEN = "bench-token";
const saida = process.argv[2] ?? path.join(os.tmpdir(), "mybots-latencia.json");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-bench-"));
const procs: ChildProcess[] = [];
const mock = `http://127.0.0.1:${LLM_PORT}/v1`;

const PEDIDO_LONGO = "Explique em duas frases o que um gerente de equipe faz no dia a dia, sem consultar ferramenta, sem abrir site e sem falar com cliente. " + "Quero so o conceito. ".repeat(8);

function personaLonga(nome: string): string {
  const bloco = `${nome} coordena a equipe, delega, confere e responde ao chefe. Não inventa dado da casa. Não apaga, não envia e não publica sem o OK. A porta 8787 não é deste sistema. `;
  return `# ${nome}\n\n${bloco.repeat(40)}`;
}

function spawnTs(name: string, cwd: string, script: string, env: Record<string, string>, args: string[] = []) {
  const p = spawn(process.execPath, ["--import", "tsx", script, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  p.stderr.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  procs.push(p);
  return p;
}

function makeNode(id: string, name: string, role: string, provider: { kind: string; model: string; baseURL: string; apiKey?: string }, persona: string) {
  const dir = path.join(tmp, id);
  fs.mkdirSync(path.join(dir, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(dir, "persona.md"), persona);
  fs.writeFileSync(path.join(dir, "mybots-node.json"), JSON.stringify({
    hub: `ws://127.0.0.1:${HUB_PORT}`, token: TOKEN,
    bot: { id, name, role, avatar: "⏱️" },
    engine: "direct", workspace: "./workspace", personaFile: "./persona.md",
    provider, approval: { shell: "sh" },
  }, null, 2));
  const nodeDir = path.join(ROOT, "packages/node");
  return spawnTs(id, nodeDir, path.join(nodeDir, "src/index.ts"), {
    // A rota rápida, quando o código existir, fala com o mock — nunca com a internet.
    MYBOTS_ROTA_GROQ_BASE: mock,
    MYBOTS_ROTA_ZAI_BASE: mock,
    GROQ_API_KEY: "bench-groq",
    ZAI_API_KEY: "bench-zai",
    MYBOTS_ROTA_GROQ_MODEL: "bench-groq",
    MYBOTS_ROTA_ZAI_MODEL: "bench-zai",
  }, [path.join(dir, "mybots-node.json")]);
}

type Ev = any;
class Ui {
  ws!: WebSocket;
  events: Ev[] = [];
  waiters: Array<{ pred: (e: Ev) => boolean; resolve: (e: Ev) => void }> = [];
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${HUB_PORT}/ws/ui`);
      this.ws.on("open", () => { this.ws.send(JSON.stringify({ type: "subscribe" })); resolve(); });
      this.ws.on("error", reject);
      this.ws.on("message", (raw) => {
        const e = JSON.parse(raw.toString());
        const stored = { ...e, em: Date.now() };
        this.events.push(stored);
        for (const w of [...this.waiters]) if (w.pred(e)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(stored); }
      });
    });
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  wait(pred: (e: Ev) => boolean, ms: number, label: string): Promise<Ev> {
    const found = this.events.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout esperando ${label}`)), ms);
      this.waiters.push({ pred, resolve: (e) => { clearTimeout(t); resolve(e); } });
    });
  }
  clear() { this.events = []; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url: string, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* ainda subindo */ }
    await sleep(200);
  }
  throw new Error(`não subiu: ${url}`);
}

type Medida = {
  cenario: string;
  provedor: string;
  tipo: string;
  ttftMs: number | null;
  totalMs: number | null;
  systemChars: number | null;
  model: string | null;
  keepAlive: unknown;
  numCtx: number | null;
  chamadas: number;
};

async function medir(ui: Ui, cenario: string, provedor: string, tipo: string, botId: string, texto: string, aquecer: boolean, fimExtra?: (texto: string) => boolean): Promise<Medida> {
  const antes = await (await fetch(`http://127.0.0.1:${LLM_PORT}/bench/last`)).json() as { n: number };
  ui.clear();
  if (aquecer) {
    ui.send({ type: "warm", conversationId: `dm:${botId}`, ativo: true });
    await sleep(400);
  }
  const t0 = Date.now();
  ui.send({ type: "send", conversationId: `dm:${botId}`, text: texto });
  const primeiro = ui.events.find((e) => e.type === "message.delta" && e.conversationId === `dm:${botId}`)
    ?? await ui.wait((e) => e.type === "message.delta" && e.conversationId === `dm:${botId}`, 25_000, "primeiro token").catch(() => null);
  const ttftMs = primeiro ? (primeiro.em ?? Date.now()) - t0 : null;
  const fim = await ui.wait((e) => e.type === "message" && e.message?.sender?.id === botId && e.message?.meta?.streaming === false && e.message?.text && !e.message?.meta?.notify && (!fimExtra || fimExtra(e.message.text)), 40_000, "fim");
  const totalMs = (fim.em ?? Date.now()) - t0;
  const last = await (await fetch(`http://127.0.0.1:${LLM_PORT}/bench/last`)).json() as { n: number; model: string | null; systemChars: number; keepAlive: unknown; numCtx: number | null };
  return {
    cenario, provedor, tipo, ttftMs, totalMs,
    systemChars: last.n > antes.n ? last.systemChars : null,
    model: last.n > antes.n ? last.model : null,
    keepAlive: last.n > antes.n ? last.keepAlive : null,
    numCtx: last.n > antes.n ? last.numCtx : null,
    chamadas: last.n - antes.n,
  };
}

async function main() {
  const llm = await startMockLlm(LLM_PORT);
  const hubDir = path.join(ROOT, "packages/hub");
  spawnTs("hub", hubDir, path.join(hubDir, "src/index.ts"), {
    MYBOTS_HUB_PORT: String(HUB_PORT),
    MYBOTS_HUB_TOKEN: TOKEN,
    MYBOTS_DB: path.join(tmp, "hub.sqlite"),
    MYBOTS_UI_DIST: path.join(ROOT, "packages/ui/dist"),
    MYBOTS_BOTS_DIR: path.join(tmp, "managed"),
    MYBOTS_TTS: "none",
    MYBOTS_STT_URL: "",
  });
  await waitHttp(`http://127.0.0.1:${HUB_PORT}/api/health`);

  makeNode("bench-ollama", "Ollama Local", "Assistente", { kind: "ollama", model: "bench-ollama", baseURL: mock, apiKey: "bench" }, "Você é Ollama Local, bot de teste. Responda curto.");
  makeNode("bench-groq", "Groq Rapido", "Assistente", { kind: "groq", model: "bench-groq", baseURL: mock, apiKey: "bench" }, "Você é Groq Rapido, bot de teste. Responda curto.");
  makeNode("bench-zai", "Zai Rapido", "Assistente", { kind: "zai", model: "bench-zai", baseURL: mock, apiKey: "bench" }, "Você é Zai Rapido, bot de teste. Responda curto.");
  makeNode("bench-anthropic", "Claude Lento", "Assistente", { kind: "nous", model: "bench-anthropic", baseURL: mock, apiKey: "bench" }, "Você é Claude Lento, bot de teste. Responda curto.");
  makeNode("bench-gerente", "Gerente Geral", "Gerente Geral", { kind: "ollama", model: "bench-ollama", baseURL: mock, apiKey: "bench" }, personaLonga("Gerente Geral"));

  const ui = new Ui();
  await ui.connect();
  const limite = Date.now() + 25_000;
  while (Date.now() < limite) {
    const online = new Set<string>();
    for (const e of ui.events) {
      if (e.type === "snapshot") for (const b of e.bots ?? []) if (b.online) online.add(b.id);
      if (e.type === "bot.update" && e.bot?.online) online.add(e.bot.id);
    }
    if (online.size >= 5) break;
    await sleep(300);
  }

  const linhas: Medida[] = [];
  // Pedido que cita estoque não é "simples": continua no Ollama (não vai para o Groq).
  linhas.push(await medir(ui, "Ollama frio (não é simples)", "ollama", "frio", "bench-ollama", "não olhe o estoque agora, só diga oi em uma frase", false));
  linhas.push(await medir(ui, "Ollama com chat aberto", "ollama", "quente", "bench-ollama", "não olhe o estoque agora, só diga boa noite em uma frase", true));
  linhas.push(await medir(ui, "saudação simples no Ollama", "ollama", "simples", "bench-ollama", "bom dia", false));
  linhas.push(await medir(ui, "mesma saudação de novo", "ollama", "cache", "bench-ollama", "bom dia", false));
  linhas.push(await medir(ui, "pedido longo do gerente", "ollama", "gerente", "bench-gerente", PEDIDO_LONGO, true));
  linhas.push(await medir(ui, "saudação no provedor atual", "nous", "simples", "bench-anthropic", "tudo bem", false));
  linhas.push(await medir(ui, "saudação atual repetida", "nous", "cache", "bench-anthropic", "tudo bem", false));
  linhas.push(await medir(ui, "frases no Groq", "groq", "simples", "bench-groq", "fale varias frases", false));
  linhas.push(await medir(ui, "oi no Z.ai", "zai", "simples", "bench-zai", "oi chefe", false));
  linhas.push(await medir(ui, "listar pasta", "ollama", "ferramenta", "bench-ollama", "liste a pasta", true, (t) => /resultado de/.test(t)));

  const relatorio = {
    quando: new Date().toISOString(),
    nota: "Tempos medidos no caminho real Hub → nó → interface, com modelo de mentira bench-* (perfil fixo por provedor). Não chama Groq, Z.ai nem Ollama de verdade. Chaves do benchmark são falsas.",
    linhas,
  };
  fs.writeFileSync(saida, JSON.stringify(relatorio, null, 2));
  console.log("\ncenário                              prov     ttft   total  chamadas  ctx   sys");
  for (const l of linhas) {
    const nome = l.cenario.padEnd(36);
    const tt = l.ttftMs == null ? "  — " : String(l.ttftMs).padStart(5);
    const tot = l.totalMs == null ? "  — " : String(l.totalMs).padStart(6);
    console.log(`${nome} ${l.provedor.padEnd(8)} ${tt} ${tot}  ${String(l.chamadas).padStart(3)}    ${String(l.numCtx ?? "—").padStart(5)}  ${l.systemChars ?? "—"}`);
  }
  console.log(`\ngravado em ${saida}`);

  for (const p of procs) p.kill("SIGTERM");
  llm.close();
  await sleep(300);
}

main().catch((e) => {
  console.error(e);
  for (const p of procs) p.kill("SIGTERM");
  process.exit(1);
});
