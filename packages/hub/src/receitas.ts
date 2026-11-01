/**
 * Receitas MyBots: um JSON por especialidade (profile, memory, skills, routines…).
 * Nascimento: Hub aplica memória/skills/rotinas pausadas antes da saudação.
 */
import fs from "node:fs";
import path from "node:path";
import { newId } from "@mybots/shared";
import { raizDoProjeto } from "./config.js";
import {
  carregarSkillsDaEspecialidade,
  listarEspecialidades,
  type Especialidade,
} from "./especialidades.js";
import { montarPromptChamada } from "./promptChamada.js";
import { nextRunOf } from "./scheduler.js";
import type { Db } from "./db.js";

export type TipoFato = "perfil" | "diario" | "regra";

export type ReceitaMemory = {
  content: string;
  type: TipoFato;
  createdAt?: string;
};

export type ReceitaSkill = {
  name: string;
  description: string;
  content: string;
};

export type ReceitaRoutine = {
  name: string;
  schedule: string;
  prompt: string;
  created?: "paused" | "enabled";
};

export type Receita = {
  versao: 1;
  id: string;
  profile: {
    name: string;
    description: string;
    ameba?: string;
  };
  memory: ReceitaMemory[];
  skills: ReceitaSkill[];
  routines: ReceitaRoutine[];
  tools?: string[];
  mcps?: Array<{ id: string; nome?: string }>;
  gettingStarted?: string;
  especialidadeId?: string;
};

export type Fato = {
  id: string;
  botId: string;
  text: string;
  tipo: TipoFato;
  learnedAt: number;
  empresaId: string;
  promovido: boolean;
};

export const EQUIPE = "__equipe__";

export function pastaReceitas(): string {
  return path.join(raizDoProjeto(), "receitas");
}

