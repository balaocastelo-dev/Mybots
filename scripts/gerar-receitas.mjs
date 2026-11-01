/**
 * Gera receitas/*.json a partir do catálogo de especialidades.
 * Rode na raiz do MyBots: node scripts/gerar-receitas.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const espPath = path.join(root, "packages/hub/src/especialidades.ts");
if (!fs.existsSync(espPath)) {
  console.error("especialidades.ts não encontrado");
  process.exit(1);
}

// Carrega via tsx-compatible dynamic import of compiled helpers by reading catalog JSON directly
const catalogo = JSON.parse(fs.readFileSync(path.join(root, "especialidades/catalogo.json"), "utf8"));
const lista = catalogo.especialidades || catalogo;
const skillsDir = path.join(root, "especialidades/skills");

function lerSkill(id) {
  const p = path.join(skillsDir, id, "SKILL.md");
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

function amebaEstavel(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const n = (h % 100) + 1;
  return "/amebas/v2/ameba-v2-" + String(n).padStart(3, "0") + ".png";
}

function paraReceita(esp) {
  const skills = [];
  for (const id of esp.skills || []) {
    const md = lerSkill(id);
    if (!md) continue;
    skills.push({ name: id, description: id, content: md });
  }
  const memory = [
    { content: `Especialidade: ${esp.nome}. ${(esp.onboarding || "").replace(/\s+/g, " ").trim().slice(0, 280)}`, type: "perfil" },
  ];
  if (esp.aviso) memory.push({ content: `Aviso permanente: ${esp.aviso.replace(/\s+/g, " ").trim().slice(0, 240)}`, type: "perfil" });
  const soulLine = (esp.soul || "").replace(/\s+/g, " ").trim().slice(0, 220);
  if (soulLine) memory.push({ content: `Jeito de trabalhar: ${soulLine}`, type: "perfil" });

  const routines = [
    {
      name: "Revisão semanal da especialidade",
      schedule: "0 9 * * 1",
      prompt: `Revise em poucas linhas o que avançou nesta semana como ${esp.nome}. Liste pendências e uma próxima ação concreta. Não invente resultados.`,
      created: "paused",
    },
  ];
  if ((esp.skills || []).length) {
    routines.push({
      name: "Checklist das skills",
      schedule: "0 10 * * 3",
      prompt: `Percorra as skills ${(esp.skills || []).slice(0, 6).join(", ")} e diga quais precisam de atualização ou exemplo novo. Sem inventar status.`,
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

const outDir = path.join(root, "receitas");
fs.mkdirSync(outDir, { recursive: true });
let ok = 0;
for (const esp of lista) {
  const r = paraReceita(esp);
  fs.writeFileSync(path.join(outDir, `${r.id}.json`), JSON.stringify(r, null, 2) + "\n", "utf8");
  ok++;
}
console.log(`Geradas ${ok} receitas em ${outDir}`);
