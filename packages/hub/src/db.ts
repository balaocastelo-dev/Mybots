import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Saber, SaberHit, BotInfo, Group, PendingApproval, PendingQuestion, Routine, Sender, StoredMessage, Risk, TarefaColab } from "@mybots/shared";
import { redigir } from "./redacao.js";

/** O que a tela da primeira empresa e o Gerente guardam além do nome e das regras. */
export type FichaEmpresa = {
  site?: string;
  instagram?: string;
  facebook?: string;
  resumo?: string;
  segmento?: string;
  contatos?: { email?: string; telefone?: string; whatsapp?: string; endereco?: string; horario?: string };
  logo?: string;
  cnpj?: string;
  corPrimaria?: string;
  corSecundaria?: string;
  responsavel?: { nome?: string; email?: string; telefone?: string };
};

function textoFicha(s: unknown): string | undefined {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t || undefined;
}

export function parseFicha(bruto: unknown): FichaEmpresa | undefined {
  if (!bruto) return undefined;
  let j: any = bruto;
  if (typeof bruto === "string") {
    try { j = JSON.parse(bruto); } catch { return undefined; }
  }
  if (!j || typeof j !== "object") return undefined;
  const contatosBrutos = j.contatos && typeof j.contatos === "object" ? j.contatos : {};
  const contatos = {
    email: textoFicha(contatosBrutos.email),
    telefone: textoFicha(contatosBrutos.telefone),
    whatsapp: textoFicha(contatosBrutos.whatsapp),
    endereco: textoFicha(contatosBrutos.endereco),
    horario: textoFicha(contatosBrutos.horario),
  };
  const ficha: FichaEmpresa = {
    site: textoFicha(j.site),
    instagram: textoFicha(j.instagram),
    facebook: textoFicha(j.facebook),
    resumo: textoFicha(j.resumo),
    segmento: textoFicha(j.segmento),
    logo: textoFicha(j.logo),
    cnpj: textoFicha(j.cnpj),
    corPrimaria: textoFicha(j.corPrimaria),
    corSecundaria: textoFicha(j.corSecundaria),
    ...(Object.values(contatos).some(Boolean) ? { contatos } : {}),
    ...(j.responsavel && typeof j.responsavel === "object" ? {
      responsavel: {
        nome: textoFicha(j.responsavel.nome),
        email: textoFicha(j.responsavel.email),
        telefone: textoFicha(j.responsavel.telefone),
      },
    } : {}),
  };
  return Object.values(ficha).some((v) => v !== undefined) ? ficha : undefined;
}

function juntarFicha(anterior: FichaEmpresa | undefined, patch: FichaEmpresa | null): string | null {
  if (patch === null) return null;
  const junta: FichaEmpresa = { ...anterior, ...parseFicha(patch) };
  if (patch.contatos || anterior?.contatos) {
    junta.contatos = { ...(anterior?.contatos ?? {}), ...(patch.contatos ?? {}) };
    for (const k of Object.keys(junta.contatos) as Array<keyof NonNullable<FichaEmpresa["contatos"]>>) {
      if (!textoFicha(junta.contatos[k])) delete junta.contatos[k];
    }
    if (!Object.keys(junta.contatos).length) delete junta.contatos;
  }
  if (patch.responsavel || anterior?.responsavel) {
    junta.responsavel = { ...(anterior?.responsavel ?? {}), ...(patch.responsavel ?? {}) };
  }
  const limpa = parseFicha(junta);
  return limpa ? JSON.stringify(limpa) : null;
}

