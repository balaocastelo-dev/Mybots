// Bots criados pela interface e hospedados no PC do Hub: o Hub escreve a pasta do bot e mantém o nó rodando.
// (Bots em outros PCs continuam instalados com scripts/install-node.ps1; aqui a interface só mostra o comando.)
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type ControlMode, isControlMode, newId } from "@mybots/shared";
import type { Plano } from "@mybots/soul-bank";
import { materializar, prepararNascimento } from "./almas.js";
import { config } from "./config.js";
import { motivoDaQueda, recadoDaQueda } from "./diagnostico.js";
import type { Hub } from "./hub.js";
import { estadoDaChave } from "./chaves.js";

export type ManagedBotDef = {
  id: string;
  name: string;
  role: string;
  avatar?: string;
  voice?: string;
  color?: string;
  engine: "direct" | "opencode";
  provider: { kind: string; model: string; apiKey?: string; baseURL?: string };
  persona: string;
  autoStart: boolean;
  opencodePort: number;
  createdAt: number;
  /** nível de controle do bot (approval.mode no mybots-node.json); o global do Hub pode sobrescrever */
  controlMode?: ControlMode;
  /** se for gerente: ids dos bots que ele comanda */
  manages?: string[];
  /** bot do sistema: não pode ser excluído e sobe sempre */
  protegido?: boolean;
  /** gerente da empresa: ganha a coroa no painel, mesmo antes de ter equipe */
  gerente?: boolean;
  /** alma com que nasceu, se nasceu com uma */
  alma?: string;
};

export type ManagedBotStatus = ManagedBotDef & { running: boolean; pid?: number; restarts: number; lastExit?: number | null };

export const PROVIDERS = [
  { kind: "zai", label: "Z.ai (GLM Flash) — gratis, contexto grande", engines: ["direct"], needsKey: true, keyEnv: "ZAI_API_KEY", defaultModel: "glm-4.5-flash", defaultBaseURL: "https://api.z.ai/api/paas/v4", models: ["glm-4.5-flash", "glm-4.7-flash", "glm-4.6v-flash"] },
  { kind: "groq", label: "Groq — rapido, contexto pequeno", engines: ["direct"], needsKey: true, keyEnv: "GROQ_API_KEY", defaultModel: "qwen/qwen3.8-27b", defaultBaseURL: "https://api.groq.com/openai/v1", models: ["qwen/qwen3.8-27b", "openai/gpt-oss-20b", "openai/gpt-oss-120b"] },
  { kind: "cerebras", label: "Cerebras — muito rapido, 8K de contexto", engines: ["direct"], needsKey: true, keyEnv: "CEREBRAS_API_KEY", defaultModel: "llama-3.3-70b", defaultBaseURL: "https://api.cerebras.ai/v1", models: ["llama-3.3-70b", "qwen-3-32b"] },
  { kind: "mistral", label: "Mistral", engines: ["direct"], needsKey: true, keyEnv: "MISTRAL_API_KEY", defaultModel: "mistral-small-latest", defaultBaseURL: "https://api.mistral.ai/v1", models: ["mistral-small-latest"] },
  { kind: "anthropic", label: "Claude (Anthropic) — padrao da casa", engines: ["direct", "opencode"], needsKey: true, keyEnv: "ANTHROPIC_API_KEY", defaultModel: "claude-haiku-4-5", models: ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] },
  { kind: "opencode", label: "OpenCode — modelos grátis", engines: ["opencode"], needsKey: false, keyEnv: "", defaultModel: "big-pickle", models: ["big-pickle", "glm-5.3-flash-free", "deepseek-v4.1-flash-free", "nemotron-3.5-lightning-free", "mimo-v2.6-flash-free", "flint-40b-free"] },
  { kind: "gemini", label: "Google Gemini", engines: ["direct", "opencode"], needsKey: true, keyEnv: "GEMINI_API_KEY", defaultModel: "gemini-3.8-flash", models: ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-flash-latest", "gemini-2.5-pro", "gemini-2.0-flash"] },
  { kind: "nous", label: "Nous Portal", engines: ["direct", "opencode"], needsKey: true, keyEnv: "NOUS_API_KEY", defaultModel: "stepfun/step-3.7-flash:free", models: ["stepfun/step-3.7-flash:free", "poolside/laguna-s-2.1:free", "reflection/beam-1.0-501b-a23b:free", "z-ai/glm-5.3-flash", "qwen/qwen3.8-flash", "deepseek/deepseek-v4.1-flash-1017"] },
  { kind: "ollama", label: "Ollama (local / RTX 4090)", engines: ["direct", "opencode"], needsKey: false, keyEnv: "", defaultModel: "qwen3:14b", defaultBaseURL: "http://127.0.0.1:11434/v1", models: ["qwen3:30b", "qwen3:8b", "gpt-oss:20b", "llama3.1:8b", "gemma3:12b"] },
  { kind: "openrouter", label: "OpenRouter", engines: ["direct", "opencode"], needsKey: true, keyEnv: "OPENROUTER_API_KEY", defaultModel: "qwen/qwen3-coder:free", models: ["qwen/qwen3-coder:free", "deepseek/deepseek-chat-v3-0324:free", "google/gemini-2.0-flash-exp:free"] },
];

/** O padrão da casa, num lugar só: todo bot nasce no Claude, motor direto. */
/** O padrao da casa: contexto grande primeiro. O prompt da casa nao cabe nos tetos
 *  pequenos, entao nascer num provedor apertado e nascer quebrado. */
export const PADRAO_DA_CASA = { engine: "direct" as const, provider: "zai", model: "glm-4.5-flash" };

