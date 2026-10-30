// ---------------------------------------------------------------------------
// Painel — as funções que o app de celular tem e o nosso não tinha:
// fixar / esconder / renomear bot na lista, seções, marcar como NÃO lido,
// ver com quais bots ele trocou mensagem num turno, e exportar um bot
// como modelo.
//
// Tudo aqui é de PAINEL: não muda como o bot pensa, só como ele aparece.
// Por isso as preferências ficam numa chave de `settings` (então o PC e o
// celular enxergam a mesma coisa) e não no localStorage de um navegador só.
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import type { Hub } from "./hub.js";

export type PrefDoBot = { fixado?: boolean; escondido?: boolean; secao?: string; apelido?: string };
type Prefs = Record<string, PrefDoBot>;

const CHAVE_PREFS = "painel.botprefs";
const CHAVE_SECOES = "painel.secoes";

export function registerPainel(app: FastifyInstance, hub: Hub) {
  const prefs = (): Prefs => hub.db.getSetting<Prefs>(CHAVE_PREFS) ?? {};
  const secoes = (): string[] => hub.db.getSetting<string[]>(CHAVE_SECOES) ?? [];

  app.get("/api/painel/prefs", async () => ({ bots: prefs(), secoes: secoes() }));

  app.post("/api/painel/prefs/:id", async (req) => {
    const id = (req.params as any).id as string;
    const patch = (req.body ?? {}) as PrefDoBot;
    const todas = prefs();
    const depois: PrefDoBot = { ...(todas[id] ?? {}), ...patch };
    // valor vazio volta ao padrão em vez de ficar guardado para sempre
    for (const k of Object.keys(depois) as Array<keyof PrefDoBot>) {
      const v = depois[k];
      if (v === "" || v === false || v == null) delete depois[k];
    }
    if (Object.keys(depois).length) todas[id] = depois; else delete todas[id];
    hub.db.setSetting(CHAVE_PREFS, todas);
    hub.db.audit(id, "painel.prefs", patch);
    return { ok: true, pref: depois };
  });

  app.post("/api/painel/secoes", async (req, reply) => {
    const nome = String((req.body as any)?.nome ?? "").trim().slice(0, 40);
    if (!nome) return reply.code(400).send({ error: "nome é obrigatório" });
    const lista = secoes();
    if (!lista.includes(nome)) lista.push(nome);
    hub.db.setSetting(CHAVE_SECOES, lista);
    return { ok: true, secoes: lista };
  });

  app.delete("/api/painel/secoes/:nome", async (req) => {
    const nome = decodeURIComponent((req.params as any).nome as string);
    hub.db.setSetting(CHAVE_SECOES, secoes().filter((s) => s !== nome));
    // bot que estava nela volta para a lista solta
    const todas = prefs();
    for (const id of Object.keys(todas)) if (todas[id].secao === nome) delete todas[id].secao;
    hub.db.setSetting(CHAVE_PREFS, todas);
    return { ok: true, secoes: secoes() };
  });

  // Marcar como NÃO lido: o contrário de /read, que já existia.
  app.post("/api/conversations/:id/unread", async (req) => {
    hub.db.marcarNaoLido((req.params as any).id as string);
    return { ok: true };
  });

  // Com quais bots ESTE bot falou no turno desta mensagem. É o que alimenta o
  // rodapé "Mensageou N bots" embaixo da resposta.
  app.get("/api/messages/:id/trocas", async (req) => {
    const id = (req.params as any).id as string;
    const m = hub.db.getMessage(id);
    if (!m || m.sender.kind !== "bot") return [];
    const janela = hub.db.janelaDoTurno(m.conversationId, id);
    if (!janela) return [];
    const bots = hub.db.listBots();
    return hub.db.trocasDoTurno(m.sender.id, janela.de, janela.ate).map((t) => ({
      ...t,
      nome: bots.find((b) => b.id === t.outro)?.name ?? t.outro,
    }));
  });

  // A mesma coisa, de uma vez só, para a conversa inteira: messageId -> trocas.
  // Uma requisição em vez de uma por bolha.
  app.get("/api/conversations/:id/trocas", async (req) => {
    const id = (req.params as any).id as string;
    const bots = hub.db.listBots();
    const msgs = hub.db.getMessages(id, 400).filter((m) => m.sender.kind === "bot").slice(-60);
    const mapa: Record<string, Array<{ conversationId: string; outro: string; nome: string; quantas: number; ultima: number }>> = {};
    for (const m of msgs) {
      const janela = hub.db.janelaDoTurno(id, m.id);
      if (!janela) continue;
      const t = hub.db.trocasDoTurno(m.sender.id, janela.de, janela.ate)
        .map((x) => ({ ...x, nome: bots.find((b) => b.id === x.outro)?.name ?? x.outro }));
      if (t.length) mapa[m.id] = t;
    }
    return mapa;
  });

  // Exportar um bot como modelo para outra máquina.
  // NUNCA leva chave, token nem senha (regra 4 da casa).
  app.get("/api/bots/:id/modelo", async (req, reply) => {
    const id = (req.params as any).id as string;
    const bot = hub.db.listBots().find((b) => b.id === id) as any;
    if (!bot) return reply.code(404).send({ error: "bot não encontrado" });
    // Varre FUNDO: a chave costuma estar aninhada (env, provider, opcoes...) e um
    // modelo vai parar em outra maquina. Nenhum segredo sai daqui.
    const semSegredo = (v: unknown): unknown => Array.isArray(v) ? v.map(semSegredo) : (v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !/key|token|secret|senha|password|ticket|auth|cred/i.test(k)).map(([k, x]) => [k, semSegredo(x)])) : v);
    const def = semSegredo(hub.db.getManaged(id) ?? {}) as Record<string, unknown>;
    const limpo: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(def)) {
      if (/key|token|secret|senha|password|ticket/i.test(k)) continue;
      limpo[k] = v;
    }
    delete limpo.id;
    reply.header("content-disposition", `attachment; filename="${id}.modelo.json"`);
    return {
      formato: "mybots.modelo/1",
      nome: bot.name,
      papel: bot.role ?? "",
      provedor: bot.provider ?? null,
      modelo: bot.model ?? null,
      voz: bot.voice ?? null,
      definicao: limpo,
      exportadoEm: new Date().toISOString(),
    };
  });
}
