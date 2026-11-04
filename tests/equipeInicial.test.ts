import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Db } from "../packages/hub/src/db.ts";
import { BotManager } from "../packages/hub/src/botManager.ts";
import type { Hub } from "../packages/hub/src/hub.ts";
import {
  REGRA_DO_DONO,
  aplicarSeed,
  camposDoNascimento,
  decidirSeed,
  idBotInicial,
  lerOferecidas,
  marcarOferecida,
  sufixoDaConta,
} from "../packages/hub/src/equipeInicial.ts";
import { carregarReceita, idsEquipeInicial } from "../packages/hub/src/receitas.ts";
import { receitaInicialPorNome } from "../packages/hub/src/importarLink.ts";
import { filtrarBotsPorUsuario } from "../packages/hub/src/isolamento.ts";
import type { Usuario } from "../packages/hub/src/usuarios.ts";
import { selecionarKitFerramentas } from "../packages/node/src/kitFerramentas.ts";

const NOVOS = [
  "secretaria-email", "assistente-executiva", "atendimento-cliente", "tira-duvidas",
  "prospeccao-clientes", "vendedor", "pos-atendimento", "gestor-leads", "depoimentos",
  "revisor-textos", "redator-textos", "imagens-miniaturas", "cortes-reels", "vigia-anuncios",
  "analista-marketing", "vigia-concorrencia", "monitor-marca", "auditor-site",
  "pesquisador-web", "cacador-ofertas",
];

function usuario(id: string, role: "owner" | "cliente" = "cliente"): Usuario {
  return { id, email: id + "@ex.com", name: id, role, googleSub: null, createdAt: 1, lastLoginAt: null };
}