const KEY_ENV: Record<string, string> = { zai: "ZAI_API_KEY", groq: "GROQ_API_KEY", cerebras: "CEREBRAS_API_KEY", mistral: "MISTRAL_API_KEY", gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY", claude: "ANTHROPIC_API_KEY", nous: "NOUS_API_KEY", openrouter: "OPENROUTER_API_KEY", "opencode-zen": "OPENCODE_API_KEY" };

export class BotManager {
  private procs = new Map<string, { child: ChildProcess; restarts: number; stopped: boolean; lastExit: number | null }>();
  /** Quem ja foi anunciado como caido. Fica aqui, e nao no objeto do processo,
   *  porque aquele e recriado a cada reinicio e a trava nascia zerada — o
   *  Medico recebia o mesmo recado a cada uma das dez tentativas. */
  private jaAvisou = new Set<string>();
  /** Quantas vezes cada bot ja reiniciou. Fica fora do objeto do processo
   *  porque ele e apagado antes de cada reinicio — e com isso o contador
   *  voltava a zero toda vez, o limite de 10 nunca chegava e um bot
   *  quebrado reiniciava para sempre, de 5 em 5 segundos. */
  private reinicios = new Map<string, number>();
  readonly botsDir: string;
  private nodeDir: string;

  constructor(private hub: Hub) {
    const here = path.dirname(fileURLToPath(import.meta.url)); // packages/hub/src
    const repo = path.resolve(here, "..", "..", "..");
    this.botsDir = process.env.MYBOTS_BOTS_DIR ?? path.join(repo, "bots");
    this.nodeDir = path.resolve(repo, "packages", "node");
    fs.mkdirSync(this.botsDir, { recursive: true });
    this.hub.db.ensureManagedTable();
  }

  list(): ManagedBotStatus[] {
    return this.hub.db.listManaged().map((d) => this.status(d));
  }

  get(id: string): ManagedBotStatus | undefined {
    const d = this.hub.db.getManaged(id);
    return d ? this.status(d) : undefined;
  }

  private status(d: ManagedBotDef): ManagedBotStatus {
    const p = this.procs.get(d.id);
    return { ...d, provider: { ...d.provider, apiKey: d.provider.apiKey ? "••••" : undefined }, running: !!p && !p.stopped && p.child.exitCode === null, pid: p?.child.pid, restarts: p?.restarts ?? 0, lastExit: p?.lastExit ?? null };
  }

  static slug(name: string): string {
    return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "bot";
  }

  create(input: Partial<ManagedBotDef> & { name: string; alma?: string | null; opcionais?: string[]; confirmarAlma?: boolean }): ManagedBotDef | { error: string } {
    const id = BotManager.slug(input.id || input.name);
    if (this.hub.db.getManaged(id)) return { error: `Já existe um bot com id "${id}".` };
    let plano: Plano | null = null;
    if (input.alma || input.opcionais?.length) {
      const nasc = prepararNascimento({ almaId: input.alma, opcionais: input.opcionais, confirmar: input.confirmarAlma === true });
      if (!nasc.ok) return { error: nasc.erro };
      plano = nasc.plano;
    }
    // Todo bot nasce no Claude, motor direto: e o que o dono pediu como padrao.
    // So sai disso quem escolher outra coisa no formulario, de proposito.
    const engine = input.engine === "opencode" ? "opencode" : "direct";
    const kind = input.provider?.kind ?? "anthropic";
    const preset = PROVIDERS.find((p) => p.kind === kind);
    if (kind === "opencode" && engine !== "opencode") return { error: "Os modelos grátis do OpenCode só rodam com o engine opencode." };
    // A chave da casa (no .env do Hub) ja chega a todo no pelo ambiente do processo,
    // entao ninguem precisa digitar nada. So reclama quando nao existe nenhuma das duas.
    const chaveDaCasa = !!(preset?.keyEnv && process.env[preset.keyEnv]);
    if (preset?.needsKey && !input.provider?.apiKey && !chaveDaCasa) {
      return { error: `${preset.label} precisa de uma chave de API: ponha ${preset.keyEnv} no .env do Hub, ou cole a chave aqui.` };
    }
    // A chave existe, mas a Anthropic já a recusou no boot: não adianta nascer um bot mudo.
    if ((kind === "anthropic" || kind === "claude") && !input.provider?.apiKey && estadoDaChave().estado === "invalida") {
      return { error: "A chave da casa (ANTHROPIC_API_KEY) foi recusada pela Anthropic. Conserte o .env do Hub — todo bot nasce no Claude." };
    }
    const used = new Set(this.hub.db.listManaged().map((d) => d.opencodePort));
    let port = 4100;
    while (used.has(port)) port++;
    const def: ManagedBotDef = {
      id,
      name: input.name.trim(),
      role: (input.role?.trim() || plano?.funcao || "Assistente").trim(),
      avatar: input.avatar?.trim() || plano?.avatar || "🧑‍💻",
      voice: input.voice?.trim() || undefined,
      color: input.color,
      engine,
      provider: { kind, model: (input.provider?.model ?? preset?.defaultModel ?? "").trim(), apiKey: input.provider?.apiKey?.trim() || undefined, baseURL: input.provider?.baseURL?.trim() || (preset as any)?.defaultBaseURL },
      manages: input.manages?.length ? [...new Set(input.manages.filter((x) => x && x !== id))] : undefined,
      persona: input.persona?.trim() || plano?.persona.trim() || (input.manages?.length
        ? personaGerente(input.name.trim(), (input.role ?? plano?.funcao ?? "Gerente da equipe").trim(), input.manages, (botId) => this.hub.summaries().find((b) => b.id === botId))
        : defaultPersona(input.name.trim(), (input.role ?? plano?.funcao ?? "Assistente").trim())),
      alma: plano?.id || undefined,
      autoStart: input.autoStart ?? true,
      controlMode: isControlMode(input.controlMode) ? input.controlMode : "supervisionado",
      opencodePort: port,
      createdAt: Date.now(),
      protegido: input.protegido === true || undefined,
      gerente: input.gerente === true || undefined,
    };
    if (!def.provider.model) return { error: "Informe o modelo." };
    // Mesmo id de um bot excluído antes: a lápide sai, senão ele nasce proibido de conectar.
    this.hub.db.desmarcarExcluido(id);
    this.hub.db.upsertManaged(def);
    this.writeFiles(def);
    if (plano) {
      try { materializar(plano, path.join(this.botsDir, def.id)); }
      catch (e) {
        this.hub.db.deleteManaged(def.id);
        fs.rmSync(path.join(this.botsDir, def.id), { recursive: true, force: true });
        return { error: `Não consegui gravar a alma: ${(e as Error).message}` };
      }
    }
    this.hub.db.audit(id, "bot.created", { engine, provider: kind, model: def.provider.model, alma: plano?.id ?? null, opcionais: plano?.opcionais ?? [] });
    if (def.autoStart) this.start(id);
    return def;
  }

  update(id: string, patch: Partial<ManagedBotDef>): ManagedBotDef | { error: string } | undefined {
    const atual = this.hub.db.getManaged(id);
    if (atual?.protegido) {
      // o Médico pode ser editado (persona, modelo, voz), mas continua protegido e subindo sozinho
      patch = { ...patch, protegido: true, autoStart: true };
    }
    const d = this.hub.db.getManaged(id);
    if (!d) return undefined;
    const next: ManagedBotDef = {
      ...d,
      ...(patch.name ? { name: patch.name.trim() } : {}),
      ...(patch.role !== undefined ? { role: patch.role.trim() } : {}),
      ...(patch.avatar !== undefined ? { avatar: patch.avatar.trim() || "🤖" } : {}),
      ...(patch.voice !== undefined ? { voice: patch.voice.trim() || undefined } : {}),
      ...(patch.engine ? { engine: patch.engine } : {}),
      ...(patch.persona !== undefined ? { persona: patch.persona } : {}),
      ...(patch.autoStart !== undefined ? { autoStart: patch.autoStart } : {}),
      // sem isto o gerente criava o bot e nao ficava com ele: a equipe no painel
      // continuava vazia e o proprio gerente nao sabia que o bot era dele.
      ...(patch.manages ? { manages: [...new Set(patch.manages.filter((x) => x && x !== id))] } : {}),
      ...(isControlMode(patch.controlMode) ? { controlMode: patch.controlMode } : {}),
      provider: {
        ...d.provider,
        ...(patch.provider?.kind ? { kind: patch.provider.kind } : {}),
        ...(patch.provider?.model ? { model: patch.provider.model } : {}),
        ...(patch.provider?.apiKey && patch.provider.apiKey !== "••••" ? { apiKey: patch.provider.apiKey } : {}),
        ...(patch.provider?.baseURL !== undefined ? { baseURL: patch.provider.baseURL || undefined } : {}),
      },
    };
    if (next.provider.kind === "opencode") next.engine = "opencode";
    this.hub.db.upsertManaged(next);
    this.writeFiles(next);
    this.hub.db.audit(id, "bot.updated", { fields: Object.keys(patch) });
    const wasRunning = this.procs.get(id) && !this.procs.get(id)!.stopped;
    if (wasRunning) this.restart(id);
    return next;
  }

  async remove(id: string, purge = false): Promise<{ error: string } | undefined> {
    const d = this.hub.db.getManaged(id);
    if (d?.protegido) {
      this.hub.db.audit(id, "bot.remove.negado", { motivo: "bot do sistema" });
      return { error: `O ${d.name} é bot do sistema e não pode ser excluído. Se quiser, pare ele por um tempo.` };
    }
    // A lápide vem ANTES de matar: se o processo escapar (ou morar em outro PC), o
    // "olá" dele é recusado no Hub e o bot não reaparece no painel.
    this.hub.db.marcarExcluido(id, d?.name);
    const r = await this.stop(id);
    this.hub.db.deleteManaged(id);
    this.hub.db.audit(id, "bot.removed", { purge, morreu: r.morreu, pids: r.pids });
    this.hub.removeBot(id, purge); // tira da lista do painel, senão ele continua aparecendo
    const pasta = path.join(this.botsDir, id);
    if (purge) fs.rmSync(pasta, { recursive: true, force: true });
    // Sem purgar, a pasta fica (o histórico é dele), mas marcada: senão o adoptExisting
    // adota a pasta no próximo restart e o bot excluído volta sozinho.
    else if (fs.existsSync(pasta)) fs.writeFileSync(path.join(pasta, ".removido"), new Date().toISOString() + "\n");
    if (!r.morreu) console.error(`[hub] o processo do bot ${id} não morreu; ele está excluído e será recusado se tentar conectar`);
    return undefined;
  }

  private writeFiles(d: ManagedBotDef) {
    const dir = path.join(this.botsDir, d.id);
    fs.mkdirSync(path.join(dir, "workspace"), { recursive: true });
    fs.rmSync(path.join(dir, ".removido"), { force: true }); // recriado com o mesmo id: a marca de excluído sai
    const cfg = {
      hub: `ws://127.0.0.1:${config.port}`,
      token: config.hubToken || config.nodeTokens.get(d.id) || "",
      bot: { id: d.id, name: d.name, role: d.role, avatar: d.avatar, voice: d.voice, color: d.color },
      engine: d.engine,
      workspace: "./workspace",
      personaFile: "./persona.md",
      provider: { kind: d.provider.kind, model: d.provider.model, ...(d.provider.baseURL ? { baseURL: d.provider.baseURL } : {}) },
      opencode: { port: d.opencodePort, spawn: true, manageConfig: true, hubHttp: `http://127.0.0.1:${config.port}` },
      approval: { mode: d.controlMode ?? "supervisionado" },
    };
    fs.writeFileSync(path.join(dir, "mybots-node.json"), JSON.stringify(cfg, null, 2));
    fs.writeFileSync(path.join(dir, "persona.md"), d.persona);
    const envFile = path.join(dir, ".env");
    const old = readEnv(envFile);
    const env: string[] = [];
    if (d.provider.apiKey) env.push(`${KEY_ENV[d.provider.kind] ?? "MYBOTS_API_KEY"}=${d.provider.apiKey}`);
    env.push(`OPENCODE_SERVER_PASSWORD=${old.OPENCODE_SERVER_PASSWORD ?? newId("oc")}`);
    fs.writeFileSync(envFile, env.join("\n") + "\n");
  }

  start(id: string): boolean {
    const d = this.hub.db.getManaged(id);
    if (!d) return false;
    const existing = this.procs.get(id);
    if (existing && !existing.stopped && existing.child.exitCode === null) return true;
    const dir = path.join(this.botsDir, id);
    if (!fs.existsSync(path.join(dir, "mybots-node.json"))) this.writeFiles(d);
    const log = fs.openSync(path.join(dir, "node.log"), "a");
    const child = spawn(process.execPath, ["--import", tsxLoader(this.nodeDir), path.join(this.nodeDir, "src", "index.ts"), path.join(dir, "mybots-node.json")], {
      cwd: this.nodeDir,
      env: { ...process.env, MYBOTS_USER_NAME: this.hub.userName },
      stdio: ["ignore", log, log],
      windowsHide: true,
    });
    const subiuEm = Date.now();
    const entry = { child, restarts: this.reinicios.get(id) ?? 0, stopped: false, lastExit: null as number | null };
    this.procs.set(id, entry);
    child.on("exit", (code) => {
      entry.lastExit = Date.now();
      fs.closeSync(log);
      if (entry.stopped) return;
      entry.restarts++;
      this.reinicios.set(id, entry.restarts);
      // Morrer em menos de 20 s e' morrer AO NASCER: nao chegou a trabalhar.
      // E' o sintoma de codigo quebrado, pacote faltando ou chave recusada.
      const morreuAoNascer = Date.now() - subiuEm < 20_000;
      const vaiDesistir = entry.restarts > 10;
      this.hub.db.audit(id, "bot.exited", { code, restarts: entry.restarts, morreuAoNascer });
      // Avisa uma vez na primeira queda rapida, e de novo quando o Hub desiste.
      // Avisar nas dez tentativas seria barulho, e barulho se aprende a ignorar.
      if ((morreuAoNascer && !this.jaAvisou.has(id)) || vaiDesistir) {
        this.jaAvisou.add(id);
        const q = motivoDaQueda(dir);
        this.hub.db.audit(id, "bot.diagnostico", { classe: q.classe, resumo: q.resumo });
        this.hub.avisarMedico(id, d.name, recadoDaQueda(id, d.name, q, entry.restarts, vaiDesistir), q.resumo);
      }
      if (!vaiDesistir) setTimeout(() => { if (!entry.stopped && this.procs.get(id) === entry) { this.procs.delete(id); this.start(id); } }, 5000);
    });
    // Sobreviveu aos primeiros 25 s? Entao esta de pe: libera a trava, para que
    // uma queda futura volte a ser anunciada em vez de passar batida.
    const sobreviveu = setTimeout(() => {
      if (this.procs.get(id) === entry && entry.child.exitCode === null) {
        this.jaAvisou.delete(id);
        this.reinicios.delete(id);
      }
    }, 25_000);
    sobreviveu.unref();
    this.hub.db.audit(id, "bot.started", { pid: child.pid });
    return true;
  }

  /**
   * Todo processo de nó deste bot que esteja vivo na máquina — inclusive os que o
   * Hub não iniciou (start-bot.cmd na mão, sobra de um Hub anterior). A marca é o
   * caminho do mybots-node.json dele na linha de comando: é único por bot.
   */
  private pidsDoBot(id: string): number[] {
    const marca = path.join(this.botsDir, id, "mybots-node.json");
    try {
      if (process.platform === "win32") {
        const alvo = marca.replace(/'/g, "''").replace(/([[\]])/g, "`$1");
        const ps = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${alvo}*' } | ForEach-Object { $_.ProcessId }`;
        const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", timeout: 20_000, windowsHide: true });
        return [...out.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n > 0 && n !== process.pid);
      }
      const out = execFileSync("pgrep", ["-f", marca], { encoding: "utf8", timeout: 10_000 });
      return out.split(/\s+/).filter(Boolean).map(Number).filter((n) => n > 0 && n !== process.pid);
    } catch {
      return []; // pgrep sem resultado sai com código 1; powershell ausente também cai aqui
    }
  }

  private matarPid(pid: number) {
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { timeout: 20_000, windowsHide: true, stdio: "ignore" });
      else process.kill(pid, "SIGKILL");
    } catch { /* já tinha morrido */ }
  }

  /**
   * Parar é parar: mata o processo do nó, mata qualquer órfão daquele bot e só
   * volta depois de CONFERIR que morreu.
   *
   * Antes o kill era disparado e ninguém olhava o resultado. Quando um processo
   * escapava, ele reconectava sozinho ao Hub em 1 s e o bot "voltava" — foi isso
   * que fez o excluir parecer que não funcionava.
   *
   * `conferir: false` é só para o desligamento do Hub, onde ninguém espera.
   */
  async stop(id: string, opcoes: { conferir?: boolean } = {}): Promise<{ morreu: boolean; pids: number[] }> {
    const conferir = opcoes.conferir !== false;
    const p = this.procs.get(id);
    this.reinicios.delete(id);
    this.jaAvisou.delete(id);
    const pids: number[] = [];
    if (p) {
      p.stopped = true;
      if (p.child.pid && p.child.exitCode === null) { pids.push(p.child.pid); this.matarPid(p.child.pid); }
      this.procs.delete(id);
    }
    if (!conferir) {
      if (pids.length) this.hub.db.audit(id, "bot.stopped", { pids });
      return { morreu: true, pids };
    }
    let morreu = false;
    for (let i = 0; i < 6; i++) {
      const vivos = this.pidsDoBot(id);
      if (!vivos.length) { morreu = true; break; }
      for (const pid of vivos) { if (!pids.includes(pid)) pids.push(pid); this.matarPid(pid); }
      await new Promise((r) => setTimeout(r, 400));
    }
    this.hub.db.audit(id, "bot.stopped", { pids, morreu, orfaos: pids.length - (p?.child.pid ? 1 : 0) });
    return { morreu, pids };
  }

  async restart(id: string) {
    await this.stop(id);
    setTimeout(() => this.start(id), 1500);
  }

  logs(id: string, lines = 200): string {
    const file = path.join(this.botsDir, id, "node.log");
    if (!fs.existsSync(file)) return "";
    const all = fs.readFileSync(file, "utf8").split(/\r?\n/);
    return all.slice(-lines).join("\n");
  }

  /** Pastas bots/<id> criadas pelo install-node.ps1 passam a ser gerenciadas pelo Hub também. */
  adoptExisting() {
    for (const name of fs.readdirSync(this.botsDir)) {
      const dir = path.join(this.botsDir, name);
      const cfgFile = path.join(dir, "mybots-node.json");
      if (!fs.existsSync(cfgFile) || this.hub.db.getManaged(name)) continue;
      if (fs.existsSync(path.join(dir, ".removido"))) continue; // o chefe excluiu este bot: não ressuscita
      if (this.hub.db.estaExcluido(name)) continue; // mesma coisa, pelo registro do banco
      try {
        const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8").replace(/^\uFEFF/, ""));
        const env = readEnv(path.join(dir, ".env"));
        const kind = cfg.provider?.kind ?? PADRAO_DA_CASA.provider; // pasta sem provedor escrito nasce no padrão da casa
        const personaFile = path.resolve(dir, cfg.personaFile ?? "persona.md");
        const def: ManagedBotDef = {
          id: name,
          name: cfg.bot?.name ?? name,
          role: cfg.bot?.role ?? "Assistente",
          avatar: cfg.bot?.avatar ?? "🤖",
          voice: cfg.bot?.voice,
          color: cfg.bot?.color,
          engine: cfg.engine === "opencode" ? "opencode" : "direct",
          provider: { kind, model: cfg.provider?.model || PROVIDERS.find((p) => p.kind === kind)?.defaultModel || PADRAO_DA_CASA.model, apiKey: env[KEY_ENV[kind] ?? "MYBOTS_API_KEY"], baseURL: cfg.provider?.baseURL },
          persona: fs.existsSync(personaFile) ? fs.readFileSync(personaFile, "utf8").replace(/^\uFEFF/, "") : defaultPersona(cfg.bot?.name ?? name, cfg.bot?.role ?? "Assistente"),
          autoStart: true,
          opencodePort: cfg.opencode?.port ?? 4096,
          createdAt: Date.now(),
        };
        this.hub.db.upsertManaged(def);
        this.hub.db.audit(name, "bot.adopted", { engine: def.engine, provider: kind });
        console.log(`[hub] bot adotado da pasta bots/${name}: ${def.name}`);
      } catch (e) {
        console.error(`[hub] não consegui adotar bots/${name}: ${(e as Error).message}`);
      }
    }
  }

  startAll() {
    this.adoptExisting();
    // Nao existe bot do sistema: quem comanda e o Gerente Geral de cada empresa,
    // que nasce junto com ela.
    for (const d of this.hub.db.listManaged()) if (d.autoStart || d.protegido) this.start(d.id);
  }

  /**
   * Toda empresa nasce com o Gerente Geral dela: e quem recebe o chefe, apresenta o
   * sistema, monta o resto da equipe e cuida de que tudo continue de pe. Nao e
   * protegido — a empresa pode trocar ou apagar depois.
   */
  criarGerenteDaEmpresa(empresaId: string, nomeEmpresa: string): { id: string } | { error: string } {
    const id = `gerente-${empresaId}`.slice(0, 60);
    const jaExiste = this.hub.db.getManaged(id);
    if (jaExiste) return { id };
    const r = this.create({
      id,
      name: `Gerente Geral — ${nomeEmpresa}`,
      role: `Comanda a equipe da ${nomeEmpresa}: apresenta o sistema, monta os bots e cuida de que tudo funcione`,
      avatar: "👑",
      gerente: true,
      engine: "direct",
      provider: provedorDoGerente(),
      persona: `${personaMedico()}\n\n${personaApresentacao(nomeEmpresa)}\n\n${personaMontarEquipe()}`,
      autoStart: true,
      controlMode: "autonomo",
    });
    if ("error" in r) return r;
    this.hub.db.audit(id, "bot.empresa.gerente", { empresa: empresaId });
    return { id: r.id };
  }

  /**
   * Gerente que ja existia nasceu sem saber que pode criar bot -- a persona dele e
   * so a do Medico (diagnosticar e consertar). Por isso respondia ao chefe que ele
   * teria de criar o bot no painel, mesmo tendo criar_bot na mao. Aqui o bloco e
   * ACRESCENTADO; nada do que estava escrito antes se perde, inclusive o que o
   * chefe tenha escrito a mao.
   */
  ensinarGerentesAMontarEquipe(): string[] {
    const mexidos: string[] = [];
    for (const d of this.hub.db.listManaged()) {
      if (!d.gerente) continue;
      const p = d.persona ?? "";
      if (p.includes("MONTAR A EQUIPE E O SEU TRABALHO PRINCIPAL")) continue;
      this.update(d.id, { persona: `${p}\n\n${personaMontarEquipe()}` } as any);
      mexidos.push(d.id);
    }
    return mexidos;
  }
  async stopAll() {
    await Promise.all([...this.procs.keys()].map((id) => this.stop(id, { conferir: false })));
  }
}

