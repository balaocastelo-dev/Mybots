/**
 * Equipe inicial por conta.
 * O id segue o sufixo que os bots iniciais já usam: receita + "-" + os 8 primeiros
 * caracteres do id do usuário (sem o prefixo usr_), cortado em 40.
 * Empresa nova usa o id da empresa no mesmo lugar do sufixo.
 * O seed é idempotente: o que já existe não é reescrito, e cada receita só é
 * oferecida uma vez por conta (apagar depois não faz o bot voltar sozinho).
 */
import type Database from "better-sqlite3";
import { PADRAO_DA_CASA } from "./botManager.js";
import type { Receita } from "./receitas.js";

export const REGRA_DO_DONO =
  "Nada de enviar mensagem, comprar, postar ou apagar sem o dono pedir com as próprias palavras.";

export type AcaoSeed = "criar" | "ja_existe" | "ja_oferecido";

export type ItemSeed = { receita: string; botId: string; acao: AcaoSeed };

export function sufixoDaConta(userId: string): string {
  return String(userId || "").replace(/^usr_/, "").slice(0, 8);
}

/** Mesmo corte de `${receita}-${sufixo}` que a equipe inicial já grava. */
export function idBotInicial(receitaId: string, sufixo: string): string {
  return `${receitaId}-${sufixo}`.slice(0, 40).replace(/-$/, "");
}

export function decidirSeed(
  receitas: string[],
  sufixo: string,
  existentes: ReadonlySet<string>,
  oferecidas: ReadonlySet<string>,
): ItemSeed[] {
  return receitas.map((receita) => {
    const botId = idBotInicial(receita, sufixo);
    if (oferecidas.has(receita)) return { receita, botId, acao: "ja_oferecido" };
    if (existentes.has(botId)) return { receita, botId, acao: "ja_existe" };
    return { receita, botId, acao: "criar" };
  });
}

export async function aplicarSeed(opts: {
  receitas: string[];
  sufixo: string;
  existentes: Set<string>;
  oferecidas: Set<string>;
  criar: (receitaId: string, botId: string) => Promise<{ ok: boolean; detalhe?: string }>;
  marcar: (receitaId: string, botId: string) => void;
}): Promise<Array<{ receita: string; botId: string; status: string }>> {
  const plano = decidirSeed(opts.receitas, opts.sufixo, opts.existentes, opts.oferecidas);
  const out: Array<{ receita: string; botId: string; status: string }> = [];
  for (const item of plano) {
    if (item.acao === "ja_oferecido") {
      out.push({ receita: item.receita, botId: item.botId, status: "ja_oferecido" });
      continue;
    }
    if (item.acao === "ja_existe") {
      opts.marcar(item.receita, item.botId);
      opts.oferecidas.add(item.receita);
      out.push({ receita: item.receita, botId: item.botId, status: "ja_existe" });
      continue;
    }
    const r = await opts.criar(item.receita, item.botId);
    if (r.ok) {
      opts.marcar(item.receita, item.botId);
      opts.oferecidas.add(item.receita);
      opts.existentes.add(item.botId);
      out.push({ receita: item.receita, botId: item.botId, status: "criado" });
    } else {
      out.push({ receita: item.receita, botId: item.botId, status: r.detalhe || "erro" });
    }
  }
  return out;
}