test("catálogo: 20 ofícios além de PROGRAMADOR, SEO e Director", () => {
  const ids = idsEquipeInicial();
  assert.deepEqual(ids.slice(0, 3), ["programador-pro", "seo-aeo-desk", "director"]);
  for (const id of NOVOS) assert.ok(ids.includes(id), id);
  assert.equal(ids.length, 23);
  for (const id of NOVOS) {
    const r = carregarReceita(id);
    assert.ok(r, id);
    assert.equal(r!.provedor?.kind, "8token");
    assert.equal(r!.provedor?.model, "claude-fable-5.1");
    assert.equal(r!.visao, true);
    assert.equal(r!.navegacao, true);
    assert.match(r!.persona || "", new RegExp(REGRA_DO_DONO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(r!.memory.some((m) => m.content.includes(REGRA_DO_DONO)));
    assert.match(r!.profile.ameba || "", /^https:\/\//);
    assert.match(r!.profile.cor || "", /^#[0-9A-Fa-f]{6}$/);
    assert.equal(r!.profile.name && /[A-Za-zÀ-ú]/.test(r!.profile.name), true);
    assert.ok(!/sk-|api[_-]?key|EIGHTTOKEN_API_KEY\s*=/i.test(JSON.stringify(r)));
  }
});

test("parser do link reconhece o nome original e o nome em português", () => {
  assert.equal(receitaInicialPorNome("Tradbot"), "secretaria-email");
  assert.equal(receitaInicialPorNome("Secretária de E-mail e Agenda"), "secretaria-email");
  assert.equal(receitaInicialPorNome("Sell Bot"), "vendedor");
  assert.equal(receitaInicialPorNome("Caçador de Ofertas"), "cacador-ofertas");
  assert.equal(receitaInicialPorNome("Director"), "director");
  assert.equal(receitaInicialPorNome("Recepcionista"), null);
});

test("sufixo da conta é o mesmo dos iniciais e não mistura tenant", () => {
  const a = sufixoDaConta("usr_aabbccdd11223344");
  const b = sufixoDaConta("usr_eeff001199887766");
  assert.equal(a, "aabbccdd");
  assert.equal(b, "eeff0011");
  assert.equal(idBotInicial("secretaria-email", a), "secretaria-email-aabbccdd");
  assert.notEqual(idBotInicial("vendedor", a), idBotInicial("vendedor", b));
  const da = decidirSeed(NOVOS, a, new Set(), new Set());
  const db = decidirSeed(NOVOS, b, new Set(), new Set());
  const idsA = new Set(da.map((x) => x.botId));
  for (const item of db) assert.equal(idsA.has(item.botId), false);
});

test("seed idempotente: não recria, não chama criar de novo e não mexe em edição", async () => {
  const sufixo = "aabbccdd";
  const existentes = new Set<string>([idBotInicial("vendedor", sufixo)]);
  const oferecidas = new Set<string>();
  const criados: string[] = [];
  const persona = new Map<string, string>([[idBotInicial("vendedor", sufixo), "EDICAO DO DONO"]]);
  const r1 = await aplicarSeed({
    receitas: ["vendedor", "pesquisador-web"],
    sufixo,
    existentes,
    oferecidas,
    marcar: (receita) => oferecidas.add(receita),
    criar: async (receita, botId) => {
      criados.push(botId);
      persona.set(botId, "nasceu");
      return { ok: true };
    },
  });
  assert.deepEqual(r1.map((x) => x.status), ["ja_existe", "criado"]);
  assert.deepEqual(criados, [idBotInicial("pesquisador-web", sufixo)]);
  assert.equal(persona.get(idBotInicial("vendedor", sufixo)), "EDICAO DO DONO");
  persona.set(idBotInicial("vendedor", sufixo), "EDICAO DO DONO de novo");
  const r2 = await aplicarSeed({
    receitas: ["vendedor", "pesquisador-web"],
    sufixo,
    existentes,
    oferecidas,
    marcar: () => { throw new Error("não marca de novo"); },
    criar: async () => { throw new Error("não cria de novo"); },
  });
  assert.deepEqual(r2.map((x) => x.status), ["ja_oferecido", "ja_oferecido"]);
  assert.equal(persona.get(idBotInicial("vendedor", sufixo)), "EDICAO DO DONO de novo");
});

test("falha de criação não marca a oferta, para tentar de novo", async () => {
  const oferecidas = new Set<string>();
  const r1 = await aplicarSeed({
    receitas: ["auditor-site"],
    sufixo: "zz11",
    existentes: new Set(),
    oferecidas,
    marcar: () => { throw new Error("não era para marcar"); },
    criar: async () => ({ ok: false, detalhe: "sem chave" }),
  });
  assert.equal(r1[0].status, "sem chave");
  assert.equal(oferecidas.size, 0);
});

test("nascimento grava 8token, visão, navegação, cor e avatar, sem segredo", () => {
  const r = carregarReceita("cacador-ofertas")!;
  const c = camposDoNascimento(r, {});
  assert.equal(c.provider.kind, "8token");
  assert.equal(c.provider.model, "claude-fable-5.1");
  assert.equal(c.visao, true);
  assert.equal(c.navegacao, true);
  assert.equal(c.color, "#FF309B");
  assert.match(c.avatar || "", /^https:\/\/x\.ai\/bot\//);
  assert.match(c.persona || "", /Mercado Livre/);
  assert.equal("apiKey" in c.provider, false);
  const antigo = camposDoNascimento(carregarReceita("programador-pro"), {});
  assert.equal(antigo.provider.kind, "zai");
  assert.equal(antigo.visao, false);
  assert.equal(antigo.navegacao, false);
});

test("kit: visão e navegação entram só quando o flag pede", () => {
  const defs = ["ask_user", "navegador", "read_attachment", "fetch_url"].map((name) => ({
    name, description: name, parameters: { type: "object" as const, properties: {} },
  }));
  const ligado = selecionarKitFerramentas(defs, { navegacao: true, visao: true, role: "contador de planilha" });
  assert.ok(ligado.incluidas.includes("navegador"));
  assert.ok(ligado.incluidas.includes("read_attachment"));
  const solto = selecionarKitFerramentas(defs, { role: "contador de planilha" });
  assert.equal(solto.incluidas.includes("navegador"), false);
  assert.equal(solto.incluidas.includes("read_attachment"), false);
});

test("dois tenants: o seed cria os bots de cada um e o cliente não vê o do outro", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-equipe-"));
  const botsDir = path.join(dir, "bots");
  fs.mkdirSync(botsDir);
  process.env.MYBOTS_BOTS_DIR = botsDir;
  process.env.EIGHTTOKEN_API_KEY = "teste-local";
  process.env.ZAI_API_KEY = "teste-local";
  process.env.MYBOTS_EQUIPE_AUTOSTART = "0";
  const db = new Db(path.join(dir, "hub.sqlite"));
  const hub = {
    db,
    botNasceu() {},
    botUpdate() {},
    summaries: () => [],
    broadcastKnowledge() {},
    removeBot() {},
    dbAudit() {},
  } as unknown as Hub;
  const manager = new BotManager(hub);
  db.saveEmpresa({ id: "casa", nome: "Casa" });

  const semear = async (userId: string) => {
    const sufixo = sufixoDaConta(userId);
    const oferecidas = lerOferecidas(db.db, "usuario", userId);
    const existentes = new Set(manager.list().map((b) => b.id));
    return aplicarSeed({
      receitas: idsEquipeInicial(),
      sufixo,
      existentes,
      oferecidas,
      marcar: (receita, botId) => marcarOferecida(db.db, "usuario", userId, receita, botId),
      criar: async (receitaId, botId) => {
        const receita = carregarReceita(receitaId);
        if (!receita) return { ok: false, detalhe: "ausente" };
        const campos = camposDoNascimento(receita, { autoStart: false });
        const r = manager.create({ id: botId, name: receita.profile.name, ...campos, ownerUserId: userId, autoStart: false });
        if ("error" in r) return { ok: false, detalhe: r.error };
        return { ok: true };
      },
    });
  };

  const a = "usr_aaaaaaaabbbbbbbb";
  const b = "usr_cccccccddddddddd";
  const s1 = await semear(a);
  assert.equal(s1.filter((x) => x.status === "criado").length, 23);
  const vendedor = manager.get(idBotInicial("vendedor", sufixoDaConta(a)))!;
  assert.equal(vendedor.provider.kind, "8token");
  assert.equal(vendedor.provider.model, "claude-fable-5.1");
  assert.equal(vendedor.visao, true);
  assert.equal(vendedor.navegacao, true);
  assert.equal(vendedor.color, "#FF6700");
  assert.match(vendedor.avatar || "", /^https:\/\//);
  const cfg = JSON.parse(fs.readFileSync(path.join(botsDir, vendedor.id, "mybots-node.json"), "utf8"));
  assert.equal(cfg.provider.kind, "8token");
  assert.equal(cfg.provider.model, "claude-fable-5.1");
  assert.equal(cfg.visao, true);
  assert.equal(cfg.navegacao, true);
  assert.equal(cfg.bot.color, "#FF6700");
  const env = fs.readFileSync(path.join(botsDir, vendedor.id, ".env"), "utf8");
  assert.equal(/EIGHTTOKEN|ZAI_API|sk-|teste-local/.test(env), false);
  const personaAntes = fs.readFileSync(path.join(botsDir, vendedor.id, "persona.md"), "utf8");
  assert.match(personaAntes, new RegExp(REGRA_DO_DONO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  manager.update(vendedor.id, { persona: "EDICAO DO DONO neste vendedor" });

  const s2 = await semear(a);
  assert.equal(s2.every((x) => x.status === "ja_oferecido"), true);
  const personaDepois = fs.readFileSync(path.join(botsDir, vendedor.id, "persona.md"), "utf8");
  assert.equal(personaDepois, "EDICAO DO DONO neste vendedor");

  const sB = await semear(b);
  assert.equal(sB.filter((x) => x.status === "criado").length, 23);
  const todos = manager.list();
  const soA = filtrarBotsPorUsuario(todos, usuario(a), "todos");
  const soB = filtrarBotsPorUsuario(todos, usuario(b), "todos");
  assert.equal(soA.length, 23);
  assert.equal(soB.length, 23);
  assert.equal(soA.some((x) => x.ownerUserId === b), false);
  assert.equal(soB.some((x) => x.id === vendedor.id), false);
  const prog = manager.get(idBotInicial("programador-pro", sufixoDaConta(a)))!;
  assert.equal(prog.provider.kind, "zai");
  assert.equal(prog.visao, undefined);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
