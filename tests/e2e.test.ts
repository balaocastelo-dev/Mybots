// Teste de ponta a ponta da Fase 1 + Fase 2 (engine direct):
// Hub + 3 nós (OpenAI-compatível, Anthropic, Gemini — todos contra o modelo de mentira) + cliente da interface.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import WebSocket from "ws";
import { startMockLlm, requests } from "./mock-llm.ts";
import { splitThoughts } from "../packages/hub/src/thoughts.ts";
import { toSpeech, cleanForSpeech, shortenSpecs, SPEECH_DETAILS_HINT, claimInstance, checkResources, isHeavyCommand, RESERVE_RAM_GB, RESERVE_VRAM_GB, limitesDaMaquina } from "../packages/shared/src/index.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const HUB_PORT = 18787, LLM_PORT = 14990, HOOK_PORT = 14995, STT_PORT = 14996, HUB2_PORT = 18789, TOKEN = "token-de-teste";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-e2e-"));
const procs: ChildProcess[] = [];
const log = (s: string) => console.log(`  ${s}`);
let failures = 0, passed = 0;

function spawnTs(name: string, cwd: string, script: string, env: Record<string, string>, args: string[] = []) {
  const p = spawn(process.execPath, ["--import", "tsx", script, ...args], { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${name}] ${d}`));
  p.stderr.on("data", (d) => process.stdout.write(`[${name}:err] ${d}`));
  procs.push(p);
  return p;
}

function makeNode(id: string, name: string, provider: { kind: string; model: string; baseURL?: string; apiKey?: string }) {
  const dir = path.join(tmp, id);
  fs.mkdirSync(path.join(dir, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(dir, "persona.md"), `Você é ${name}, bot de teste.`);
  fs.writeFileSync(path.join(dir, "workspace", "arquivo-de-teste.txt"), "conteúdo");
  fs.writeFileSync(path.join(dir, "mybots-node.json"), JSON.stringify({
    hub: `ws://127.0.0.1:${HUB_PORT}`, token: TOKEN,
    bot: { id, name, role: "Bot de teste", avatar: "🧪" },
    engine: "direct", workspace: "./workspace", personaFile: "./persona.md",
    provider, approval: { shell: "sh" },
  }, null, 2));
  const nodeDir = path.join(ROOT, "packages/node");
  return spawnTs(id, nodeDir, path.join(nodeDir, "src/index.ts"), { MYBOTS_CACHE: "0", MYBOTS_ROTA_RAPIDA: "0" }, [path.join(dir, "mybots-node.json")]);
}

type Ev = any;
class UiClient {
  ws!: WebSocket; events: Ev[] = []; waiters: Array<{ pred: (e: Ev) => boolean; resolve: (e: Ev) => void }> = [];
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${HUB_PORT}/ws/ui`);
      this.ws.on("open", () => { this.ws.send(JSON.stringify({ type: "subscribe" })); resolve(); });
      this.ws.on("error", reject);
      this.ws.on("message", (raw) => {
        const e = JSON.parse(raw.toString());
        this.events.push(e);
        for (const w of [...this.waiters]) if (w.pred(e)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(e); }
      });
    });
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  wait(pred: (e: Ev) => boolean, ms = 20_000, label = "evento"): Promise<Ev> {
    const found = this.events.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout esperando ${label}`)), ms);
      this.waiters.push({ pred, resolve: (e) => { clearTimeout(t); resolve(e); } });
    });
  }
  clear() { this.events = []; }
}

const botText = (botId: string) => (e: Ev) => e.type === "message" && e.message.sender.id === botId && e.message.meta?.streaming !== true && e.message.text && !e.message.meta?.notify;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`✔ ${name}`); }
  catch (e) { failures++; console.log(`✖ ${name}\n    ${(e as Error).message}`); }
}
function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url: string, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await sleep(300); }
  throw new Error(`hub não subiu em ${url}`);
}