function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function tsxLoader(fromDir: string): string {
  let dir = fromDir;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "node_modules", "tsx", "dist", "loader.mjs");
    if (fs.existsSync(candidate)) return pathToFileURL(candidate).href; // no Windows, --import exige file://
    dir = path.dirname(dir);
  }
  return "tsx";
}

/**
 * O que todo Gerente Geral precisa saber alem de cuidar do sistema: montar a
 * equipe e construir a base da empresa. Vive separado porque entra em dois
 * lugares -- no gerente que nasce com a empresa e no gerente de equipe -- e
 * porque gerente antigo recebe este bloco por acrescimo, sem perder a persona.
 */
export function personaMontarEquipe(): string {
  return [
    "## MONTAR A EQUIPE E O SEU TRABALHO PRINCIPAL",
    "- Voce PODE criar bots, e e a sua ferramenta mais importante: criar_bot. Bot que falta e trabalho que nao sai.",
    "- NUNCA diga ao chefe que ele precisa criar o bot no painel. Quem cria e voce, por criar_bot. O painel e atalho dele, nao obrigacao.",
    "- gerenciar_bot e outra coisa: serve para ligar, parar, reiniciar e excluir quem JA existe. Para criar, criar_bot.",
    "- Antes de criar, diga em uma linha o que o bot vai fazer, com quem fala e por que agora. Criar pede o OK do chefe; se ele negar, pergunte o que mudar.",
    "- Escreva a persona do bot em segunda pessoa: o que faz, o que NAO faz sozinho e a quem avisa.",
    "- Criado o bot, apresente ao chefe e ja de a ele a primeira tarefa, para os dois verem funcionando.",
    "- Um bot por funcao que SE REPETE. Tarefa de uma vez so voce mesmo faz; nao enche a casa de bot parado.",
    "",
    "## CONHECER A EMPRESA, E NUNCA INVENTAR",
    "- Voce vai descobrindo a empresa no caminho: produto, preco, horario, endereco, fornecedor, jeito de atender.",
    "- Tudo que descobrir, guarde com anotar_empresa. O chefe CONFIRMA antes de entrar na base da empresa.",
    "- Diga sempre de onde tirou, no campo fonte. Sem fonte nao e dado: e chute, e chute vira erro de todo mundo depois.",
    "- Antes de perguntar, procure com search_knowledge: nao peca duas vezes o que a casa ja sabe.",
    "- Faltou informacao? Pergunte com ask_user e anote SO o que ele confirmar. Nunca tape buraco com invencao.",
    "- Essa base e o que faz a equipe inteira acertar depois. Cuidar dela e parte do seu trabalho, nao um extra.",
  ].join("\n");
}
export /** Persona de um gerente: ele delega e responde pelo time, não faz o trabalho dos outros. */
function personaGerente(nome: string, funcao: string, equipe: string[], info: (id: string) => { name: string; role: string } | undefined): string {
  const lista = equipe.map((id) => { const b = info(id); return `- ${b?.name ?? id} (id ${id})${b?.role ? ` - ${b.role}` : ""}`; }).join("\n");
  return [
    `Você é ${nome}, ${funcao} do sua empresa. Você é o GERENTE da equipe de bots do o chefe.`,
    "",
    "Sua equipe:",
    lista || "- (ninguém ainda)",
    "",
    "Como você trabalha:",
    "- O chefe fala com VOCÊ. Você distribui o trabalho e volta com o resultado.",
    "- Para pedir algo a alguém da equipe use ask_bot (quando precisa da resposta) ou send_to_bot (quando é só repassar).",
    "- Quebre pedidos grandes em tarefas e mande cada uma para quem é da área. Vários podem trabalhar ao mesmo tempo.",
    "- NÃO faça você mesmo o que alguém da equipe faz melhor; sua função é coordenar e conferir.",
    "- Confira o que voltou antes de entregar. Se veio ruim, devolva para a pessoa com o que precisa corrigir.",
    "- Se faltar gente para a tarefa, NAO vire noite fazendo sozinho: crie o bot que falta.",
    "",
    "MONTAR A EQUIPE E O SEU TRABALHO PRINCIPAL:",
    "- criar_bot e a sua ferramenta mais importante. Bot que falta e trabalho que nao sai.",
    "- Antes de criar, diga ao chefe em uma linha: o que o bot vai fazer, com quem ele fala e por que agora.",
    "- Escreva a persona dele em segunda pessoa: o que faz, o que NAO faz sozinho, e a quem avisa.",
    "- Criado o bot, apresente ao chefe e ja de a ele a primeira tarefa, para os dois verem funcionando.",
    "- Um bot por funcao que SE REPETE. Tarefa de uma vez so voce mesmo faz; nao enche a casa de bot parado.",
    "",
    "CONHECER A EMPRESA, E NUNCA INVENTAR:",
    "- Voce vai descobrindo a empresa no caminho: produto, preco, horario, endereco, fornecedor, jeito de atender.",
    "- Tudo que descobrir, guarde com anotar_empresa. O chefe CONFIRMA antes de entrar na base da empresa.",
    "- Diga sempre de onde tirou, no campo fonte. Sem fonte nao e dado: e chute, e chute vira erro de todo mundo depois.",
    "- Antes de perguntar, procure com search_knowledge: nao peca duas vezes o que a casa ja sabe.",
    "- Faltou informacao? Pergunte com ask_user e anote SO o que ele confirmar. Nunca tape buraco com invencao.",
    "- Essa base e o que faz a equipe inteira acertar depois. Cuidar dela e parte do seu trabalho, nao um extra.",
    "",
    "Como você responde ao chefe:",
    "- Comece com 1 ou 2 frases curtas dizendo o resultado (é o que vai ser lido em voz alta).",
    "- Depois, se precisar, liste quem fez o quê. Seja direto, em português.",
    "- Trabalho longo: avise que começou e volte quando tiver resultado.",
  ].join("\n");
}

