// A roleta de cotas: conferir que ela não estoura limite, não desperdiça a cota que
// expira hoje, e que SEMPRE sobra o piso local em vez de ficar sem resposta.
import assert from "node:assert";
import { PROVEDORES, usoZerado, virar, registrar, cabe, escolher, type Uso } from "../packages/shared/src/cotas.ts";

let n = 0;
const t = (nome: string, f: () => void) => { f(); n++; console.log("  ok " + nome); };
const AGORA = Date.parse("2026-10-30T15:00:00Z");
const todas = Object.fromEntries(PROVEDORES.map((p) => [p.id, true]));
const usos = (p: Partial<Record<string, Uso>> = {}): Record<string, Uso> =>
  Object.fromEntries(PROVEDORES.map((x) => [x.id, p[x.id] ?? usoZerado(AGORA)]));

console.log("roleta de cotas");

t("o dia vira e a cota do dia zera", () => {
  const u = registrar(usoZerado(AGORA), 500, AGORA);
  assert.equal(u.reqDia, 1);
  const amanha = virar(u, AGORA + 26 * 3600_000);
  assert.equal(amanha.reqDia, 0, "cota do dia devia ter zerado");
  assert.equal(amanha.tokensMes, 500, "a do mês NÃO devia zerar no outro dia");
});

t("o minuto vira sozinho", () => {
  let u = usoZerado(AGORA);
  for (let i = 0; i < 30; i++) u = registrar(u, 0, AGORA);
  const groq = PROVEDORES.find((p) => p.id === "groq")!;
  assert.equal(cabe(groq, u, 0, AGORA).cabe, false, "30 por minuto é o teto do Groq");
  assert.equal(cabe(groq, u, 0, AGORA + 61_000).cabe, true, "um minuto depois tem de caber");
});

t("não estoura a cota de tokens do mês", () => {
  const mistral = PROVEDORES.find((p) => p.id === "mistral")!;
  const u = { ...usoZerado(AGORA), tokensMes: 999_999_000 };
  assert.equal(cabe(mistral, u, 2000, AGORA).cabe, false);
  assert.equal(cabe(mistral, u, 500, AGORA).cabe, true);
});

t("tarefa curta vai para o mais rápido", () => {
  const e = escolher("curta", usos(), { chaves: todas, consentidos: todas, agora: AGORA });
  assert.ok(["groq", "cerebras"].includes(e.provedor.id), "esperava Groq ou Cerebras, veio " + e.provedor.id);
  assert.equal(e.provedor.latencia, 1);
});

t("documento grande vai para quem tem contexto", () => {
  const e = escolher("contexto", usos(), { chaves: todas, consentidos: todas, contextoK: 400, agora: AGORA });
  assert.equal(e.provedor.id, "gemini");
});

t("quem não comporta o contexto é recusado com o motivo escrito", () => {
  const e = escolher("volume", usos(), { chaves: todas, consentidos: todas, contextoK: 64, agora: AGORA });
  assert.notEqual(e.provedor.id, "cerebras", "Cerebras só tem 8K no grátis");
  assert.ok(e.recusados.some((r) => r.includes("Cerebras") && r.includes("8K")));
});

t("Mistral fica de fora enquanto o dono não aceitar os termos", () => {
  const e = escolher("volume", usos(), { chaves: todas, consentidos: {}, agora: AGORA });
  assert.notEqual(e.provedor.id, "mistral");
  assert.ok(e.recusados.some((r) => r.includes("Mistral") && r.includes("termos")));
});

t("gasta primeiro a cota que expira hoje, depois a do mês", () => {
  const e = escolher("volume", usos(), { chaves: { cerebras: true, mistral: true }, consentidos: todas, agora: AGORA });
  assert.equal(e.provedor.id, "cerebras", "a do dia vira pó à meia-noite; a do mês é poupança");
});

t("cota cheia manda para o próximo, não para o erro", () => {
  const cheio = { ...usoZerado(AGORA), reqDia: 1000, reqMin: 30 };
  const e = escolher("curta", usos({ groq: cheio }), { chaves: { groq: true, gemini: true }, agora: AGORA });
  assert.equal(e.provedor.id, "gemini");
  assert.ok(e.recusados.some((r) => r.includes("Groq")));
});

t("sem nuvem nenhuma, cai no piso local em vez de ficar mudo", () => {
  const e = escolher("agente", usos(), { chaves: {}, agora: AGORA });
  assert.equal(e.provedor.id, "ollama");
  assert.equal(e.provedor.local, true);
  assert.ok(e.motivo.includes("desta máquina"));
});

t("o local é o último recurso, nunca o primeiro", () => {
  const e = escolher("agente", usos(), { chaves: todas, consentidos: todas, agora: AGORA });
  assert.notEqual(e.provedor.id, "ollama");
});

t("toda cota cheia E sem local seria erro de catálogo, não silêncio", () => {
  assert.ok(PROVEDORES.some((p) => p.local), "o catálogo TEM de ter um piso local");
});

t("pedido grande demais nao e mandado para quem nao pode receber (ITPM)", () => {
  // Caso real de 30/10/2026: Groq devolveu 413 com "Limit 7000, Requested 12497".
  // Nao e cota esgotada — e o pedido nao caber no minuto daquele provedor.
  const groq = PROVEDORES.find((p) => p.id === "groq")!;
  assert.equal(cabe(groq, usoZerado(AGORA), 12497, AGORA).cabe, false, "12.497 nao cabe nos 7.000 por minuto da Groq");
  assert.ok(cabe(groq, usoZerado(AGORA), 12497, AGORA).motivo.includes("grande demais"));
  assert.equal(cabe(groq, usoZerado(AGORA), 3000, AGORA).cabe, true, "3.000 cabe");
  // e a roleta desvia sozinha para quem aguenta, em vez de tomar o erro
  const e = escolher("contexto", usos(), { chaves: { groq: true, gemini: true }, tokens: 12497, agora: AGORA });
  assert.equal(e.provedor.id, "gemini", "pedido grande tem de ir para quem tem fôlego, veio " + e.provedor.id);
  assert.ok(e.recusados.some((r) => r.includes("Groq")));
});

console.log(`\n${n} testes da roleta passando`);