async function main() {
  console.log(`MyBots e2e · pasta temporária ${tmp}`);
  const llm = await startMockLlm(LLM_PORT);
  const hubDir = path.join(ROOT, "packages/hub");
  // servidor STT de mentira (compatível com /v1/audio/transcriptions)
  const stt = http.createServer((req, res) => { req.on("data", () => {}); req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ text: "transcrição de mentira" })); }); });
  await new Promise<void>((r) => stt.listen(STT_PORT, "127.0.0.1", () => r()));
  spawnTs("hub", hubDir, path.join(hubDir, "src/index.ts"), { MYBOTS_HUB_PORT: String(HUB_PORT), MYBOTS_HUB_TOKEN: TOKEN, MYBOTS_DB: path.join(tmp, "hub.sqlite"), MYBOTS_UI_DIST: path.join(ROOT, "packages/ui/dist"), MYBOTS_CHANNEL_WEBHOOK_URL: `http://127.0.0.1:${HOOK_PORT}/out`, MYBOTS_STT_URL: `http://127.0.0.1:${STT_PORT}/v1`, MYBOTS_TTS: "edge", MYBOTS_BOTS_DIR: path.join(tmp, "managed"), MYBOTS_CACHE: "0", MYBOTS_ROTA_RAPIDA: "0" });
  await waitHttp(`http://127.0.0.1:${HUB_PORT}/api/health`);
  log("hub no ar");

  makeNode("joao-videomaker", "João Videomaker", { kind: "nous", model: "mock-1", baseURL: `http://127.0.0.1:${LLM_PORT}/v1`, apiKey: "k-nous" });
  makeNode("robertinho-auditor", "Robertinho Auditor", { kind: "anthropic", model: "claude-mock", baseURL: `http://127.0.0.1:${LLM_PORT}`, apiKey: "k-anthropic" });
  makeNode("kenlinho-corretor", "Kenlinho Corretor", { kind: "gemini", model: "gemini-mock", baseURL: `http://127.0.0.1:${LLM_PORT}/v1beta`, apiKey: "k-gemini" });

  const ui = new UiClient();

  await test("reserva de máquina: percentual do PC, com piso, teto e sempre 3/4 para os bots", async () => {
    // A regra deixou de ser 12/4 fixos: é 15% da máquina, piso 2 GB/1 GB, teto 12 GB/4 GB,
    // e nunca mais de 25% do total. Num PC de 40 GB com 24 GB de vídeo isso dá 6 e 3,6.
    assert(RESERVE_RAM_GB === 2, "o piso de RAM deveria ser 2 GB, veio " + RESERVE_RAM_GB);
    assert(RESERVE_VRAM_GB === 1, "o piso de VRAM deveria ser 1 GB, veio " + RESERVE_VRAM_GB);
    const lim = limitesDaMaquina(40, 24);
    assert(lim.ram === 6, "40 GB a 15% deveria reservar 6 GB, veio " + lim.ram);
    assert(lim.vram === 3.6, "24 GB de vídeo a 15% deveria reservar 3,6 GB, veio " + lim.vram);

    // o piso protege a máquina pequena, e o teto impede a reserva de engolir a grande
    assert(limitesDaMaquina(8).ram === 2, "num PC de 8 GB a reserva não pode ser menos que o piso");
    assert(limitesDaMaquina(128).ram === 12, "num servidor de 128 GB a reserva para no teto de 12 GB");
    for (const total of [4, 8, 16, 32, 64, 128, 256]) {
      const r = limitesDaMaquina(total).ram;
      assert(r <= total * 0.25 + 0.001, `com ${total} GB a reserva (${r}) passou de um quarto da máquina`);
    }
    // sem saber o tamanho da máquina, cai no piso em vez de inventar
    assert(limitesDaMaquina().ram === 2 && limitesDaMaquina().vram === 1, "sem total conhecido, usar o piso");

    // PC folgado: 20 GB livres de 40 (reserva 6) -> sobra 14, pode
    const folgado = checkResources({ ramFreeGb: 20, ramTotalGb: 40, vramFreeGb: 16, vramTotalGb: 24 });
    assert(folgado.ok, "com 20 GB livres deveria caber");
    assert(folgado.ramHeadroomGb === 14, "sobra de RAM deveria ser 14 GB, veio " + folgado.ramHeadroomGb);
    assert(folgado.vramHeadroomGb === 12.4, "sobra de VRAM deveria ser 12,4 GB, veio " + folgado.vramHeadroomGb);

    // PC apertado: 5 GB livres de 40 -> bloqueia e explica citando a reserva calculada
    const apertado = checkResources({ ramFreeGb: 5, ramTotalGb: 40, vramFreeGb: 16, vramTotalGb: 24 });
    assert(!apertado.ok, "com 5 GB livres não pode iniciar trabalho pesado");
    assert(/RAM/.test(apertado.reason) && /6 GB/.test(apertado.reason), "motivo deveria citar a reserva de RAM: " + apertado.reason);

    // vídeo no limite: 3 GB livres invadem os 3,6 reservados
    const semVram = checkResources({ ramFreeGb: 20, ramTotalGb: 40, vramFreeGb: 3, vramTotalGb: 24 });
    assert(!semVram.ok, "3 GB de VRAM livres invadem a reserva de 3,6 GB");
    assert(/VRAM/.test(semVram.reason), "motivo deveria citar a VRAM: " + semVram.reason);

    // o tamanho do trabalho conta: 20 livres - 15 pedidos = 5, abaixo dos 6 reservados
    assert(!checkResources({ ramFreeGb: 20, ramTotalGb: 40 }, 15).ok, "trabalho de 15 GB com 20 GB livres invade a reserva");
  });

  await test("toSpeech: fala só o lead em roteiros estruturados e a mensagem inteira quando é curta", async () => {
    const roteiro = [
      "## Roteiro Reels — Placa de vídeo 🔥", "",
      '**Gancho (0–3s)**: "Seu PC trava no jogo?" 😱',
      "- Cena 1 → close na RTX 4090", "- Cena 2 → benchmark rodando", '- CTA (25–30s): "Vem pra empresa!"', "",
      "| Cena | Tempo |", "|------|-------|", "| 1 | 3s |", "",
      "#balao #campinas #gamer https://exemplo.com.br",
    ].join("\n");
    const sp = toSpeech(roteiro);
    assert(sp.truncated, "roteiro deveria ser resumido");
    assert(sp.lead.endsWith(SPEECH_DETAILS_HINT), `lead sem aviso: ${sp.lead}`);
    assert(sp.lead.length <= 280 + SPEECH_DETAILS_HINT.length + 1, "lead longo demais");
    assert(!/[#*|→🔥😱]/.test(sp.full) && !/https?:/.test(sp.full) && !/\(0–3s\)/.test(sp.full), `sobrou símbolo no texto limpo: ${sp.full}`);
    assert(/Cena 1, close na RTX 4090/.test(sp.full), "seta → não virou pausa");
    const curta = toSpeech("Pronto, chefe! Criei o arquivo **LOG.md** no workspace. 🚀");
    assert(!curta.truncated && curta.lead === "Pronto, chefe! Criei o arquivo LOG.md no workspace.", `mensagem curta errada: ${curta.lead}`);
    assert(toSpeech("").lead === "", "vazio deveria dar vazio");
    const longa = toSpeech("Primeira frase. Segunda frase. " + "palavra ".repeat(80));
    assert(longa.truncated && longa.lead.startsWith("Primeira frase. Segunda frase. Os detalhes"), `texto longo sem estrutura: ${longa.lead}`);
    // limpeza pura (a mesma que o hub usa no /api/tts): markdown some, conteúdo fica
    assert(cleanForSpeech("## Oi\n- **teste** 🔥 `x`") === "Oi. teste x.", `limpeza: ${cleanForSpeech("## Oi\n- **teste** 🔥 `x`")}`);
  });

  await test("voz: ficha técnica longa vira resumo, prosa normal fica inteira", async () => {
    const pc = cleanForSpeech("Montei um computador com processador Intel i9-14900K 3.2GHz 24 núcleos, 64GB DDR5 6000MHz e RTX 4090 24GB.");
    assert(/processador Intel i9 e mais especificações/.test(pc), `ficha técnica não foi resumida: ${pc}`);
    assert(!/14900K|6000MHz|DDR5/.test(pc), `sobrou número técnico para a voz ler: ${pc}`);

    // parênteses que são só ficha técnica somem
    assert(cleanForSpeech("Windows 11 (RTX 4090 + 32GB RAM) está pronto.") === "Windows 11 está pronto.", "parênteses técnico deveria sumir");

    // caminho de modelo encurta
    assert(/modelo solar mini4/.test(cleanForSpeech("Rodando o modelo upstage/solar-mini4:free hoje.")), "caminho de modelo não encurtou");

    // prosa normal com números NÃO pode ser mexida (dinheiro é a exceção: tem teste próprio em fala.test.ts)
    for (const frase of ["Cena 1, close na placa. Cena 2, benchmark rodando.", "Chego às 14 horas com 2 caixas."]) {
      assert(cleanForSpeech(frase) === frase, `prosa normal foi mexida: ${cleanForSpeech(frase)}`);
    }
    // preço é lido como gente lê, e o resto da frase fica de pé
    assert(cleanForSpeech("O preço é 3500 reais e entrego amanhã.") === "O preço é três mil e quinhentos reais e entrego amanhã.",
      `preço não virou extenso: ${cleanForSpeech("O preço é 3500 reais e entrego amanhã.")}`);
    // ponto no meio de palavra não quebra ("LOG.md", "3.2GHz")
    assert(shortenSpecs("Criei o LOG.md agora.") === "Criei o LOG.md agora.", "ponto de nome de arquivo quebrou a frase");
  });

  await test("um painel só: a 2ª janela vira duplicada; 'Usar aqui' substitui a 1ª", async () => {
    const a = await claimInstance(150);
    assert(a.role === "leader", `primeira janela deveria liderar (${a.role})`);
    const b = await claimInstance(150);
    assert(b.role === "duplicate", `segunda janela deveria ser duplicada (${b.role})`);
    let replaced = false;
    a.onReplaced(() => { replaced = true; });
    b.takeover();
    await sleep(100);
    assert(replaced && a.role === "duplicate" && b.role === "leader", "takeover não substituiu a janela antiga");
    const c = await claimInstance(150);
    assert(c.role === "duplicate", "nova janela ainda deveria ver um líder (b)");
    a.close(); b.close(); c.close();
    const d = await claimInstance(150);
    assert(d.role === "leader", "sem janelas abertas, a próxima lidera");
    d.close();
  });

  await test("3 bots ficam online no hub (Nous/OpenAI-compat, Anthropic, Gemini)", async () => {
    // o Médico do Sistema também sobe sozinho (bot do sistema), então não dá para
    // contar o total: o que importa é que estes três específicos fiquem de pé.
    const esperados = ["joao-videomaker", "robertinho-auditor", "kenlinho-corretor"];
    const end = Date.now() + 30_000;
    for (;;) {
      const bots = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/bots`)).json() as any[];
      const faltando = esperados.filter((id) => !bots.some((b) => b.id === id && b.online));
      if (!faltando.length) { log(bots.filter((b) => esperados.includes(b.id)).map((b) => `${b.id} ${b.engine} ${b.provider}/${b.model}`).join(" · ")); return; }
      if (Date.now() > end) throw new Error(`faltando: ${faltando.join(", ")} | online: ${JSON.stringify(bots.map((b) => [b.id, b.online]))}`);
      await sleep(400);
    }
  });

  await test("não nasce mais Médico do Sistema: o médico é da empresa", async () => {
    // Regra nova: um médico só, e com dono. Ele nasce junto com a empresa
    // (medico-<empresa>), não no boot do Hub.
    await sleep(1500);
    const bots = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/bots`)).json() as any[];
    assert(!bots.some((b) => b.id === "medico"), `o Médico do Sistema voltou a nascer: ${JSON.stringify(bots.map((b) => b.id))}`);
    const managed = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/managed`)).json() as any[];
    assert(!managed.some((b) => b.id === "medico"), "ainda existe um bot gerenciado chamado medico");
  });

  await test("interface recebe snapshot com os bots", async () => {
    await ui.connect();
    const s = await ui.wait((e) => e.type === "snapshot", 5000, "snapshot");
    assert(s.bots.length >= 3, "snapshot sem bots");
  });

  await test("mensagem → resposta (provedor OpenAI-compatível / Nous)", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "olá" });
    const e = await ui.wait(botText("joao-videomaker"), 15_000, "resposta do joao");
    assert(e.message.text.includes("Você disse: olá"), `texto inesperado: ${e.message.text}`);
    assert(requests.some((r) => r.api === "openai"), "mock não recebeu chamada OpenAI");
  });

  await test("chamada de voz: a fala sai frase a frase, antes de a resposta terminar", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "fale varias frases" });
    const e = await ui.wait(botText("joao-videomaker"), 15_000, "resposta do joao");
    const ordem = ui.events;
    const falas = ordem.filter((x: Ev) => x.type === "speech.delta" && x.conversationId === "dm:joao-videomaker");
    assert(falas.length >= 2, `a fala tinha de sair em pedaços, saiu ${falas.length}: ${JSON.stringify(falas.map((f: Ev) => f.text))}`);
    const primeiraFala = ordem.indexOf(falas[0]);
    const textoFinal = ordem.indexOf(e);
    assert(primeiraFala < textoFinal, "o primeiro pedaço de fala só chegou depois do texto final — isso é esperar ele terminar de escrever");
    for (const f of falas) assert(/[.!?…:;]$/.test(String(f.text).trim()), `pedaço sem fim de frase (a voz gagueja): «${f.text}»`);
    assert(ordem.some((x: Ev) => x.type === "speech.done" && x.conversationId === "dm:joao-videomaker"), "faltou avisar que a fala acabou");
    assert(falas.map((f: Ev) => f.text).join(" ").replace(/\s+/g, " ").trim() === e.message.text.replace(/\s+/g, " ").trim(),
      `a fala não bate com o texto:\nfala: ${falas.map((f: Ev) => f.text).join(" ")}\ntexto: ${e.message.text}`);
  });

  await test("PARAR É PARAR: 500 ms depois do ⏹ nada mais chega, nada fica pendurado", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "fale sem parar" });
    await ui.wait((e: Ev) => e.type === "speech.delta" && e.conversationId === "dm:joao-videomaker", 15_000, "o bot começar a falar");

    ui.send({ type: "stop", reason: "teste do ⏹" });
    await ui.wait((e: Ev) => e.type === "stop", 5_000, "o aviso de parada para todas as janelas");
    await ui.wait((e: Ev) => e.type === "bot.update" && e.bot.id === "joao-videomaker" && e.bot.busy === false, 5_000, "o bot voltar para ocioso");

    // a partir daqui ninguém mais pode falar nada
    ui.clear();
    await sleep(500);
    const tardios = ui.events.filter((e: Ev) =>
      e.type === "speech.delta" || e.type === "speech.done" || e.type === "message.delta" ||
      (e.type === "message" && e.message?.sender?.kind === "bot" && e.message?.meta?.streaming === true));
    assert(!tardios.length, `chegou coisa depois do stop: ${JSON.stringify(tardios.slice(0, 3))}`);

    const msgs = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/conversations/dm:joao-videomaker/messages`)).json();
    const ultima = [...msgs].reverse().find((m: any) => m.sender.kind === "bot");
    assert(ultima?.meta?.interrompido, "a mensagem cortada tinha de ficar marcada como interrompida");
    assert(ultima.meta?.streaming === false, "ficou mensagem aberta, em streaming, depois do stop");

    const pendentes = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/approvals`)).json().catch(() => []);
    assert(!Array.isArray(pendentes) || !pendentes.length, "sobrou cartão de aprovação esperando clique");
  });

  await test("chamada de voz: o raciocínio em inglês não é falado", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "pense alto" });
    await ui.wait(botText("joao-videomaker"), 15_000, "resposta do joao");
    const dito = ui.events.filter((x: Ev) => x.type === "speech.delta").map((x: Ev) => x.text).join(" ");
    assert(dito.length > 0, "não falou nada");
    assert(!/The user asks|Let me respond|think out loud/i.test(dito), `o pensamento do modelo foi para a voz: ${dito}`);
  });

  await test("mensagem → resposta (provedor Anthropic)", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:robertinho-auditor", text: "olá" });
    const e = await ui.wait(botText("robertinho-auditor"), 15_000, "resposta do robertinho");
    assert(e.message.text.includes("Robertinho"), `texto inesperado: ${e.message.text}`);
    assert(requests.some((r) => r.api === "anthropic" && r.body.system), "chamada Anthropic sem system");
  });

  await test("mensagem → resposta (provedor Gemini)", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:kenlinho-corretor", text: "olá" });
    const e = await ui.wait(botText("kenlinho-corretor"), 15_000, "resposta do kenlinho");
    assert(e.message.text.includes("Kenlinho"), `texto inesperado: ${e.message.text}`);
    assert(requests.some((r) => r.api === "gemini" && r.body.systemInstruction), "chamada Gemini sem systemInstruction");
  });

  await test("status 'Pensando' aparece na lista enquanto trabalha", async () => {
    await ui.wait((e) => e.type === "status" && e.fase === "digitando" && e.busy, 5000, "digitando");
    await ui.wait((e) => e.type === "status" && e.text === "Pensando" && e.busy, 5000, "status busy");
    await ui.wait((e) => e.type === "status" && e.busy === false, 5000, "status Disponível");
  });

  await test("ferramenta list_dir: tool.start/tool.done + resposta final", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "liste a pasta" });
    const start = await ui.wait((e) => e.type === "tool" && e.phase === "start" && e.tool === "list_dir", 15_000, "tool.start");
    const done = await ui.wait((e) => e.type === "tool" && e.phase === "done" && e.callId === start.callId, 15_000, "tool.done");
    assert(done.ok && String(done.output).includes("arquivo-de-teste.txt"), `saída inesperada: ${done.output}`);
    const final = await ui.wait((e) => botText("joao-videomaker")(e) && e.message.text.includes("resultado de list_dir"), 15_000, "resposta final");
    assert(final, "sem resposta final");
  });

  await test("run_command pede aprovação; Permitir → executa e responde", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "rode o comando" });
    await ui.wait((e) => e.type === "status" && e.botId === "joao-videomaker" && e.fase === "digitando", 5_000, "digitando na hora");
    const nota = await ui.wait((e) => e.type === "message" && e.message.sender.id === "joao-videomaker" && e.message.text === "Vou fazer isso no computador agora.", 15_000, "confirmação curta");
    assert(nota.message.meta?.nota === true, "a confirmação devia ser uma nota, sem encerrar o turno");
    await ui.wait((e) => e.type === "status" && e.botId === "joao-videomaker" && e.fase === "trabalhando", 15_000, "trabalhando");
    const ap = await ui.wait((e) => e.type === "approval.request", 15_000, "approval.request");
    assert(ap.approval.tool === "run_command" && String((ap.approval.input as any).command).includes("echo"), "pedido de aprovação errado");
    const pend = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/approvals`)).json() as any[];
    assert(pend.some((p) => p.id === ap.approval.id), "aprovação não está pendente na API");
    ui.send({ type: "approval.response", requestId: ap.approval.id, allow: true });
    await ui.wait((e) => e.type === "approval.resolved" && e.requestId === ap.approval.id, 5000, "approval.resolved");
    const done = await ui.wait((e) => e.type === "tool" && e.phase === "done" && e.tool === "run_command", 15_000, "tool.done");
    assert(done.ok && String(done.output).includes("ola-mybots"), `saída: ${done.output}`);
    const final = await ui.wait((e) => botText("joao-videomaker")(e) && e.message.text.includes("comando executado"), 15_000, "resposta final");
    assert(final, "sem resposta final");
  });

  await test("run_command com Negar → ferramenta falha e bot explica", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:robertinho-auditor", text: "rode o comando" });
    const ap = await ui.wait((e) => e.type === "approval.request" && e.approval.botId === "robertinho-auditor", 15_000, "approval.request");
    ui.send({ type: "approval.response", requestId: ap.approval.id, allow: false });
    const done = await ui.wait((e) => e.type === "tool" && e.phase === "done" && e.tool === "run_command" && e.conversationId === "dm:robertinho-auditor", 15_000, "tool.done");
    assert(done.ok === false && String(done.output).includes("NEGOU"), `saída: ${done.output}`);
    await ui.wait((e) => botText("robertinho-auditor")(e) && e.message.text.includes("negado"), 15_000, "resposta final");
  });

  await test("ask_user com botões → resposta chega ao bot", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:kenlinho-corretor", text: "me pergunte" });
    const q = await ui.wait((e) => e.type === "question", 15_000, "question");
    assert(q.question.options.includes("Sim"), "opções erradas");
    ui.send({ type: "question.answer", questionId: q.question.id, answer: "Sim" });
    await ui.wait((e) => botText("kenlinho-corretor")(e) && e.message.text.includes('"Sim"'), 15_000, "resposta final");
  });

  // ---------- automode: níveis de controle ----------
  const setControl = async (global: string | null, confirm?: string) => fetch(`http://127.0.0.1:${HUB_PORT}/api/control`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ global, confirm }) });

  await test("automode Supervisionado (padrão): comando médio pede aprovação; nó informa o nível; porta 8787 é intocável", async () => {
    const c = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/control`)).json() as any;
    assert(c.global === null && c.bots["joao-videomaker"] === "supervisionado", `estado inicial errado: ${JSON.stringify(c)}`);
    const bots = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/bots`)).json() as any[];
    assert(bots.find((b) => b.id === "joao-videomaker")?.controlMode === "supervisionado", "BotSummary sem controlMode");
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "comando medio" });
    const ap = await ui.wait((e) => e.type === "approval.request" && e.approval.botId === "joao-videomaker", 15_000, "approval.request");
    assert(ap.approval.risk === "medium", `risco deveria ser médio: ${ap.approval.risk}`);
    ui.send({ type: "approval.response", requestId: ap.approval.id, allow: false });
    await ui.wait((e) => botText("joao-videomaker")(e) && /negado/i.test(e.message.text), 15_000, "bot explica a negação");
    // porta 8787: bloqueada antes de qualquer aprovação, em qualquer modo
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "mate a 8787" });
    const done = await ui.wait((e) => e.type === "tool" && e.phase === "done" && e.tool === "run_command", 15_000, "tool.done");
    assert(done.ok === false && /8787/.test(String(done.output)), `deveria bloquear a 8787: ${done.output}`);
    assert(!ui.events.some((e) => e.type === "approval.request"), "não deveria nem pedir aprovação para mexer na 8787");
    await ui.wait((e) => e.type === "status" && e.botId === "joao-videomaker" && e.busy === false, 15_000, "bot livre");
  });

  await test("automode Autônomo: comando médio roda sem aprovação (auditado); destrutivo ainda pede", async () => {
    const r = await setControl("autonomo");
    assert(r.ok, "PUT /api/control falhou");
    await ui.wait((e) => e.type === "control" && e.control.global === "autonomo", 5000, "broadcast do nível");
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "comando medio" });
    const done = await ui.wait((e) => e.type === "tool" && e.phase === "done" && e.tool === "run_command", 15_000, "tool.done");
    assert(done.ok && /medio-ok/.test(String(done.output)), `comando médio deveria rodar: ${done.output}`);
    assert(!ui.events.some((e) => e.type === "approval.request"), "modo autônomo não deveria pedir aprovação para comando médio");
    await ui.wait((e) => botText("joao-videomaker")(e) && /executado/.test(e.message.text), 15_000, "resposta final");
    const audit = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/audit?limit=50`)).json() as any[];
    assert(audit.some((a) => a.action === "approval.auto" && /autonomo/.test(a.detail ?? "")), "aprovação automática não foi auditada");
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "comando perigoso" });
    const ap = await ui.wait((e) => e.type === "approval.request" && e.approval.botId === "joao-videomaker", 15_000, "approval.request do destrutivo");
    assert(ap.approval.risk === "high", "destrutivo deveria ser risco alto");
    ui.send({ type: "approval.response", requestId: ap.approval.id, allow: false });
    await ui.wait((e) => botText("joao-videomaker")(e) && /negado/i.test(e.message.text), 15_000, "bot explica a negação");
  });

  await test("automode MODO DEUS EXTREMO: exige 'DEUS', aprova tudo, não pergunta; ⏹ pânico volta para Supervisionado", async () => {
    const bad = await setControl("deus");
    assert(bad.status === 400, "ligar o modo Deus sem confirmar deveria falhar");
    const ok = await setControl("deus", "DEUS");
    assert(ok.ok, "PUT /api/control deus falhou");
    await ui.wait((e) => e.type === "control" && e.control.global === "deus", 5000, "broadcast do nível");
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "comando perigoso" });
    const done = await ui.wait((e) => e.type === "tool" && e.phase === "done" && e.tool === "run_command", 15_000, "tool.done");
    assert(done.ok && /perigoso-ok/.test(String(done.output)), `no modo Deus o destrutivo deveria rodar: ${done.output}`);
    assert(!ui.events.some((e) => e.type === "approval.request"), "modo Deus não deveria pedir aprovação");
    await ui.wait((e) => botText("joao-videomaker")(e) && /executado/.test(e.message.text), 15_000, "resposta final");
    // ask_user vira "decida você mesmo": nenhuma pergunta chega à interface
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:kenlinho-corretor", text: "me pergunte" });
    await ui.wait((e) => botText("kenlinho-corretor")(e) && /MODO DEUS/.test(e.message.text), 15_000, "bot decidiu sozinho");
    assert(!ui.events.some((e) => e.type === "question"), "modo Deus não deveria perguntar ao chefe");
    const audit = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/audit?limit=80`)).json() as any[];
    assert(audit.some((a) => a.action === "question.auto") && audit.some((a) => a.action === "approval.auto" && /deus/.test(a.detail ?? "")) && audit.some((a) => a.action === "control.global"), "auditoria do modo Deus incompleta");
    // pânico
    ui.clear();
    const p = await fetch(`http://127.0.0.1:${HUB_PORT}/api/control/panic`, { method: "POST" });
    assert(p.ok, "pânico falhou");
    await ui.wait((e) => e.type === "control" && e.control.global === "supervisionado", 5000, "voltou para supervisionado");
    assert((await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/control`)).json() as any).global === "supervisionado", "estado não voltou");
    // deixa como estava (por bot) para os testes seguintes
    await setControl(null);
    await ui.wait((e) => e.type === "control" && e.control.global === null, 5000, "voltou para 'por bot'");
  });

  await test("ask_bot: João consulta Robertinho (outro PC/provedor) e usa a resposta", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "consulte o bot robertinho-auditor sobre o estoque" });
    await ui.wait((e) => e.type === "tool" && e.phase === "start" && e.tool === "ask_bot", 15_000, "ask_bot start");
    const pairMsg = await ui.wait((e) => e.type === "message" && e.message.conversationId === "pair:joao-videomaker:robertinho-auditor" && e.message.sender.id === "robertinho-auditor" && e.message.text, 20_000, "resposta na conversa pair");
    assert(pairMsg.message.text.includes("42"), `robertinho respondeu: ${pairMsg.message.text}`);
    const final = await ui.wait((e) => botText("joao-videomaker")(e) && e.message.text.includes("colega respondeu"), 20_000, "resposta final do joao");
    assert(final.message.text.includes("42"), `joao não usou a resposta: ${final.message.text}`);
    const msgs = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/conversations/pair:joao-videomaker:robertinho-auditor/messages`)).json() as any[];
    assert(msgs.length >= 2, "conversa entre bots não foi salva");
  });

  await test("ask_bot para bot offline devolve erro claro", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "consulte o bot inexistente sobre nada" });
    const done = await ui.wait((e) => e.type === "tool" && e.phase === "done" && e.tool === "ask_bot", 15_000, "tool.done");
    assert(done.ok === false && String(done.output).includes("não está online"), `saída: ${done.output}`);
  });

  await test("corpo vazio com content-type JSON não vira 400 (era o que quebrava excluir bot)", async () => {
    // A interface manda content-type JSON em toda chamada; DELETE não tem corpo.
    // O Fastify recusava antes de chegar na rota e a tela só dizia "Bad Request".
    const r = await fetch(`http://127.0.0.1:${HUB_PORT}/api/managed/nao-existe-mesmo`, {
      method: "DELETE", headers: { "content-type": "application/json" },
    });
    assert(r.status !== 400, "corpo vazio devia ser tolerado, veio 400 (Bad Request)");
    const r2 = await fetch(`http://127.0.0.1:${HUB_PORT}/api/audit`, {
      method: "GET", headers: { "content-type": "application/json" },
    });
    assert(r2.ok, "GET com content-type JSON e sem corpo também tem de passar");
  });

  await test("histórico persiste e API REST responde", async () => {
    const msgs = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/conversations/dm:joao-videomaker/messages`)).json() as any[];
    assert(msgs.length >= 6, `poucas mensagens: ${msgs.length}`);
    const audit = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/audit`)).json() as any[];
    assert(audit.some((a) => a.action === "approval.allowed") && audit.some((a) => a.action === "approval.denied"), "auditoria sem aprovações");
    const html = await (await fetch(`http://127.0.0.1:${HUB_PORT}/`)).text();
    assert(html.includes("<div id=\"root\">"), "interface não servida");
  });

  await test("grupo: mensagem chega aos dois bots; cada um responde uma vez; falas dos colegas viram contexto silencioso", async () => {
    const g = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/groups`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Equipe", members: ["joao-videomaker", "robertinho-auditor"] }) })).json() as any;
    assert(g.id, "grupo não criado");
    ui.clear();
    ui.send({ type: "send", conversationId: `group:${g.id}`, text: "olá grupo" });
    await ui.wait((e) => botText("joao-videomaker")(e) && e.message.conversationId === `group:${g.id}`, 15_000, "resposta do joao no grupo");
    await ui.wait((e) => botText("robertinho-auditor")(e) && e.message.conversationId === `group:${g.id}`, 15_000, "resposta do robertinho no grupo");
    await sleep(2500);
    const msgs = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/conversations/group:${g.id}/messages`)).json() as any[];
    const botMsgs = msgs.filter((m) => m.sender.kind === "bot" && m.text);
    assert(botMsgs.length === 2, `esperava 2 respostas de bots, veio ${botMsgs.length}: ${botMsgs.map((m) => m.sender.id).join(",")}`);
    // a fala do colega entrou no histórico do outro sem gerar resposta
    const hist = JSON.parse(fs.readFileSync(path.join(tmp, "joao-videomaker/workspace/.mybots/history", `group_${g.id}.json`), "utf8")) as any[];
    assert(hist.some((h) => h.role === "user" && /disse no grupo/.test(h.content)), "fala do colega não entrou no contexto");
  });

  await test("rotina: criar pela API, 'rodar agora' chega ao bot como [Rotina] e ele executa", async () => {
    const r = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/routines`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ botId: "joao-videomaker", name: "Conferir estoque", cron: "0 9 * * 1", prompt: "conferir o estoque e avisar" }) })).json() as any;
    assert(r.id && r.nextRun, `rotina inválida: ${JSON.stringify(r)}`);
    const bad = await fetch(`http://127.0.0.1:${HUB_PORT}/api/routines`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ botId: "joao-videomaker", name: "x", cron: "99 99 * * *", prompt: "x" }) });
    assert(bad.status === 400, "cron inválido deveria dar 400");
    ui.clear();
    await fetch(`http://127.0.0.1:${HUB_PORT}/api/routines/${r.id}/run`, { method: "POST" });
    const trig = await ui.wait((e) => e.type === "message" && e.message.sender.id === `routine:${r.id}`, 5000, "mensagem da rotina");
    assert(/\[Rotina "Conferir estoque"/.test(trig.message.text), `texto da rotina: ${trig.message.text}`);
    await ui.wait((e) => botText("joao-videomaker")(e) && /rotina executada/.test(e.message.text), 15_000, "bot executou a rotina");
    const routines = await ui.wait((e) => e.type === "routines" && e.routines.some((x: any) => x.id === r.id && x.lastRun), 5000, "routines atualizadas");
    assert(routines, "sem broadcast de rotinas");
  });

  await test("bot cria rotina sozinho pela ferramenta schedule", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:robertinho-auditor", text: "agende isso" });
    const done = await ui.wait((e) => e.type === "tool" && e.phase === "done" && e.tool === "schedule", 15_000, "tool.done");
    assert(done.ok && /criada/.test(String(done.output)), `saída: ${done.output}`);
    const list = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/routines?bot=robertinho-auditor`)).json() as any[];
    assert(list.some((x) => x.name === "Teste agendado"), "rotina não aparece na API");
  });

  await test("send_file: bot envia arquivo do workspace; aparece no chat e baixa pela API", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "mande o arquivo" });
    const fm = await ui.wait((e) => e.type === "message" && e.message.sender.id === "joao-videomaker" && e.message.meta?.files?.length, 15_000, "mensagem com arquivo");
    const f = fm.message.meta.files[0];
    assert(f.name === "arquivo-de-teste.txt", `nome: ${f.name}`);
    const body = await (await fetch(`http://127.0.0.1:${HUB_PORT}${f.url}`)).text();
    assert(body === "conteúdo", `conteúdo baixado: ${body}`);
    await ui.wait((e) => botText("joao-videomaker")(e) && /arquivo enviado/.test(e.message.text), 15_000, "resposta final");
  });

  await test("anexo do usuário: arquivo vai para o hub e o bot recebe o link", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:robertinho-auditor", text: "olha isso", attachments: [{ name: "nota.txt", mime: "text/plain", dataBase64: Buffer.from("nota fiscal 123").toString("base64") }] });
    const um = await ui.wait((e) => e.type === "message" && e.message.sender.kind === "user" && e.message.meta?.files?.length, 5000, "mensagem do usuário com anexo");
    const body = await (await fetch(`http://127.0.0.1:${HUB_PORT}${um.message.meta.files[0].url}`)).text();
    assert(body === "nota fiscal 123", "anexo não baixou");
    const reply = await ui.wait(botText("robertinho-auditor"), 15_000, "resposta");
    assert(/\[anexo: nota.txt/.test(reply.message.text), `bot não recebeu o link do anexo: ${reply.message.text}`);
  });

  await test("canal externo: POST /api/channels/incoming → bot responde → webhook de saída recebe", async () => {
    const got: any[] = [];
    const hook = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { got.push(JSON.parse(b)); res.end("ok"); }); });
    await new Promise<void>((r) => hook.listen(HOOK_PORT, "127.0.0.1", () => r()));
    const r = await fetch(`http://127.0.0.1:${HUB_PORT}/api/channels/incoming`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ channel: "whatsapp", from: "5519999990000", botId: "joao-videomaker", text: "oi, vocês fazem vídeo?" }) });
    assert(r.ok, `incoming falhou: ${r.status}`);
    const unauth = await fetch(`http://127.0.0.1:${HUB_PORT}/api/channels/incoming`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "whatsapp", from: "x", botId: "joao-videomaker", text: "x" }) });
    assert(unauth.status === 401, "sem chave deveria dar 401");
    const end = Date.now() + 15_000;
    while (!got.length && Date.now() < end) await sleep(300);
    hook.close();
    assert(got.length === 1 && got[0].channel === "whatsapp" && got[0].to === "5519999990000" && /Você disse: oi/.test(got[0].text), `webhook: ${JSON.stringify(got)}`);
  });

  await test("voz: /api/voice/config, TTS pelo Hub (Edge) devolve áudio e STT usa o servidor whisper configurado", async () => {
    const cfg = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/voice/config`)).json() as any;
    assert(cfg.tts === true && cfg.ttsEngine === "edge" && cfg.stt === true, `config: ${JSON.stringify(cfg)}`);
    const tts = await fetch(`http://127.0.0.1:${HUB_PORT}/api/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Olá, o chefe. Aqui é o João.", botId: "joao-videomaker" }) });
    assert(tts.ok && (tts.headers.get("content-type") ?? "").startsWith("audio/"), `tts: ${tts.status} ${tts.headers.get("content-type")}`);
    const audio = Buffer.from(await tts.arrayBuffer());
    assert(audio.length > 5000, `áudio pequeno demais: ${audio.length}`);
    const stt = await fetch(`http://127.0.0.1:${HUB_PORT}/api/stt`, { method: "POST", headers: { "content-type": "audio/webm" }, body: Buffer.alloc(8000, 7) });
    const j = await stt.json() as any;
    assert(stt.ok && j.text === "transcrição de mentira", `stt: ${stt.status} ${JSON.stringify(j)}`);

    // Guarda-corpo da captação: clique, tosse ou porta batendo geram um arquivo minúsculo.
    // Mandar isso ao Whisper não devolve silêncio — devolve uma frase inventada, que o
    // painel manda ao bot como se fosse pedido do chefe. Então nem sai daqui.
    const curto = await fetch(`http://127.0.0.1:${HUB_PORT}/api/stt`, { method: "POST", headers: { "content-type": "audio/webm" }, body: Buffer.from("fake-audio") });
    const jc = await curto.json() as any;
    assert(curto.ok && jc.text === "", `áudio curto demais deveria voltar vazio, veio: ${JSON.stringify(jc)}`);
  });

  await test("filtro de pensamento não engole a resposta: inglês de propósito continua chegando", async () => {
    // Bug real: a heurística tratava inglês como raciocínio, então um bot que
    // responde em inglês de propósito (professor de idiomas) ficava mudo.
    const aula = "Almost! We say: Yesterday I sold three notebooks. Who was the client?";

    // com permiteIngles, nada de inglês é cortado
    const livre = splitThoughts(aula, { permiteIngles: true });
    assert(livre.answer === aula, `bot de idiomas perdeu a resposta: "${livre.answer}"`);
    assert(!livre.thought, `não deveria haver pensamento: "${livre.thought}"`);

    // mesmo com permiteIngles, bloco marcado continua sendo pensamento
    const marcado = splitThoughts(`<think>Let me check the tense.</think>${aula}`, { permiteIngles: true });
    assert(marcado.answer === aula, `a resposta depois do <think> se perdeu: "${marcado.answer}"`);
    assert(/check the tense/.test(marcado.thought), "o bloco <think> deveria ter ido para o pensamento");

    // rede de segurança: sem a flag, a heurística NUNCA pode zerar a mensagem
    const semFlag = splitThoughts(aula);
    assert(semFlag.answer.trim().length > 0, "a heurística engoliu a mensagem inteira (bot ficaria mudo)");

    // e o caso normal continua funcionando: raciocínio em inglês antes da resposta em português
    const normal = splitThoughts("The user asks about stock. Let me check. Chefe, tem 42 unidades no estoque.");
    assert(/42 unidades/.test(normal.answer), `a resposta em português se perdeu: "${normal.answer}"`);
    assert(!/42 unidades/.test(normal.thought), "a resposta não deveria estar no pensamento");
    assert(/user asks/.test(normal.thought), `o raciocínio em inglês deveria ter sido cortado: "${normal.thought}"`);
  });

  await test("pensamentos do modelo são filtrados: nem no texto salvo nem na interface", async () => {
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "pense alto" });
    const e = await ui.wait(botText("joao-videomaker"), 15_000, "resposta");
    assert(!/The user asks/.test(e.message.text) && /pensei em silêncio/.test(e.message.text), `texto: ${e.message.text}`);
    assert(/The user asks/.test(String(e.message.meta?.thought ?? "")), "pensamento não foi guardado em meta.thought");
    const parcial = ui.events.filter((x) => x.type === "message.delta").map((x) => x.text).join("");
    assert(!/The user asks/.test(parcial), `o pensamento vazou no texto parcial: ${parcial}`);
    assert(/pensei em silêncio/.test(parcial), `o texto parcial devia ir saindo: ${parcial}`);
  });

  // O menu de botão direito só vale se o bot DEIXAR de ver o que saiu da conversa.
  // Testar que a mensagem some da tela não bastaria: o perigo é ela continuar no
  // histórico do nó e o bot responder a um pedido que o chefe apagou.
  await test("menu do chat: rebobinar tira do histórico, desfazer traz de volta", async () => {
    const conv = "dm:joao-videomaker";
    const url = `http://127.0.0.1:${HUB_PORT}`;
    ui.clear();
    ui.send({ type: "send", conversationId: conv, text: "primeiro pedido" });
    const r1 = await ui.wait(botText("joao-videomaker"), 20_000, "resposta do primeiro pedido");
    ui.send({ type: "send", conversationId: conv, text: "segundo pedido, este vai sumir" });
    await ui.wait(botText("joao-videomaker"), 20_000, "resposta do segundo pedido");

    // espera o banco ter os quatro (pedido, resposta, pedido, resposta): o evento da
    // interface chega um instante antes da gravação terminar, e rebobinar cedo demais
    // mediria outra coisa.
    let antes: any[] = [];
    for (let i = 0; i < 25; i++) {
      antes = await (await fetch(`${url}/api/conversations/${encodeURIComponent(conv)}/messages`)).json() as any[];
      const j = antes.findIndex((m) => m.text === "segundo pedido, este vai sumir");
      if (j >= 0 && antes.slice(j + 1).some((m) => m.sender.kind === "bot" && m.text)) break;
      await sleep(300);
    }
    const segundo = antes.find((m) => m.text === "segundo pedido, este vai sumir");
    assert(segundo, "não achei o segundo pedido");
    assert(antes.some((m) => m.sender.kind === "bot" && m.createdAt > segundo.createdAt), "a resposta do segundo pedido não chegou ao banco");

    const rw = await (await fetch(`${url}/api/conversations/${encodeURIComponent(conv)}/rewind`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: segundo.id, include: "this" }),
    })).json() as any;
    assert(rw.afetadas >= 2, `deveria ter escondido o pedido e a resposta, escondeu ${rw.afetadas}`);

    const depois = await (await fetch(`${url}/api/conversations/${encodeURIComponent(conv)}/messages`)).json() as any[];
    assert(!depois.some((m) => m.text === "segundo pedido, este vai sumir"), "o pedido rebobinado continua no histórico");
    assert(depois.some((m) => m.id === r1.message.id), "o rebobinar levou junto o que era para ficar");

    // o nó também precisa ter esquecido: o arquivo de histórico dele é a prova.
    // (procura em qualquer workspace sob o tmp do teste: o caminho muda conforme o bot)
    const arquivo = conv.replace(/[^a-z0-9_-]/gi, "_") + ".json";
    const achar = (dir: string): string | null => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { const r = achar(full); if (r) return r; }
        else if (e.name === arquivo && full.includes("history")) return full;
      }
      return null;
    };
    let hist: string | null = null;
    for (let i = 0; i < 25; i++) {
      hist = achar(tmp);
      if (hist && !fs.readFileSync(hist, "utf8").includes("este vai sumir")) break;
      await sleep(400);
    }
    assert(hist, "não achei o arquivo de histórico do nó");
    assert(!fs.readFileSync(hist!, "utf8").includes("este vai sumir"), "o nó ainda tem o pedido rebobinado na memória dele");

    const un = await (await fetch(`${url}/api/conversations/${encodeURIComponent(conv)}/unrewind`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: rw.token }),
    })).json() as any;
    assert(un.voltaram === rw.afetadas, `desfazer devolveu ${un.voltaram} de ${rw.afetadas}`);
    const voltou = await (await fetch(`${url}/api/conversations/${encodeURIComponent(conv)}/messages`)).json() as any[];
    assert(voltou.some((m) => m.text === "segundo pedido, este vai sumir"), "o desfazer não trouxe a mensagem de volta");
  });

  await test("menu do chat: apagar esconde (não some do banco), fixar marca, editar gera versão nova", async () => {
    const conv = "dm:joao-videomaker";
    const url = `http://127.0.0.1:${HUB_PORT}`;
    ui.clear();
    ui.send({ type: "send", conversationId: conv, text: "mensagem para apagar" });
    await ui.wait(botText("joao-videomaker"), 20_000, "resposta");
    let msgs = await (await fetch(`${url}/api/conversations/${encodeURIComponent(conv)}/messages`)).json() as any[];
    const alvo = msgs.find((m) => m.text === "mensagem para apagar");

    await fetch(`${url}/api/messages/${alvo.id}/pin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pinned: true }) });
    msgs = await (await fetch(`${url}/api/conversations/${encodeURIComponent(conv)}/messages`)).json() as any[];
    assert(msgs.find((m) => m.id === alvo.id)?.pinned === true, "fixar não marcou a mensagem");

    await fetch(`${url}/api/messages/${alvo.id}`, { method: "DELETE" });
    msgs = await (await fetch(`${url}/api/conversations/${encodeURIComponent(conv)}/messages`)).json() as any[];
    assert(!msgs.some((m) => m.id === alvo.id), "apagada continua aparecendo");

    ui.clear();
    ui.send({ type: "send", conversationId: conv, text: "pedido com erro de digitacao" });
    await ui.wait(botText("joao-videomaker"), 20_000, "resposta do pedido com erro");
    msgs = await (await fetch(`${url}/api/conversations/${encodeURIComponent(conv)}/messages`)).json() as any[];
    const errado = msgs.find((m) => m.text === "pedido com erro de digitacao");
    const ed = await (await fetch(`${url}/api/messages/${errado.id}/edit`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "pedido corrigido" }),
    })).json() as any;
    assert(ed.text === "pedido corrigido", `editar devolveu ${JSON.stringify(ed).slice(0, 120)}`);
    await ui.wait(botText("joao-videomaker"), 20_000, "resposta do pedido editado");
    msgs = await (await fetch(`${url}/api/conversations/${encodeURIComponent(conv)}/messages`)).json() as any[];
    assert(!msgs.some((m) => m.text === "pedido com erro de digitacao"), "a versão antiga do pedido ficou na conversa");
    assert(msgs.some((m) => m.text === "pedido corrigido"), "a versão nova não entrou");
  });

  await test("criar bot pela interface: o Hub escreve a pasta, inicia o nó e ele fica online", async () => {
    // Todo bot pertence a uma empresa: sem ela, a criação é recusada de propósito.
    const semEmpresa = await fetch(`http://127.0.0.1:${HUB_PORT}/api/managed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Orfão" }) });
    assert(semEmpresa.status === 400, `bot sem empresa deveria ser recusado, veio ${semEmpresa.status}`);
    await fetch(`http://127.0.0.1:${HUB_PORT}/api/empresas`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nome: "Casa de Teste", comMedico: false }) });
    const r = await fetch(`http://127.0.0.1:${HUB_PORT}/api/managed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Malaquias Marketing", empresa: "casa-de-teste", role: "Marketing", avatar: "📣", engine: "direct", provider: { kind: "nous", model: "mock-1", apiKey: "k", baseURL: `http://127.0.0.1:${LLM_PORT}/v1` }, persona: "Você é Malaquias, bot de teste." }) });
    const d = await r.json() as any;
    assert(r.ok && d.id === "malaquias-marketing", `criação: ${JSON.stringify(d)}`);
    assert(fs.existsSync(path.join(tmp, "managed/malaquias-marketing/mybots-node.json")), "pasta do bot não foi escrita");
    const env = fs.readFileSync(path.join(tmp, "managed/malaquias-marketing/.env"), "utf8");
    assert(/NOUS_API_KEY=k/.test(env), ".env sem a chave");
    const end = Date.now() + 40_000;
    for (;;) {
      const bots = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/bots`)).json() as any[];
      const b = bots.find((x) => x.id === "malaquias-marketing");
      if (b?.online) { assert(b.managed === true, "deveria estar marcado como gerenciado"); break; }
      if (Date.now() > end) throw new Error("bot gerenciado não ficou online");
      await sleep(500);
    }
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:malaquias-marketing", text: "olá" });
    const e = await ui.wait(botText("malaquias-marketing"), 20_000, "resposta do bot gerenciado");
    assert(/Malaquias/.test(e.message.text), `texto: ${e.message.text}`);
    const dup = await fetch(`http://127.0.0.1:${HUB_PORT}/api/managed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Malaquias Marketing", provider: { kind: "opencode" } }) });
    assert(dup.status === 400, "id duplicado deveria dar 400");
    const semChave = await fetch(`http://127.0.0.1:${HUB_PORT}/api/managed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sem Chave", engine: "direct", provider: { kind: "gemini", model: "gemini-2.5-flash" } }) });
    assert(semChave.status === 400, "gemini sem chave deveria dar 400");
  });

  await test("herança da casa: saber de identidade entra inteiro no prompt de todo bot, sem reiniciar", async () => {
    const MARCA = "Pedro Herrera-de-Teste, irmão gêmeo imaginário, nasceu em 1988 em Sorocaba";
    const r = await fetch(`http://127.0.0.1:${HUB_PORT}/api/knowledge`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ titulo: "Quem é a casa (teste)", resumo: "quem manda aqui", tipo: "identidade", conteudo: MARCA }),
    });
    assert(r.ok, "gravar saber de identidade falhou");

    // o bloco que o hub monta tem o conteúdo INTEIRO, não só o título
    const h = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/knowledge/heranca/joao-videomaker`)).json() as any;
    assert(h.bloco.includes(MARCA), "a herança deveria trazer o conteúdo inteiro do saber de identidade");
    assert(/Quem é a casa/.test(h.bloco), "a herança deveria ter o cabeçalho de identidade");

    // um saber comum entra como índice (título + resumo), não inteiro
    await fetch(`http://127.0.0.1:${HUB_PORT}/api/knowledge`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ titulo: "Trocar tela de notebook", resumo: "passo a passo da bancada", tipo: "procedimento", conteudo: "SEGREDO-QUE-NAO-DEVE-IR-NO-PROMPT" }),
    });
    const h2 = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/knowledge/heranca/joao-videomaker`)).json() as any;
    assert(/Trocar tela de notebook/.test(h2.bloco), "saber comum deveria aparecer no índice");
    assert(!h2.bloco.includes("SEGREDO-QUE-NAO-DEVE-IR-NO-PROMPT"), "saber comum não deveria ir inteiro no prompt");

    // e chega no bot que JÁ estava de pé (push), sem reiniciar o nó
    await sleep(1200);
    const antes = requests.length;
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "quem sou eu?" });
    await ui.wait(botText("joao-videomaker"), 20_000, "resposta do joão");
    const nova = requests.slice(antes).find((x) => JSON.stringify(x.body).includes("Pedro Herrera-de-Teste"));
    assert(nova, "o prompt enviado ao modelo deveria conter a herança (hello.ok/knowledge não chegou ao motor)");
  });

  await test("search_knowledge entrega o CONTEÚDO ao bot (e não \"[object Object]\")", async () => {
    // Regressão: hub.call() resolve { ok, data } e o nó passava o objeto inteiro
    // para String(), virando a palavra "[object Object]". Resultado: a base da
    // casa inteira chegava vazia aos bots, que então diziam não saber — ou pior,
    // inventavam. O teste de herança não pegava isso: ele olha o prompt, não a
    // ferramenta. Este faz o caminho todo.
    const MARCA = "DESAPERTE-OS-SEIS-PARAFUSOS-TORX-ANTES-DE-LEVANTAR-A-MOLDURA";
    const r = await fetch(`http://127.0.0.1:${HUB_PORT}/api/knowledge`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ titulo: "Tela de notebook na bancada", resumo: "troca de tela", tipo: "procedimento", conteudo: MARCA }),
    });
    assert(r.ok, "gravar o saber de teste falhou");
    await sleep(600);

    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "busque na base como trocar a tela" });
    const e = await ui.wait((ev) => botText("joao-videomaker")(ev) && ev.message.text.includes(MARCA), 20_000, "resposta com o resultado da busca");
    const texto = e.message.text;
    assert(!/\[object Object\]/.test(texto), `o nó entregou "[object Object]" em vez do conteúdo: ${texto}`);
    assert(texto.includes(MARCA), `o conteúdo da base não chegou ao modelo: ${texto}`);
  });

  await test("editar bot gerenciado (persona) reinicia o nó; parar e excluir funcionam", async () => {
    const r = await fetch(`http://127.0.0.1:${HUB_PORT}/api/managed/malaquias-marketing`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona: "Você é Malaquias v2.", role: "Marketing e Instagram" }) });
    assert(r.ok, "patch falhou");
    assert(fs.readFileSync(path.join(tmp, "managed/malaquias-marketing/persona.md"), "utf8") === "Você é Malaquias v2.", "persona não foi regravada");
    await ui.wait((e) => e.type === "bot.update" && e.bot.id === "malaquias-marketing" && e.bot.online === false, 20_000, "nó parou para reiniciar");
    await ui.wait((e) => e.type === "bot.update" && e.bot.id === "malaquias-marketing" && e.bot.online === true && e.bot.role === "Marketing e Instagram", 40_000, "nó voltou com a nova função");
    await fetch(`http://127.0.0.1:${HUB_PORT}/api/managed/malaquias-marketing/stop`, { method: "POST" });
    await ui.wait((e) => e.type === "bot.update" && e.bot.id === "malaquias-marketing" && e.bot.online === false, 20_000, "parou");
    const st = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/managed/malaquias-marketing`)).json() as any;
    assert(st.running === false, "deveria constar como parado");
    const log = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/managed/malaquias-marketing/logs`)).json() as any;
    assert(/conectado ao hub/.test(log.log), "log do nó vazio");
    // deixa conversa para trás de propósito: é o caso do chefe — o bot some da lista e o
    // chat continua ali, com mensagem e resposta pela metade.
    ui.send({ type: "send", conversationId: "dm:malaquias-marketing", text: "ficou algo aqui?" });
    await ui.wait((e) => e.type === "message" && e.message.conversationId === "dm:malaquias-marketing", 10_000, "mensagem gravada na conversa");
    ui.clear();
    await fetch(`http://127.0.0.1:${HUB_PORT}/api/managed/malaquias-marketing`, { method: "DELETE" });
    const list = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/managed`)).json() as any[];
    assert(!list.some((b) => b.id === "malaquias-marketing"), "ainda listado em /api/managed após excluir");
    // o que faltava: sumir de verdade do painel, não só do cadastro de gerenciados
    await ui.wait((e) => e.type === "bot.removed" && e.botId === "malaquias-marketing", 10_000, "aviso bot.removed para a interface");
    const bots = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/bots`)).json() as any[];
    assert(!bots.some((b) => b.id === "malaquias-marketing"), "bot excluído continua aparecendo na lista do painel");
    const rotinas = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/routines`)).json() as any[];
    assert(!rotinas.some((r) => r.botId === "malaquias-marketing"), "rotinas do bot excluído ficaram para trás");
    // excluir é acabar com tudo: a conversa não sobrevive ao bot
    const convs = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/conversations`)).json() as any[];
    assert(!convs.some((c) => c.id === "dm:malaquias-marketing"), "a conversa do bot excluído continuou de pé");
    const sobrou = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/conversations/${encodeURIComponent("dm:malaquias-marketing")}/messages`)).json() as any[];
    assert(sobrou.length === 0, `sobraram ${sobrou.length} mensagens do bot excluído`);
  });

  await test("parar um bot para só ele: o bot do lado continua trabalhando", async () => {
    // Regressão: parar mandava abortar UMA conversa (a direta). Trabalho em rotina, em
    // grupo ou entre bots seguia correndo, e o único "parar de verdade" era o Pânico,
    // que cala todo mundo. Aqui são dois bots pendurados ao mesmo tempo: parar um tem
    // que soltar os cartões DELE e não encostar no outro.
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "me pergunte" });
    const qJoao = await ui.wait((e) => e.type === "question" && e.question.botId === "joao-videomaker", 15_000, "pergunta do joão");
    ui.send({ type: "send", conversationId: "dm:robertinho-auditor", text: "me pergunte" });
    const qRober = await ui.wait((e) => e.type === "question" && e.question.botId === "robertinho-auditor", 15_000, "pergunta do robertinho");

    ui.clear();
    const r = await fetch(`http://127.0.0.1:${HUB_PORT}/api/bots/joao-videomaker/parar`, { method: "POST" });
    const d = await r.json() as any;
    assert(r.ok && d.online === true, `parar devolveu ${JSON.stringify(d)}`);
    await ui.wait((e) => e.type === "question.resolved" && e.questionId === qJoao.question.id, 10_000, "a pergunta do joão sai da tela");
    await ui.wait((e) => e.type === "bot.update" && e.bot.id === "joao-videomaker" && e.bot.busy === false, 10_000, "joão volta a Disponível");

    // o outro não foi tocado: cartão de pé e bot ainda ocupado
    assert(!ui.events.some((e) => e.type === "question.resolved" && e.questionId === qRober.question.id), "parar o joão derrubou a pergunta do robertinho");
    const pendentes = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/questions`)).json() as any[];
    assert(pendentes.some((q) => q.id === qRober.question.id), "a pergunta do robertinho foi cancelada junto — o parar não foi individual");
    assert(!pendentes.some((q) => q.id === qJoao.question.id), "a pergunta do joão continuou pendurada depois de parar");
    // e ele termina normalmente quando respondem
    ui.send({ type: "question.answer", questionId: qRober.question.id, answer: "Sim" });
    await ui.wait((e) => botText("robertinho-auditor")(e) && e.message.text.includes('"Sim"'), 15_000, "robertinho termina o trabalho dele");
  });

  await test("bot excluído não ressuscita: o nó que volta a conectar é recusado", async () => {
    // Regressão de 30/10: o processo do nó escapava do kill (ou morava em outro PC),
    // reconectava em 1 s dizendo "olá", e o Hub recriava a linha em `bots` — o bot
    // excluído reaparecia sozinho no painel minutos depois.
    const id = "malaquias-marketing"; // excluído no teste anterior
    const ws = new WebSocket(`ws://127.0.0.1:${HUB_PORT}/ws/node`);
    const recado = await new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("o hub não respondeu ao olá do bot excluído")), 10_000);
      ws.on("open", () => ws.send(JSON.stringify({
        type: "hello", protocol: 1, token: TOKEN,
        bot: { id, name: "Malaquias Marketing", role: "Marketing" },
        engine: "direct", provider: "nous", model: "mock-1", version: "0.1.0",
      })));
      ws.on("message", (raw) => { clearTimeout(t); resolve(JSON.parse(raw.toString())); });
      ws.on("error", (e) => { clearTimeout(t); reject(e); });
    });
    assert(recado.type === "error", `o hub aceitou o olá de um bot excluído: ${JSON.stringify(recado)}`);
    assert(recado.fatal === true, "o recado precisa ser fatal, senão o nó fica tentando para sempre");
    await new Promise<void>((r) => { ws.on("close", () => r()); setTimeout(r, 3000); });
    const bots = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/bots`)).json() as any[];
    assert(!bots.some((b) => b.id === id), "o bot excluído voltou para a lista do painel ao reconectar");
    ws.close();
  });

  await test("erro do modelo vira mensagem de sistema (não trava o bot)", async () => {
    ui.clear();
    llm.closeAllConnections();
    await new Promise<void>((r) => llm.close(() => r()));
    ui.send({ type: "send", conversationId: "dm:joao-videomaker", text: "olá de novo" });
    const err = await ui.wait((e) => e.type === "message" && e.message.sender.kind === "system" && /Falha no modelo/.test(e.message.text), 20_000, "mensagem de erro");
    assert(err, "sem erro");
    await ui.wait((e) => e.type === "status" && e.botId === "joao-videomaker" && e.busy === false, 10_000, "bot volta a Disponível");
  });

  await test("bot excluído não ressuscita; pasta adotada nasce no padrão da casa (motor direto)", async () => {
    const dir2 = path.join(tmp, "adocao");
    const morto = path.join(dir2, "fantasma-teste");
    const solto = path.join(dir2, "adotado-teste");
    for (const [d, nome] of [[morto, "Fantasma Teste"], [solto, "Adotado Teste"]] as Array<[string, string]>) {
      fs.mkdirSync(path.join(d, "workspace"), { recursive: true });
      fs.writeFileSync(path.join(d, "persona.md"), `Você é ${nome}, bot de teste.`);
      fs.writeFileSync(path.join(d, "mybots-node.json"), JSON.stringify({ hub: `ws://127.0.0.1:${HUB2_PORT}`, token: TOKEN, bot: { id: path.basename(d), name: nome, role: "Bot de teste" }, workspace: "./workspace", personaFile: "./persona.md" }, null, 2));
    }
    fs.writeFileSync(path.join(morto, ".removido"), new Date().toISOString());

    const hubDir2 = path.join(ROOT, "packages/hub");
    spawnTs("hub2", hubDir2, path.join(hubDir2, "src/index.ts"), { MYBOTS_HUB_PORT: String(HUB2_PORT), MYBOTS_HUB_TOKEN: TOKEN, MYBOTS_DB: path.join(tmp, "hub2.sqlite"), MYBOTS_BOTS_DIR: dir2, MYBOTS_SEM_CHECAR_CHAVE: "1" });
    await waitHttp(`http://127.0.0.1:${HUB2_PORT}/api/health`);
    const lista = await (await fetch(`http://127.0.0.1:${HUB2_PORT}/api/managed`)).json() as any[];
    assert(!lista.some((b: any) => b.id === "fantasma-teste"), "bot excluído ressuscitou na adoção");
    const adotado = lista.find((b: any) => b.id === "adotado-teste");
    assert(adotado, "pasta solta não foi adotada");
    assert(adotado.engine === "direct", `adotado deveria nascer no motor direto, veio ${adotado.engine}`);
    assert(adotado.provider.kind === "zai" && adotado.provider.model === "glm-4.5-flash", `adotado fora do padrão da casa: ${JSON.stringify(adotado.provider)}`);
  });

  await test("bot offline: mensagem fica salva e usuário é avisado", async () => {
    procs[3].kill(); // kenlinho
    await ui.wait((e) => e.type === "bot.update" && e.bot.id === "kenlinho-corretor" && e.bot.online === false, 10_000, "bot offline");
    ui.clear();
    ui.send({ type: "send", conversationId: "dm:kenlinho-corretor", text: "está aí?" });
    await ui.wait((e) => e.type === "message" && e.message.sender.kind === "system" && /offline/.test(e.message.text), 5000, "aviso de offline");
  });

  await test("parar é parar: o que o nó mandar DEPOIS do stop não entra na conversa", async () => {
    // Nó de mentira: é a única forma de simular o nó que demora a obedecer. Com o nó de
    // verdade o abort corta o fluxo na hora — e aí este caminho nunca seria exercitado.
    const no = new WebSocket(`ws://127.0.0.1:${HUB_PORT}/ws/node`);
    await new Promise<void>((ok, erro) => { no.on("open", () => ok()); no.on("error", erro); });
    no.send(JSON.stringify({ type: "hello", protocol: 1, token: TOKEN, bot: { id: "fantasma", name: "Fantasma", role: "teste de parada" }, engine: "direct", provider: "mock", model: "mock", version: "teste" }));
    await ui.wait((e: Ev) => e.type === "bot.update" && e.bot.id === "fantasma", 5_000, "o nó de mentira conectar");

    const conversa = "dm:fantasma";
    const messageId = "b-fantasma-1";
    const evento = (event: unknown) => no.send(JSON.stringify({ type: "event", conversationId: conversa, event }));
    evento({ kind: "text.delta", messageId, text: "Comecei a responder. " });
    await ui.wait((e: Ev) => e.type === "speech.delta" && e.conversationId === conversa, 5_000, "a primeira frase");

    ui.send({ type: "stop", reason: "teste do nó teimoso" });
    await ui.wait((e: Ev) => e.type === "stop", 5_000, "o aviso de parada");
    ui.clear();

    // o nó ainda não parou e continua mandando: nada disto pode virar texto nem fala
    evento({ kind: "text.delta", messageId, text: "Isto aqui chegou tarde. " });
    evento({ kind: "tool.start", messageId, callId: "c1", tool: "run_command", input: { command: "echo tarde" } });
    evento({ kind: "text.done", messageId, text: "Comecei a responder. Isto aqui chegou tarde." });
    await sleep(400);
    assert(!ui.events.some((e: Ev) => e.type === "speech.delta" || e.type === "speech.done"), "falou depois do stop");
    assert(!ui.events.some((e: Ev) => e.type === "tool"), "ferramenta atrasada apareceu depois do stop");

    const msgs = await (await fetch(`http://127.0.0.1:${HUB_PORT}/api/conversations/${conversa}/messages`)).json();
    const texto = msgs.map((m: any) => m.text).join(" ");
    assert(!/chegou tarde/.test(texto), `o texto atrasado entrou na conversa: ${texto}`);
    assert(msgs.some((m: any) => m.meta?.interrompido), "a mensagem cortada não ficou marcada como interrompida");
    no.close();
  });

  console.log(`\n${passed} passaram, ${failures} falharam`);
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  for (const p of procs) p.kill();
  setTimeout(() => process.exit(), 500);
});
