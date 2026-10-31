// Modelo de mentira para testes: fala as três APIs (OpenAI-compatível, Anthropic, Gemini)
// e segue um roteiro simples a partir da última mensagem do usuário.
// Serve para testar o MyBots inteiro sem gastar chave nem depender de internet.
import http from "node:http";

type Call = { name: string; args: Record<string, unknown> };
type Decision = { text?: string; calls?: Call[] };

function botName(system: string): string {
  const m = system.match(/Você é o Bot "([^"]+)"/);
  return m?.[1] ?? "Bot";
}

/** Roteiro: decide o que responder a partir do texto do usuário ou do resultado de ferramenta. */
export function decide(system: string, lastUser: string | null, lastToolResults: Array<{ name: string; content: string }> | null, calledBefore: string[]): Decision {
  const me = botName(system);
  if (lastToolResults?.length) {
    const r = lastToolResults[0];
    if (r.name === "ask_bot") return { text: `${me}: o colega respondeu — ${r.content.slice(0, 200)}` };
    // eco longo de proposito: o teste precisa ver o CONTEUDO que veio do Hub,
    // nao so o nome da ferramenta (foi assim que "[object Object]" passou batido)
    if (r.name === "search_knowledge") return { text: `${me}: a base diz — ${r.content.replace(/\s+/g, " ").slice(0, 700)}` };
    if (r.name === "ask_user") return { text: `${me}: você escolheu "${r.content}". Seguindo assim.` };
    if (r.name === "send_file") return { text: `${me}: arquivo enviado. ${r.content.slice(0, 120)}` };
    if (r.name === "schedule") return { text: `${me}: rotina criada. ${r.content.slice(0, 120)}` };
    if (r.name === "run_command") return { text: /negou|rejected|denied/i.test(r.content) ? `${me}: ok, o comando foi negado; não vou rodar.` : `${me}: comando executado. Saída: ${r.content.replace(/\s+/g, " ").slice(0, 120)}` };
    return { text: `${me}: resultado de ${r.name}: ${r.content.replace(/\s+/g, " ").slice(0, 160)}` };
  }
  const u = (lastUser ?? "").toLowerCase();
  if (u.startsWith("[mensagem do bot")) return { text: `${me} responde ao colega: estoque ok, 42 unidades.` };
  if (u.includes("liste a pasta")) return { text: "Vou olhar a pasta.", calls: [{ name: "list_dir", args: { path: "." } }] };
  if (u.includes("rode o comando")) return { calls: [{ name: "run_command", args: { command: "mkdir -p pasta-teste && echo ola-mybots", why: "teste de comando" } }] };
  // automode: comando médio (cria pasta) e comando destrutivo (apaga arquivo) para testar os níveis
  if (u.includes("comando medio")) return { calls: [{ name: "run_command", args: { command: "mkdir -p pasta-media && echo medio-ok", why: "teste de comando médio" } }] };
  if (u.includes("comando perigoso")) return { calls: [{ name: "run_command", args: { command: "touch lixo.txt && rm -f lixo.txt && echo perigoso-ok", why: "teste de comando destrutivo" } }] };
  if (u.includes("mate a 8787")) return { calls: [{ name: "run_command", args: { command: "kill $(lsof -t -i:8787)", why: "teste de porta proibida" } }] };
  if (u.includes("busque na base")) return { calls: [{ name: "search_knowledge", args: { query: "tela notebook bancada" } }] };
  if (u.includes("me pergunte")) return { calls: [{ name: "ask_user", args: { question: "Posso continuar?", options: ["Sim", "Não"] } }] };
  const m = u.match(/consulte o bot ([a-z0-9-]+) sobre (.+)/);
  if (m) return { calls: [{ name: "ask_bot", args: { bot: m[1], question: `Como está ${m[2]}?` } }] };
  if (u.includes("mande o arquivo")) return { calls: [{ name: "send_file", args: { path: "arquivo-de-teste.txt", caption: "segue o arquivo de teste" } }] };
  if (u.includes("agende")) return { calls: [{ name: "schedule", args: { name: "Teste agendado", cron: "0 9 * * 1", prompt: "conferir o estoque" } }] };
  if (u.startsWith("[rotina")) return { text: `${me}: rotina executada — ${lastUser!.split("\n").slice(1).join(" ").slice(0, 80)}` };
  // resposta comprida e LENTA: serve para mandar parar no meio (teste do ⏹)
  if (u.includes("fale sem parar")) return { text: Array.from({ length: 40 }, (_, i) => `Frase número ${i + 1} desta resposta bem comprida.`).join(" ") };
  if (u.includes("fale varias frases")) return { text: "Claro, chefe. O SSD está em estoque. O preço é R$ 3058,00 à vista. Posso separar um agora mesmo?" };
  if (u.includes("pense alto")) return { text: `The user asks me to think out loud. I should answer briefly in Portuguese. Let me respond now.Claro, ${me} na área: pensei em silêncio e aqui está a resposta.` };
  if (u.includes("erro proposital")) return { text: "" };
  return { text: `Oi! Aqui é ${me}. Você disse: ${lastUser}` };
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}

