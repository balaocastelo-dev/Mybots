import { test } from "node:test";
import assert from "node:assert/strict";
import { pairConversation } from "@mybots/shared";
import {
  aplicarEvento,
  colunaDe,
  fundirTarefa,
  marcarCancelada,
  normalizarMensagens,
  normalizarTarefas,
  podeCancelar,
  simularAndamento,
  tarefasDaEmpresa,
  tarefasDoBot,
  tarefasNaColuna,
} from "../packages/ui/src/colab/normalizar.ts";
import { amostra } from "../packages/ui/src/colab/amostra.ts";
import type { PacoteColab, Tarefa } from "../packages/ui/src/colab/tipos.ts";

const base: Tarefa = {
  id: "t1", de: "gerente", para: "pixel", objetivo: "Cortar o vídeo", status: "queued",
  progresso: 0, historico: [{ em: 1, status: "queued", texto: "Na fila" }],
  criadaEm: 1, atualizadaEm: 1, empresaId: "balao",
};

function pacote(tarefas: Tarefa[]): PacoteColab {
  return { fonte: "api", aviso: "", tarefas, conversas: [], mensagens: [], salas: [], auditoria: [], ajudando: {} };
}

test("normaliza a lista do GET /api/colab/tarefas e o prazo em ISO", () => {
  const lista = normalizarTarefas({
    tarefas: [{
      id: "abc", de: "gerente", para: "ana", objetivo: "Estoque", status: "running",
      prazo: "2026-11-02T18:00:00-03:00", progresso: 150,
    }],
  });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].progresso, 100);
  assert.equal(lista[0].prazo, Date.parse("2026-11-02T18:00:00-03:00"));
  assert.equal(lista[0].historico[0].status, "running");
});

test("o envelope do Hub (type colab + tipo) move o cartão igual ao evento solto", () => {
  const antes = pacote([base]);
  const depois = aplicarEvento(antes, {
    type: "colab", tipo: "colab.tarefa", id: "t1", de: "gerente", para: "pixel", status: "waiting", progresso: 48,
  }, 20);
  assert.equal(depois.tarefas[0].status, "waiting");
  assert.equal(colunaDe(depois.tarefas[0].status), "waiting");
});

test("mensagem do contrato usa autor, nome e criadaEm", () => {
  const msgs = normalizarMensagens([{
    id: "m1", autor: "gerente", nome: "Gerente Geral", texto: "segue", prioridade: true, criadaEm: 1710000000000,
  }], "pair:gerente:pixel");
  assert.equal(msgs[0].de, "gerente");
  assert.equal(msgs[0].nomeDe, "Gerente Geral");
  assert.equal(msgs[0].em, 1710000000000);
  assert.equal(msgs[0].prioridade, true);
});

test("colab.tarefa move o cartão de coluna e guarda o histórico", () => {
  const antes = pacote([base]);
  assert.equal(colunaDe(antes.tarefas[0].status), "queued");
  const depois = aplicarEvento(antes, {
    type: "colab.tarefa", id: "t1", de: "gerente", para: "pixel", status: "running", progresso: 62,
  }, 50);
  assert.equal(depois.tarefas[0].status, "running");
  assert.equal(depois.tarefas[0].progresso, 62);
  assert.equal(colunaDe(depois.tarefas[0].status), "running");
  assert.equal(depois.tarefas[0].historico.at(-1)?.texto, "Fazendo");
  const pronto = aplicarEvento(depois, {
    type: "colab.tarefa", id: "t1", status: "done", resultado: { resumo: "corte entregue", arquivos: ["loja.mp4"] },
  }, 80);
  assert.equal(colunaDe(pronto.tarefas[0].status), "feito");
  assert.equal(pronto.tarefas[0].progresso, 100);
  assert.equal(pronto.tarefas[0].resultado?.resumo, "corte entregue");
  assert.equal(tarefasNaColuna(pronto.tarefas, "feito").length, 1);
});

test("failed e cancelled ficam na coluna Pronto / Falhou, e dá para cancelar", () => {
  const p = marcarCancelada(pacote([{ ...base, status: "running", progresso: 10 }]), "t1", 9);
  assert.equal(p.tarefas[0].status, "cancelled");
  assert.equal(podeCancelar(p.tarefas[0]), false);
  assert.equal(tarefasNaColuna(p.tarefas, "feito")[0].id, "t1");
  const falha = fundirTarefa(base, { id: "t1", status: "failed", resultado: { motivo: "arquivo grande" } }, 3);
  assert.equal(falha && colunaDe(falha.status), "feito");
});

test("colab.ajudando liga e desliga o indicador", () => {
  const p = aplicarEvento(pacote([]), { type: "colab.ajudando", bot: "pixel", ajudando: "heitor", tarefaId: "t-foto" });
  assert.deepEqual(p.ajudando.pixel, { ajudando: "heitor", tarefaId: "t-foto" });
  const limpo = aplicarEvento(p, { type: "colab.ajudando", bot: "pixel", ajudando: null, tarefaId: null });
  assert.equal(limpo.ajudando.pixel, undefined);
});

test("colab.mensagem cria a conversa pair e colab.bloqueio entra na auditoria", () => {
  let p = pacote([]);
  p = aplicarEvento(p, { type: "colab.mensagem", id: "m", de: "pixel", para: "heitor", prioridade: true }, 10);
  assert.equal(p.conversas[0].id, pairConversation("pixel", "heitor"));
  assert.equal(p.conversas[0].quantas, 1);
  p = aplicarEvento(p, { type: "colab.bloqueio", motivo: "taxa", de: "pixel", para: "ana" }, 11);
  assert.equal(p.auditoria[0].motivo, "taxa");
});

test("colab.parar cancela as tarefas ativas do alvo", () => {
  const p = aplicarEvento(pacote([
    base,
    { ...base, id: "t2", para: "ana", status: "running" },
    { ...base, id: "t3", status: "done", progresso: 100 },
  ]), { type: "colab.parar", alvo: ["pixel"], por: "humano" }, 4);
  assert.equal(p.tarefas.find((t) => t.id === "t1")?.status, "cancelled");
  assert.equal(p.tarefas.find((t) => t.id === "t2")?.status, "running");
  assert.equal(p.tarefas.find((t) => t.id === "t3")?.status, "done");
});

test("quadro filtra por bot e por empresa; simular tira da fila", () => {
  const a = amostra();
  assert.equal(tarefasDoBot(a.tarefas, "pixel").length, 4);
  assert.ok(tarefasDoBot(a.tarefas, "pixel").some((t) => t.status === "queued"));
  assert.ok(tarefasDoBot(a.tarefas, "pixel").some((t) => t.status === "running"));
  assert.ok(tarefasDoBot(a.tarefas, "pixel").some((t) => t.status === "waiting"));
  assert.ok(tarefasDoBot(a.tarefas, "pixel").some((t) => t.status === "done"));
  const soBalao = tarefasDaEmpresa(a.tarefas, [{ id: "pixel", empresaId: "balao" }], "balao");
  assert.equal(soBalao.length, a.tarefas.length);
  assert.equal(tarefasDaEmpresa(a.tarefas, [{ id: "pixel", empresaId: "balao" }], "outra").length, 0);
  const andou = simularAndamento(a, 99);
  assert.equal(andou.tarefas.find((t) => t.id === "t-vitrine")?.status, "running");
  assert.equal(tarefasNaColuna(andou.tarefas, "queued").some((t) => t.id === "t-vitrine"), false);
});