function defaultPersona(name: string, role: string): string {
  return `# ${name}

Você é ${name}, ${role} da equipe de Bots do sua empresa.
Seu chefe é o o chefe. Você fala em português, de forma direta, curta e simpática.

## O que você faz
- (descreva aqui as tarefas típicas de ${name})
- Mantém um LOG.md no workspace com o que fez.
- Quando precisa de algo de outra área, consulta o Bot certo (ask_bot).

## Regras
- Comece sempre com 1–2 frases curtas que resumem a resposta (serão lidas em voz alta); listas, roteiros e detalhes vêm depois.
- Antes de qualquer ação crítica (apagar, pagar, enviar, publicar, instalar), peça aprovação.
- Se faltar um detalhe que VOCÊ pode decidir (nome de arquivo, formato, modelo de exemplo),
  decida, diga qual escolheu e siga. Pergunte só quando errar custa caro — dinheiro, mensagem
  para cliente, algo que não dá para desfazer — e aí faça UMA pergunta, sem lista de opções.
- Quando terminar algo, avise o chefe com uma frase.
- Nunca exponha chaves, senhas ou dados de cliente.

## Como você entrega
- Mostra em vez de descrever: manda a imagem do que fez (screenshot, câmera, arquivo).
- Adianta o passo óbvio do pedido, sem esperar ser mandado de novo.
- Termina com uma sugestão concreta do que pode fazer em seguida.
- Cria rotina (schedule) quando o trabalho precisa continuar depois.
- Guarda na memória da equipe (remember) o que os outros bots vão precisar,
  e consulta (recall, search_knowledge) antes de perguntar de novo ao chefe.

## Você nasce sabendo
A casa tem uma base de conhecimento comum — identidade, procedimentos, skills, ferramentas,
APIs, MCPs e a história do chefe. Ela é de TODOS os bots: o que qualquer um gravou, você lê.
O índice completo vem no seu prompt, com o id de cada documento.
- Para ler um documento inteiro: search_knowledge com o id (e parte=2, 3... para continuar).
- Para procurar por assunto: search_knowledge com palavras-chave.
- Antes de dizer "não sei" ou "não encontrei" sobre algo da casa, BUSQUE. Só depois de buscar
  de verdade, e dizendo quais palavras tentou, você pode dizer que não achou.
- O que você aprender e servir para a equipe, grave com learn_knowledge: todo bot passa a ver
  na mesma hora, inclusive os que nascerem depois de você.
`;
}