export function listarIdsReceitas(): string[] {
  const dir = pastaReceitas();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export function carregarReceita(id: string): Receita | null {
  const p = path.join(pastaReceitas(), `${id}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as Receita;
    if (!j || j.versao !== 1 || !j.id || !j.profile?.name) return null;
    return j;
  } catch {
    return null;
  }
}

export function listarReceitas(): Receita[] {
  return listarIdsReceitas()
    .map((id) => carregarReceita(id))
    .filter((r): r is Receita => !!r);
}

function amebaEstavel(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const n = (h % 100) + 1;
  return "/amebas/v2/ameba-v2-" + String(n).padStart(3, "0") + ".png";
}

/** Converte uma especialidade do catálogo numa receita MyBots. */
export function especialidadeParaReceita(esp: Especialidade): Receita {
  const skillsMd = carregarSkillsDaEspecialidade(esp);
  const skills: ReceitaSkill[] = skillsMd.map((s) => ({
    name: s.id,
    description: s.titulo.replace(/^Skill:\s*/i, ""),
    content: s.conteudo,
  }));
  const memory: ReceitaMemory[] = [
    {
      content: `Especialidade: ${esp.nome}. ${(esp.onboarding || "").replace(/\s+/g, " ").trim().slice(0, 280)}`,
      type: "perfil",
    },
  ];
  if (esp.aviso) {
    memory.push({
      content: `Aviso permanente: ${esp.aviso.replace(/\s+/g, " ").trim().slice(0, 240)}`,
      type: "perfil",
    });
  }
  const soulLine = (esp.soul || "").replace(/\s+/g, " ").trim().slice(0, 220);
  if (soulLine) {
    memory.push({ content: `Jeito de trabalhar: ${soulLine}`, type: "perfil" });
  }

  const routines: ReceitaRoutine[] = [
    {
      name: "Revisão semanal da especialidade",
      schedule: "0 9 * * 1",
      prompt: `Revise em poucas linhas o que avançou nesta semana como ${esp.nome}. Liste pendências e uma próxima ação concreta. Não invente resultados.`,
      created: "paused",
    },
  ];
  if (esp.skills?.length) {
    routines.push({
      name: "Checklist das skills",
      schedule: "0 10 * * 3",
      prompt: `Percorra as skills ${esp.skills.slice(0, 6).join(", ")} e diga quais precisam de atualização ou exemplo novo. Sem inventar status.`,
      created: "paused",
    });
  }

  return {
    versao: 1,
    id: esp.id,
    profile: {
      name: esp.nome,
      description: (esp.onboarding || esp.soul || esp.nome).replace(/\s+/g, " ").trim().slice(0, 400),
      ameba: amebaEstavel(esp.id),
    },
    memory,
    skills,
    routines,
    tools: [...(esp.ferramentas || [])],
    mcps: (esp.mcpOpcionais || []).map((m) => ({ id: m.id, nome: m.nome })),
    gettingStarted: esp.onboarding || undefined,
    especialidadeId: esp.id,
  };
}

export function gravarReceita(r: Receita): string {
  const dir = pastaReceitas();
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${r.id}.json`);
  fs.writeFileSync(p, JSON.stringify(r, null, 2) + "\n", "utf8");
  return p;
}

export function gerarTodasReceitasDoCatalogo(): { ok: number; falhas: string[] } {
  const falhas: string[] = [];
  let ok = 0;
  for (const esp of listarEspecialidades()) {
    try {
      gravarReceita(especialidadeParaReceita(esp));
      ok++;
    } catch (e) {
      falhas.push(`${esp.id}: ${(e as Error).message}`);
    }
  }
  return { ok, falhas };
}

export type AplicarResultado = {
  memorias: number;
  skills: number;
  rotinas: number;
  erros: string[];
};

/**
 * Setup no nascimento: grava memórias, skills e rotinas pausadas.
 * Se um item falha, continua com o resto e registra o erro.
 */
export function aplicarReceitaNoNascimento(
  db: Db,
  opts: {
    botId: string;
    botName: string;
    empresaId: string;
    receita: Receita;
    botsDir?: string;
  },
): AplicarResultado {
  const erros: string[] = [];
  let memorias = 0;
  let skills = 0;
  let rotinas = 0;
  const { botId, empresaId, receita } = opts;

  for (const m of receita.memory || []) {
    try {
      const text = String(m.content || "").trim();
      if (!text) continue;
      db.inserirFato({
        id: newId("fato"),
        botId,
        text,
        tipo: m.type === "diario" ? "diario" : m.type === "regra" ? "regra" : "perfil",
        learnedAt: m.createdAt ? Date.parse(m.createdAt) || Date.now() : Date.now(),
        empresaId,
        promovido: false,
      });
      memorias++;
    } catch (e) {
      erros.push(`memory: ${(e as Error).message}`);
    }
  }

  for (const sk of receita.skills || []) {
    try {
      const name = String(sk.name || "skill").trim();
      const content = String(sk.content || "").trim();
      if (!content) continue;
      db.saveSaber({
        id: `skill-${botId}-${name}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 80),
        titulo: sk.description || `Skill: ${name}`,
        resumo: `Skill da receita ${receita.id} (${name})`,
        conteudo: content,
        tipo: "procedimento",
        tags: ["skill", "receita", receita.id, name].filter(Boolean),
        bots: [botId],
        origem: "receita",
      });
      skills++;
    } catch (e) {
      erros.push(`skill ${sk.name}: ${(e as Error).message}`);
    }
  }

  for (const rt of receita.routines || []) {
    try {
      const name = String(rt.name || "rotina").trim();
      const cron = String(rt.schedule || "").trim();
      const prompt = String(rt.prompt || "").trim();
      if (!cron || !prompt) continue;
      let next: number | undefined;
      try {
        next = nextRunOf(cron);
      } catch {
        next = undefined;
      }
      const paused = (rt.created || "paused") !== "enabled";
      db.insertRoutine({
        id: newId("r"),
        botId,
        name,
        cron,
        prompt,
        enabled: !paused,
        nextRun: paused ? undefined : next,
        createdAt: Date.now(),
      });
      rotinas++;
    } catch (e) {
      erros.push(`routine ${rt.name}: ${(e as Error).message}`);
    }
  }

  try {
    const botsDir = opts.botsDir || path.join(raizDoProjeto(), "bots");
    const dir = path.join(botsDir, botId);
    fs.mkdirSync(dir, { recursive: true });
    const texto = montarPromptChamada(opts.botName || receita.profile.name, receita.profile.description);
    fs.writeFileSync(path.join(dir, "prompt-chamada.md"), texto + "\n", "utf8");
  } catch (e) {
    erros.push(`prompt-chamada: ${(e as Error).message}`);
  }

  try {
    db.regenerarResumoBot(botId, empresaId);
  } catch (e) {
    erros.push(`resumo: ${(e as Error).message}`);
  }

  return { memorias, skills, rotinas, erros };
}

/** Exporta o estado atual do bot como receita. */
export function exportarBotComoReceita(
  db: Db,
  opts: { botId: string; name: string; role: string; avatar?: string; especialidadeId?: string },
): Receita {
  const fatos = db.listarFatos(opts.botId);
  const skillsSaberes = db
    .listSaberesTodos()
    .filter((s) => (s.bots || []).includes(opts.botId) && (s.tags || []).includes("skill"));
  const routines = db.listRoutines(opts.botId);
  return {
    versao: 1,
    id: opts.botId,
    profile: {
      name: opts.name,
      description: opts.role || opts.name,
      ameba: opts.avatar,
    },
    memory: fatos
      .filter((f) => !f.promovido)
      .map((f) => ({
        content: f.text,
        type: f.tipo,
        createdAt: new Date(f.learnedAt).toISOString(),
      })),
    skills: skillsSaberes.map((s) => ({
      name: (s.tags || []).find((t) => t && t !== "skill" && t !== "receita" && t !== "especialidade") || s.id,
      description: s.titulo,
      content: s.conteudo,
    })),
    routines: routines.map((r) => ({
      name: r.name,
      schedule: r.cron,
      prompt: r.prompt,
      created: r.enabled ? "enabled" : "paused",
    })),
    especialidadeId: opts.especialidadeId,
  };
}

export function saudacaoDeReceita(receita: Receita, botName: string): string {
  const gs = (receita.gettingStarted || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (gs) return `Oi — sou ${botName}. ${gs}`;
  return `Oi — sou ${botName} (${receita.profile.name}). Pronto para começar.`;
}