let counter = 0;
export const requests: Array<{ api: string; body: any }> = [];
/** Modelos que receberam keep_alive e ainda não esfriaram. Só o benchmark usa. */
const quentes = new Set<string>();

/**
 * Atraso só para modelos `bench-*`. O teste e2e usa mock-1 e continua instantâneo.
 * O número imita o que muda de verdade: carga fria do Ollama, prefill de prompt
 * grande e janela num_ctx. Não é a latência de um provedor real.
 */
function perfilBench(body: any, system: string): { espera: number; gap: number } | null {
  const model = String(body.model ?? "");
  if (!model.startsWith("bench-")) return null;
  const tabela: Record<string, { ttft: number; gap: number; frio: number }> = {
    "bench-ollama": { ttft: 160, gap: 36, frio: 280 },
    "bench-groq": { ttft: 35, gap: 4, frio: 0 },
    "bench-zai": { ttft: 50, gap: 5, frio: 0 },
    "bench-anthropic": { ttft: 200, gap: 12, frio: 0 },
  };
  const p = tabela[model] ?? { ttft: 80, gap: 8, frio: 0 };
  let espera = p.ttft;
  if (model.includes("ollama")) {
    const pedidoQuente = !!(body.keep_alive && body.keep_alive !== 0 && String(body.keep_alive) !== "0");
    const jaCarregado = quentes.has(model);
    // A primeira carga paga mesmo com keep_alive no pedido. O que o keep_alive
    // (ou o ping de pré-carga) evita é pagar de novo na próxima.
    if (!jaCarregado) espera += p.frio;
    if (system.length > 6000) espera += 450;
    const ctx = Number(body.options?.num_ctx ?? 32768);
    espera = Math.round(espera * Math.min(1, 0.35 + ctx / 32768));
    if (pedidoQuente || jaCarregado) quentes.add(model);
  }
  return { espera, gap: p.gap };
}

