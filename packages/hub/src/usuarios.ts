import crypto from "node:crypto";
import type Database from "better-sqlite3";

export type RoleUsuario = "owner" | "cliente";

export type Usuario = {
  id: string;
  email: string;
  name: string;
  role: RoleUsuario;
  googleSub: string | null;
  createdAt: number;
  lastLoginAt: number | null;
};

function rowToUser(r: any): Usuario {
  return {
    id: String(r.id),
    email: String(r.email),
    name: String(r.name ?? ""),
    role: r.role === "owner" ? "owner" : "cliente",
    googleSub: r.google_sub ? String(r.google_sub) : null,
    createdAt: Number(r.created_at),
    lastLoginAt: r.last_login_at == null ? null : Number(r.last_login_at),
  };
}

export class UsuariosRepo {
  constructor(private db: Database.Database) {}

  ensure() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'cliente',
        google_sub TEXT,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
    `);
    this.adicionarColuna("managed_bots", "owner_user_id", "TEXT");
    this.adicionarColuna("groups", "owner_user_id", "TEXT");
    this.adicionarColuna("files", "owner_user_id", "TEXT");
    this.adicionarColuna("bots", "owner_user_id", "TEXT");
    this.adicionarColuna("routines", "owner_user_id", "TEXT");
  }

  private adicionarColuna(tabela: string, coluna: string, tipo: string) {
    try { this.db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`); } catch { /* ja existe */ }
  }

  getById(id: string): Usuario | undefined {
    const r = this.db.prepare(`SELECT * FROM users WHERE id=?`).get(id);
    return r ? rowToUser(r) : undefined;
  }

  getByEmail(email: string): Usuario | undefined {
    const r = this.db.prepare(`SELECT * FROM users WHERE email=?`).get(email.trim().toLowerCase());
    return r ? rowToUser(r) : undefined;
  }

  list(): Usuario[] {
    return (this.db.prepare(`SELECT * FROM users ORDER BY created_at`).all() as any[]).map(rowToUser);
  }

  /** Garante o owner a partir do e-mail configurado. Bots existentes sem dono passam a ser dele. */
  ensureOwner(email: string, name = "Owner"): Usuario | null {
    const e = email.trim().toLowerCase();
    if (!e) return null;
    this.ensure();
    let u = this.getByEmail(e);
    const agora = Date.now();
    if (!u) {
      const id = "usr_" + crypto.randomBytes(8).toString("hex");
      this.db.prepare(
        `INSERT INTO users (id, email, name, role, google_sub, created_at, last_login_at) VALUES (?,?,?,?,NULL,?,NULL)`,
      ).run(id, e, name || e.split("@")[0], "owner", agora);
      u = this.getById(id)!;
    } else if (u.role !== "owner") {
      this.db.prepare(`UPDATE users SET role='owner', name=COALESCE(NULLIF(name,''), ?) WHERE id=?`).run(name, u.id);
      u = this.getById(u.id)!;
    }
    // Migracao: tudo sem owner_user_id fica do dono.
    this.db.prepare(`UPDATE managed_bots SET owner_user_id=? WHERE owner_user_id IS NULL OR owner_user_id=''`).run(u.id);
    this.db.prepare(`UPDATE groups SET owner_user_id=? WHERE owner_user_id IS NULL OR owner_user_id=''`).run(u.id);
    this.db.prepare(`UPDATE files SET owner_user_id=? WHERE owner_user_id IS NULL OR owner_user_id=''`).run(u.id);
    this.db.prepare(`UPDATE bots SET owner_user_id=? WHERE owner_user_id IS NULL OR owner_user_id=''`).run(u.id);
    this.db.prepare(`UPDATE routines SET owner_user_id=? WHERE owner_user_id IS NULL OR owner_user_id=''`).run(u.id);
    // Tambem no JSON def dos managed bots
    const rows = this.db.prepare(`SELECT id, def FROM managed_bots`).all() as Array<{ id: string; def: string }>;
    const up = this.db.prepare(`UPDATE managed_bots SET def=? WHERE id=?`);
    for (const row of rows) {
      try {
        const def = JSON.parse(row.def);
        if (!def.ownerUserId) {
          def.ownerUserId = u.id;
          up.run(JSON.stringify(def), row.id);
        }
      } catch { /* ignore */ }
    }
    return u;
  }

  /** Login Google: cria como cliente ativo (sem aprovacao). Se o e-mail for o owner, promove. */
  upsertGoogle(opts: { email: string; name: string; googleSub: string; ownerEmail: string }): Usuario {
    this.ensure();
    const email = opts.email.trim().toLowerCase();
    const agora = Date.now();
    const isOwner = !!opts.ownerEmail && email === opts.ownerEmail.trim().toLowerCase();
    let u = this.getByEmail(email) || (opts.googleSub
      ? (() => {
          const r = this.db.prepare(`SELECT * FROM users WHERE google_sub=?`).get(opts.googleSub);
          return r ? rowToUser(r) : undefined;
        })()
      : undefined);

    if (!u) {
      const id = "usr_" + crypto.randomBytes(8).toString("hex");
      this.db.prepare(
        `INSERT INTO users (id, email, name, role, google_sub, created_at, last_login_at) VALUES (?,?,?,?,?,?,?)`,
      ).run(id, email, opts.name || email.split("@")[0], isOwner ? "owner" : "cliente", opts.googleSub, agora, agora);
      return this.getById(id)!;
    }
    const role = isOwner ? "owner" : u.role;
    this.db.prepare(
      `UPDATE users SET email=?, name=COALESCE(NULLIF(?,''), name), role=?, google_sub=COALESCE(?, google_sub), last_login_at=? WHERE id=?`,
    ).run(email, opts.name, role, opts.googleSub, agora, u.id);
    return this.getById(u.id)!;
  }

  touchLogin(id: string) {
    this.db.prepare(`UPDATE users SET last_login_at=? WHERE id=?`).run(Date.now(), id);
  }

  setOwnerUserIdManaged(botId: string, ownerUserId: string) {
    this.db.prepare(`UPDATE managed_bots SET owner_user_id=? WHERE id=?`).run(ownerUserId, botId);
    const r = this.db.prepare(`SELECT def FROM managed_bots WHERE id=?`).get(botId) as { def?: string } | undefined;
    if (!r?.def) return;
    try {
      const def = JSON.parse(r.def);
      def.ownerUserId = ownerUserId;
      this.db.prepare(`UPDATE managed_bots SET def=? WHERE id=?`).run(JSON.stringify(def), botId);
    } catch { /* ignore */ }
  }

  ownerUserIdDoBot(botId: string): string | null {
    const r = this.db.prepare(`SELECT owner_user_id, def FROM managed_bots WHERE id=?`).get(botId) as any;
    if (!r) {
      const b = this.db.prepare(`SELECT owner_user_id FROM bots WHERE id=?`).get(botId) as any;
      return b?.owner_user_id ? String(b.owner_user_id) : null;
    }
    if (r.owner_user_id) return String(r.owner_user_id);
    try {
      const def = JSON.parse(r.def);
      return def.ownerUserId ? String(def.ownerUserId) : null;
    } catch {
      return null;
    }
  }
}

export function podeVerRecurso(user: Usuario | null | undefined, ownerUserId: string | null | undefined, escopo?: "meus" | "clientes" | "todos"): boolean {
  if (!user) return false;
  if (user.role === "owner") {
    const e = escopo || "todos";
    if (e === "todos") return true;
    if (e === "meus") return !ownerUserId || ownerUserId === user.id;
    if (e === "clientes") return !!ownerUserId && ownerUserId !== user.id;
    return true;
  }
  return !!ownerUserId && ownerUserId === user.id;
}