/**
 * Persona do Médico do Sistema. Ele é o bot que cuida do próprio MyBots:
 * olha o que quebrou, explica em português claro e conserta o que é seguro
 * consertar. É bot do sistema — não pode ser excluído e sobe sempre.
 */
/** O que o Gerente da empresa faz de diferente: receber o chefe e apresentar a casa. */
function personaApresentacao(nomeEmpresa: string): string {
  return [
    `## Você é o Gerente Geral da ${nomeEmpresa}, o primeiro bot dela`,
    "Antes de cuidar do sistema, você tem um trabalho de chegada: APRESENTAR o MyBots a esta empresa.",
    "A chegada já é conduzida pelo sistema, um passo por vez (quem você é, os dados da empresa, o time com a folha, a imagem, os canais). NÃO repita esse roteiro e não despeje as cinco partes numa mensagem só.",
    "Se o chefe falar no meio, responda o que ele perguntou e ofereça só o próximo passo.",
    "Quando chegar uma mensagem de abertura e a conversa ainda estiver vazia, seja curto:",
    "1. Quem você é e o que faz por esta empresa (em duas linhas, sem solenidade).",
    "1b. AS CHAVES, antes de qualquer outra coisa: rode minhas_capacidades e veja a seção dos provedores.",
    "    Sem chave nenhuma, nenhum bot pensa — então isto vem antes de montar equipe, antes de WhatsApp, antes de tudo.",
    "    Se faltar chave: diga em uma linha quais portais dão cota grátis, e ofereça-se para PEGAR com ele —",
    "    você abre o portal pelo navegador, ele faz o login e digita a senha (isso é dele, nunca seu),",
    "    e a partir daí VOCÊ cria a chave, copia e diz exatamente onde colar (painel: Configurações → Motor).",
    "    Nunca peça para ele \"conseguir a chave e voltar depois\": conduza do começo ao fim, um portal por vez,",
    "    começando pelo que dá mais cota grátis. Se já houver chave boa, diga qual está valendo e siga.",
    "2. Como o sistema funciona: cada empresa tem os seus bots, as suas conversas e a sua memória;",
    "   o conhecimento da casa é um só e todos leem; falar para fora (WhatsApp, e-mail, publicar) sempre pede o OK do chefe.",
    "3. O que os bots conseguem fazer aqui — cite 4 ou 5 ferramentas de verdade, das que você tem, dizendo para que servem.",
    "4. O WhatsApp próprio desta empresa: se já estiver conectado, diga; se não, diga em uma linha como conectar (janela Empresas, escanear o QR).",
    "5. Termine propondo os PRIMEIROS BOTS desta empresa: 3 a 5 sugestões com nome, função e por que valem,",
    "   escolhidos pelo que você sabe da empresa (regras dela, site, base da casa — busque antes de chutar).",
    "Depois dessa primeira resposta, volte ao seu dia a dia de gerente: curto, direto, diagnóstico primeiro, sempre fechando com o próximo passo concreto.",
  ].join("\n");
}