export function startMockLlm(port: number): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "";
    const body = await readJson(req);
    const auth = req.headers.authorization ?? req.headers["x-api-key"] ?? "";
    const send = (obj: unknown, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    try {
      if (url.includes("/chat/completions")) {
        requests.push({ api: "openai", body });
        if (!String(auth).includes("Bearer")) return send({ error: { message: "sem Authorization" } }, 401);
        const sys = body.messages.find((m: any) => m.role === "system");
        const system = typeof sys?.content === "string" ? sys.content : (sys?.content ?? []).map((c: any) => c.text ?? "").join("");
        const last = body.messages[body.messages.length - 1];
        const opencodeMode = (body.tools ?? []).some((t: any) => t.function?.name === "mybots_ask_user");
        const toolResults = last.role === "tool" ? body.messages.filter((m: any) => m.role === "tool").slice(-countTrailingTools(body.messages)).map((m: any) => ({ name: fromOpenCodeName(nameForCall(body.messages, m.tool_call_id)), content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) })) : null;
        const lastUser = last.role === "user" ? (typeof last.content === "string" ? last.content : (last.content ?? []).map((c: any) => c.text ?? "").join("")) : null;
        const d = decide(system, lastUser, toolResults, []);
        const calls = (d.calls ?? []).map((c) => (opencodeMode ? toOpenCodeCall(c) : c));
        const toolCalls = calls.map((c) => ({ id: `call_${++counter}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }));
        if (body.stream) {
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
          const chunk = (delta: any, finish: string | null = null) => res.write(`data: ${JSON.stringify({ id: "chatcmpl-mock", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
          const atraso = perfilBench(body, system);
          chunk({ role: "assistant", content: "" });
          if (d.text) {
            const devagar = /fale sem parar/i.test(lastUser ?? "");
            const pedacos = d.text.match(/.{1,12}/g) ?? [];
            for (let i = 0; i < pedacos.length; i++) {
              if (res.writableEnded || res.destroyed) return;   // abortaram: o modelo de mentira também para
              if (atraso) await new Promise((r) => setTimeout(r, i === 0 ? atraso.espera : atraso.gap));
              else if (devagar) await new Promise((r) => setTimeout(r, 40));
              chunk({ content: pedacos[i] });
            }
          }
          if (toolCalls.length) chunk({ tool_calls: toolCalls.map((t, index) => ({ index, ...t })) });
          chunk({}, toolCalls.length ? "tool_calls" : "stop");
          res.write(`data: ${JSON.stringify({ id: "chatcmpl-mock", object: "chat.completion.chunk", model: body.model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`);
          res.write("data: [DONE]\n\n");
          return res.end();
        }
        const msg: any = { role: "assistant", content: d.text ?? null };
        if (toolCalls.length) msg.tool_calls = toolCalls;
        return send({ id: "chatcmpl-mock", object: "chat.completion", model: body.model, choices: [{ index: 0, message: msg, finish_reason: toolCalls.length ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      }
      if (url.includes("/v1/messages")) {
        requests.push({ api: "anthropic", body });
        if (!req.headers["x-api-key"]) return send({ type: "error", error: { message: "sem x-api-key" } }, 401);
        const last = body.messages[body.messages.length - 1];
        const blocks: any[] = Array.isArray(last.content) ? last.content : [{ type: "text", text: last.content }];
        const toolResults = blocks[0]?.type === "tool_result" ? blocks.map((b: any) => ({ name: nameForAnthropic(body.messages, b.tool_use_id), content: b.content })) : null;
        const lastUser = toolResults ? null : blocks.map((b: any) => b.text).join("");
        const sistema = Array.isArray(body.system) ? body.system.map((b: any) => b.text ?? "").join("\n") : (body.system ?? "");
        const d = decide(sistema, lastUser, toolResults, []);
        const content: any[] = [];
        if (d.text) content.push({ type: "text", text: d.text });
        for (const c of d.calls ?? []) content.push({ type: "tool_use", id: `toolu_${++counter}`, name: c.name, input: c.args });
        if (body.stream) {
          // fluxo igual ao da Anthropic de verdade: texto em pedacinhos, ferramenta em JSON picado
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
          const ev = (type: string, obj: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...obj })}\n\n`);
          ev("message_start", { message: { id: "msg_mock", role: "assistant", model: body.model, content: [], usage: { input_tokens: 10 } } });
          content.forEach((bloco, index) => {
            if (bloco.type === "text") {
              ev("content_block_start", { index, content_block: { type: "text", text: "" } });
              for (const piece of bloco.text.match(/.{1,12}/g) ?? []) ev("content_block_delta", { index, delta: { type: "text_delta", text: piece } });
            } else {
              ev("content_block_start", { index, content_block: { type: "tool_use", id: bloco.id, name: bloco.name, input: {} } });
              const json = JSON.stringify(bloco.input ?? {});
              for (const piece of json.match(/.{1,8}/g) ?? []) ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: piece } });
            }
            ev("content_block_stop", { index });
          });
          ev("message_delta", { delta: { stop_reason: d.calls ? "tool_use" : "end_turn" }, usage: { output_tokens: 5 } });
          ev("message_stop", {});
          return res.end();
        }
        return send({ id: "msg_mock", type: "message", role: "assistant", model: body.model, content, stop_reason: d.calls ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });
      }
      if (url.includes(":generateContent")) {
        requests.push({ api: "gemini", body });
        if (!url.includes("key=")) return send({ error: { message: "sem key" } }, 400);
        const system = body.systemInstruction?.parts?.map((p: any) => p.text).join("") ?? "";
        const last = body.contents[body.contents.length - 1];
        const fr = last.parts.filter((p: any) => p.functionResponse);
        const toolResults = fr.length ? fr.map((p: any) => ({ name: p.functionResponse.name, content: String(p.functionResponse.response?.result ?? "") })) : null;
        const lastUser = toolResults ? null : last.parts.map((p: any) => p.text ?? "").join("");
        const d = decide(system, lastUser, toolResults, []);
        const parts: any[] = [];
        if (d.text) parts.push({ text: d.text });
        for (const c of d.calls ?? []) parts.push({ functionCall: { name: c.name, args: c.args } });
        return send({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
      }
      if (url.endsWith("/models")) return send({ object: "list", data: [{ id: "mock-1" }] });
      // Pré-carga do Ollama (keep_alive). Não gera texto; só marca o modelo como quente.
      if (url.includes("/api/generate") || url.includes("/api/chat")) {
        if (body.keep_alive && body.keep_alive !== 0 && String(body.keep_alive) !== "0") quentes.add(String(body.model ?? ""));
        else if (body.keep_alive === 0 || String(body.keep_alive) === "0") quentes.delete(String(body.model ?? ""));
        return send({ done: true });
      }
      if (url.startsWith("/bench/last")) {
        const last = requests[requests.length - 1];
        const sys = last?.body?.messages?.find((m: any) => m.role === "system");
        const system = typeof sys?.content === "string" ? sys.content : "";
        return send({
          n: requests.length,
          model: last?.body?.model ?? null,
          systemChars: system.length,
          keepAlive: last?.body?.keep_alive ?? null,
          numCtx: last?.body?.options?.num_ctx ?? null,
        });
      }
      send({ error: `rota desconhecida ${url}` }, 404);
    } catch (e) {
      send({ error: (e as Error).message }, 500);
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

/** No OpenCode as ferramentas têm outros nomes: bash, e as da equipe com prefixo mybots_. */
function toOpenCodeCall(c: Call): Call {
  switch (c.name) {
    case "run_command": return { name: "bash", args: { command: c.args.command, description: c.args.why ?? "teste" } };
    case "list_dir": return { name: "bash", args: { command: "ls", description: "listar pasta" } };
    case "ask_user": return { name: "mybots_ask_user", args: c.args };
    case "ask_bot": return { name: "mybots_ask_bot", args: c.args };
    case "send_file": return { name: "mybots-local_send_file", args: c.args };
    case "schedule": return { name: "mybots_schedule", args: c.args };
    default: return c;
  }
}
function fromOpenCodeName(n: string) {
  if (n === "bash") return "run_command";
  return n.replace(/^mybots(-local)?_/, "");
}

function countTrailingTools(messages: any[]) { let n = 0; for (let i = messages.length - 1; i >= 0 && messages[i].role === "tool"; i--) n++; return n; }
function nameForCall(messages: any[], id: string) {
  for (const m of messages) for (const t of m.tool_calls ?? []) if (t.id === id) return t.function.name;
  return "?";
}
function nameForAnthropic(messages: any[], id: string) {
  for (const m of messages) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_use" && b.id === id) return b.name;
  return "?";
}

if (process.argv[1] && process.argv[1].endsWith("mock-llm.ts")) {
  const port = Number(process.env.PORT ?? 4990);
  startMockLlm(port).then(() => console.log(`mock-llm em http://127.0.0.1:${port}`));
}
