// Mensagens entre bots, parar, permissões e auditoria.
// Tarefa e sala não moram aqui: ver docs/colaboracao.md.
import type { ColabEvento, HubToNode, HubToUi, Sender, StoredMessage } from "@mybots/shared";
import { pairConversation } from "@mybots/shared";
import type { Db } from "../db.js";
import { checarColab, ligarSeguranca, registrarAuditoria } from "./seguranca.js";
import { notificarParada } from "./parar.js";

const CHAVE_PERMISSAO = "colab.permissoes.empresa";

export type PermissaoEmpresa = { de: string; para: string; liberado: boolean };

export type PortaColab = {
  db: Db;
  empresaId(botId: string): string | null;
  entregarNo(botId: string, msg: HubToNode): boolean;
  online(botId: string): boolean;
  storeMessage(conversationId: string, sender: Sender, text: string, meta?: Record<string, unknown>): StoredMessage;
  emitirUi(msg: HubToUi): void;
  pararBot(botId: string, motivo?: string): void;
  idsDosBots(): string[];
  botSender(botId: string): Sender;
  acharBot(de: string, para: string): { id: string } | { erro: string };
};

export type PedidoMensagem = {
  de: string;
  para: string;
  texto: string;
  prioridade: boolean;
  profundidade: number;
  contexto?: string;
};

export type ResultadoMensagem =
  | { ok: true; id: string; aviso: string }
  | { ok: false; erro: string; motivo?: "profundidade" | "taxa" | "empresa" | "aprovacao" };

export class ServicoColab {
  private autor = new Map<string, string>();

  constructor(private porta: PortaColab) {
    ligarSeguranca({
      empresaDe: (id) => this.porta.empresaId(id),
      liberado: (a, b) => this.empresasLiberadas(a, b),
      gravar: (e) => {
        const detalhe = {
          ...(e.para ? { para: e.para } : {}),
          ...(e.detalhe && typeof e.detalhe === "object" ? e.detalhe as Record<string, unknown> : e.detalhe !== undefined ? { detalhe: e.detalhe } : {}),
        };
        this.porta.db.audit(e.de ?? null, e.acao, Object.keys(detalhe).length ? detalhe : undefined);
      },
    });
  }

  anotarAutor(botId: string, autor: string) {
    this.autor.set(botId, autor);
  }

  autorDe(botId: string): string {
    return this.autor.get(botId) ?? "";
  }

  emitir(evento: ColabEvento) {
    this.porta.emitirUi({ type: "colab", ...evento });
  }

  permissoes(): PermissaoEmpresa[] {
    return this.porta.db.getSetting<PermissaoEmpresa[]>(CHAVE_PERMISSAO) ?? [];
  }

  definirPermissao(de: string, para: string, liberado: boolean): PermissaoEmpresa | { erro: string } {
    const a = de.trim();
    const b = para.trim();
    if (!a || !b || a === b) return { erro: "Informe duas empresas diferentes." };
    const [x, y] = [a, b].sort();
    const item: PermissaoEmpresa = { de: x, para: y, liberado: !!liberado };
    const outras = this.permissoes().filter((p) => !(p.de === x && p.para === y));
    this.porta.db.setSetting(CHAVE_PERMISSAO, [...outras, item]);
    registrarAuditoria({ acao: "colab.permissao", de: x, para: y, detalhe: { liberado: item.liberado } });
    return item;
  }

  empresasLiberadas(a: string, b: string): boolean {
    const [x, y] = [a, b].sort();
    return this.permissoes().some((p) => p.de === x && p.para === y && p.liberado);
  }

  enviar(p: PedidoMensagem): ResultadoMensagem {
    const achado = this.porta.acharBot(p.de, p.para);
    if ("erro" in achado) return { ok: false, erro: achado.erro };
    const alvo = achado.id;
    const cheque = checarColab({
      de: p.de, para: alvo, tipo: "mensagem",
      profundidade: p.profundidade,
    });
    if (!cheque.ok) {
      this.emitir({ tipo: "colab.bloqueio", motivo: cheque.motivo, de: p.de, para: alvo });
      return { ok: false, motivo: cheque.motivo, erro: textoDoMotivo(cheque.motivo, alvo) };
    }

    const conversa = pairConversation(p.de, alvo);
    const autor = p.de === "humano" ? "humano" : p.de;
    const sender: Sender = p.de === "humano"
      ? { kind: "user", id: "humano", name: "humano" }
      : this.porta.botSender(p.de);
    const texto = p.contexto?.trim() ? `${p.texto}\n\n[contexto do pedido]\n${p.contexto.trim()}` : p.texto;
    const online = alvo !== "humano" && this.porta.online(alvo);
    const stored = this.porta.storeMessage(conversa, sender, texto, {
      colab: true, autor, de: p.de, para: alvo, prioridade: p.prioridade,
      contexto: p.contexto?.trim() || null, pendente: alvo !== "humano" && !online,
    });
    if (online && !this.entregar(alvo, stored, p.prioridade, autor)) {
      this.porta.db.updateMessageMeta(stored.id, { ...(stored.meta ?? {}), pendente: true });
    }
    registrarAuditoria({
      acao: "colab.mensagem", de: p.de, para: alvo,
      detalhe: { id: stored.id, prioridade: p.prioridade, profundidade: p.profundidade, online },
    });
    this.emitir({ tipo: "colab.mensagem", id: stored.id, de: p.de, para: alvo, prioridade: p.prioridade });
    const nome = alvo === "humano" ? "humano" : this.porta.botSender(alvo).name;
    const aviso = !p.prioridade
      ? `Recado guardado para ${nome}. Entra no próximo turno, como mensagem de outro bot.`
      : online
        ? `Mensagem entregue a ${nome}, que foi acordado.`
        : `${nome} está offline. A mensagem fica salva e o acorda quando o PC conectar.`;
    return { ok: true, id: stored.id, aviso };
  }