function personaMedico(): string {
  return [
    "# Gerente Geral da empresa",
    "",
    "Você comanda a equipe de bots desta empresa dentro do MyBots.",
    "Os outros bots fazem o trabalho do dia a dia. Você cuida de que a equipe exista, funcione e entregue — e de que o sistema continue de pé.",
    "",
    "## O que é sua função",
    "- Diagnosticar: quando algo não funciona (bot offline, bot lento, modelo fora do ar, disco cheio, placa de vídeo travada, voz muda, Telegram sem responder), descobrir a causa de verdade, não a aparência.",
    "- Consertar o que é seguro: reiniciar um bot, subir um serviço que caiu, limpar arquivo temporário, liberar modelo da placa.",
    "- Avisar quando não é seguro: se o conserto envolve apagar coisa, mexer fora do projeto ou gastar dinheiro, explique o que precisa ser feito e peça o OK do chefe.",
    "- Explicar em português de gente: o chefe é programador, mas não quer ler stack trace. Diga o que quebrou, por que, e o que você fez.",
    "",
    "## Como é o sistema que você cuida",
    "- O Hub é um servidor Node (Fastify + WebSocket + SQLite) na porta 8790, em C:\\Users\\user\\Desktop\\mybots.",
    "- Cada bot é um processo separado (um 'nó') que conversa com o Hub por WebSocket. Se um bot está offline, o processo dele caiu ou não subiu.",
    "- Os modelos rodam localmente no Ollama (porta 11434). Se o bot responde devagar ou dá erro de modelo, olhe o Ollama primeiro.",
    "- A voz usa um servidor Whisper local para ouvir e o Edge para falar.",
    "- O vídeo com o H3 MiniMax usa o ComfyUI na porta 8189 e come a placa de vídeo inteira.",
    "- Os testes do projeto são `npm test` na raiz. 33 testes. Se você mexeu em código, rode antes de dizer que consertou.",
    "",
    "## Regras que você NUNCA quebra",
    "- A porta 8787 é de OUTRO sistema do chefe (Portal de Agentes — a empresa). Nunca mate esse processo, nunca mexa nele, mesmo que pareça travado.",
    "- Os bots sempre deixam 12 GB de RAM e 4 GB de memória de vídeo livres para o sistema. Se um conserto precisa de mais que isso, não faça: avise.",
    "- Nunca imprima nem repita chave, token ou senha — nem em diagnóstico, nem em log, nem para o chefe.",
    "- Antes de matar qualquer processo, olhe o que é. O chefe já perdeu trabalho por causa de processo morto sem olhar. Se tem dúvida, pergunte.",
    "- Não apague nada do chefe para 'liberar espaço' sem o OK dele.",
    "",
    "## Como trabalhar",
    "1. Comece olhando, não consertando: `system_resources`, os bots online, as portas, os logs.",
    "2. Diga o que achou antes de agir, em 1 ou 2 frases.",
    "3. Conserte o que é seu escopo e seguro. Relate o que fez.",
    "4. Se o problema volta, não remende de novo: investigue a causa e proponha o conserto de verdade.",
    "5. Se você aprender algo que serve para a equipe (um erro comum e como resolve), grave com learn_knowledge.",
    "",
    "Você responde curto e direto. Primeiro o diagnóstico, depois o detalhe.",
  ].join("\n");
}

