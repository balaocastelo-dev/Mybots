import { Db } from "../packages/hub/src/db.ts";
import { FilaDeTarefas } from "../packages/hub/src/colab/fila.ts";
import { ServicoPlanos } from "../packages/hub/src/planos.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planos-"));
const dbPath = path.join(dir, "t.sqlite");
const db = new Db(dbPath);
const fila = new FilaDeTarefas(db, { online: () => false });
const planos = new ServicoPlanos(db, fila);

const c = planos.criar({
  botId: "salada",
  conversationId: "dm:salada",
  objetivo: "Abrir loja de notebooks",
  passos: [
    { titulo: "Pesquisar fornecedores", precisaDecisao: false },
    { titulo: "Escolher mix de produtos", precisaDecisao: true },
    { titulo: "Publicar anuncio", precisaDecisao: true },
  ],
});
if (!c.ok) throw new Error(c.erro);
const tarefaId = c.plano.tarefaId || "";
console.log("plano", c.plano.id, "tarefa", tarefaId, "passos", c.plano.passos.length);

const a = planos.atualizarPasso({ planoId: c.plano.id, ordem: 1, status: "em_andamento" });
if (!a.ok) throw new Error(a.erro);
const d = planos.pedirDecisao({ planoId: c.plano.id, ordem: 2, pergunta: "Fecha no mix A ou B?", opcoes: ["Mix A", "Mix B"] });
if (!d.ok) throw new Error(d.erro);
console.log("status apos pedir", d.plano.status, "tarefa", fila.obter(tarefaId)?.status);

const r = planos.decidir({ planoId: c.plano.id, resposta: "Mix A" });
if (!r.ok) throw new Error(r.erro);
console.log("apos decidir", r.plano.status, r.plano.passos.map(p => p.ordem + ":" + p.status + ":" + (p.resposta || "-")).join(" | "));
console.log("tarefa", fila.obter(tarefaId)?.status);
console.log("OK");
