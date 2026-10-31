// Cofre de credenciais do Hub.
// O segredo fica cifrado. A API, a auditoria e a ferramenta do bot devolvem
// máscara, os 4 últimos dígitos, ou só "ok" / "erro: …". Nunca o valor.
import type Database from "better-sqlite3";
import { newId } from "@mybots/shared";
import { carregarChaveMestra, cifrar, decifrar, type ChaveMestra } from "./cofreCripto.js";
import { alvoDoNavegador, mesmoSite, preencherNoNavegador } from "./cofreCdp.js";
import { redigir, registrarSegredo } from "./redacao.js";

export type TipoItem = "login" | "cartao";
export type Campo = "usuario" | "senha" | "notas" | "titular" | "numero" | "validade" | "cvv";

export type ItemLogin = {
  id: string; tipo: "login"; nome: string; site: string; usuario: string;
  senhaMascarada: "••••••••"; criadoEm: number; atualizadoEm: number;
};
export type ItemCartao = {
  id: string; tipo: "cartao"; nome: string; titular: string; finalNumero: string;
  validade: string; criadoEm: number; atualizadoEm: number;
};
export type ItemPublico = ItemLogin | ItemCartao;

export type LinhaAuditoria = {
  id: number; quando: number; quem: string; itemId: string | null;
  acao: string; resultado: string; detalhe: string | null;
};

export type Falha = { error: string; status: number };

type Segredos = { senha?: string; notas?: string; numero?: string; cvv?: string };

export type Digitar = (o: { porta: number; site: string; campo: string; valor: string }) => Promise<{ ok: true } | { ok: false; erro: string }>;
export type PortaDe = (botId: string, empresaId: string | null) => Promise<{ porta: number } | { erro: string }>;

const MASCARA = "••••••••" as const;

const ALIAS_LOGIN: Record<string, Campo> = {
  usuario: "usuario", user: "usuario", username: "usuario", email: "usuario", login: "usuario",
  senha: "senha", password: "senha", pass: "senha", pwd: "senha",
  notas: "notas", notes: "notas", nota: "notas",
};
const ALIAS_CARTAO: Record<string, Campo> = {
  titular: "titular", cardholder: "titular", nome: "titular", name: "titular",
  numero: "numero", number: "numero", cartao: "numero", card: "numero", pan: "numero",
  validade: "validade", expiry: "validade", exp: "validade", expiration: "validade", vencimento: "validade",
  cvv: "cvv", cvc: "cvv", cvv2: "cvv", codigo: "cvv",
};

