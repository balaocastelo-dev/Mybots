// O diagnostico de queda tem de acertar O LUGAR do problema, nao so dizer que
// deu errado. A primeira versao anunciava JSON quebrado como "o codigo nao
// compila" e mandava mexer em packages/node — onde nao havia nada errado.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { motivoDaQueda } from "../packages/hub/src/diagnostico.js";

function comLog(conteudo: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-diag-"));
  fs.writeFileSync(path.join(dir, "node.log"), conteudo, "utf8");
  return dir;
}

test("config do bot quebrado nao e confundido com codigo quebrado", () => {
  const q = motivoDaQueda(comLog([
    "[node] MyBots no 0.1.0",
    "SyntaxError: Expected property name or '}' in JSON at position 2 (line 1 column 3)",
    "    at JSON.parse (<anonymous>)",
  ].join("\n")));
  assert.equal(q.classe, "config-invalido", `classificou como ${q.classe}`);
  assert.match(q.conserto, /mybots-node\.json/, "o conserto deve apontar o arquivo do bot");
  assert.doesNotMatch(q.conserto, /packages\/node/, "nao pode mandar mexer no codigo do projeto");
});

test("codigo que nao compila e reconhecido, com o arquivo no trecho", () => {
  const q = motivoDaQueda(comLog([
    "Error: Transform failed with 1 error:",
    "C:\\mybots\\packages\\node\\src\\engines\\direct.ts:135:6: ERROR: Expected \"]\" but found \"- CRIE ROTINA\"",
    "    at failureErrorWithLog (...)",
  ].join("\n")));
  assert.equal(q.classe, "nao-compila", `classificou como ${q.classe}`);
  assert.match(q.trecho, /direct\.ts:135/, "o trecho deve trazer o arquivo e a linha");
  assert.match(q.conserto, /npm test/, "o conserto deve lembrar de rodar os testes");
});

test("falta de pacote e chave recusada tem cada uma o seu conserto", () => {
  const mod = motivoDaQueda(comLog("Error: Cannot find module 'ws'"));
  assert.equal(mod.classe, "falta-modulo");
  assert.match(mod.conserto, /npm install/);

  const chave = motivoDaQueda(comLog("authentication_error: invalid x-api-key (401)"));
  assert.equal(chave.classe, "chave-recusada");
  // o conserto NUNCA pode pedir para imprimir o valor da chave
  assert.match(chave.conserto, /n\u00e3o imprima|nao imprima/i);
});

test("motivo desconhecido entrega as linhas uteis, sem a pilha do Node", () => {
  const q = motivoDaQueda(comLog([
    "[node] subindo",
    "Algo muito estranho aconteceu aqui",
    "    at Object.<anonymous> (/x/y.js:1:1)",
    "    at Module._compile (node:internal/modules/cjs/loader:1234:14)",
  ].join("\n")));
  assert.equal(q.classe, "desconhecido");
  assert.match(q.trecho, /muito estranho/);
  assert.doesNotMatch(q.trecho, /at Module\._compile/, "a pilha do Node so atrapalha quem vai ler");
});

test("sem log nenhum, diz isso em vez de inventar causa", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-diag-vazio-"));
  const q = motivoDaQueda(dir);
  assert.equal(q.classe, "sem-log");
});
