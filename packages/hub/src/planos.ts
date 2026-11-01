import { newId } from "@mybots/shared";
import type { Db } from "./db.js";
import type { FilaDeTarefas } from "./colab/fila.js";

export type StatusPasso = "pendente" | "em_andamento" | "esperando_ok" | "feito" | "cancelado";
export type StatusPlano = "ativo" | "esperando_ok" | "concluido" | "cancelado";

export type PlanoPasso = {
  id: string;
  planoId: string;
  ordem: number;
  titulo: string;
  status: StatusPasso;
  precisaDecisao: boolean;
  pergunta: string | null;
  opcoes: string[];
  resposta: string | null;
  atualizadoEm: number;
};

export type Plano = {
  id: string;
  botId: string;
  conversationId: string | null;
  objetivo: string;
  status: StatusPlano;
  tarefaId: string | null;
  passos: PlanoPasso[];
  criadoEm: number;
  atualizadoEm: number;
};

export type PedidoPasso = { titulo: string; precisaDecisao?: boolean };

function normPassos(raw: unknown): PedidoPasso[] {
  if (!Array.isArray(raw)) return [];
  const out: PedidoPasso[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const titulo = item.trim();
      if (titulo) out.push({ titulo });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const titulo = String(o.titulo ?? o.title ?? o.passo ?? "").trim();
      if (!titulo) continue;
      out.push({ titulo, precisaDecisao: !!(o.precisaDecisao ?? o.decisao ?? o.aguardar) });
    }
  }
  return out.slice(0, 20);
}

export class ServicoPlanos {
  constructor(
    private db: Db,
    private tarefas: FilaDeTarefas,
  ) {}

  criar(p: {
    botId: string;
    conversationId?: string | null;
    objetivo: string;
    passos: unknown;
  }): { ok: true; plano: Plano } | { ok: false; erro: string } {
    const objetivo = String(p.objetivo ?? "").trim();
    if (!objetivo) return { ok: false, erro: "objetivo e obrigatorio" };
    const pedidos = normPassos(p.passos);
    if (!pedidos.length) return { ok: false, erro: "informe pelo menos 1 passo" };

    const agora = Date.now();
    const id = newId("plano");
    const passos: PlanoPasso[] = pedidos.map((ped, i) => ({
      id: newId("passo"),
      planoId: id,
      ordem: i + 1,
      titulo: ped.titulo.slice(0, 500),
      status: "pendente" as StatusPasso,
      precisaDecisao: !!ped.precisaDecisao,
      pergunta: null,
      opcoes: [],
      resposta: null,
      atualizadoEm: agora,
    }));

    const lista = passos.map((x) => `${x.ordem}. ${x.titulo}${x.precisaDecisao ? " (precisa da sua OK)" : ""}`).join("\n");
    const criada = this.tarefas.criar({
      de: "humano",
      para: p.botId,
      objetivo: objetivo.slice(0, 2000),
      contexto: `[PLANO ${id}]\n${lista}\n[/PLANO]`,
      criterioSucesso: "Todos os passos concluidos e decisoes do chefe registradas.",
      prazo: null,
      formatoEntrega: "plano com passos no quadro",
      chamadorHumano: true,
    });
    if (!criada.ok) return { ok: false, erro: criada.erro };

    const plano: Plano = {
      id,
      botId: p.botId,
      conversationId: p.conversationId ?? null,
      objetivo: objetivo.slice(0, 2000),
      status: "ativo",
      tarefaId: criada.tarefa.id,
      passos,
      criadoEm: agora,
      atualizadoEm: agora,
    };
    this.db.inserirPlano(plano);
    for (const passo of passos) this.db.inserirPlanoPasso(passo);
    return { ok: true, plano: this.obter(id)! };
  }

  obter(id: string): Plano | null {
    const base = this.db.getPlano(id);
    if (!base) return null;
    return { ...base, passos: this.db.listarPlanoPassos(id) };
  }

  listar(botId: string): Plano[] {
    return this.db.listarPlanos(botId).map((p) => ({ ...p, passos: this.db.listarPlanoPassos(p.id) }));
  }

  porTarefa(tarefaId: string): Plano | null {
    const base = this.db.getPlanoPorTarefa(tarefaId);
    if (!base) return null;
    return { ...base, passos: this.db.listarPlanoPassos(base.id) };
  }