  /** O que ficou pendente enquanto o bot estava fora volta agora. */
  reidratar(botId: string) {
    for (const m of this.porta.db.mensagensColabPendentes(botId)) {
      const meta = m.meta ?? {};
      const prioridade = meta.prioridade === true;
      const de = String(meta.autor ?? meta.de ?? m.sender.id);
      if (this.entregar(botId, m, prioridade, de)) {
        this.porta.db.updateMessageMeta(m.id, { ...meta, pendente: false });
      }
    }
  }

  conversas(bot?: string) {
    const filtro = bot?.trim();
    return this.porta.db.listConversations()
      .filter((c) => c.id.startsWith("pair:"))
      .filter((c) => !filtro || c.id.slice("pair:".length).split(":").includes(filtro))
      .map((c) => ({
        id: c.id,
        bots: c.id.slice("pair:".length).split(":"),
        ultimaEm: c.last?.createdAt ?? 0,
      }));
  }

  mensagens(conversationId: string) {
    if (!conversationId.startsWith("pair:")) return null;
    return this.porta.db.getMessages(conversationId, 200).map((m) => ({
      id: m.id,
      autor: autorDa(m),
      nome: m.sender.name,
      texto: m.text,
      prioridade: m.meta?.prioridade === true,
      contexto: typeof m.meta?.contexto === "string" ? m.meta.contexto : null,
      criadaEm: m.createdAt,
    }));
  }

  parar(de: string, alvo: "todos" | string[]): { ok: true; alvo: "todos" | string[] } | { ok: false; motivo: "aprovacao"; erro: string } {
    if (de !== "humano") {
      const quem = de || "bot";
      registrarAuditoria({ acao: "colab.bloqueio", de: quem, para: "parar", detalhe: { motivo: "aprovacao" } });
      this.emitir({ tipo: "colab.bloqueio", motivo: "aprovacao", de: quem, para: "parar" });
      return { ok: false, motivo: "aprovacao", erro: "Só o humano pode parar a equipe. Um bot não dispara isso." };
    }
    const ids = alvo === "todos" ? this.porta.idsDosBots() : [...new Set(alvo.map((x) => String(x).trim()).filter(Boolean))];
    registrarAuditoria({ acao: "colab.parar", de: "humano", detalhe: { alvo } });
    this.emitir({ tipo: "colab.parar", alvo, por: "humano" });
    notificarParada({ alvo, por: "humano" });
    for (const id of ids) {
      this.porta.entregarNo(id, { type: "colab.parar", alvo, por: "humano" });
      this.porta.pararBot(id, "colab.parar");
    }
    return { ok: true, alvo };
  }

  auditoria(filtro: { bot?: string; desde?: number }) {
    return this.porta.db.auditColab(filtro);
  }

  private entregar(botId: string, m: StoredMessage, prioridade: boolean, autor: string): boolean {
    const foi = this.porta.entregarNo(botId, {
      type: "message",
      conversationId: m.conversationId,
      messageId: m.id,
      from: m.sender,
      text: m.text,
      ...(prioridade ? {} : { silent: true, adiada: true }),
    });
    if (foi && prioridade) this.anotarAutor(botId, autor === "humano" ? "humano" : autor);
    return foi;
  }
}

function autorDa(m: StoredMessage): string {
  if (typeof m.meta?.autor === "string") return m.meta.autor;
  if (m.sender.kind === "bot") return m.sender.id;
  if (m.sender.kind === "user") return "humano";
  return m.sender.id;
}

function textoDoMotivo(motivo: "profundidade" | "taxa" | "empresa", alvo: string): string {
  if (motivo === "profundidade") return "Profundidade de delegação acima de 3. Não repasse de novo.";
  if (motivo === "taxa") return "Limite de mensagens entre bots nesta janela. Espere um pouco para não entrar em loop.";
  return `"${alvo}" é de outra empresa. Conversa entre empresas só com liberação explícita.`;
}