export function garantirTabelaSeed(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS equipe_seed (
    escopo TEXT NOT NULL,
    dono TEXT NOT NULL,
    receita TEXT NOT NULL,
    bot_id TEXT,
    quando INTEGER NOT NULL,
    PRIMARY KEY (escopo, dono, receita)
  )`);
}

export function lerOferecidas(db: Database.Database, escopo: string, dono: string): Set<string> {
  garantirTabelaSeed(db);
  const rows = db.prepare(`SELECT receita FROM equipe_seed WHERE escopo=? AND dono=?`).all(escopo, dono) as Array<{ receita: string }>;
  return new Set(rows.map((r) => r.receita));
}

export function marcarOferecida(db: Database.Database, escopo: string, dono: string, receita: string, botId: string) {
  garantirTabelaSeed(db);
  db.prepare(`INSERT INTO equipe_seed (escopo, dono, receita, bot_id, quando) VALUES (?,?,?,?,?)
    ON CONFLICT(escopo, dono, receita) DO NOTHING`).run(escopo, dono, receita, botId, Date.now());
}

type Provedor = { kind: string; model: string };

function provedorPadrao(): Provedor {
  const base = PADRAO_DA_CASA as { provider?: string | { kind?: string; model?: string; visao?: boolean; navegacao?: boolean }; model?: string; visao?: boolean; navegacao?: boolean };
  const kind = typeof base.provider === "string" ? base.provider : base.provider?.kind || "zai";
  const model = (typeof base.provider === "object" && base.provider?.model) || base.model || "glm-4.5-flash";
  return { kind, model };
}

/** Provedor do bot: o da receita, senão o padrão da casa (que um PR de defaults pode mudar). */
export function provedorDoBot(receita: { provedor?: { kind?: string; model?: string } } | null | undefined): Provedor {
  const padrao = provedorPadrao();
  const kind = String(receita?.provedor?.kind || padrao.kind);
  const model = String(receita?.provedor?.model || padrao.model);
  return { kind, model };
}

/**
 * Visão e navegação. A receita manda. Se ela não disser, vale o padrão da casa
 * quando esse padrão passar a trazer o flag (boolean na raiz ou dentro de provider).
 */
export function flagCapacidade(nome: "visao" | "navegacao", receita: { visao?: boolean; navegacao?: boolean; provedor?: { visao?: boolean; navegacao?: boolean } } | null | undefined): boolean {
  const daReceita = receita?.[nome];
  if (typeof daReceita === "boolean") return daReceita;
  const doProvedor = receita?.provedor?.[nome];
  if (typeof doProvedor === "boolean") return doProvedor;
  const base = PADRAO_DA_CASA as any;
  if (typeof base?.[nome] === "boolean") return base[nome];
  const prov = typeof base?.provider === "object" ? base.provider : null;
  if (prov && typeof prov[nome] === "boolean") return prov[nome];
  return false;
}

export type CamposNascimento = {
  role: string;
  avatar?: string;
  voice?: string;
  color?: string;
  cores?: { accent?: string; coatLight?: string; coatDark?: string };
  persona?: string;
  provider: Provedor;
  visao: boolean;
  navegacao: boolean;
  engine: "direct" | "opencode";
  autoStart: boolean;
};

/** Campos de nascimento lidos da receita. Body explícito ganha (import manual). */
export function camposDoNascimento(receita: Receita | null | undefined, body: any = {}): CamposNascimento {
  const explicito = body?.provider;
  const kindEx = typeof explicito === "string" ? explicito : explicito?.kind;
  const modelEx = (typeof explicito === "object" && explicito?.model) || body?.model;
  const base = provedorDoBot(receita);
  const provider = { kind: String(kindEx || base.kind), model: String(modelEx || base.model) };
  const perfil = receita?.profile;
  const coresBrutas = (body?.cores && typeof body.cores === "object" ? body.cores : perfil?.cores) || {};
  const cores = {
    ...(coresBrutas.accent ? { accent: String(coresBrutas.accent) } : {}),
    ...(coresBrutas.coatLight ? { coatLight: String(coresBrutas.coatLight) } : {}),
    ...(coresBrutas.coatDark ? { coatDark: String(coresBrutas.coatDark) } : {}),
  };
  const persona = typeof body?.persona === "string" && body.persona.trim()
    ? body.persona
    : (typeof receita?.persona === "string" && receita.persona.trim() ? receita.persona : undefined);
  const autoStart = typeof body?.autoStart === "boolean"
    ? body.autoStart
    : process.env.MYBOTS_EQUIPE_AUTOSTART === "0"
      ? false
      : true;
  return {
    role: String(body?.role || perfil?.description || perfil?.name || "Assistente"),
    avatar: body?.avatar || perfil?.ameba,
    voice: body?.voice || perfil?.voice,
    color: body?.color || perfil?.cor || cores.accent,
    ...(Object.keys(cores).length ? { cores } : {}),
    ...(persona ? { persona } : {}),
    provider,
    visao: typeof body?.visao === "boolean" ? body.visao : flagCapacidade("visao", receita),
    navegacao: typeof body?.navegacao === "boolean" ? body.navegacao : flagCapacidade("navegacao", receita),
    engine: body?.engine === "opencode" ? "opencode" : "direct",
    autoStart,
  };
}