  atualizarPasso(p: {
    planoId: string;
    passoId?: string;
    ordem?: number;
    status: StatusPasso;
  }): { ok: true; plano: Plano } | { ok: false; erro: string } {
    const plano = this.obter(p.planoId);
    if (!plano) return { ok: false, erro: "plano nao encontrado" };
    if (plano.status === "cancelado" || plano.status === "concluido") {
      return { ok: false, erro: "plano ja encerrado" };
    }
    const passo = plano.passos.find((x) => x.id === p.passoId) ?? plano.passos.find((x) => x.ordem === p.ordem);
    if (!passo) return { ok: false, erro: "passo nao encontrado" };
    const agora = Date.now();
    passo.status = p.status;
    passo.atualizadoEm = agora;
    this.db.atualizarPlanoPasso(passo);
    return { ok: true, plano: this.sincronizar(plano.id) };
  }

  pedirDecisao(p: {
    planoId: string;
    passoId?: string;
    ordem?: number;
    pergunta: string;
    opcoes?: string[];
  }): { ok: true; plano: Plano; pergunta: string; opcoes: string[] } | { ok: false; erro: string } {
    const plano = this.obter(p.planoId);
    if (!plano) return { ok: false, erro: "plano nao encontrado" };
    const passo = plano.passos.find((x) => x.id === p.passoId) ?? plano.passos.find((x) => x.ordem === p.ordem)
      ?? plano.passos.find((x) => x.status === "em_andamento")
      ?? plano.passos.find((x) => x.status === "pendente");
    if (!passo) return { ok: false, erro: "passo nao encontrado" };
    const pergunta = String(p.pergunta ?? "").trim() || `Pode seguir no passo: ${passo.titulo}?`;
    const opcoes = (p.opcoes ?? []).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 6);
    const agora = Date.now();
    passo.status = "esperando_ok";
    passo.precisaDecisao = true;
    passo.pergunta = pergunta.slice(0, 1000);
    passo.opcoes = opcoes;
    passo.resposta = null;
    passo.atualizadoEm = agora;
    this.db.atualizarPlanoPasso(passo);
    this.db.atualizarPlanoStatus(plano.id, "esperando_ok", agora);
    if (plano.tarefaId) {
      const t = this.tarefas.obter(plano.tarefaId);
      if (t?.status === "running") this.tarefas.transicionar(plano.tarefaId, "waiting", {
        resumo: "Esperando decisao do chefe.",
        motivo: pergunta.slice(0, 200),
      });
      else if (t?.status === "queued") {
        // sobe pra running e ja cai em waiting
        this.tarefas.transicionar(plano.tarefaId, "running");
        this.tarefas.transicionar(plano.tarefaId, "waiting", {
          resumo: "Esperando decisao do chefe.",
          motivo: pergunta.slice(0, 200),
        });
      }
    }
    return { ok: true, plano: this.obter(plano.id)!, pergunta, opcoes };
  }

  decidir(p: {
    planoId?: string;
    tarefaId?: string;
    passoId?: string;
    resposta: string;
  }): { ok: true; plano: Plano } | { ok: false; erro: string } {
    const plano = p.planoId ? this.obter(p.planoId) : (p.tarefaId ? this.porTarefa(p.tarefaId) : null);
    if (!plano) return { ok: false, erro: "plano nao encontrado" };
    const passo = plano.passos.find((x) => x.id === p.passoId)
      ?? plano.passos.find((x) => x.status === "esperando_ok");
    if (!passo) return { ok: false, erro: "nenhum passo esperando OK" };
    const resposta = String(p.resposta ?? "").trim();
    if (!resposta) return { ok: false, erro: "resposta vazia" };
    const agora = Date.now();
    passo.resposta = resposta.slice(0, 2000);
    passo.status = "feito";
    passo.atualizadoEm = agora;
    this.db.atualizarPlanoPasso(passo);
    if (plano.tarefaId) {
      const t = this.tarefas.obter(plano.tarefaId);
      if (t?.status === "waiting") {
        this.tarefas.transicionar(plano.tarefaId, "running", {
          resumo: `Chefe decidiu: ${resposta.slice(0, 200)}`,
        });
      }
    }
    return { ok: true, plano: this.sincronizar(plano.id) };
  }

  private sincronizar(id: string): Plano {
    const plano = this.obter(id)!;
    const agora = Date.now();
    const abertos = plano.passos.filter((x) => x.status !== "feito" && x.status !== "cancelado");
    const esperando = plano.passos.some((x) => x.status === "esperando_ok");
    let status: StatusPlano = "ativo";
    if (!abertos.length) status = "concluido";
    else if (esperando) status = "esperando_ok";
    this.db.atualizarPlanoStatus(id, status, agora);
    if (status === "concluido" && plano.tarefaId) {
      const t = this.tarefas.obter(plano.tarefaId);
      if (t && (t.status === "running" || t.status === "waiting" || t.status === "queued")) {
        this.tarefas.transicionar(plano.tarefaId, "done", {
          resumo: "Plano concluido: " + plano.passos.map((x) => x.titulo).join("; "),
        });
      }
    }
    return this.obter(id)!;
  }
}
