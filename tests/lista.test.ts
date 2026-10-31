import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparPorEmpresa } from "../packages/ui/src/lista.ts";

const empresas = [
  { id: "balao", nome: "Balão" },
  { id: "outra", nome: "Outra Casa" },
];

test("fixados ficam no topo e o resto se agrupa pela empresa", () => {
  const grupos = agruparPorEmpresa([
    { id: "bia", empresaId: "balao" },
    { id: "caio", empresaId: "balao", secao: "Vendas" },
    { id: "ana", empresaId: "outra", fixado: true },
    { id: "lia", empresaId: "outra" },
    { id: "medico" },
  ], empresas);
  assert.deepEqual(grupos.map((g) => g.titulo), ["Fixados", "Balão", "Balão · Vendas", "Outra Casa", "Sistema"]);
  assert.deepEqual(grupos[0].ids, ["ana"]);
  assert.deepEqual(grupos.find((g) => g.titulo === "Outra Casa")?.ids, ["lia"]);
  assert.deepEqual(grupos[1].ids, ["bia"]);
  assert.deepEqual(grupos.at(-1)?.ids, ["medico"]);
});
