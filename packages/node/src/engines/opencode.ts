// Engine "opencode": o Bot é uma sessão do OpenCode (opencode serve) rodando neste PC.
// O nó traduz mensagens do Hub em prompts, e os eventos SSE do OpenCode em eventos do MyBots.
// Ferramentas da equipe (ask_bot, ask_user...) chegam ao OpenCode pelo MCP remoto do Hub.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type ControlMode, type HubToNode, type Risk, controlPromptLine, effectiveControl, needsHumanApproval, resourcePromptLine } from "@mybots/shared";
import { OPENAI_COMPAT_PRESETS, type NodeConfig, readPersona } from "../config.js";
import type { HubClient } from "../hubClient.js";
import { limitsFromEnv } from "../resources.js";
import { tocaCoracaoDoSistema } from "../tools.js";
import type { Engine } from "./types.js";

export class OpenCodeEngine implements Engine {
  readonly name = "opencode";
  private child: ChildProcess | null = null;
  private base: string;
  private authHeader: Record<string, string> = {};
  private sessions = new Map<string, string>(); // conversationId -> sessionID
  /** Recados de outros bots que esperam o próximo turno. */
  private recados: string[] = [];
  /** conversationId -> histórico que o Hub refez (vai como contexto na primeira mensagem da sessão nova) */
  private contextoRefeito = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();
  private sessionConv = new Map<string, string>();  // sessionID -> conversationId
  private partText = new Map<string, string>();     // partID -> texto já enviado
  private openStreams = new Map<string, Set<string>>(); // sessionID -> messageIDs com texto em andamento
  private toolsStarted = new Set<string>();
  private messageRole = new Map<string, string>();     // messageID -> user | assistant
  private pendingPermissions = new Map<string, string>(); // requestId -> sessionID
  private pendingQuestions = new Map<string, { sessionID: string; count: number; firstOptions: string[][] }>();
  private stopped = false;
  /** Indice da base comum, mandado pelo Hub. O engine direct ja usava; aqui faltava. */
  private knowledge = "";
  /** quedas seguidas do opencode serve (3 = o painel passa a mostrar "motor fora do ar") */
  private quedasSeguidas = 0;
  private agent: string;
  /** nível global do Hub (sobrescreve cfg.approval.mode); null = usa o do nó */
  private controlOverride: ControlMode | null = null;

  /** Nível de controle em vigor agora. */
  mode(): ControlMode { return effectiveControl(this.controlOverride, this.cfg.approval.mode); }

  constructor(private cfg: NodeConfig, private hub: HubClient) {
    this.base = `http://127.0.0.1:${cfg.opencode.port}`;
    if (cfg.opencode.password) this.authHeader = { authorization: "Basic " + Buffer.from(`opencode:${cfg.opencode.password}`).toString("base64") };
    this.agent = cfg.opencode.agent ?? cfg.bot.id;
    hub.on("hello.ok", (m: any) => { if (typeof m?.knowledge === "string") this.knowledge = m.knowledge; });
    hub.on("knowledge", (m: any) => { if (typeof m?.knowledge === "string") { this.knowledge = m.knowledge; try { this.writeOpenCodeConfig(); } catch {} } });
    hub.on("control", (m: Extract<HubToNode, { type: "control" }>) => {
      this.controlOverride = m.override;
      console.log(`[node] nível de controle: ${this.mode()}${m.override ? " (global do Hub)" : ""}`);
    });
    hub.on("message", (m: Extract<HubToNode, { type: "message" }>) => void this.onMessage(m).catch((e) => hub.event(m.conversationId, { kind: "error", message: (e as Error).message })));
    hub.on("approval.response", (m: Extract<HubToNode, { type: "approval.response" }>) => void this.onApproval(m));
    hub.on("question.answer", (m: Extract<HubToNode, { type: "question.answer" }>) => void this.onAnswer(m));
    hub.on("colab.parar", (m: Extract<HubToNode, { type: "colab.parar" }>) => {
      const alvo = m.alvo;
      if (alvo !== "todos" && !alvo.includes(this.cfg.bot.id)) return;
      this.recados = [];
      const ids = [...this.sessions.values()];
      for (const s of ids) void this.api("POST", `/session/${s}/abort`).catch(() => {});
    });
    hub.on("abort", (m: Extract<HubToNode, { type: "abort" }>) => {
      const ids = m.conversationId === "*" ? [...this.sessions.values()] : [this.sessions.get(m.conversationId)].filter(Boolean) as string[];
      for (const s of ids) void this.api("POST", `/session/${s}/abort`).catch(() => {});
    });
    // Rebobinou no painel: a sessão do opencode guarda o estado lá dentro, então a antiga
    // é abandonada e a próxima começa limpa, levando como contexto só o que sobrou.
    hub.on("history.reset", (m: Extract<HubToNode, { type: "history.reset" }>) => {
      const s = this.sessions.get(m.conversationId);
      if (s) void this.api("POST", `/session/${s}/abort`).catch(() => {});
      this.sessions.delete(m.conversationId);
      this.saveSessions();
      this.contextoRefeito.set(m.conversationId, m.messages);
      console.log(`[node] sessão de ${m.conversationId} recomeça com ${m.messages.length} mensagens de contexto`);
    });
  }