export class Db {
  private db: Database.Database;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bots (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '',
        avatar TEXT, color TEXT, voice TEXT,
        engine TEXT, provider TEXT, model TEXT,
        last_seen INTEGER, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS empresas (
        id TEXT PRIMARY KEY, nome TEXT NOT NULL, regras TEXT NOT NULL DEFAULT '',
        cor TEXT, criada_em INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS saberes (
        id TEXT PRIMARY KEY, titulo TEXT NOT NULL, resumo TEXT NOT NULL DEFAULT '',
        conteudo TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'conhecimento',
        tags TEXT NOT NULL DEFAULT '[]', bots TEXT, origem TEXT,
        usos INTEGER NOT NULL DEFAULT 0,
        criado_em INTEGER NOT NULL, atualizado_em INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS saberes_fts USING fts5(
        titulo, resumo, conteudo, tags, content='saberes', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS saberes_ai AFTER INSERT ON saberes BEGIN
        INSERT INTO saberes_fts(rowid, titulo, resumo, conteudo, tags) VALUES (new.rowid, new.titulo, new.resumo, new.conteudo, new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS saberes_ad AFTER DELETE ON saberes BEGIN
        INSERT INTO saberes_fts(saberes_fts, rowid, titulo, resumo, conteudo, tags) VALUES('delete', old.rowid, old.titulo, old.resumo, old.conteudo, old.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS saberes_au AFTER UPDATE ON saberes BEGIN
        INSERT INTO saberes_fts(saberes_fts, rowid, titulo, resumo, conteudo, tags) VALUES('delete', old.rowid, old.titulo, old.resumo, old.conteudo, old.tags);
        INSERT INTO saberes_fts(rowid, titulo, resumo, conteudo, tags) VALUES (new.rowid, new.titulo, new.resumo, new.conteudo, new.tags);
      END;
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
        sender_kind TEXT NOT NULL, sender_id TEXT NOT NULL, sender_name TEXT NOT NULL,
        text TEXT NOT NULL, meta TEXT, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
        tool TEXT NOT NULL, input TEXT NOT NULL, risk TEXT NOT NULL, description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, resolved_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
        question TEXT NOT NULL, options TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        answer TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS memory (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, bot_id TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, bot_id TEXT, action TEXT NOT NULL, detail TEXT
      );
      CREATE TABLE IF NOT EXISTS reads (
        conversation_id TEXT PRIMARY KEY, last_read_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS routines (
        id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, name TEXT NOT NULL, cron TEXT NOT NULL, prompt TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, last_run INTEGER, next_run INTEGER, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, members TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, bot_id TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, bot_id TEXT NOT NULL, provider TEXT NOT NULL, kind TEXT NOT NULL, amount REAL NOT NULL, ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_media_usage_day ON media_usage(day);
    `);
    // Colunas que nasceram depois do banco. ALTER TABLE ... ADD COLUMN não aceita
    // IF NOT EXISTS no SQLite, então a segunda vez dá erro — e esse erro é o
    // normal, não é falha.
    this.adicionarColuna("questions", "cartao", "TEXT");
    // Menu do chat: apagar é esconder (nunca DELETE — é o que deixa desfazer e mantém a
    // auditoria), editar guarda a versão anterior, fixar marca a mensagem.
    this.adicionarColuna("messages", "deleted_at", "INTEGER");
    this.adicionarColuna("messages", "edit_of", "TEXT");
    this.adicionarColuna("messages", "pinned", "INTEGER DEFAULT 0");
    this.adicionarColuna("approvals", "resolved_by", "TEXT");
    this.db.exec(`CREATE TABLE IF NOT EXISTS conversation_meta (
      id TEXT PRIMARY KEY, forked_from_conversation TEXT, forked_from_message TEXT,
      title TEXT, created_at INTEGER NOT NULL
    );`);
    // Fila de delegação. Uma linha por tarefa; o destinatário (`para`) é a fila daquele bot.
    this.db.exec(`CREATE TABLE IF NOT EXISTS colab_tarefas (
      id TEXT PRIMARY KEY,
      de TEXT NOT NULL,
      para TEXT NOT NULL,
      objetivo TEXT NOT NULL,
      contexto TEXT NOT NULL DEFAULT '',
      criterio_sucesso TEXT NOT NULL DEFAULT '',
      prazo INTEGER,
      formato_entrega TEXT,
      status TEXT NOT NULL,
      profundidade INTEGER NOT NULL DEFAULT 0,
      tarefa_mae_id TEXT,
      resultado TEXT,
      criada_em INTEGER NOT NULL,
      atualizada_em INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_colab_tarefas_para ON colab_tarefas(para, status, criada_em);`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS planos (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        conversation_id TEXT,
        objetivo TEXT NOT NULL,
        status TEXT NOT NULL,
        tarefa_id TEXT,
        criado_em INTEGER NOT NULL,
        atualizado_em INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_planos_bot ON planos(bot_id, atualizado_em);
      CREATE TABLE IF NOT EXISTS plano_passos (
        id TEXT PRIMARY KEY,
        plano_id TEXT NOT NULL,
        ordem INTEGER NOT NULL,
        titulo TEXT NOT NULL,
        status TEXT NOT NULL,
        precisa_decisao INTEGER NOT NULL DEFAULT 0,
        pergunta TEXT,
        opcoes TEXT,
        resposta TEXT,
        atualizado_em INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_plano_passos_plano ON plano_passos(plano_id, ordem);
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fatos (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        text TEXT NOT NULL,
        tipo TEXT NOT NULL,
        learned_at INTEGER NOT NULL,
        empresa_id TEXT NOT NULL DEFAULT '',
        promovido INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_fatos_bot ON fatos(bot_id, tipo, learned_at);
      CREATE TABLE IF NOT EXISTS resumos_bot (
        bot_id TEXT PRIMARY KEY,
        texto TEXT NOT NULL,
        atualizado_em INTEGER NOT NULL
      );
    `);
  }

  close() { this.db.close(); }

  /**
   * A memoria curta e POR EMPRESA (o conhecimento e que e universal): o combinado com
   * um cliente da empresa A nao pode aparecer para um bot da empresa B. Isso muda a
   * chave primaria, entao a tabela e refeita.
   */
  private migrarMemoriaPorEmpresa() {
    const temColuna = (this.db.prepare(`PRAGMA table_info(memory)`).all() as any[]).some((c) => c.name === "empresa_id");
    if (temColuna) return;
    const velhas = this.db.prepare(`SELECT key, value, bot_id, updated_at FROM memory`).all() as any[];
    this.db.exec(`
      DROP TABLE IF EXISTS memory;
      CREATE TABLE memory (
        empresa_id TEXT NOT NULL DEFAULT '', key TEXT NOT NULL, value TEXT NOT NULL,
        bot_id TEXT NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (empresa_id, key)
      );
    `);
    const ins = this.db.prepare(`INSERT OR REPLACE INTO memory (empresa_id, key, value, bot_id, updated_at) VALUES ('', ?, ?, ?, ?)`);
    for (const v of velhas) ins.run(v.key, v.value, v.bot_id, v.updated_at);
  }

  // ---- plano, saldo e consumo ----
  plano(empresaId: string) {
    let r = this.db.prepare(`SELECT * FROM plano WHERE empresa_id=?`).get(empresaId) as any;
    if (!r) {
      this.db.prepare(`INSERT INTO plano (empresa_id, ciclo_inicio, quando) VALUES (?,?,?)`).run(empresaId, Date.now(), Date.now());
      r = this.db.prepare(`SELECT * FROM plano WHERE empresa_id=?`).get(empresaId) as any;
    }
    return {
      empresaId, mensalidadeCentavos: r.mensalidade_centavos, franquiaMensagens: r.franquia_mensagens,
      precoMensagemCentavos: r.preco_mensagem_centavos, saldoCentavos: r.saldo_centavos,
      usadasNoCiclo: r.usadas_no_ciclo, cicloInicio: r.ciclo_inicio, carenciaAte: r.carencia_ate ?? null,
      cobranca: !!r.cobranca,
    };
  }
  salvarPlano(empresaId: string, p: Partial<{ mensalidadeCentavos: number; franquiaMensagens: number; precoMensagemCentavos: number; carenciaAte: number | null; cobranca: boolean }>) {
    const a = this.plano(empresaId);
    this.db.prepare(`UPDATE plano SET mensalidade_centavos=?, franquia_mensagens=?, preco_mensagem_centavos=?, carencia_ate=?, cobranca=?, quando=? WHERE empresa_id=?`)
      .run(p.mensalidadeCentavos ?? a.mensalidadeCentavos, p.franquiaMensagens ?? a.franquiaMensagens,
           p.precoMensagemCentavos ?? a.precoMensagemCentavos,
           p.carenciaAte === undefined ? a.carenciaAte : p.carenciaAte,
           (p.cobranca === undefined ? a.cobranca : p.cobranca) ? 1 : 0, Date.now(), empresaId);
    return this.plano(empresaId);
  }
  creditar(empresaId: string, centavos: number) {
    this.plano(empresaId);
    this.db.prepare(`UPDATE plano SET saldo_centavos = saldo_centavos + ? WHERE empresa_id=?`).run(centavos, empresaId);
    return this.plano(empresaId);
  }
  /** Conta a mensagem: dentro da franquia não debita; acima dela, tira do saldo. */
  cobrarMensagem(empresaId: string): { cobrado: number; saldo: number; dentroDaFranquia: boolean } {
    const p = this.plano(empresaId);
    const dentro = p.usadasNoCiclo < p.franquiaMensagens;
    const cobrado = dentro ? 0 : p.precoMensagemCentavos;
    this.db.prepare(`UPDATE plano SET usadas_no_ciclo = usadas_no_ciclo + 1, saldo_centavos = saldo_centavos - ? WHERE empresa_id=?`)
      .run(cobrado, empresaId);
    return { cobrado, saldo: this.plano(empresaId).saldoCentavos, dentroDaFranquia: dentro };
  }
  novoCiclo(empresaId: string) {
    this.db.prepare(`UPDATE plano SET usadas_no_ciclo = 0, ciclo_inicio = ? WHERE empresa_id=?`).run(Date.now(), empresaId);
  }
  registrarConsumo(c: { empresaId: string; botId: string; modelo: string; entrada: number; saida: number; cacheLido: number; cacheGravado: number; custoMilesimos: number; cobradoCentavos: number }) {
    this.db.prepare(`INSERT INTO consumo (empresa_id, bot_id, modelo, entrada, saida, cache_lido, cache_gravado, custo_milesimos, cobrado_centavos, quando)
      VALUES (@empresaId,@botId,@modelo,@entrada,@saida,@cacheLido,@cacheGravado,@custoMilesimos,@cobradoCentavos,@quando)`)
      .run({ ...c, quando: Date.now() });
  }
  resumoConsumo(empresaId: string, desde: number) {
    const t = this.db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(custo_milesimos),0) custo, COALESCE(SUM(cobrado_centavos),0) cobrado,
      COALESCE(SUM(entrada),0) entrada, COALESCE(SUM(saida),0) saida, COALESCE(SUM(cache_lido),0) cacheLido
      FROM consumo WHERE empresa_id=? AND quando>=?`).get(empresaId, desde) as any;
    const porBot = this.db.prepare(`SELECT bot_id botId, COUNT(*) n, COALESCE(SUM(custo_milesimos),0) custo, COALESCE(SUM(cobrado_centavos),0) cobrado
      FROM consumo WHERE empresa_id=? AND quando>=? GROUP BY bot_id ORDER BY n DESC`).all(empresaId, desde) as any[];
    return { mensagens: t.n, custoMilesimos: t.custo, cobradoCentavos: t.cobrado, entrada: t.entrada, saida: t.saida, cacheLido: t.cacheLido, porBot };
  }
  novaRecarga(r: { id: string; empresaId: string; valorCentavos: number; metodo: string; txid: string }) {
    this.db.prepare(`INSERT INTO recargas (id, empresa_id, valor_centavos, status, metodo, txid, pedida_em) VALUES (?,?,?,'pendente',?,?,?)`)
      .run(r.id, r.empresaId, r.valorCentavos, r.metodo, r.txid, Date.now());
  }
  confirmarRecarga(id: string): { ok: boolean; empresaId?: string; valor?: number } {
    const r = this.db.prepare(`SELECT * FROM recargas WHERE id=?`).get(id) as any;
    if (!r || r.status === "paga") return { ok: false };
    this.db.prepare(`UPDATE recargas SET status='paga', confirmada_em=? WHERE id=?`).run(Date.now(), id);
    this.creditar(r.empresa_id, r.valor_centavos);
    return { ok: true, empresaId: r.empresa_id, valor: r.valor_centavos };
  }
  listRecargas(empresaId: string) {
    return this.db.prepare(`SELECT id, valor_centavos valorCentavos, status, metodo, txid, pedida_em pedidaEm, confirmada_em confirmadaEm
      FROM recargas WHERE empresa_id=? ORDER BY pedida_em DESC LIMIT 30`).all(empresaId) as any[];
  }

  // ---- consentimentos (LGPD) ----
  listConsentimentos(empresaId: string): Array<{ doc: string; versao: string; aceito: boolean; quem: string | null; quando: number }> {
    return (this.db.prepare(`SELECT doc, versao, aceito, quem, quando FROM consentimentos WHERE empresa_id=?`).all(empresaId) as any[])
      .map((r) => ({ doc: r.doc, versao: r.versao, aceito: !!r.aceito, quem: r.quem ?? null, quando: r.quando }));
  }
  registrarConsentimento(empresaId: string, doc: string, versao: string, aceito: boolean, quem?: string) {
    this.db.prepare(`INSERT INTO consentimentos (empresa_id, doc, versao, aceito, quem, quando) VALUES (?,?,?,?,?,?)
      ON CONFLICT(empresa_id, doc) DO UPDATE SET versao=excluded.versao, aceito=excluded.aceito, quem=excluded.quem, quando=excluded.quando`)
      .run(empresaId, doc, versao, aceito ? 1 : 0, quem ?? null, Date.now());
  }

  // ---- empresas ----
  listEmpresas(): Array<{ id: string; nome: string; regras: string; cor?: string; idioma?: "pt" | "en" | "es"; ficha?: FichaEmpresa; criadaEm: number; bots: number }> {
    const rows = this.db.prepare(`SELECT * FROM empresas ORDER BY nome`).all() as any[];
    return rows.map((r) => ({
      id: r.id, nome: r.nome, regras: r.regras ?? "", cor: r.cor ?? undefined, idioma: (r.idioma ?? "pt") as "pt" | "en" | "es",
      ficha: parseFicha(r.ficha), criadaEm: r.criada_em,
      bots: (this.db.prepare(`SELECT COUNT(*) c FROM bots WHERE empresa_id=?`).get(r.id) as any).c,
    }));
  }
  getEmpresa(id: string) { return this.listEmpresas().find((e) => e.id === id); }
  saveEmpresa(e: { id: string; nome: string; regras?: string; cor?: string; idioma?: string; ficha?: FichaEmpresa | null }) {
    this.adicionarColuna("empresas", "ficha", "TEXT");
    const atual = this.db.prepare(`SELECT ficha FROM empresas WHERE id=?`).get(e.id) as { ficha?: string } | undefined;
    const fichaJson = e.ficha === undefined ? (atual?.ficha ?? null) : juntarFicha(parseFicha(atual?.ficha), e.ficha);
    this.db.prepare(`INSERT INTO empresas (id, nome, regras, cor, idioma, criada_em, ficha) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, regras=excluded.regras, cor=excluded.cor, idioma=excluded.idioma, ficha=excluded.ficha`)
      .run(e.id, e.nome, e.regras ?? "", e.cor ?? null, e.idioma ?? "pt", Date.now(), fichaJson);
    return this.getEmpresa(e.id)!;
  }
  /** So apaga empresa vazia: bot orfao sem empresa vira bot do sistema sem querer. */
  deleteEmpresa(id: string): { ok: boolean; motivo?: string } {
    const n = (this.db.prepare(`SELECT COUNT(*) c FROM bots WHERE empresa_id=?`).get(id) as any).c;
    if (n > 0) return { ok: false, motivo: `a empresa ainda tem ${n} bot(s); mova ou apague eles antes` };
    this.db.prepare(`DELETE FROM empresas WHERE id=?`).run(id);
    this.db.prepare(`DELETE FROM memory WHERE empresa_id=?`).run(id);
    return { ok: true };
  }
  /** Marca a empresa do bot. Cria a linha se ele ainda nem conectou. */
  setEmpresaDoBot(id: string, nome: string, empresaId: string | null, ponte?: boolean) {
    this.db.prepare(`INSERT INTO bots (id, name, role, created_at, empresa_id, ponte) VALUES (?,?,'',?,?,?)
      ON CONFLICT(id) DO UPDATE SET empresa_id=excluded.empresa_id, ponte=excluded.ponte`)
      .run(id, nome || id, Date.now(), empresaId || null, ponte ? 1 : 0);
  }

  private adicionarColuna(tabela: string, coluna: string, tipo: string) {
    const existe = (this.db.prepare(`PRAGMA table_info(${tabela})`).all() as any[]).some((c) => c.name === coluna);
    if (!existe) this.db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
  }

  /** Consumo de mídia gerada (imagens / segundos de vídeo) de um dia. */
  mediaUsage(day: string): Array<{ bot_id: string; provider: string; kind: string; amount: number }> {
    return this.db.prepare(`SELECT bot_id, provider, kind, amount FROM media_usage WHERE day=?`).all(day) as any[];
  }
  mediaUsageAdd(day: string, botId: string, provider: string, kind: string, amount: number) {
    this.db.prepare(`INSERT INTO media_usage (day, bot_id, provider, kind, amount, ts) VALUES (?, ?, ?, ?, ?, ?)`).run(day, botId, provider, kind, amount, Date.now());
  }

  /** Configurações do Hub (nível de controle global, preferências da interface…). */
  getSetting<T = unknown>(key: string): T | undefined {
    const r = this.db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string } | undefined;
    if (!r) return undefined;
    try { return JSON.parse(r.value) as T; } catch { return undefined; }
  }
  setSetting(key: string, value: unknown) {
    this.db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(key, JSON.stringify(value), Date.now());
  }

  /** Mensagens de bots (para limpeza de pensamentos antigos). */
  allBotMessages(): StoredMessage[] {
    return (this.db.prepare(`SELECT * FROM messages WHERE sender_kind='bot' AND text<>'' AND deleted_at IS NULL`).all() as any[]).map(rowToMessage);
  }

  // ---- bots gerenciados (criados pela interface) ----
  ensureManagedTable() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS managed_bots (id TEXT PRIMARY KEY, def TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    // Plano e saldo de cada empresa. Mensalidade cobre a plataforma e uma franquia
    // de mensagens; acima dela, cada resposta debita o saldo.
    this.db.exec(`CREATE TABLE IF NOT EXISTS plano (
      empresa_id TEXT PRIMARY KEY,
      mensalidade_centavos INTEGER NOT NULL DEFAULT 0,
      franquia_mensagens INTEGER NOT NULL DEFAULT 0,
      preco_mensagem_centavos INTEGER NOT NULL DEFAULT 25,
      saldo_centavos INTEGER NOT NULL DEFAULT 0,
      usadas_no_ciclo INTEGER NOT NULL DEFAULT 0,
      ciclo_inicio INTEGER,
      carencia_ate INTEGER,
      quando INTEGER NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS consumo (
      id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id TEXT, bot_id TEXT, modelo TEXT,
      entrada INTEGER, saida INTEGER, cache_lido INTEGER, cache_gravado INTEGER,
      custo_milesimos INTEGER NOT NULL DEFAULT 0, cobrado_centavos INTEGER NOT NULL DEFAULT 0,
      quando INTEGER NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS recargas (
      id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL, valor_centavos INTEGER NOT NULL,
      status TEXT NOT NULL, metodo TEXT, txid TEXT, pedida_em INTEGER NOT NULL, confirmada_em INTEGER
    )`);
    // Cobrança nasce DESLIGADA: empresa nova (a sua, inclusive) trabalha sem trava
    // até você ligar o plano. Trava que aparece sozinha é trava que derruba o dono.
    this.adicionarColuna("plano", "cobranca", "INTEGER NOT NULL DEFAULT 0");
    // Saber sem empresa é da casa inteira (universal). Com empresa, só os bots dela leem:
    // é o que permite ensinar o catálogo de UM cliente sem vazar para os outros.
    this.adicionarColuna("saberes", "empresa_id", "TEXT");
    // Idioma nativo da empresa: pt, en ou es. É o que os bots dela falam por padrão.
    this.adicionarColuna("empresas", "idioma", "TEXT NOT NULL DEFAULT 'pt'");
    // Site, Instagram, resumo, segmento, contatos e logo. JSON para não espalhar coluna
    // cada vez que a ficha ganha um campo — e para empresa antiga simplesmente não ter.
    this.adicionarColuna("empresas", "ficha", "TEXT");
    // Registro de aceite dos documentos legais, por empresa. Guarda a VERSÃO aceita:
    // documento que muda depois exige aceite de novo, senão o registro mente.
    this.db.exec(`CREATE TABLE IF NOT EXISTS consentimentos (
      empresa_id TEXT NOT NULL, doc TEXT NOT NULL, versao TEXT NOT NULL,
      aceito INTEGER NOT NULL, quem TEXT, quando INTEGER NOT NULL,
      PRIMARY KEY (empresa_id, doc)
    )`);
    // Empresas: cada bot pertence a uma. empresa_id vazio = bot do sistema, acima das empresas.
    this.adicionarColuna("bots", "empresa_id", "TEXT");
    this.adicionarColuna("bots", "ponte", "INTEGER NOT NULL DEFAULT 0");
    this.migrarMemoriaPorEmpresa();
  }
  listManaged(): any[] {
    return (this.db.prepare(`SELECT def FROM managed_bots ORDER BY created_at`).all() as any[]).map((r) => JSON.parse(r.def));
  }
  getManaged(id: string): any | undefined {
    const r = this.db.prepare(`SELECT def FROM managed_bots WHERE id=?`).get(id) as any;
    return r ? JSON.parse(r.def) : undefined;
  }
  upsertManaged(def: { id: string; createdAt: number }) {
    this.db.prepare(`INSERT INTO managed_bots (id, def, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET def=excluded.def`).run(def.id, JSON.stringify(def), def.createdAt);
  }
  deleteManaged(id: string) { this.db.prepare(`DELETE FROM managed_bots WHERE id=?`).run(id); }

  // ---------- lápide: bot excluído não volta ----------
  // O nó de um bot excluído pode estar vivo em outro PC, ou ter escapado do kill aqui.
  // Ele reconecta, diz "olá" e o Hub recriava a linha em `bots`: o bot ressuscitava
  // sozinho no painel. A lápide é a lista de quem foi excluído de propósito; o hello
  // de quem está nela é recusado.
  ensureTombstoneTable() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS bots_excluidos (id TEXT PRIMARY KEY, nome TEXT, em INTEGER NOT NULL)`);
  }
  marcarExcluido(id: string, nome?: string) {
    this.ensureTombstoneTable();
    this.db.prepare(`INSERT INTO bots_excluidos (id, nome, em) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, em=excluded.em`).run(id, nome ?? null, Date.now());
  }
  /** Bot criado de novo com o mesmo id: a lápide sai, senão ele nasce proibido de conectar. */
  desmarcarExcluido(id: string) {
    this.ensureTombstoneTable();
    this.db.prepare(`DELETE FROM bots_excluidos WHERE id=?`).run(id);
  }
  estaExcluido(id: string): boolean {
    this.ensureTombstoneTable();
    return !!this.db.prepare(`SELECT 1 FROM bots_excluidos WHERE id=?`).get(id);
  }
  listExcluidos(): Array<{ id: string; nome: string | null; em: number }> {
    this.ensureTombstoneTable();
    return this.db.prepare(`SELECT id, nome, em FROM bots_excluidos ORDER BY em DESC`).all() as any[];
  }

  /**
   * Tira o bot da lista de verdade: some do painel e não volta.
   * `purge` também joga fora conversa, leituras, memória e arquivos dele.
   */
  deleteBot(id: string, purge = false) {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM bots WHERE id=?`).run(id);
      this.db.prepare(`DELETE FROM routines WHERE bot_id=?`).run(id);
      this.db.prepare(`DELETE FROM approvals WHERE bot_id=?`).run(id);
      this.db.prepare(`DELETE FROM questions WHERE bot_id=?`).run(id);
      // Excluir o bot e deixar a conversa dele de pé era o pior dos dois mundos: ele some da
      // lista e o chat segue ali, com resposta pela metade e rotina que acabou de disparar.
      // A conversa direta e as de bot para bot morrem junto com ele. Grupos ficam (são de todos).
      for (const c of this.conversationsOfBot(id)) {
        this.db.prepare(`DELETE FROM messages WHERE conversation_id=?`).run(c);
        this.db.prepare(`DELETE FROM reads WHERE conversation_id=?`).run(c);
      }
      if (purge) {
        this.db.prepare(`DELETE FROM memory WHERE bot_id=?`).run(id);
        this.db.prepare(`DELETE FROM files WHERE bot_id=?`).run(id);
      }
      // sai dos grupos de que participava
      for (const g of this.listGroups()) {
        if (g.members.includes(id)) {
          const members = g.members.filter((m) => m !== id);
          this.db.prepare(`UPDATE groups SET members=? WHERE id=?`).run(JSON.stringify(members), g.id);
        }
      }
    })();
  }

  // ---- rotinas ----
  listRoutines(botId?: string): Routine[] {
    const rows = botId
      ? this.db.prepare(`SELECT * FROM routines WHERE bot_id=? ORDER BY created_at`).all(botId)
      : this.db.prepare(`SELECT * FROM routines ORDER BY created_at`).all();
    return (rows as any[]).map((r) => ({ id: r.id, botId: r.bot_id, name: r.name, cron: r.cron, prompt: r.prompt, enabled: !!r.enabled, lastRun: r.last_run ?? undefined, nextRun: r.next_run ?? undefined, createdAt: r.created_at }));
  }
  insertRoutine(r: Routine) {
    this.db.prepare(`INSERT INTO routines (id, bot_id, name, cron, prompt, enabled, next_run, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(r.id, r.botId, r.name, r.cron, r.prompt, r.enabled ? 1 : 0, r.nextRun ?? null, r.createdAt);
  }
  updateRoutine(id: string, patch: Partial<Pick<Routine, "enabled" | "lastRun" | "nextRun" | "cron" | "prompt" | "name">>) {
    const sets: string[] = []; const vals: unknown[] = [];
    if (patch.enabled !== undefined) { sets.push("enabled=?"); vals.push(patch.enabled ? 1 : 0); }
    if (patch.lastRun !== undefined) { sets.push("last_run=?"); vals.push(patch.lastRun); }
    if (patch.nextRun !== undefined) { sets.push("next_run=?"); vals.push(patch.nextRun); }
    if (patch.cron !== undefined) { sets.push("cron=?"); vals.push(patch.cron); }
    if (patch.prompt !== undefined) { sets.push("prompt=?"); vals.push(patch.prompt); }
    if (patch.name !== undefined) { sets.push("name=?"); vals.push(patch.name); }
    if (!sets.length) return;
    this.db.prepare(`UPDATE routines SET ${sets.join(", ")} WHERE id=?`).run(...vals, id);
  }
  deleteRoutine(id: string) { this.db.prepare(`DELETE FROM routines WHERE id=?`).run(id); }

  // ---- grupos ----
  listGroups(): Group[] {
    return (this.db.prepare(`SELECT * FROM groups ORDER BY created_at`).all() as any[]).map((g) => ({ id: g.id, name: g.name, members: JSON.parse(g.members), createdAt: g.created_at }));
  }
  getGroup(id: string): Group | undefined { return this.listGroups().find((g) => g.id === id); }
  upsertGroup(g: Group) {
    this.db.prepare(`INSERT INTO groups (id, name, members, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, members=excluded.members`).run(g.id, g.name, JSON.stringify(g.members), g.createdAt);
  }
  deleteGroup(id: string) { this.db.prepare(`DELETE FROM groups WHERE id=?`).run(id); }

  // ---- arquivos ----
  insertFile(f: { id: string; name: string; mime: string; size: number; botId: string; path: string; createdAt: number }) {
    this.db.prepare(`INSERT INTO files (id, name, mime, size, bot_id, path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(f.id, f.name, f.mime, f.size, f.botId, f.path, f.createdAt);
  }
  getFile(id: string) { return this.db.prepare(`SELECT * FROM files WHERE id=?`).get(id) as { id: string; name: string; mime: string; size: number; bot_id: string; path: string; created_at: number } | undefined; }
  /** Tudo que os bots produziram, do mais novo para o mais velho. A tela "Trabalhos feitos" vive disto. */
  listFiles(limite = 500) {
    return this.db.prepare(`SELECT * FROM files ORDER BY created_at DESC LIMIT ?`).all(limite) as Array<{ id: string; name: string; mime: string; size: number; bot_id: string; path: string; created_at: number }>;
  }

  upsertBot(bot: BotInfo, extra: { engine?: string; provider?: string; model?: string }) {
    this.db
      .prepare(
        `INSERT INTO bots (id, name, role, avatar, color, voice, engine, provider, model, last_seen, created_at)
         VALUES (@id, @name, @role, @avatar, @color, @voice, @engine, @provider, @model, @now, @now)
         ON CONFLICT(id) DO UPDATE SET name=@name, role=@role, avatar=@avatar, color=@color, voice=@voice,
           engine=@engine, provider=@provider, model=@model, last_seen=@now`,
      )
      .run({
        id: bot.id, name: bot.name, role: bot.role ?? "", avatar: bot.avatar ?? null, color: bot.color ?? null,
        voice: bot.voice ?? null, engine: extra.engine ?? null, provider: extra.provider ?? null,
        model: extra.model ?? null, now: Date.now(),
      });
  }

  touchBot(id: string) {
    this.db.prepare(`UPDATE bots SET last_seen=? WHERE id=?`).run(Date.now(), id);
  }

  listBots(): Array<BotInfo & { engine?: string; provider?: string; model?: string; lastSeen?: number; empresaId?: string; ponte?: boolean }> {
    return this.db.prepare(`SELECT * FROM bots ORDER BY name`).all().map((r: any) => ({
      id: r.id, name: r.name, role: r.role, avatar: r.avatar ?? undefined, color: r.color ?? undefined,
      voice: r.voice ?? undefined, engine: r.engine ?? undefined, provider: r.provider ?? undefined,
      model: r.model ?? undefined, lastSeen: r.last_seen ?? undefined,
      empresaId: r.empresa_id ?? undefined, ponte: !!r.ponte,
    }));
  }

  insertMessage(m: StoredMessage) {
    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, sender_kind, sender_id, sender_name, text, meta, created_at, edit_of)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(m.id, m.conversationId, m.sender.kind, m.sender.id, m.sender.name, m.text, m.meta ? JSON.stringify(m.meta) : null, m.createdAt, (m as any).editOf ?? null);
  }

  getMessage(id: string): StoredMessage | undefined {
    const r = this.db.prepare(`SELECT * FROM messages WHERE id=?`).get(id) as any;
    return r ? rowToMessage(r) : undefined;
  }

  updateMessageText(id: string, text: string, meta?: Record<string, unknown>) {
    this.db.prepare(`UPDATE messages SET text=?, meta=COALESCE(?, meta) WHERE id=?`).run(text, meta ? JSON.stringify(meta) : null, id);
  }

  getMessages(conversationId: string, limit = 200, before?: number): StoredMessage[] {
    const rows = before
      ? this.db.prepare(`SELECT * FROM messages WHERE conversation_id=? AND created_at<? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`).all(conversationId, before, limit)
      : this.db.prepare(`SELECT * FROM messages WHERE conversation_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`).all(conversationId, limit);
    return (rows as any[]).reverse().map(rowToMessage);
  }

  // ---- menu do chat: rebobinar, dividir, editar, fixar ----

  /**
   * Esconde desta mensagem em diante (ou só as seguintes). Nada é apagado de verdade:
   * todas as mensagens do lote levam o MESMO deleted_at, e esse número é o bilhete
   * do desfazer.
   */
  rewind(conversationId: string, messageId: string, include: "this" | "after" = "after"): { token: number; afetadas: number } {
    const alvo = this.db.prepare(`SELECT created_at FROM messages WHERE id=?`).get(messageId) as any;
    if (!alvo) return { token: 0, afetadas: 0 };
    const token = Date.now();
    const sql = include === "this"
      ? `UPDATE messages SET deleted_at=? WHERE conversation_id=? AND deleted_at IS NULL AND (created_at>? OR id=?)`
      : `UPDATE messages SET deleted_at=? WHERE conversation_id=? AND deleted_at IS NULL AND created_at>? AND id<>?`;
    const r = this.db.prepare(sql).run(token, conversationId, alvo.created_at, messageId);
    return { token, afetadas: r.changes };
  }

  /** Desfaz o rebobinar: devolve exatamente o lote daquele bilhete. */
  unrewind(conversationId: string, token: number): number {
    return this.db.prepare(`UPDATE messages SET deleted_at=NULL WHERE conversation_id=? AND deleted_at=?`).run(conversationId, token).changes;
  }

  softDeleteMessage(id: string): number {
    return this.db.prepare(`UPDATE messages SET deleted_at=? WHERE id=? AND deleted_at IS NULL`).run(Date.now(), id).changes;
  }

  setPinned(id: string, pinned: boolean) {
    this.db.prepare(`UPDATE messages SET pinned=? WHERE id=?`).run(pinned ? 1 : 0, id);
  }

  /** Copia a conversa até a mensagem escolhida para uma conversa nova. A original fica intacta. */
  forkConversation(from: string, messageId: string, to: string) {
    const alvo = this.db.prepare(`SELECT created_at FROM messages WHERE id=?`).get(messageId) as any;
    if (!alvo) return 0;
    const rows = this.db.prepare(`SELECT * FROM messages WHERE conversation_id=? AND deleted_at IS NULL AND created_at<=? ORDER BY created_at`).all(from, alvo.created_at) as any[];
    const ins = this.db.prepare(`INSERT INTO messages (id, conversation_id, sender_kind, sender_id, sender_name, text, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    this.db.transaction(() => {
      for (const r of rows) ins.run(`${r.id}-f${Math.random().toString(36).slice(2, 7)}`, to, r.sender_kind, r.sender_id, r.sender_name, r.text, r.meta, r.created_at);
      this.db.prepare(`INSERT OR REPLACE INTO conversation_meta (id, forked_from_conversation, forked_from_message, created_at) VALUES (?, ?, ?, ?)`).run(to, from, messageId, Date.now());
    })();
    return rows.length;
  }

  conversationMeta(id: string): { forkedFromConversation?: string; forkedFromMessage?: string } | undefined {
    const r = this.db.prepare(`SELECT * FROM conversation_meta WHERE id=?`).get(id) as any;
    return r ? { forkedFromConversation: r.forked_from_conversation ?? undefined, forkedFromMessage: r.forked_from_message ?? undefined } : undefined;
  }

  listConversations(): Array<{ id: string; last: StoredMessage; count: number }> {
    const rows = this.db.prepare(`SELECT conversation_id AS id, COUNT(*) AS count, MAX(created_at) AS last_at FROM messages WHERE deleted_at IS NULL GROUP BY conversation_id ORDER BY last_at DESC`).all() as any[];
    return rows.map((r) => ({ id: r.id, count: r.count, last: this.lastMessage(r.id)! }));
  }

  /** Conversas de que este bot participa: a direta (`dm:<id>`) e as de bot para bot (`pair:a:b`). */
  conversationsOfBot(botId: string): string[] {
    const rows = this.db.prepare(`SELECT DISTINCT conversation_id AS id FROM messages`).all() as any[];
    return rows.map((r) => String(r.id)).filter((id) => id === `dm:${botId}` || (id.startsWith("pair:") && id.slice(5).split(":").includes(botId)));
  }

  /** Mensagens que ESTE bot trocou com OUTROS bots entre dois instantes.
   *  É o que alimenta o rodapé "Mensageou N bots": o turno é a janela. */
  trocasDoTurno(botId: string, de: number, ate: number): Array<{ conversationId: string; outro: string; quantas: number; ultima: number }> {
    const rows = this.db.prepare(
      `SELECT conversation_id AS id, COUNT(*) AS n, MAX(created_at) AS ultima
         FROM messages
        WHERE deleted_at IS NULL AND created_at >= ? AND created_at <= ? AND conversation_id LIKE 'pair:%'
        GROUP BY conversation_id`
    ).all(de, ate) as any[];
    const saida: Array<{ conversationId: string; outro: string; quantas: number; ultima: number }> = [];
    for (const r of rows) {
      const partes = String(r.id).slice(5).split(":");
      if (!partes.includes(botId)) continue;
      saida.push({ conversationId: String(r.id), outro: partes.find((p) => p !== botId) ?? partes[0], quantas: Number(r.n), ultima: Number(r.ultima) });
    }
    return saida.sort((a, b) => b.ultima - a.ultima);
  }

  /** Começo e fim do turno que gerou esta mensagem: do pedido do chefe que veio
   *  antes até o próximo pedido dele (ou agora, se ainda não veio). */
  janelaDoTurno(conversationId: string, messageId: string): { de: number; ate: number } | null {
    const m = this.db.prepare(`SELECT created_at FROM messages WHERE id=?`).get(messageId) as any;
    if (!m) return null;
    const em = Number(m.created_at);
    const antes = this.db.prepare(`SELECT MAX(created_at) AS t FROM messages WHERE conversation_id=? AND created_at<=? AND sender_kind='user' AND deleted_at IS NULL`).get(conversationId, em) as any;
    const depois = this.db.prepare(`SELECT MIN(created_at) AS t FROM messages WHERE conversation_id=? AND created_at>? AND sender_kind='user' AND deleted_at IS NULL`).get(conversationId, em) as any;
    return { de: Number(antes?.t ?? em), ate: Number(depois?.t ?? Date.now()) };
  }

  /** Marca a conversa como NÃO lida: o relógio volta para antes da última
   *  mensagem do bot, então ela reaparece com o numerinho. */
  marcarNaoLido(conversationId: string) {
    const r = this.db.prepare(`SELECT MAX(created_at) AS t FROM messages WHERE conversation_id=? AND sender_kind='bot' AND deleted_at IS NULL`).get(conversationId) as any;
    const t = Number(r?.t ?? 0);
    if (!t) { this.db.prepare(`DELETE FROM reads WHERE conversation_id=?`).run(conversationId); return; }
    this.db.prepare(`INSERT INTO reads (conversation_id, last_read_at) VALUES (?, ?) ON CONFLICT(conversation_id) DO UPDATE SET last_read_at=excluded.last_read_at`).run(conversationId, t - 1);
  }

  lastMessage(conversationId: string): StoredMessage | undefined {
    const r = this.db.prepare(`SELECT * FROM messages WHERE conversation_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`).get(conversationId) as any;
    return r ? rowToMessage(r) : undefined;
  }

  unreadCount(conversationId: string): number {
    const r = this.db.prepare(`SELECT last_read_at FROM reads WHERE conversation_id=?`).get(conversationId) as any;
    const since = r?.last_read_at ?? 0;
    const c = this.db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE conversation_id=? AND created_at>? AND sender_kind='bot' AND deleted_at IS NULL`).get(conversationId, since) as any;
    return c?.n ?? 0;
  }

  markRead(conversationId: string) {
    this.db.prepare(`INSERT INTO reads (conversation_id, last_read_at) VALUES (?, ?) ON CONFLICT(conversation_id) DO UPDATE SET last_read_at=excluded.last_read_at`).run(conversationId, Date.now());
  }

  insertApproval(a: PendingApproval) {
    this.db
      .prepare(`INSERT INTO approvals (id, bot_id, conversation_id, tool, input, risk, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(a.id, a.botId, a.conversationId, a.tool, JSON.stringify(a.input ?? null), a.risk, a.description, a.createdAt);
  }

  resolveApproval(id: string, allow: boolean, por = "humano") {
    this.db.prepare(`UPDATE approvals SET status=?, resolved_at=?, resolved_by=? WHERE id=? AND status='pending'`).run(allow ? "allowed" : "denied", Date.now(), por, id);
  }

  /** Cartão que o humano deixou passar, ainda dentro da janela. Aprovação de bot não entra. */
  temAprovacaoHumana(botId: string, tool: string, janelaMs = 15 * 60_000): boolean {
    const r = this.db.prepare(
      `SELECT id FROM approvals WHERE bot_id=? AND tool=? AND status='allowed' AND resolved_by='humano' AND resolved_at>=? LIMIT 1`,
    ).get(botId, tool, Date.now() - janelaMs);
    return !!r;
  }

  /** Cartão que não espera mais ninguém: o turno dele foi rebobinado. */
  cancelApproval(id: string) {
    this.db.prepare(`UPDATE approvals SET status='cancelled', resolved_at=? WHERE id=? AND status='pending'`).run(Date.now(), id);
  }

  cancelQuestion(id: string) {
    this.db.prepare(`UPDATE questions SET status='cancelled', resolved_at=? WHERE id=? AND status='pending'`).run(Date.now(), id);
  }

  pendingApprovals(): PendingApproval[] {
    return (this.db.prepare(`SELECT * FROM approvals WHERE status='pending' ORDER BY created_at`).all() as any[]).map((r) => ({
      id: r.id, botId: r.bot_id, conversationId: r.conversation_id, tool: r.tool, input: JSON.parse(r.input),
      risk: r.risk as Risk, description: r.description, createdAt: r.created_at,
    }));
  }

  insertQuestion(q: PendingQuestion) {
    this.db
      .prepare(`INSERT INTO questions (id, bot_id, conversation_id, question, options, status, created_at, cartao) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(q.id, q.botId, q.conversationId, q.question, JSON.stringify(q.options), q.createdAt, q.cartao ? JSON.stringify(q.cartao) : null);
  }

  resolveQuestion(id: string, answer: string) {
    this.db.prepare(`UPDATE questions SET status='answered', answer=?, resolved_at=? WHERE id=? AND status='pending'`).run(answer, Date.now(), id);
  }

  pendingQuestions(): PendingQuestion[] {
    return (this.db.prepare(`SELECT * FROM questions WHERE status='pending' ORDER BY created_at`).all() as any[]).map((r) => ({
      id: r.id, botId: r.bot_id, conversationId: r.conversation_id, question: r.question, options: JSON.parse(r.options), createdAt: r.created_at,
      ...(r.cartao ? { cartao: JSON.parse(r.cartao) } : {}),
    }));
  }

  // ---- base de conhecimento comum ----
  /** Grava ou atualiza um verbete. */
  saveSaber(v: Omit<Saber, "criadoEm" | "atualizadoEm" | "usos"> & { criadoEm?: number }): Saber {
    const agora = Date.now();
    const existe = this.db.prepare(`SELECT criado_em, usos FROM saberes WHERE id=?`).get(v.id) as any;
    this.db.prepare(`
      INSERT INTO saberes (id, titulo, resumo, conteudo, tipo, tags, bots, origem, empresa_id, usos, criado_em, atualizado_em)
      VALUES (@id, @titulo, @resumo, @conteudo, @tipo, @tags, @bots, @origem, @empresa, @usos, @criado, @atualizado)
      ON CONFLICT(id) DO UPDATE SET titulo=excluded.titulo, resumo=excluded.resumo, conteudo=excluded.conteudo,
        tipo=excluded.tipo, tags=excluded.tags, bots=excluded.bots, origem=excluded.origem, empresa_id=excluded.empresa_id, atualizado_em=excluded.atualizado_em
    `).run({
      id: v.id, titulo: v.titulo, resumo: v.resumo, conteudo: v.conteudo, tipo: v.tipo,
      tags: JSON.stringify(v.tags ?? []), bots: v.bots?.length ? JSON.stringify(v.bots) : null,
      origem: v.origem ?? null, empresa: (v as any).empresaId ?? null, usos: existe?.usos ?? 0,
      criado: existe?.criado_em ?? v.criadoEm ?? agora, atualizado: agora,
    });
    return this.getSaber(v.id)!;
  }

  getSaber(id: string): Saber | undefined {
    const r = this.db.prepare(`SELECT * FROM saberes WHERE id=?`).get(id) as any;
    return r ? this.saberDe(r) : undefined;
  }

  deleteSaber(id: string) { this.db.prepare(`DELETE FROM saberes WHERE id=?`).run(id); }

  /** Lista tudo (para o painel) ou só o que serve a um bot. */
  /** Quantos saberes a casa tem, por tipo. O painel mostra isso em /api/maquina. */
  contarSaberes(): { total: number; porTipo: Array<{ tipo: string; n: number }> } {
    const linhas = this.db.prepare(`SELECT tipo, COUNT(*) AS n FROM saberes GROUP BY tipo ORDER BY n DESC`).all() as any[];
    const porTipo = linhas.map((l) => ({ tipo: String(l.tipo), n: Number(l.n) }));
    return { total: porTipo.reduce((s, l) => s + l.n, 0), porTipo };
  }

  /**
   * A base e COMUM: todo saber e de todo bot. O parametro botId so continua existindo
   * porque meia duzia de chamadas o passam; ele e ignorado de proposito. Base com dono
   * era o que fazia um bot dizer "nao sei" sobre o que a casa ja sabia.
   */
  listSaberes(empresaId?: string | null): Saber[] {
    const rows = this.db.prepare(`SELECT * FROM saberes WHERE empresa_id IS NULL OR empresa_id = ? ORDER BY tipo, titulo`)
      .all(empresaId ?? null) as any[];
    return rows.map((r) => this.saberDe(r));
  }
  /** Só o que foi anotado DESTA empresa. A base universal não entra: senão a folha
   *  de uma casa nova herdaria texto de outra instalação. */
  saberesDaEmpresa(empresaId: string): Saber[] {
    return (this.db.prepare(`SELECT * FROM saberes WHERE empresa_id = ? ORDER BY tipo, titulo`).all(empresaId) as any[])
      .map((r) => this.saberDe(r));
  }
  /** Tudo, sem escopo: só para o painel e a manutenção. */
  listSaberesTodos(): Saber[] {
    return (this.db.prepare(`SELECT * FROM saberes ORDER BY tipo, titulo`).all() as any[]).map((r) => this.saberDe(r));
  }

  /** As chaves da memoria da equipe. Entram no prompt para o bot saber o que ja foi anotado. */
  listMemoryKeys(limit = 80, empresaId = ""): Array<{ key: string; botId: string | null }> {
    return this.db.prepare(`SELECT key, bot_id AS botId FROM memory WHERE empresa_id=? ORDER BY updated_at DESC LIMIT ?`).all(empresaId, limit) as any[];
  }

  /** Busca por palavras. Devolve o trecho onde bateu, não o verbete inteiro. */
  searchSaberes(query: string, empresaId?: string | null, limit = 6): SaberHit[] {
    const termo = (query ?? "").trim();
    if (!termo) return [];
    // FTS5: cada palavra com * no fim, aspas para não quebrar com pontuação
    const expr = termo.split(/\s+/).filter(Boolean).slice(0, 8).map((p) => `"${p.replace(/"/g, "")}"*`).join(" OR ");
    let rows: any[] = [];
    try {
      rows = this.db.prepare(`
        SELECT s.*, snippet(saberes_fts, 2, '', '', ' … ', 28) AS trecho
        FROM saberes_fts f JOIN saberes s ON s.rowid = f.rowid
        WHERE saberes_fts MATCH ? ORDER BY bm25(saberes_fts) LIMIT ?
      `).all(expr, limit * 3) as any[];
    } catch {
      rows = this.db.prepare(`SELECT *, substr(conteudo, 1, 300) AS trecho FROM saberes WHERE titulo LIKE ? OR conteudo LIKE ? LIMIT ?`)
        .all(`%${termo}%`, `%${termo}%`, limit * 3) as any[];
    }
    const out: SaberHit[] = [];
    for (const r of rows) {
      const v = this.saberDe(r);
      // A base é da equipe inteira; o único recorte é a empresa dona do saber.
      if (v.empresaId && v.empresaId !== (empresaId ?? null)) continue;
      this.db.prepare(`UPDATE saberes SET usos = usos + 1 WHERE id=?`).run(v.id);
      out.push({ id: v.id, titulo: v.titulo, resumo: v.resumo, tipo: v.tipo, tags: v.tags, trecho: String(r.trecho ?? "").trim() });
      if (out.length >= limit) break;
    }
    return out;
  }

  private saberDe(r: any): Saber {
    return {
      id: r.id, titulo: r.titulo, resumo: r.resumo, conteudo: r.conteudo, tipo: r.tipo,
      tags: JSON.parse(r.tags || "[]"), bots: r.bots ? JSON.parse(r.bots) : undefined,
      origem: r.origem ?? undefined, empresaId: r.empresa_id ?? undefined, usos: r.usos ?? 0, criadoEm: r.criado_em, atualizadoEm: r.atualizado_em,
    };
  }

  // ---- fatos estruturados por bot (+ equipe) ----
  /** perfil | diario | regra (correção do chefe). */
  normalizarTipoFato(t: unknown): "perfil" | "diario" | "regra" {
    const x = String(t ?? "").toLowerCase().trim();
    if (x === "perfil") return "perfil";
    if (x === "regra" || x === "regra_aprendida" || x === "aprendida" || x === "correction" || x === "lição" || x === "licao") return "regra";
    return "diario";
  }

  
  inserirPlano(p: { id: string; botId: string; conversationId: string | null; objetivo: string; status: string; tarefaId: string | null; criadoEm: number; atualizadoEm: number }) {
    this.db.prepare(`INSERT INTO planos (id, bot_id, conversation_id, objetivo, status, tarefa_id, criado_em, atualizado_em)
      VALUES (@id, @botId, @conversationId, @objetivo, @status, @tarefaId, @criadoEm, @atualizadoEm)`).run(p);
  }
  atualizarPlanoStatus(id: string, status: string, atualizadoEm: number) {
    this.db.prepare(`UPDATE planos SET status = ?, atualizado_em = ? WHERE id = ?`).run(status, atualizadoEm, id);
  }
  getPlano(id: string) {
    const r = this.db.prepare(`SELECT id, bot_id as botId, conversation_id as conversationId, objetivo, status, tarefa_id as tarefaId, criado_em as criadoEm, atualizado_em as atualizadoEm FROM planos WHERE id = ?`).get(id) as any;
    return r ?? null;
  }
  getPlanoPorTarefa(tarefaId: string) {
    const r = this.db.prepare(`SELECT id, bot_id as botId, conversation_id as conversationId, objetivo, status, tarefa_id as tarefaId, criado_em as criadoEm, atualizado_em as atualizadoEm FROM planos WHERE tarefa_id = ? ORDER BY criado_em DESC LIMIT 1`).get(tarefaId) as any;
    return r ?? null;
  }
  listarPlanos(botId: string) {
    return this.db.prepare(`SELECT id, bot_id as botId, conversation_id as conversationId, objetivo, status, tarefa_id as tarefaId, criado_em as criadoEm, atualizado_em as atualizadoEm FROM planos WHERE bot_id = ? ORDER BY atualizado_em DESC LIMIT 50`).all(botId) as any[];
  }
  inserirPlanoPasso(p: { id: string; planoId: string; ordem: number; titulo: string; status: string; precisaDecisao: boolean; pergunta: string | null; opcoes: string[]; resposta: string | null; atualizadoEm: number }) {
    this.db.prepare(`INSERT INTO plano_passos (id, plano_id, ordem, titulo, status, precisa_decisao, pergunta, opcoes, resposta, atualizado_em)
      VALUES (@id, @planoId, @ordem, @titulo, @status, @precisaDecisao, @pergunta, @opcoes, @resposta, @atualizadoEm)`).run({
      ...p,
      precisaDecisao: p.precisaDecisao ? 1 : 0,
      opcoes: JSON.stringify(p.opcoes ?? []),
    });
  }
  atualizarPlanoPasso(p: { id: string; status: string; precisaDecisao: boolean; pergunta: string | null; opcoes: string[]; resposta: string | null; atualizadoEm: number; titulo?: string }) {
    this.db.prepare(`UPDATE plano_passos SET status = @status, precisa_decisao = @precisaDecisao, pergunta = @pergunta, opcoes = @opcoes, resposta = @resposta, atualizado_em = @atualizadoEm WHERE id = @id`).run({
      id: p.id,
      status: p.status,
      precisaDecisao: p.precisaDecisao ? 1 : 0,
      pergunta: p.pergunta,
      opcoes: JSON.stringify(p.opcoes ?? []),
      resposta: p.resposta,
      atualizadoEm: p.atualizadoEm,
    });
  }
  listarPlanoPassos(planoId: string) {
    const rows = this.db.prepare(`SELECT id, plano_id as planoId, ordem, titulo, status, precisa_decisao as precisaDecisao, pergunta, opcoes, resposta, atualizado_em as atualizadoEm FROM plano_passos WHERE plano_id = ? ORDER BY ordem ASC`).all(planoId) as any[];
    return rows.map((r) => ({
      ...r,
      precisaDecisao: !!r.precisaDecisao,
      opcoes: (() => { try { const a = JSON.parse(r.opcoes || "[]"); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } })(),
    }));
  }

  inserirFato(f: { id: string; botId: string; text: string; tipo: "perfil" | "diario" | "regra"; learnedAt: number; empresaId: string; promovido?: boolean }) {
    this.db.prepare(`INSERT INTO fatos (id, bot_id, text, tipo, learned_at, empresa_id, promovido) VALUES (?,?,?,?,?,?,?)`)
      .run(f.id, f.botId, f.text, f.tipo, f.learnedAt, f.empresaId || "", f.promovido ? 1 : 0);
  }

  listarFatos(botId: string, tipo?: "perfil" | "diario" | "regra"): Array<{ id: string; botId: string; text: string; tipo: "perfil" | "diario" | "regra"; learnedAt: number; empresaId: string; promovido: boolean }> {
    const rows = tipo
      ? this.db.prepare(`SELECT * FROM fatos WHERE bot_id=? AND tipo=? ORDER BY learned_at DESC`).all(botId, tipo)
      : this.db.prepare(`SELECT * FROM fatos WHERE bot_id=? ORDER BY learned_at DESC`).all(botId);
    return (rows as any[]).map((r) => ({
      id: r.id, botId: r.bot_id, text: r.text, tipo: r.tipo, learnedAt: r.learned_at, empresaId: r.empresa_id || "", promovido: !!r.promovido,
    }));
  }

  listarFatosEquipe(empresaId: string) {
    return (this.db.prepare(`SELECT * FROM fatos WHERE promovido=1 AND empresa_id=? ORDER BY learned_at DESC`).all(empresaId || "") as any[]).map((r) => ({
      id: r.id, botId: r.bot_id, text: r.text, tipo: r.tipo as "perfil" | "diario" | "regra", learnedAt: r.learned_at, empresaId: r.empresa_id || "", promovido: true,
    }));
  }

  getFato(id: string) {
    const r = this.db.prepare(`SELECT * FROM fatos WHERE id=?`).get(id) as any;
    if (!r) return undefined;
    return { id: r.id, botId: r.bot_id, text: r.text, tipo: r.tipo as "perfil" | "diario" | "regra", learnedAt: r.learned_at, empresaId: r.empresa_id || "", promovido: !!r.promovido };
  }

  atualizarFato(id: string, patch: { text?: string; tipo?: "perfil" | "diario" | "regra" }) {
    const cur = this.getFato(id);
    if (!cur) return false;
    this.db.prepare(`UPDATE fatos SET text=?, tipo=? WHERE id=?`).run(patch.text ?? cur.text, patch.tipo ?? cur.tipo, id);
    return true;
  }

  apagarFato(id: string) {
    this.db.prepare(`DELETE FROM fatos WHERE id=?`).run(id);
  }

  promoverFatoEquipe(id: string, empresaId: string) {
    const cur = this.getFato(id);
    if (!cur) return false;
    this.db.prepare(`UPDATE fatos SET promovido=1, empresa_id=? WHERE id=?`).run(empresaId || cur.empresaId, id);
    return true;
  }

  buscarFatosDiario(botId: string, query: string, limit = 6) {
    const termos = (query || "").toLowerCase().split(/\s+/).filter((t) => t.length > 2).slice(0, 8);
    const todos = this.listarFatos(botId, "diario");
    if (!termos.length) return todos.slice(0, limit);
    const scored = todos.map((f) => {
      const t = f.text.toLowerCase();
      let s = 0;
      for (const w of termos) if (t.includes(w)) s += 1;
      return { f, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || b.f.learnedAt - a.f.learnedAt);
    return scored.slice(0, limit).map((x) => x.f);
  }

  lerResumoBot(botId: string): string | null {
    const r = this.db.prepare(`SELECT texto FROM resumos_bot WHERE bot_id=?`).get(botId) as any;
    return r?.texto ?? null;
  }

  regenerarResumoBot(botId: string, _empresaId = "") {
    const regras = this.listarFatos(botId, "regra").slice(0, 20);
    const perfil = this.listarFatos(botId, "perfil").slice(0, 12);
    const diario = this.listarFatos(botId, "diario").slice(0, 8);
    const linhas = [
      ...regras.map((f) => `- [regra] ${f.text}`),
      ...perfil.map((f) => `- [perfil] ${f.text}`),
      ...diario.map((f) => `- [diario ${new Date(f.learnedAt).toLocaleDateString("pt-BR")}] ${f.text}`),
    ];
    const texto = linhas.length
      ? `Resumo rolante do bot ${botId}:\n${linhas.join("\n")}`.slice(0, 2500)
      : `Resumo rolante do bot ${botId}: (sem fatos ainda)`;
    this.db.prepare(`INSERT INTO resumos_bot (bot_id, texto, atualizado_em) VALUES (?,?,?)
      ON CONFLICT(bot_id) DO UPDATE SET texto=excluded.texto, atualizado_em=excluded.atualizado_em`)
      .run(botId, texto, Date.now());
    return texto;
  }

  blocoFatosParaPrompt(botId: string, empresaId: string): string {
    const regras = this.listarFatos(botId, "regra").slice(0, 30);
    const perfil = this.listarFatos(botId, "perfil").slice(0, 20);
    const resumo = this.lerResumoBot(botId);
    const equipe = this.listarFatosEquipe(empresaId).slice(0, 12);
    const partes: string[] = ["## Memória estruturada deste bot"];
    if (regras.length) {
      partes.push("## Regras aprendidas (correções do chefe — OBEDECER SEMPRE, acima de preferências suas)");
      for (const f of regras) partes.push(`  - ${f.text}  [id: ${f.id}]`);
    } else {
      partes.push("Ainda sem regras aprendidas. Quando o chefe corrigir você, chame aprender_regra com a regra em uma frase.");
    }
    if (perfil.length) {
      partes.push("", "Fatos de perfil (sempre no contexto):");
      for (const f of perfil) partes.push(`  - ${f.text}  [id: ${f.id}]`);
    } else {
      partes.push("", "Ainda sem fatos de perfil. Use remember para guardar.");
    }
    if (resumo) {
      partes.push("", "Resumo rolante:", resumo);
    }
    if (equipe.length) {
      partes.push("", "## Memória da equipe (fatos promovidos)");
      for (const f of equipe) partes.push(`  - ${f.text}  [id: ${f.id}]`);
    }
    partes.push("", "Diário: busque com recall(consulta) ou remember(texto). Correção do chefe → aprender_regra(regra). Painel: editar/apagar regras.");
    return partes.join("\n");
  }

  remember(botId: string, key: string, value: string, empresaId = "") {
    this.db.prepare(`INSERT INTO memory (empresa_id, key, value, bot_id, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(empresa_id, key) DO UPDATE SET value=excluded.value, bot_id=excluded.bot_id, updated_at=excluded.updated_at`)
      .run(empresaId, key, value, botId, Date.now());
  }

  recall(key: string, empresaId = ""): string | null {
    const r = this.db.prepare(`SELECT value FROM memory WHERE key=? AND empresa_id=?`).get(key, empresaId) as any;
    return r?.value ?? null;
  }

  recallPrefix(prefix: string, empresaId = ""): Array<{ key: string; value: string }> {
    return this.db.prepare(`SELECT key, value FROM memory WHERE key LIKE ? AND empresa_id=? ORDER BY key`).all(prefix + "%", empresaId) as any[];
  }

  audit(botId: string | null, action: string, detail?: unknown) {
    const cru = detail === undefined ? null : JSON.stringify(detail);
    this.db.prepare(`INSERT INTO audit (ts, bot_id, action, detail) VALUES (?, ?, ?, ?)`).run(Date.now(), botId, action, cru == null ? null : redigir(cru));
  }

  /** Conexão do cofre, que mora neste mesmo banco. */
  get sqlite(): Database.Database { return this.db; }

  auditTail(limit = 100) {
    return this.db.prepare(`SELECT * FROM audit ORDER BY id DESC LIMIT ?`).all(limit);
  }

  insertTarefa(t: TarefaColab) {
    this.db.prepare(`INSERT INTO colab_tarefas (
      id, de, para, objetivo, contexto, criterio_sucesso, prazo, formato_entrega,
      status, profundidade, tarefa_mae_id, resultado, criada_em, atualizada_em
    ) VALUES (
      @id, @de, @para, @objetivo, @contexto, @criterioSucesso, @prazo, @formatoEntrega,
      @status, @profundidade, @tarefaMaeId, @resultado, @criadaEm, @atualizadaEm
    )`).run({
      ...t,
      prazo: t.prazo,
      formatoEntrega: t.formatoEntrega,
      tarefaMaeId: t.tarefaMaeId,
      resultado: t.resultado ? JSON.stringify(t.resultado) : null,
    });
  }

  getTarefa(id: string): TarefaColab | null {
    const r = this.db.prepare(`SELECT * FROM colab_tarefas WHERE id=?`).get(id);
    return r ? rowToTarefa(r) : null;
  }

  /** Fila do destinatário (`bot` = para), da mais antiga para a mais nova. Sem filtro, devolve todas. */
  listTarefas(filtro: { bot?: string; status?: string } = {}): TarefaColab[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filtro.bot) { where.push("para = ?"); args.push(filtro.bot); }
    if (filtro.status) { where.push("status = ?"); args.push(filtro.status); }
    const sql = `SELECT * FROM colab_tarefas ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY criada_em ASC, id ASC`;
    return (this.db.prepare(sql).all(...args) as any[]).map(rowToTarefa);
  }

  updateTarefa(t: TarefaColab) {
    this.db.prepare(`UPDATE colab_tarefas SET status=?, resultado=?, atualizada_em=? WHERE id=?`)
      .run(t.status, t.resultado ? JSON.stringify(t.resultado) : null, t.atualizadaEm, t.id);
  }
  auditColab(filtro: { bot?: string; desde?: number; limit?: number }) {
    const desde = filtro.desde ?? 0;
    const limit = Math.min(500, Math.max(1, filtro.limit ?? 200));
    const rows = this.db.prepare(
      `SELECT * FROM audit WHERE action LIKE 'colab.%' AND ts >= ? ORDER BY id DESC LIMIT ?`,
    ).all(desde, limit) as Array<{ id: number; ts: number; bot_id: string | null; action: string; detail: string | null }>;
    const bot = filtro.bot?.trim();
    const saida = rows.map((r) => {
      let detail: unknown = null;
      if (r.detail) { try { detail = JSON.parse(r.detail); } catch { detail = r.detail; } }
      return { id: r.id, ts: r.ts, botId: r.bot_id, action: r.action, detail };
    });
    if (!bot) return saida;
    return saida.filter((r) => r.botId === bot || JSON.stringify(r.detail ?? "").includes(bot));
  }

  updateMessageMeta(id: string, meta: Record<string, unknown>) {
    this.db.prepare(`UPDATE messages SET meta=? WHERE id=?`).run(JSON.stringify(meta), id);
  }

  /** Recados de colaboração ainda não entregues a este bot. */
  mensagensColabPendentes(botId: string): StoredMessage[] {
    const rows = this.db.prepare(
      `SELECT * FROM messages WHERE conversation_id LIKE 'pair:%' AND deleted_at IS NULL AND meta LIKE '%"pendente":true%' ORDER BY created_at ASC LIMIT 50`,
    ).all() as any[];
    return rows.map(rowToMessage).filter((m) => m.meta?.para === botId && m.meta?.pendente === true);
  }
}

function rowToTarefa(r: any): TarefaColab {
  let resultado: TarefaColab["resultado"];
  if (r.resultado) {
    try { resultado = JSON.parse(r.resultado); } catch { resultado = undefined; }
  }
  return {
    id: r.id,
    de: r.de,
    para: r.para,
    objetivo: r.objetivo,
    contexto: r.contexto,
    criterioSucesso: r.criterio_sucesso,
    prazo: r.prazo == null ? null : Number(r.prazo),
    formatoEntrega: r.formato_entrega ?? null,
    status: r.status,
    profundidade: Number(r.profundidade ?? 0),
    tarefaMaeId: r.tarefa_mae_id ?? null,
    ...(resultado ? { resultado } : {}),
    criadaEm: Number(r.criada_em),
    atualizadaEm: Number(r.atualizada_em),
  };
}

function rowToMessage(r: any): StoredMessage {
  return {
    id: r.id, conversationId: r.conversation_id,
    sender: { kind: r.sender_kind, id: r.sender_id, name: r.sender_name } as Sender,
    text: r.text, createdAt: r.created_at, meta: r.meta ? JSON.parse(r.meta) : undefined,
    ...(r.pinned ? { pinned: true } : {}),
    ...(r.edit_of ? { editOf: r.edit_of } : {}),
  };
}