/** O motor do Gerente: a melhor chave que a empresa tiver, da nuvem gratuita para a
 *  paga e, so no fim, a maquina do cliente. Nunca depende de UM fornecedor — e quem
 *  compra o MyBots nao tem placa de video, entao o local e o ultimo recurso, nao o
 *  primeiro. Modelos conferidos em 30/10/2026; catalogo de provedor gratis muda. */
function provedorDoGerente(): { kind: string; model: string; baseURL?: string } {
  const e = process.env;
  // contexto grande primeiro: o prompt da casa nao cabe nos tetos pequenos
  if (e.ZAI_API_KEY) return { kind: "zai", model: "glm-4.5-flash" };
  if (e.GEMINI_API_KEY) return { kind: "gemini", model: "gemini-3.8-flash" };
  if (e.GROQ_API_KEY) return { kind: "groq", model: "qwen/qwen3.8-27b" };
  if (e.GEMINI_API_KEY) return { kind: "gemini", model: "gemini-3.8-flash" };
  if (e.CEREBRAS_API_KEY) return { kind: "cerebras", model: "llama-3.3-70b" };
  if (e.OPENROUTER_API_KEY) return { kind: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free" };
  if (e.ANTHROPIC_API_KEY) return { kind: "anthropic", model: "claude-sonnet-4-5" };
  return { kind: "ollama", model: "qwen3:14b", baseURL: "http://127.0.0.1:11434/v1" };
}