  async start() {
    if (this.cfg.opencode.manageConfig) this.writeOpenCodeConfig();
    this.loadSessions();
    if (this.cfg.opencode.spawn) await this.spawnServer();
    await this.waitHealthy();
    void this.listenEvents();
    console.log(`[node] engine opencode · ${this.base} · agente "${this.agent}" · workspace ${this.cfg.workspace}`);
  }

  async stop() {
    this.stopped = true;
    const pid = this.child?.pid;
    if (!pid) return;
    // mata a árvore inteira: o "opencode" do npm é um wrapper que inicia o binário de verdade
    if (os.platform() === "win32") spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
    else { try { process.kill(-pid, "SIGTERM"); } catch { this.child?.kill(); } }
  }

  // ---------- OpenCode: processo e config ----------

  private writeOpenCodeConfig() {
    const file = path.join(this.cfg.workspace, "opencode.json");
    let existing: any = {};
    try { if (fs.existsSync(file)) existing = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch {}
    const p = this.cfg.provider;
    let model = this.cfg.opencode.model;
    const provider: any = existing.provider ?? {};
    if (!model) {
      if (p.kind === "gemini") model = `google/${p.model}`;
      else if (p.kind === "anthropic" || p.kind === "claude") model = `anthropic/${p.model}`;
      else if (p.kind === "opencode") model = `opencode/${p.model}`;
      else {
        const preset = OPENAI_COMPAT_PRESETS[p.kind];
        const baseURL = p.baseURL ?? preset?.baseURL;
        model = `${p.kind}/${p.model}`;
        provider[p.kind] = {
          npm: "@ai-sdk/openai-compatible",
          name: preset?.label ?? p.kind,
          options: { baseURL, ...(p.apiKey ? { apiKey: "{env:MYBOTS_API_KEY}" } : {}) },
          models: { ...(provider[p.kind]?.models ?? {}), [p.model]: { name: p.model, tool_call: true, limit: { context: 128_000, output: 16_000 } } },
        };
      }
    }
    const hubHttp = (this.cfg.opencode.hubHttp ?? this.cfg.hub.replace(/^ws/, "http")).replace(/\/$/, "");
    const persona = [
      readPersona(this.cfg).trim(),
      "",
      "## Contexto do MyBots",
      `- Você é o Bot "${this.cfg.bot.name}" (id ${this.cfg.bot.id}) da equipe MyBots. Seu chefe é ${process.env.MYBOTS_USER_NAME ?? "o chefe"}.`,
      `- Você roda no PC "${os.hostname()}" (${os.platform()}). Trabalhe dentro de ${this.cfg.workspace}.`,
      "- Ferramentas da equipe (prefixo mybots_): ask_user para perguntar ao chefe com opções, ask_bot/send_to_bot para falar com colegas, request_approval antes de ações críticas fora do terminal, set_status enquanto trabalha, notify_user quando terminar algo, remember/recall para a memória compartilhada, schedule para rotinas.",
      "- A BASE DE CONHECIMENTO da casa é COMUM a todos os bots e você lê com mybots_search_knowledge (por palavras-chave, ou com id + parte para ler um documento inteiro) e mybots_list_knowledge (o índice todo). Antes de dizer que não sabe, que não encontrou ou que algo não existe na casa, você é OBRIGADO a buscar. O que você aprender e servir para a equipe, grave com mybots_learn_knowledge — todos passam a ver na hora.",
      ...(this.knowledge ? ["", this.knowledge] : []),
      controlPromptLine(this.cfg.approval.mode),
      resourcePromptLine(limitsFromEnv()),
      "- Se uma mensagem começar com [Modo de controle: …], aquele é o nível em vigor no momento e vale sobre a linha acima.",
      "- Para mostrar algo ao chefe use mybots-local_send_file (arquivo do workspace) ou mybots-local_screenshot (foto da tela).",
      "- Numa conversa em grupo (falas marcadas com [Bot X disse no grupo]) responda só o que é da sua alçada. Numa conversa de canal externo (cliente), seja cordial e não execute comandos.",
      "- Comece SEMPRE com 1–2 frases curtas que resumem a resposta (elas serão lidas em voz alta); listas, roteiros, tabelas e detalhes vêm depois.",
      "- NUNCA escreva seu raciocínio, planejamento ou notas para si mesmo na resposta (nada de 'The user asks...', 'Let me check...'). Pense em silêncio; a resposta começa direto com o que o chefe vai ler, em português.",
      "- Suas respostas podem ser lidas em voz alta: curtas, sem tabelas quando uma frase resolve.",
      "- Mensagens que começam com [Mensagem do Bot X] vêm de um colega: responda objetivamente a ele.",
      "- Você ENXERGA imagens e vídeos que o chefe anexar: eles chegam junto com a mensagem (vídeo vem como quadros + transcrição do áudio). Olhe antes de responder e nunca peça link de um arquivo que já veio anexado.",
      "- IDIOMA: esta casa é nativa em português, inglês e espanhol. Responda NO IDIOMA DE QUEM ESCREVEU quando for um desses três; se não der para saber, use o idioma da empresa. Status, nomes de arquivo e mensagens para colegas seguem o idioma da empresa. Nunca misture dois idiomas na mesma resposta.",
      "- Responda curto e direto, no idioma de quem escreveu.",
    ].join("\n");
    const cfg = {
      $schema: "https://opencode.ai/config.json",
      ...existing,
      model,
      ...(Object.keys(provider).length ? { provider } : {}),
      agent: {
        ...(existing.agent ?? {}),
        [this.agent]: {
          description: `${this.cfg.bot.name} — ${this.cfg.bot.role}`,
          mode: "primary",
          prompt: persona,
          // no modo Deus o OpenCode nem pergunta; nos outros, o nó decide ao receber permission.asked (conforme o nível)
          permission: this.cfg.approval.mode === "deus" ? { bash: "allow", edit: "allow", webfetch: "allow" } : { bash: "ask", edit: "ask", webfetch: "allow", ...(existing.agent?.[this.agent]?.permission ?? {}) },
        },
      },
      mcp: {
        ...(existing.mcp ?? {}),
        mybots: {
          type: "remote",
          url: `${hubHttp}/mcp`,
          headers: { Authorization: `Bearer ${this.cfg.token}`, "X-MyBots-Bot": this.cfg.bot.id },
          enabled: true,
        },
        // ferramentas que precisam do PC do bot (arquivos, tela): servidor MCP local do nó
        "mybots-local": {
          type: "local",
          command: [process.execPath, "--import", tsxLoader(), path.resolve(nodeSrcDir(), "localMcp.ts")],
          cwd: path.resolve(nodeSrcDir(), ".."),
          environment: { MYBOTS_HUB_HTTP: hubHttp, MYBOTS_NODE_TOKEN: this.cfg.token, MYBOTS_BOT_ID: this.cfg.bot.id, MYBOTS_WORKSPACE: this.cfg.workspace },
          enabled: true,
        },
      },
    };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
    console.log(`[node] opencode.json atualizado em ${file} (model ${model})`);
  }

  /** Quem está na porta: ninguém, um opencode nosso (sobrou de um restart) ou outra coisa. */
  private async quemEstaNaPorta(): Promise<"livre" | "nosso" | "estranho"> {
    try {
      const r = await fetch(`${this.base}/global/health`, { headers: this.authHeader, signal: AbortSignal.timeout(2500) });
      return r.ok ? "nosso" : "estranho";
    } catch {
      return "livre";
    }
  }

  private async spawnServer() {
    if (this.stopped) return;
    // Um "opencode serve" de um restart anterior costuma sobreviver segurando a porta.
    // Sem isto vira loop infinito de ServeError: o nó conecta no Hub, o bot aparece
    // ONLINE no painel e nunca responde — foi o que aconteceu com o chefe-dos-email.
    const dono = await this.quemEstaNaPorta();
    if (dono === "nosso") {
      console.log(`[node] opencode serve já estava de pé em ${this.base}; reaproveitando em vez de subir outro`);
      this.quedasSeguidas = 0;
      this.child = null;
      return;
    }
    if (dono === "estranho") {
      const antes = this.cfg.opencode.port;
      this.cfg.opencode.port = antes + 1 + Math.floor(Math.random() * 20);
      this.base = `http://127.0.0.1:${this.cfg.opencode.port}`;
      console.error(`[node] porta ${antes} ocupada por outra coisa; subindo o opencode em ${this.cfg.opencode.port}`);
    }
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (this.cfg.opencode.password) env.OPENCODE_SERVER_PASSWORD = this.cfg.opencode.password;
    const p = this.cfg.provider;
    if (p.apiKey) {
      env.MYBOTS_API_KEY = p.apiKey;
      if (p.kind === "gemini") env.GOOGLE_GENERATIVE_AI_API_KEY ??= p.apiKey;
      if (p.kind === "anthropic" || p.kind === "claude") env.ANTHROPIC_API_KEY ??= p.apiKey;
    }
    const args = ["serve", "--port", String(this.cfg.opencode.port), "--hostname", "127.0.0.1"];
    this.child = spawn(this.cfg.opencode.bin, args, { cwd: this.cfg.workspace, env, shell: os.platform() === "win32", windowsHide: true, detached: os.platform() !== "win32" });
    this.child.stdout?.on("data", (d) => process.stdout.write(`[opencode] ${d}`));
    this.child.stderr?.on("data", (d) => process.stderr.write(`[opencode] ${d}`));
    this.child.on("exit", (code) => {
      if (this.stopped) return;
      this.quedasSeguidas++;
      console.error(`[node] opencode serve saiu com código ${code}; reiniciando em 5s (queda ${this.quedasSeguidas})`);
      // Bot online e mudo é pior que bot offline: da terceira queda seguida em diante o painel conta a verdade.
      if (this.quedasSeguidas >= 3) this.hub.status(`Motor fora do ar (opencode serve caiu ${this.quedasSeguidas}x)`, false);
      setTimeout(() => void this.spawnServer(), 5000);
    });
  }

  private async waitHealthy() {
    this.quedasSeguidas = 0;
    const deadline = Date.now() + 90_000;
    let lastErr = "";
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${this.base}/global/health`, { headers: this.authHeader, signal: AbortSignal.timeout(3000) });
        if (r.ok) return;
        lastErr = `HTTP ${r.status}`;
      } catch (e) { lastErr = (e as Error).message; }
      if (process.env.MYBOTS_DEBUG) console.log(`[node] aguardando opencode: ${lastErr}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`opencode serve não respondeu em ${this.base}`);
  }

