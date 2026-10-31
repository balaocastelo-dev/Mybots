import { test } from "node:test";
import assert from "node:assert/strict";
import { ehGerente, montarLista } from "../packages/ui/src/lista.ts";

test("gerente pelo flag, pela equipe ou pelo nome", () => {
  assert.equal(ehGerente({ nome: "Ana" }), false);
  assert.equal(ehGerente({ nome: "Ana", gerente: true }), true);
  assert.equal(ehGerente({ nome: "Ana", manages: ["bia"] }), true);
  assert.equal(ehGerente({ nome: "Gerente Geral", role: "atendente" }), true);
  assert.equal(ehGerente({ nome: "Bia", role: "Gerente Geral da loja" }), true);
});

test("fixados saem da lista e o gerente fica no topo de cada empresa", () => {
  const empresas = [
    { id: "balao", nome: "Balão" },
    { id: "outra", nome: "Outra Casa" },
  ];
  const r = montarLista([
    { id: "heitor", nome: "Heitor", empresaId: "balao" },
    { id: "ana", nome: "Ana", empresaId: "balao", fixado: true },
    { id: "chefe", nome: "Gerente Geral", empresaId: "balao", role: "Gerente Geral" },
    { id: "lia", nome: "Lia", empresaId: "outra" },
    { id: "g2", nome: "Caio", empresaId: "outra", gerente: true },
    { id: "solto", nome: "Médico" },
  ], empresas);
  assert.deepEqual(r.fixados, ["ana"]);
  assert.deepEqual(r.grupos.map((g) => g.titulo), ["Balão", "Outra Casa", "Sistema"]);
  assert.deepEqual(r.grupos[0].ids, ["chefe", "heitor"]);
  assert.deepEqual(r.grupos[1].ids, ["g2", "lia"]);
  assert.equal(r.grupos[0].ids.includes("ana"), false);
});
