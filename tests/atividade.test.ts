import assert from "node:assert/strict";
import test from "node:test";
import { faseDoStatus } from "@mybots/shared";
import { confirmacaoCurta } from "../packages/node/src/confirma.ts";

test("fase: pensando é digitando, ferramenta é trabalhando, livre quando para", () => {
  assert.equal(faseDoStatus("Pensando", true), "digitando");
  assert.equal(faseDoStatus("Digitando", true), "digitando");
  assert.equal(faseDoStatus("Terminando a resposta", true), "digitando");
  assert.equal(faseDoStatus("Executando comando", true), "trabalhando");
  assert.equal(faseDoStatus("Disponível", false), "livre");
  assert.equal(faseDoStatus("Pensando", true, "trabalhando"), "trabalhando");
});

test("confirmação curta sai antes do trabalho longo", () => {
  assert.equal(confirmacaoCurta("me dá um retorno em PDF", ["write_file"]), "Vou montar o resumo em PDF agora.");
  assert.equal(confirmacaoCurta("abre a tela do computador", ["screenshot"]), "Vou abrir a tela do computador agora.");
  assert.equal(confirmacaoCurta("busque na base como trocar a tela", ["search_knowledge"]), "Vou cuidar disso agora.");
  assert.equal(confirmacaoCurta("rode o comando", ["run_command"]), "Vou fazer isso no computador agora.");
  assert.equal(confirmacaoCurta("pergunta ao colega", ["mybots_ask_bot"]), "Vou perguntar para o colega agora.");
});