  private async api(method: string, p: string, body?: unknown): Promise<any> {
    const r = await fetch(this.base + p, { method, headers: { "content-type": "application/json", ...this.authHeader }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const text = await r.text();
    if (!r.ok) throw new Error(`OpenCode ${method} ${p}: HTTP ${r.status} ${text.slice(0, 300)}`);
    try { return text ? JSON.parse(text) : null; } catch { return text; }
  }

  // ---------- sessões ----------

  private sessionsFile() { return path.join(this.cfg.workspace, ".mybots", "opencode-sessions.json"); }
  private loadSessions() {
    try {
      const m = JSON.parse(fs.readFileSync(this.sessionsFile(), "utf8")) as Record<string, string>;
      for (const [c, s] of Object.entries(m)) { this.sessions.set(c, s); this.sessionConv.set(s, c); }
    } catch {}
  }
  private saveSessions() {
    fs.mkdirSync(path.dirname(this.sessionsFile()), { recursive: true });
    fs.writeFileSync(this.sessionsFile(), JSON.stringify(Object.fromEntries(this.sessions), null, 2));
  }

  private async sessionFor(conversationId: string): Promise<string> {
    const existing = this.sessions.get(conversationId);
    if (existing) {
      try { await this.api("GET", `/session/${existing}`); return existing; } catch { /* sessão sumiu: cria outra */ }
    }
    const s = await this.api("POST", "/session", { title: `MyBots ${conversationId}` });
    this.sessions.set(conversationId, s.id);
    this.sessionConv.set(s.id, conversationId);
    this.saveSessions();
    return s.id;
  }

  private async onMessage(m: Extract<HubToNode, { type: "message" }>) {
    if (m.adiada) {
      this.recados.push(`[Mensagem do Bot ${m.from.name}]\n${m.text}`);
      return;
    }
    const sessionID = await this.sessionFor(m.conversationId);
    let text = m.silent ? `[${m.from.kind === "bot" ? "Bot " : ""}${m.from.name} disse no grupo]\n${m.text}` : m.from.kind === "bot" ? `[Mensagem do Bot ${m.from.name}]\n${m.text}` : m.text;
    if (this.recados.length) {
      text = `${this.recados.join("\n\n")}\n\n${text}`;
      this.recados = [];
    }
    // o prompt do agente é fixo no opencode.json; se o Hub sobrescreveu o nível, avisamos na própria mensagem
    if (!m.silent && this.controlOverride && this.controlOverride !== this.cfg.approval.mode) text = `${controlPromptLine(this.controlOverride).replace(/^- MODO DE CONTROLE: /, "[Modo de controle: ")}]\n${text}`;
    if (m.silent) {
      await this.api("POST", `/session/${sessionID}/prompt_async`, { parts: [{ type: "text", text }], agent: this.agent, noReply: true });
      return;
    }
    // Primeira mensagem depois de um rebobinar: a sessão nova não viu nada, então o que
    // sobrou da conversa vai junto, uma vez só.
    const refeito = this.contextoRefeito.get(m.conversationId);
    if (refeito) {
      this.contextoRefeito.delete(m.conversationId);
      if (refeito.length) {
        const resumo = refeito.slice(-30).map((x) => `${x.role === "user" ? "Chefe" : "Você"}: ${x.content}`).join("\n\n");
        text = `[A conversa foi rebobinada no painel. O que vale dela até aqui:]\n${resumo}\n\n[Agora o chefe diz:]\n${text}`;
      }
    }
    this.hub.status("Pensando", true);
    await this.api("POST", `/session/${sessionID}/prompt_async`, { parts: [{ type: "text", text }], agent: this.agent });
  }

  private async onApproval(m: Extract<HubToNode, { type: "approval.response" }>) {
    if (!this.pendingPermissions.has(m.requestId)) return;
    this.pendingPermissions.delete(m.requestId);
    const reply = m.allow ? (m.remember ? "always" : "once") : "reject";
    await this.api("POST", `/permission/${m.requestId}/reply`, { reply, ...(m.allow ? {} : { message: "O chefe negou. Não tente contornar; explique e ofereça alternativas." }) }).catch((e) => console.error(`[node] permissão: ${e.message}`));
  }

  private async onAnswer(m: Extract<HubToNode, { type: "question.answer" }>) {
    const q = this.pendingQuestions.get(m.questionId);
    if (!q) return;
    this.pendingQuestions.delete(m.questionId);
    const answers: string[][] = [];
    for (let i = 0; i < q.count; i++) answers.push(i === 0 ? [m.answer] : q.firstOptions[i] ?? []);
    await this.api("POST", `/question/${m.questionId}/reply`, { answers }).catch((e) => console.error(`[node] pergunta: ${e.message}`));
  }

  // ---------- eventos SSE ----------

  private async listenEvents() {
    while (!this.stopped) {
      try {
        const res = await fetch(`${this.base}/event`, { headers: { accept: "text/event-stream", ...this.authHeader } });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
            const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
            if (!data) continue;
            try { this.onEvent(JSON.parse(data)); } catch (e) { console.error(`[node] evento inválido: ${(e as Error).message}`); }
          }
        }
      } catch (e) {
        if (!this.stopped) console.error(`[node] stream de eventos caiu (${(e as Error).message}); reconectando`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  private onEvent(ev: { type: string; properties: any }) {
    const p = ev.properties ?? {};
    const conv = (sessionID: string) => this.sessionConv.get(sessionID);
    switch (ev.type) {
      case "message.updated": {
        if (p.info?.id && p.info?.role) this.messageRole.set(p.info.id, p.info.role);
        return;
      }
      case "message.part.updated": {
        const part = p.part;
        const conversationId = conv(part.sessionID);
        if (!conversationId) return;
        if (part.type === "text" && !part.synthetic && !part.ignored) {
          if (this.messageRole.get(part.messageID) !== "assistant") return; // texto do usuário ecoado pelo servidor
          const prev = this.partText.get(part.id) ?? "";
          const full: string = part.text ?? "";
          if (full.length > prev.length && full.startsWith(prev)) {
            this.hub.event(conversationId, { kind: "text.delta", messageId: part.messageID, text: full.slice(prev.length) });
          } else if (full !== prev) {
            this.hub.event(conversationId, { kind: "text.delta", messageId: part.messageID, text: full });
          }
          this.partText.set(part.id, full);
          const set = this.openStreams.get(part.sessionID) ?? new Set();
          set.add(part.messageID);
          this.openStreams.set(part.sessionID, set);
        } else if (part.type === "tool") {
          const st = part.state ?? {};
          const key = `${part.sessionID}:${part.callID}`;
          if (st.status === "running" && !this.toolsStarted.has(key)) {
            this.toolsStarted.add(key);
            this.hub.event(conversationId, { kind: "tool.start", messageId: part.messageID, callId: part.callID, tool: part.tool, input: st.input });
            this.hub.status(st.title || statusForTool(part.tool), true);
          } else if (st.status === "completed" || st.status === "error") {
            if (!this.toolsStarted.has(key)) this.hub.event(conversationId, { kind: "tool.start", messageId: part.messageID, callId: part.callID, tool: part.tool, input: st.input });
            this.toolsStarted.delete(key);
            this.hub.event(conversationId, { kind: "tool.done", messageId: part.messageID, callId: part.callID, tool: part.tool, output: String(st.output ?? st.error ?? "").slice(0, 4000), ok: st.status === "completed" });
            this.hub.status("Pensando", true);
          }
        }
        return;
      }
      case "message.part.delta": {
        // Alguns provedores mandam deltas antes do part.updated; tratamos como texto incremental.
        const conversationId = conv(p.sessionID);
        if (!conversationId || p.field !== "text") return;
        if (this.messageRole.get(p.messageID) !== "assistant") return;
        const prev = this.partText.get(p.partID) ?? "";
        this.partText.set(p.partID, prev + p.delta);
        this.hub.event(conversationId, { kind: "text.delta", messageId: p.messageID, text: p.delta });
        const set = this.openStreams.get(p.sessionID) ?? new Set();
        set.add(p.messageID);
        this.openStreams.set(p.sessionID, set);
        return;
      }
      case "session.idle":
      case "session.status": {
        if (ev.type === "session.status" && p.status?.type !== "idle") {
          if (p.status?.type === "retry") this.hub.status(`Tentando de novo (${p.status.attempt})`, true);
          return;
        }
        const conversationId = conv(p.sessionID);
        if (!conversationId) return;
        for (const messageID of this.openStreams.get(p.sessionID) ?? []) {
          this.hub.event(conversationId, { kind: "text.done", messageId: messageID, text: "" });
        }
        this.openStreams.delete(p.sessionID);
        this.hub.status("Disponível", false);
        return;
      }
      case "permission.asked": {
        const conversationId = conv(p.sessionID);
        if (!conversationId) return;
        this.pendingPermissions.set(p.id, p.sessionID);
        const patterns: string[] = p.patterns ?? [];
        const joined = patterns.join(" ");
        const risk: Risk = p.permission === "bash" && /\b(rm|del|rmdir|format|Remove-Item|reg|shutdown|taskkill|Stop-Process|kill|pkill|Stop-Service|git push --force|git reset --hard)\b/i.test(joined) ? "high" : "medium";
        const description = `${p.permission}: ${patterns.join(", ") || JSON.stringify(p.metadata ?? {}).slice(0, 300)}`;
        // a porta 8787 é intocável em qualquer modo
        if (p.permission === "bash" && /\b8787\b/.test(joined) && /\b(taskkill|Stop-Process|kill|pkill|Stop-Service|net stop)\b/i.test(joined)) {
          this.pendingPermissions.delete(p.id);
          void this.api("POST", `/permission/${p.id}/reply`, { reply: "reject", message: "Bloqueado: o processo da porta 8787 (Portal de Agentes) é intocável." }).catch(() => {});
          return;
        }
        // O coração do sistema é intocável aqui também. Sem esta linha, bastava um bot
        // no motor OpenCode para passar por cima da trava que o motor direto aplica:
        // trava com porta dos fundos não é trava.
        const coracao = tocaCoracaoDoSistema(joined);
        if (coracao) {
          this.pendingPermissions.delete(p.id);
          this.hub.send({ type: "audit", action: "comando.bloqueado.coracao", detail: { command: joined.slice(0, 300), motivo: coracao, engine: "opencode", conversationId } });
          void this.api("POST", `/permission/${p.id}/reply`, { reply: "reject", message: `Bloqueado: ${coracao}. Isso é intocável em qualquer modo — não tente por outro caminho. Pasta de bot, workspace e log você gerencia à vontade.` }).catch(() => {});
          return;
        }
        const mode = this.mode();
        const kind = p.permission === "edit" ? "command" : p.permission === "bash" ? "command" : "action"; // edit dentro do workspace = médio
        if (!needsHumanApproval(mode, kind, risk)) {
          this.pendingPermissions.delete(p.id);
          this.hub.send({ type: "audit", action: "approval.auto", detail: { mode, tool: p.permission, input: { patterns }, risk, description, conversationId } });
          void this.api("POST", `/permission/${p.id}/reply`, { reply: mode === "deus" ? "always" : "once" }).catch((e) => console.error(`[node] permissão: ${e.message}`));
          return;
        }
        this.hub.status("Aguardando aprovação do chefe", true);
        this.hub.event(conversationId, { kind: "approval.request", requestId: p.id, tool: p.permission, input: { patterns, metadata: p.metadata }, risk, description });
        return;
      }
      case "question.asked": {
        const conversationId = conv(p.sessionID);
        if (!conversationId) return;
        const qs: any[] = p.questions ?? [];
        const first = qs[0];
        if (!first) return;
        this.pendingQuestions.set(p.id, { sessionID: p.sessionID, count: qs.length, firstOptions: qs.map((q) => (q.options?.[0]?.label ? [q.options[0].label] : [])) });
        if (this.mode() === "deus") {
          // MODO DEUS EXTREMO: o chefe não é consultado; o bot decide sozinho
          this.hub.send({ type: "audit", action: "question.auto", detail: { mode: "deus", question: first.question, conversationId } });
          const auto = first.options?.[0]?.label ?? "[MODO DEUS EXTREMO] O chefe não será consultado. Decida você mesmo e siga em frente.";
          void this.onAnswer({ type: "question.answer", questionId: p.id, answer: auto });
          return;
        }
        this.hub.status("Aguardando sua resposta", true);
        this.hub.event(conversationId, { kind: "question", questionId: p.id, question: first.question, options: (first.options ?? []).map((o: any) => o.label) });
        return;
      }
      case "session.error": {
        const conversationId = conv(p.sessionID);
        if (!conversationId) return;
        const err = p.error ?? {};
        this.hub.event(conversationId, { kind: "error", message: `${err.name ?? "erro"}: ${err.data?.message ?? JSON.stringify(err).slice(0, 300)}` });
        this.hub.status("Disponível", false);
        return;
      }
    }
  }
}

/** Pasta packages/node/src (funciona rodando via tsx ou compilado). */
function nodeSrcDir(): string {
  return path.dirname(fileURLToPath(import.meta.url)).replace(/[\\/]engines$/, "");
}

/** Caminho absoluto do loader do tsx (o OpenCode inicia o MCP local fora do nosso node_modules). */
function tsxLoader(): string {
  let dir = nodeSrcDir();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "node_modules", "tsx", "dist", "loader.mjs");
    if (fs.existsSync(candidate)) return pathToFileURL(candidate).href; // no Windows, --import exige file://
    dir = path.dirname(dir);
  }
  return "tsx";
}

function statusForTool(tool: string): string {
  if (/bash|shell/i.test(tool)) return "Executando comando";
  if (/read/i.test(tool)) return "Lendo o arquivo";
  if (/write|edit|patch/i.test(tool)) return "Escrevendo código";
  if (/webfetch|websearch/i.test(tool)) return "Navegando pelas páginas";
  if (/ask_bot/i.test(tool)) return "Consultando outro Bot";
  if (/ask_user/i.test(tool)) return "Aguardando sua resposta";
  return "Trabalhando nisso";
}
