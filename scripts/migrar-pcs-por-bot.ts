/**
 * Registra o PC de cada bot que já existe. Não sobe os containers e não apaga
 * volume nenhum — nem o novo de cada bot, nem o antigo da empresa
 * (`dados/maquinas/<empresa>`).
 *
 * Pode rodar de novo: o segundo passe devolve as mesmas portas.
 *
 *   node --import tsx scripts/migrar-pcs-por-bot.ts
 *   node --import tsx scripts/migrar-pcs-por-bot.ts --db packages/hub/data/mybots.sqlite --bots bots
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { raizDoProjeto } from "../packages/hub/src/config.js";
import { NAVEGADOR_DO_PC, migrarRegistros, politicaDoPc, type BotParaPc } from "../packages/hub/src/pcs.js";

type LinhaBot = { id: string; name?: string; empresa_id?: string | null };
type LinhaManaged = { id: string; def: string; created_at: number };

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function bancoPadrao(): string | undefined {
  if (process.env.MYBOTS_DB && fs.existsSync(process.env.MYBOTS_DB)) return process.env.MYBOTS_DB;
  const raiz = raizDoProjeto();
  for (const p of [path.join(raiz, "packages", "hub", "data", "mybots.sqlite"), path.join(raiz, "data", "mybots.sqlite")]) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function lerJson<T>(bruto: string): T | undefined {
  try { return JSON.parse(bruto.replace(/^\uFEFF/, "")) as T; } catch { return undefined; }
}

export function botsDaPasta(dir: string): BotParaPc[] {
  if (!dir || !fs.existsSync(dir)) return [];
  const fora: BotParaPc[] = [];
  for (const nome of fs.readdirSync(dir)) {
    const pasta = path.join(dir, nome);
    if (!fs.statSync(pasta).isDirectory()) continue;
    if (fs.existsSync(path.join(pasta, ".removido"))) continue;
    const cfg = path.join(pasta, "mybots-node.json");
    if (!fs.existsSync(cfg)) continue;
    const j = lerJson<{ bot?: { id?: string; name?: string } }>(fs.readFileSync(cfg, "utf8"));
    const id = j?.bot?.id || nome;
    fora.push({ id, nome: j?.bot?.name || nome, empresaId: null, createdAt: 0 });
  }
  return fora;
}

export function botsDoBanco(arquivo: string): BotParaPc[] {
  if (!arquivo || !fs.existsSync(arquivo)) return [];
  const db = new Database(arquivo, { readonly: true, fileMustExist: true });
  try {
    const tabelas = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map((t) => t.name));
    const porId = new Map<string, BotParaPc>();
    if (tabelas.has("bots")) {
      const linhas = db.prepare(`SELECT id, name, empresa_id FROM bots`).all() as LinhaBot[];
      for (const b of linhas) {
        if (!b.id) continue;
        porId.set(b.id, { id: b.id, nome: b.name || b.id, empresaId: b.empresa_id || null, createdAt: 0 });
      }
    }
    if (tabelas.has("managed_bots")) {
      const linhas = db.prepare(`SELECT id, def, created_at FROM managed_bots`).all() as LinhaManaged[];
      for (const m of linhas) {
        const def = lerJson<{ name?: string; gerente?: boolean; createdAt?: number }>(m.def) ?? {};
        const atual = porId.get(m.id);
        porId.set(m.id, {
          id: m.id,
          nome: def.name || atual?.nome || m.id,
          empresaId: atual?.empresaId ?? null,
          gerente: !!def.gerente,
          createdAt: def.createdAt || m.created_at || atual?.createdAt || 0,
        });
      }
    }
    return [...porId.values()];
  } finally {
    db.close();
  }
}

function juntar(lista: BotParaPc[]): BotParaPc[] {
  const porId = new Map<string, BotParaPc>();
  for (const b of lista) {
    const atual = porId.get(b.id);
    if (!atual) { porId.set(b.id, { ...b }); continue; }
    porId.set(b.id, {
      id: b.id,
      nome: b.nome || atual.nome,
      empresaId: b.empresaId ?? atual.empresaId,
      gerente: !!(b.gerente || atual.gerente),
      createdAt: [atual.createdAt, b.createdAt].filter((n) => !!n).sort((a, c) => (a ?? 0) - (c ?? 0))[0] ?? 0,
    });
  }
  return [...porId.values()];
}

export function volumesAntigos(raiz: string): string[] {
  if (!fs.existsSync(raiz)) return [];
  return fs.readdirSync(raiz).filter((nome) => {
    if (nome === "bots" || nome.endsWith(".json")) return false;
    try { return fs.statSync(path.join(raiz, nome)).isDirectory(); } catch { return false; }
  });
}

export function executarMigracao(op: { db?: string; botsDir?: string; raiz: string }) {
  process.env.MYBOTS_MAQUINAS_DIR = op.raiz;
  const antes = volumesAntigos(op.raiz);
  const bots = juntar([
    ...botsDaPasta(op.botsDir ?? ""),
    ...botsDoBanco(op.db ?? ""),
  ]);
  const r = migrarRegistros(bots);
  const depois = volumesAntigos(op.raiz);
  return {
    bots: bots.length,
    criados: r.criados,
    jaExistiam: r.jaExistiam,
    containersLigados: 0,
    volumesApagados: antes.filter((n) => !depois.includes(n)),
    volumesAntigos: depois,
  };
}

function imprimir(resumo: ReturnType<typeof executarMigracao>) {
  const pol = politicaDoPc();
  console.log("migração de PCs por bot");
  console.log(`  bots encontrados: ${resumo.bots}`);
  console.log(`  registros novos: ${resumo.criados.length}`);
  console.log(`  já existiam: ${resumo.jaExistiam.length}`);
  console.log(`  containers ligados nesta migração: ${resumo.containersLigados}`);
  console.log(`  volumes antigos apagados: ${resumo.volumesApagados.length}`);
  if (resumo.volumesAntigos.length) console.log(`  volumes antigos preservados: ${resumo.volumesAntigos.join(", ")}`);
  console.log(`  navegador: ${NAVEGADOR_DO_PC.binario} (${NAVEGADOR_DO_PC.imagem})`);
  console.log(`  motivo: ${NAVEGADOR_DO_PC.motivo}`);
  console.log(`  memória por container: ${pol.memoria}   cpu: ${pol.cpus}   ocioso: ${pol.ociosoMin} min`);
}

const direto = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (direto) {
  const raizProjeto = raizDoProjeto();
  const raiz = path.resolve(arg("--raiz") ?? process.env.MYBOTS_MAQUINAS_DIR ?? path.join(raizProjeto, "dados", "maquinas"));
  const db = arg("--db") ?? bancoPadrao();
  const botsDir = arg("--bots") ?? path.join(raizProjeto, "bots");
  const resumo = executarMigracao({ db, botsDir, raiz });
  imprimir(resumo);
}
