// Roteamento, cache, prompt enxuto e o primeiro pedaço na tela.
import assert from "node:assert/strict";
import { devePublicar } from "../packages/hub/src/fluxo.ts";
import { splitThoughts } from "../packages/hub/src/thoughts.ts";
import { Aquecedor } from "../packages/node/src/aquecer.ts";
import { CacheResposta } from "../packages/node/src/cacheResposta.ts";
import { ehGerenteBot, enxugarPersona, numCtxDe, promptGerenteNoOllama } from "../packages/node/src/promptEnxuto.ts";
import { podeCachear, rotaRapida, tarefaSimples } from "../packages/node/src/roteamento.ts";

let falhas = 0;
const jobs: Promise<void>[] = [];
function test(nome: string, fn: () => void | Promise<void>) {
  jobs.push((async () => {
    try { await fn(); console.log(`✔ ${nome}`); }
    catch (e) { falhas++; console.log(`✖ ${nome}\n    ${(e as Error).message}`); }
  })());
}

test("tarefa simples não inclui efeito, ferramenta nem segredo", () => {
  const env = {} as NodeJS.ProcessEnv;
  assert.equal(tarefaSimples("bom dia", env), true);
  assert.equal(tarefaSimples("tudo bem por aí?", env), true);
  assert.equal(tarefaSimples("liste a pasta", env), false);
  assert.equal(tarefaSimples("rode o comando ls", env), false);
  assert.equal(tarefaSimples("qual a senha do wifi", env), false);
  assert.equal(tarefaSimples("não olhe o estoque agora, só diga oi", env), false);
  assert.equal(tarefaSimples("a".repeat(300), env), false);
  assert.equal(podeCachear("bom dia", "Oi!", false, env), true);
  assert.equal(podeCachear("bom dia", "a chave é abc", false, env), false);
  assert.equal(podeCachear("liste a pasta", "pronto", false, env), false);
  assert.equal(podeCachear("bom dia", "Oi!", true, env), false);
});

test("rota: Groq se houver chave, senão Z.ai, senão o provedor atual", () => {
  assert.equal(rotaRapida("ollama", "bom dia", false, {}), null);
  const groq = rotaRapida("ollama", "bom dia", false, { GROQ_API_KEY: "g", ZAI_API_KEY: "z" });
  assert.equal(groq?.kind, "groq");
  assert.equal(groq?.model, "qwen/qwen3.8-27b");
  assert.ok(!JSON.stringify(groq).includes("g") || groq?.apiKey === "g");
  const zai = rotaRapida("anthropic", "bom dia", false, { ZAI_API_KEY: "z", MYBOTS_ROTA_ORDEM: "zai,groq" });
  assert.equal(zai?.kind, "zai");
  assert.equal(rotaRapida("groq", "bom dia", false, { GROQ_API_KEY: "g" }), null);
  assert.equal(rotaRapida("ollama", "bom dia", true, { GROQ_API_KEY: "g" }), null);
  assert.equal(rotaRapida("ollama", "liste a pasta", false, { GROQ_API_KEY: "g" }), null);
  assert.equal(rotaRapida("ollama", "bom dia", false, { GROQ_API_KEY: "g", MYBOTS_ROTA_RAPIDA: "0" }), null);
  const base = rotaRapida("ollama", "bom dia", false, { GROQ_API_KEY: "g", MYBOTS_ROTA_GROQ_BASE: "http://127.0.0.1:9/v1", MYBOTS_ROTA_GROQ_MODEL: "bench-groq" });
  assert.equal(base?.baseURL, "http://127.0.0.1:9/v1");
  assert.equal(base?.model, "bench-groq");
});

test("cache: mesma frase, TTL, e nada com efeito", () => {
  const c = new CacheResposta(50, 2);
  const t0 = 1_000_000;
  c.guardar("ana", "Bom   dia", "Oi, chefe.", false, t0);
  assert.equal(c.ler("ana", "bom dia", t0 + 10), "Oi, chefe.");
  assert.equal(c.ler("bia", "bom dia", t0 + 10), null);
  assert.equal(c.ler("ana", "bom dia", t0 + 50), null);
  c.guardar("ana", "rode o comando", "não", false, t0);
  assert.equal(c.ler("ana", "rode o comando", t0 + 1), null);
  c.guardar("ana", "qual a senha", "não digo", false, t0);
  assert.equal(c.ler("ana", "qual a senha", t0 + 1), null);
});

test("num_ctx acompanha o texto e o prompt do gerente no Ollama cabe", () => {
  assert.equal(numCtxDe(["a".repeat(1000)]), 2048);
  assert.equal(numCtxDe(["a".repeat(20_000)]), 8192);
  assert.equal(ehGerenteBot({ name: "Ana", role: "Gerente Geral" }), true);
  assert.equal(ehGerenteBot({ name: "Ana", role: "Vendas" }), false);
  const enorme = "# Gerente\n\n" + "Parágrafo muito longo que não cabe numa linha curta e repete a porta 8787 sem acrescentar regra nova. ".repeat(80);
  const curto = promptGerenteNoOllama({ persona: enorme, nome: "Gerente Geral", id: "gerente-1", chefe: "o chefe", workspace: "/tmp/w" });
  assert.ok(curto.length < 2500, `prompt ficou com ${curto.length}`);
  assert.ok(curto.includes("8787"));
  assert.ok(enxugarPersona(enorme).length < enorme.length);
  assert.equal(numCtxDe([curto]) <= 4096, true);
});

test("o primeiro pedaço sai antes dos 40 caracteres e o pensamento não", () => {
  assert.equal(devePublicar("", ""), false);
  assert.equal(devePublicar("Oi", ""), false);
  assert.equal(devePublicar("Oi, chefe", ""), true);
  assert.equal(devePublicar("Oi, chefe. Tudo", "Oi, chefe"), true);
  const raw = "The user asks me to think out loud. I should answer briefly. Let me respond now.Claro, pensei em silêncio e aqui está a resposta.";
  let mostrado = "";
  let visivel = "";
  for (let i = 1; i <= raw.length; i++) {
    const { answer } = splitThoughts(raw.slice(0, i), { aoVivo: true });
    if (!devePublicar(answer, mostrado)) continue;
    visivel = answer.startsWith(mostrado) ? visivel + answer.slice(mostrado.length) : answer;
    mostrado = answer;
  }
  assert.ok(!/The user asks/.test(visivel), visivel);
  assert.ok(/pensei em silêncio/.test(visivel), visivel);
  assert.ok(mostrado.length < raw.length || mostrado.startsWith("Claro"), "a resposta não precisava do texto inteiro para começar");
});

test("aquecedor: chat aberto pede keep_alive, chat fechado esfria", async () => {
  const pings: boolean[] = [];
  const a = new Aquecedor(async (ativo) => { pings.push(ativo); }, 60_000);
  assert.equal(a.keepAlive(), undefined);
  a.definir("dm:ana", true);
  assert.equal(a.keepAlive(), "15m");
  a.definir("dm:ana", false);
  assert.equal(a.keepAlive(), undefined);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(pings, [true, false]);
});

void (async () => {
  await Promise.all(jobs);
  if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
  console.log("\nrapidez ok");
})();
