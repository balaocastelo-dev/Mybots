// Continuacao automatica: promessa sem ferramenta, retry e persistencia.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parecePromessaSemFerramenta,
  pareceTarefaIncompleta,
  isErroRetriavelProvedor,
  comRetryProvedor,
  persistirTarefa,
  carregarTarefa,
  limparTarefa,
  montarAvisoContinuar,
  textoProgresso,
  textoConclusao,
  provedorFallback,
} from "../packages/node/src/continuarTarefa.ts";

let falhas = 0;
const jobs: Promise<void>[] = [];
function test(nome: string, fn: () => void | Promise<void>) {
  jobs.push((async () => {
    try { await fn(); console.log(`ok ${nome}`); }
    catch (e) { falhas++; console.log(`FAIL ${nome}\n    ${(e as Error).message}`); }
  })());
}

test("detecta promessa sem ferramenta (caso myfriend)", () => {
  assert.equal(parecePromessaSemFerramenta("Vou gerar a imagem agora mesmo."), true);
  assert.equal(parecePromessaSemFerramenta("Sim, estou processando a geracao da imagem na GPU 4090 agora."), true);
  assert.equal(parecePromessaSemFerramenta("Vou abrir o arquivo index.html no seu navegador padrao agora."), true);
  assert.equal(pareceTarefaIncompleta("Vou gerar a imagem agora mesmo.", "kd a imagem", 0), true);
  assert.equal(pareceTarefaIncompleta("Vou gerar a imagem agora mesmo.", "kd a imagem", 1), false);
});

test("nao forca continuar em entrega ou pergunta ao chefe", () => {
  assert.equal(parecePromessaSemFerramenta("Pronto. O jogo esta em jogo-carro-3d/index.html."), false);
  assert.equal(parecePromessaSemFerramenta("Concluido. Segue o PDF."), false);
  assert.equal(parecePromessaSemFerramenta("Quer que eu envie o PDF para o cliente agora?"), false);
  assert.equal(parecePromessaSemFerramenta("Oi, chefe! Tudo bem?"), false);
});

test("erro retriavel do 8token / rede", () => {
  assert.equal(isErroRetriavelProvedor(new Error("The AI service did not complete")), true);
  assert.equal(isErroRetriavelProvedor(new Error("429 rate limit")), true);
  assert.equal(isErroRetriavelProvedor(new Error("aborted")), false);
  assert.equal(isErroRetriavelProvedor(new Error("invalid api key")), false);
});

test("comRetryProvedor volta a tentar e depois sobe o erro", async () => {
  let n = 0;
  await assert.rejects(async () => {
    await comRetryProvedor(async () => {
      n++;
      throw new Error("did not complete — try again");
    }, { max: 3 });
  });
  assert.equal(n, 3);

  let m = 0;
  const ok = await comRetryProvedor(async () => {
    m++;
    if (m < 2) throw new Error("503 temporary");
    return "feito";
  }, { max: 3 });
  assert.equal(ok, "feito");
  assert.equal(m, 2);
});

test("persiste e retoma tarefa em andamento", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-tar-"));
  persistirTarefa(dir, {
    conversationId: "dm_myfriend",
    botId: "myfriend",
    objetivo: "gerar imagem na 4090",
    status: "em_andamento",
    continues: 2,
    ultimoTexto: "Vou gerar a imagem agora mesmo.",
    atualizadoEm: Date.now(),
  });
  const t = carregarTarefa(dir, "dm_myfriend");
  assert.ok(t);
  assert.equal(t!.botId, "myfriend");
  assert.equal(t!.continues, 2);
  limparTarefa(dir, "dm_myfriend");
  assert.equal(carregarTarefa(dir, "dm_myfriend"), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("textos de andamento e aviso", () => {
  const aviso = montarAvisoContinuar("Vou gerar a imagem agora mesmo.", 1, 6);
  assert.match(aviso, /CONTINUE AGORA/);
  assert.match(textoProgresso(1, 6, "Vou gerar"), /Andamento \(1\/6\)/);
  assert.match(textoConclusao(true), /Concluido/);
  assert.match(textoConclusao(false, "provedor caiu"), /Nao consegui terminar/);
});

test("provedorFallback respeita ordem e chaves", () => {
  assert.equal(provedorFallback({}).kind, "ollama");
  const z = provedorFallback({ ZAI_API_KEY: "z", MYBOTS_FALLBACK_ORDEM: "zai,ollama" });
  assert.equal(z?.kind, "zai");
  assert.ok(!JSON.stringify(z).includes("secret-should-not"));
});

void (async () => {
  await Promise.all(jobs);
  if (falhas) { console.log("\n" + falhas + " falha(s)"); process.exit(1); }
  console.log("\ncontinuarTarefa ok");
})();
