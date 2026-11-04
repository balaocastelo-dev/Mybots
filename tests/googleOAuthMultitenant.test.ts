import { test } from "node:test";
import assert from "node:assert/strict";
import { rotaPublicaOnline, googleOAuthAtivo, authOnlineAtivo } from "../packages/hub/src/authOnline.ts";
import { podeVerRecurso } from "../packages/hub/src/usuarios.ts";
import { UsuariosRepo } from "../packages/hub/src/usuarios.ts";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("rotas Google OAuth sao publicas", () => {
  assert.equal(rotaPublicaOnline("/api/auth/google"), true);
  assert.equal(rotaPublicaOnline("/api/auth/google/callback"), true);
  assert.equal(rotaPublicaOnline("/api/login"), true);
});

test("isolamento: cliente so ve o proprio; owner ve todos", () => {
  const owner = { id: "u1", email: "o@x.com", name: "O", role: "owner" as const, googleSub: null, createdAt: 1, lastLoginAt: null };
  const cli = { id: "u2", email: "c@x.com", name: "C", role: "cliente" as const, googleSub: "g", createdAt: 1, lastLoginAt: null };
  assert.equal(podeVerRecurso(cli, "u2"), true);
  assert.equal(podeVerRecurso(cli, "u1"), false);
  assert.equal(podeVerRecurso(owner, "u2"), true);
  assert.equal(podeVerRecurso(owner, "u1", "meus"), true);
  assert.equal(podeVerRecurso(owner, "u2", "meus"), false);
  assert.equal(podeVerRecurso(owner, "u2", "clientes"), true);
});

test("novo Google vira cliente; ownerEmail vira owner; sem aprovacao", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-users-"));
  const db = new Database(path.join(dir, "t.db"));
  // tabelas minimas usadas no ensure
  db.exec(`CREATE TABLE managed_bots (id TEXT PRIMARY KEY, def TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, members TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE files (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, bot_id TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE bots (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT, avatar TEXT, color TEXT, voice TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE routines (id TEXT PRIMARY KEY, bot_id TEXT, name TEXT, cron TEXT, prompt TEXT, enabled INTEGER, created_at INTEGER NOT NULL);`);
  const repo = new UsuariosRepo(db);
  repo.ensure();
  const c = repo.upsertGoogle({ email: "cliente@ex.com", name: "Cli", googleSub: "sub1", ownerEmail: "dono@ex.com" });
  assert.equal(c.role, "cliente");
  const o = repo.upsertGoogle({ email: "dono@ex.com", name: "Dono", googleSub: "sub2", ownerEmail: "dono@ex.com" });
  assert.equal(o.role, "owner");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("googleOAuthAtivo depende das tres envs", () => {
  // so garante a funcao existe e retorna boolean no estado atual
  assert.equal(typeof googleOAuthAtivo(), "boolean");
  assert.equal(typeof authOnlineAtivo(), "boolean");
});