export function campoDe(tipo: TipoItem, bruto: string): Campo | null {
  const k = String(bruto ?? "").trim().toLowerCase();
  return (tipo === "login" ? ALIAS_LOGIN : ALIAS_CARTAO)[k] ?? null;
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function texto(v: unknown, max: number): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function digitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

export class Cofre {
  private chave: Buffer | null = null;
  private motivo = "";
  private origem: "env" | "dpapi" | "teste" | null = null;

  constructor(private db: Database.Database, opts?: { chave?: Buffer | null }) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cofre_itens (
        id TEXT PRIMARY KEY,
        tipo TEXT NOT NULL,
        nome TEXT NOT NULL,
        site TEXT,
        usuario TEXT,
        titular TEXT,
        validade TEXT,
        final_numero TEXT,
        segredos TEXT NOT NULL,
        criado_em INTEGER NOT NULL,
        atualizado_em INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cofre_permissoes (
        item_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        PRIMARY KEY (item_id, bot_id)
      );
      CREATE TABLE IF NOT EXISTS cofre_auditoria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        quem TEXT,
        item_id TEXT,
        acao TEXT NOT NULL,
        resultado TEXT NOT NULL,
        detalhe TEXT
      );
    `);
    if (opts && "chave" in opts) {
      if (opts.chave && opts.chave.length === 32) {
        this.chave = opts.chave;
        this.origem = "teste";
      } else {
        this.motivo = "Cofre desativado: sem chave mestra.";
      }
    } else {
      const estado: ChaveMestra = carregarChaveMestra();
      if (estado.ativo) {
        this.chave = estado.chave;
        this.origem = estado.origem;
        registrarSegredo(process.env.MYBOTS_VAULT_KEY);
      } else {
        this.motivo = estado.motivo;
      }
    }
    if (this.chave) this.armarRedacao();
  }

  status(): { ativo: boolean; motivo?: string } {
    if (!this.chave) return { ativo: false, motivo: this.motivo };
    return { ativo: true };
  }

  private armarRedacao() {
    if (!this.chave) return;
    const rows = this.db.prepare(`SELECT segredos FROM cofre_itens`).all() as Array<{ segredos: string }>;
    for (const r of rows) {
      try { this.lembrar(JSON.parse(decifrar(this.chave, r.segredos))); } catch { /* item ilegível fica mudo */ }
    }
  }

  private lembrar(s: Segredos) {
    registrarSegredo(s.senha);
    registrarSegredo(s.notas);
    registrarSegredo(s.numero);
    registrarSegredo(s.cvv);
  }

  private auditar(quem: string, itemId: string | null, acao: string, resultado: string, detalhe?: string) {
    const d = detalhe ? redigir(detalhe).slice(0, 300) : null;
    this.db.prepare(`INSERT INTO cofre_auditoria (ts, quem, item_id, acao, resultado, detalhe) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(Date.now(), quem, itemId, acao, resultado, d);
  }

  private linha(id: string): any | undefined {
    return this.db.prepare(`SELECT * FROM cofre_itens WHERE id=?`).get(id);
  }

  private publico(r: any): ItemPublico {
    const base = { id: String(r.id), nome: String(r.nome), criadoEm: Number(r.criado_em), atualizadoEm: Number(r.atualizado_em) };
    if (r.tipo === "cartao") {
      return { ...base, tipo: "cartao", titular: String(r.titular ?? ""), finalNumero: String(r.final_numero ?? ""), validade: String(r.validade ?? "") };
    }
    return { ...base, tipo: "login", site: String(r.site ?? ""), usuario: String(r.usuario ?? ""), senhaMascarada: MASCARA };
  }

  private abrirSegredos(r: any): Segredos | null {
    if (!this.chave) return null;
    try { return JSON.parse(decifrar(this.chave, String(r.segredos))) as Segredos; } catch { return null; }
  }

  private exigir(): Falha | null {
    if (!this.chave) return { error: this.motivo, status: 503 };
    return null;
  }

  listar(busca = "", tipo = ""): ItemPublico[] | Falha {
    const off = this.exigir();
    if (off) return off;
    if (tipo && tipo !== "login" && tipo !== "cartao") return { error: "tipo é login ou cartao", status: 400 };
    const q = norm(busca.trim());
    const rows = this.db.prepare(`SELECT * FROM cofre_itens ORDER BY nome`).all() as any[];
    return rows
      .filter((r) => !tipo || r.tipo === tipo)
      .filter((r) => !q || norm(`${r.nome} ${r.site ?? ""} ${r.usuario ?? ""} ${r.titular ?? ""}`).includes(q))
      .map((r) => this.publico(r));
  }

  criar(body: any, quem = "painel"): ItemPublico | Falha {
    const off = this.exigir();
    if (off) return off;
    const montado = this.montar(body, null);
    if ("error" in montado) return montado;
    const id = newId("cf");
    const agora = Date.now();
    this.db.prepare(`INSERT INTO cofre_itens (id, tipo, nome, site, usuario, titular, validade, final_numero, segredos, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, montado.tipo, montado.nome, montado.site, montado.usuario, montado.titular, montado.validade, montado.finalNumero,
      cifrar(this.chave!, JSON.stringify(montado.segredos)), agora, agora,
    );
    this.lembrar(montado.segredos);
    this.auditar(quem, id, "criar", "ok", montado.tipo === "login" ? `login ${montado.nome}` : `cartao ${montado.nome}`);
    return this.publico(this.linha(id));
  }

  editar(id: string, body: any, quem = "painel"): ItemPublico | Falha {
    const off = this.exigir();
    if (off) return off;
    const atual = this.linha(id);
    if (!atual) return { error: "item não encontrado", status: 404 };
    const segredos = this.abrirSegredos(atual);
    if (!segredos) return { error: "não consegui abrir este item com a chave atual", status: 400 };
    const montado = this.montar(body ?? {}, { tipo: atual.tipo, segredos, row: atual });
    if ("error" in montado) return montado;
    const agora = Date.now();
    this.db.prepare(`UPDATE cofre_itens SET nome=?, site=?, usuario=?, titular=?, validade=?, final_numero=?, segredos=?, atualizado_em=? WHERE id=?`)
      .run(montado.nome, montado.site, montado.usuario, montado.titular, montado.validade, montado.finalNumero,
        cifrar(this.chave!, JSON.stringify(montado.segredos)), agora, id);
    this.lembrar(montado.segredos);
    this.auditar(quem, id, "editar", "ok", montado.nome);
    return this.publico(this.linha(id));
  }

  apagar(id: string, quem = "painel"): { ok: true } | Falha {
    const off = this.exigir();
    if (off) return off;
    const atual = this.linha(id);
    if (!atual) return { error: "item não encontrado", status: 404 };
    this.db.prepare(`DELETE FROM cofre_permissoes WHERE item_id=?`).run(id);
    this.db.prepare(`DELETE FROM cofre_itens WHERE id=?`).run(id);
    this.auditar(quem, id, "apagar", "ok", String(atual.nome ?? ""));
    return { ok: true };
  }

  permissoes(id: string): { botIds: string[] } | Falha {
    const off = this.exigir();
    if (off) return off;
    if (!this.linha(id)) return { error: "item não encontrado", status: 404 };
    const rows = this.db.prepare(`SELECT bot_id FROM cofre_permissoes WHERE item_id=? ORDER BY bot_id`).all(id) as Array<{ bot_id: string }>;
    return { botIds: rows.map((r) => r.bot_id) };
  }

  definirPermissoes(id: string, body: any, quem = "painel"): { botIds: string[] } | Falha {
    const off = this.exigir();
    if (off) return off;
    if (!this.linha(id)) return { error: "item não encontrado", status: 404 };
    const ids = normalizarBots(body);
    if (!ids) return { error: "mande { botIds: string[] }", status: 400 };
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM cofre_permissoes WHERE item_id=?`).run(id);
      const ins = this.db.prepare(`INSERT INTO cofre_permissoes (item_id, bot_id) VALUES (?, ?)`);
      for (const bot of ids) ins.run(id, bot);
    });
    tx();
    this.auditar(quem, id, "permissao", "ok", ids.length ? ids.join(",") : "ninguém");
    return { botIds: ids };
  }

  auditoria(itemId = ""): LinhaAuditoria[] | Falha {
    const off = this.exigir();
    if (off) return off;
    const rows = itemId
      ? this.db.prepare(`SELECT * FROM cofre_auditoria WHERE item_id=? ORDER BY id DESC LIMIT 200`).all(itemId)
      : this.db.prepare(`SELECT * FROM cofre_auditoria ORDER BY id DESC LIMIT 200`).all();
    return (rows as any[]).map((r) => ({
      id: Number(r.id), quando: Number(r.ts), quem: String(r.quem ?? ""), itemId: r.item_id ? String(r.item_id) : null,
      acao: String(r.acao), resultado: String(r.resultado), detalhe: r.detalhe ? String(r.detalhe) : null,
    }));
  }

  /**
   * Preenche o campo no navegador do bot. A string devolvida é o que o modelo
   * pode ver: "ok" ou "erro: …", sem o valor.
   */
  async preencher(o: {
    botId: string; empresaId: string | null; site: string; campo: string;
    digitar?: Digitar; portaDe?: PortaDe;
  }): Promise<string> {
    const site = String(o.site ?? "").trim();
    const campoBruto = String(o.campo ?? "").trim();
    if (!this.chave) return this.falhaPreencher(o.botId, null, "cofre desativado", []);
    if (!site || !campoBruto) return this.falhaPreencher(o.botId, null, "diga o site e o campo", []);

    const todos = this.db.prepare(`SELECT * FROM cofre_itens`).all() as any[];
    const permitidos = new Set((this.db.prepare(`SELECT item_id FROM cofre_permissoes WHERE bot_id=?`).all(o.botId) as Array<{ item_id: string }>).map((r) => r.item_id));
    const campoLogin = campoDe("login", campoBruto);
    const campoCartao = campoDe("cartao", campoBruto);
    const loginsDoSite = todos.filter((r) => r.tipo === "login" && mesmoSite(String(r.site ?? ""), site));
    const cartoes = todos.filter((r) => r.tipo === "cartao");
    let item: any = null;
    let campo: Campo | null = null;

    if (campoLogin && !campoCartao) {
      if (!loginsDoSite.length) {
        this.auditar(o.botId, null, "preencher", "erro", "site sem credencial");
        return "erro: não há credencial para este site";
      }
      const meus = loginsDoSite.filter((r) => permitidos.has(String(r.id))).sort((a, b) => Number(b.atualizado_em) - Number(a.atualizado_em));
      if (!meus.length) {
        this.auditar(o.botId, String(loginsDoSite[0].id), "preencher", "negado", "sem permissão");
        return "erro: sem permissão";
      }
      item = meus[0];
      campo = campoLogin;
    } else if (campoCartao) {
      const meus = cartoes.filter((r) => permitidos.has(String(r.id)));
      if (!cartoes.length) {
        this.auditar(o.botId, null, "preencher", "erro", "sem cartão");
        return "erro: não há credencial para este site";
      }
      if (!meus.length) {
        this.auditar(o.botId, String(cartoes[0].id), "preencher", "negado", "sem permissão");
        return "erro: sem permissão";
      }
      const peloNome = meus.filter((r) => mesmoSite(String(r.nome ?? ""), site) || norm(String(r.nome ?? "")) === norm(site));
      const escolhido = (peloNome.length ? peloNome : meus.length === 1 ? meus : []).sort((a, b) => Number(b.atualizado_em) - Number(a.atualizado_em));
      if (!escolhido.length) return this.falhaPreencher(o.botId, null, "há mais de um cartão permitido; passe o nome do cartão no lugar do site", []);
      item = escolhido[0];
      campo = campoCartao;
    } else {
      return this.falhaPreencher(o.botId, null, "campo desconhecido", []);
    }
    if (!item || !campo) return this.falhaPreencher(o.botId, null, "campo desconhecido", []);
    const segredos = this.abrirSegredos(item);
    if (!segredos) return this.falhaPreencher(o.botId, String(item.id), "não consegui abrir esta credencial", []);
    const valor = valorDoCampo(item, segredos, campo);
    if (!valor) return this.falhaPreencher(o.botId, String(item.id), "este campo está vazio", [segredos.senha, segredos.numero, segredos.cvv, segredos.notas].filter(Boolean) as string[]);

    const portaDe = o.portaDe ?? alvoDoNavegador;
    const digitar = o.digitar ?? ((p) => preencherNoNavegador(p.porta, p.site, p.campo, p.valor));
    const alvo = await portaDe(o.botId, o.empresaId);
    if ("erro" in alvo) return this.falhaPreencher(o.botId, String(item.id), alvo.erro, [valor]);
    let posto: { ok: true } | { ok: false; erro: string };
    try {
      posto = await digitar({ porta: alvo.porta, site, campo, valor });
    } catch (e) {
      return this.falhaPreencher(o.botId, String(item.id), e instanceof Error ? e.message : "não consegui preencher", [valor]);
    }
    if (!posto.ok) return this.falhaPreencher(o.botId, String(item.id), posto.erro, [valor]);
    this.auditar(o.botId, String(item.id), "preencher", "ok", `campo ${campo}`);
    return "ok";
  }

  private falhaPreencher(botId: string, itemId: string | null, erro: string, segredos: string[]): string {
    this.auditar(botId, itemId, "preencher", /permiss/.test(erro) ? "negado" : "erro", erro);
    let t = redigir(`erro: ${erro}`);
    for (const s of segredos) {
      if (s && s.length >= 3 && t.includes(s)) t = "erro: não consegui preencher";
    }
    return t.startsWith("erro") ? t : `erro: ${t}`;
  }

  private montar(body: any, atual: { tipo: TipoItem; segredos: Segredos; row: any } | null): {
    tipo: TipoItem; nome: string; site: string | null; usuario: string | null; titular: string | null;
    validade: string | null; finalNumero: string | null; segredos: Segredos;
  } | Falha {
    const tipo = (atual?.tipo ?? body?.tipo) as TipoItem;
    if (tipo !== "login" && tipo !== "cartao") return { error: "tipo é login ou cartao", status: 400 };
    if (body?.tipo && body.tipo !== tipo) return { error: "o tipo do item não muda", status: 400 };
    const nome = body?.nome !== undefined ? texto(body.nome, 120) : texto(atual?.row?.nome, 120);
    if (!nome) return { error: "nome é obrigatório", status: 400 };

    if (tipo === "login") {
      const site = body?.site !== undefined ? texto(body.site, 300) : texto(atual?.row?.site, 300);
      const usuario = body?.usuario !== undefined ? texto(body.usuario, 200) : texto(atual?.row?.usuario, 200);
      if (!site) return { error: "site é obrigatório", status: 400 };
      if (!usuario) return { error: "usuario é obrigatório", status: 400 };
      const senha = presente(body, "senha") ? texto(body.senha, 500) : (atual?.segredos.senha ?? "");
      if (!senha) return { error: "senha é obrigatória", status: 400 };
      const notas = "notas" in (body ?? {}) && body.notas != null ? texto(body.notas, 4000) : (atual?.segredos.notas ?? "");
      return { tipo, nome, site, usuario, titular: null, validade: null, finalNumero: null, segredos: { senha, ...(notas ? { notas } : {}) } };
    }

    const titular = body?.titular !== undefined ? texto(body.titular, 120) : texto(atual?.row?.titular, 120);
    const validade = body?.validade !== undefined ? texto(body.validade, 16) : texto(atual?.row?.validade, 16);
    if (!titular) return { error: "titular é obrigatório", status: 400 };
    if (!validade) return { error: "validade é obrigatória", status: 400 };
    const numero = presente(body, "numero") ? digitos(body.numero) : digitos(atual?.segredos.numero);
    const cvv = presente(body, "cvv") ? digitos(body.cvv) : digitos(atual?.segredos.cvv);
    if (!numero) return { error: "numero é obrigatório", status: 400 };
    if (numero.length < 12) return { error: "numero do cartão curto demais", status: 400 };
    if (!cvv || cvv.length < 3 || cvv.length > 4) return { error: "cvv é obrigatório", status: 400 };
    return {
      tipo, nome, site: null, usuario: null, titular, validade, finalNumero: numero.slice(-4),
      segredos: { numero, cvv },
    };
  }
}

function presente(body: any, chave: string): boolean {
  if (!body || !(chave in body) || body[chave] == null) return false;
  return String(body[chave]).trim() !== "";
}

function valorDoCampo(row: any, segredos: Segredos, campo: Campo): string {
  if (campo === "usuario") return String(row.usuario ?? "");
  if (campo === "titular") return String(row.titular ?? "");
  if (campo === "validade") return String(row.validade ?? "");
  if (campo === "senha") return String(segredos.senha ?? "");
  if (campo === "notas") return String(segredos.notas ?? "");
  if (campo === "numero") return String(segredos.numero ?? "");
  if (campo === "cvv") return String(segredos.cvv ?? "");
  return "";
}

function normalizarBots(body: any): string[] | null {
  if (!body || typeof body !== "object" || !Array.isArray(body.botIds)) return null;
  const ids = body.botIds.map((x: unknown) => String(x ?? "").trim()).filter(Boolean);
  if (ids.length > 200) return null;
  if (ids.some((id: string) => !/^[A-Za-z0-9_.-]{1,80}$/.test(id))) return null;
  return [...new Set<string>(ids)];
}
