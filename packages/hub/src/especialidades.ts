/**
 * Especialidade pelo nome do bot — como no Grok Bot.
 * Catálogo: MyBots-Base/especialidades/catalogo.json
 *
 * Fluxo: keywords → se confiança baixa ou empate, Z.ai → persona = soul + especialidade + skills.
 * Skills: especialidades/skills/<id>/SKILL.md gravadas como saberes no create.
 */
import fs from "node:fs";
import path from "node:path";
import { raizDoProjeto } from "./config.js";

export type McpOpcional = {
  id: string;
  nome: string;
  pacote?: string;
  url?: string;
  chave: boolean;
  enabled: boolean;
};

export type Especialidade = {
  id: string;
  nome: string;
  categoria?: string;
  keywords: string[];
  emoji: string;
  cor: string;
  skills: string[];
  ferramentas?: string[];
  mcpOpcionais?: McpOpcional[];
  soul: string;
  onboarding: string;
  aviso?: string | null;
};

export type Deteccao = {
  especialidade: Especialidade | null;
  confianca: number;
  metodo: "keywords" | "llm" | "manual" | "desligado" | "nenhuma" | "default";
  candidatos?: Array<{ id: string; score: number }>;
  motivo?: string;
};

let cache: Especialidade[] | null = null;
let defaultIdCache: string | null = null;

function caminhoCatalogo(): string {
  return path.join(raizDoProjeto(), "especialidades", "catalogo.json");
}

function caminhoSkills(): string {
  return path.join(raizDoProjeto(), "especialidades", "skills");
}

export function idPadrao(): string {
  if (defaultIdCache) return defaultIdCache;
  try {
    const j = JSON.parse(fs.readFileSync(caminhoCatalogo(), "utf8").replace(/^\uFEFF/, ""));
    defaultIdCache = typeof j.defaultId === "string" ? j.defaultId : "assistente-geral";
  } catch {
    defaultIdCache = "assistente-geral";
  }
  return defaultIdCache!;
}

export function listarEspecialidades(): Especialidade[] {
  if (cache) return cache;
  const p = caminhoCatalogo();
  if (!fs.existsSync(p)) {
    console.warn("[especialidades] catalogo nao encontrado em", p);
    cache = [];
    return cache ?? [];
  }
  const j = JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  cache = Array.isArray(j.especialidades) ? j.especialidades : [];
  if (typeof j.defaultId === "string") defaultIdCache = j.defaultId;
  return cache ?? [];
}

export function recarregarEspecialidades(): Especialidade[] {
  cache = null;
  defaultIdCache = null;
  return listarEspecialidades();
}

export function categoriasDoCatalogo(): Array<{ id: string; nome: string }> {
  try {
    const j = JSON.parse(fs.readFileSync(caminhoCatalogo(), "utf8").replace(/^\uFEFF/, ""));
    return Array.isArray(j.categorias) ? j.categorias : [];
  } catch {
    return [];
  }
}

export function normalizar(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreKeywords(texto: string, esp: Especialidade): number {
  const t = ` ${texto} `;
  let score = 0;
  const id = normalizar(esp.id);
  if (id && (t.includes(` ${id} `) || t.endsWith(` ${id}`) || t.startsWith(`${id} `) || t === id)) score += 2;
  for (const kw of esp.keywords) {
    const k = normalizar(kw);
    if (!k) continue;
    if (t.includes(` ${k} `) || t.startsWith(`${k} `) || t.endsWith(` ${k}`) || t === k) {
      score += Math.max(1, Math.min(3, Math.ceil(k.length / 4)));
    } else if (k.length >= 4 && t.includes(k)) {
      score += 0.5;
    }
  }
  return score;
}

const CONFIANCA_MIN = 0.55;

export function detectarPorKeywords(nome: string, funcao = ""): Deteccao {
  const lista = listarEspecialidades();
  const texto = normalizar(`${nome} ${funcao}`);
  if (!texto || !lista.length) return { especialidade: null, confianca: 0, metodo: "nenhuma", motivo: "sem texto ou catalogo" };
  const ranque = lista
    .map((esp) => ({ esp, score: scoreKeywords(texto, esp) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!ranque.length) return { especialidade: null, confianca: 0, metodo: "nenhuma", candidatos: [], motivo: "nenhuma keyword" };
  const top = ranque[0];
  const segundo = ranque[1]?.score ?? 0;
  const confianca = Math.min(1, top.score / (top.score + segundo + 1));
  return {
    especialidade: top.esp,
    confianca,
    metodo: "keywords",
    candidatos: ranque.slice(0, 8).map((x) => ({ id: x.esp.id, score: x.score })),
    motivo: `keywords score=${top.score}`,
  };
}

async function classificarComLlm(nome: string, funcao: string, candidatos: Especialidade[]): Promise<string | null> {
  const key = process.env.ZAI_API_KEY || process.env.Z_AI_API_KEY;
  if (!key || !candidatos.length) return null;
  const ids = candidatos.map((c) => c.id);
  const prompt = [
    "Voce classifica a ESPECIALIDADE de um bot de IA pelo nome e funcao.",
    "Responda SOMENTE com o id exato de uma das opcoes, sem texto extra.",
    `Opcoes: ${ids.join(", ")}`,
    `Nome: ${nome}`,
    `Funcao: ${funcao || "(vazia)"}`,
  ].join("\n");
  try {
    const r = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "glm-4.5-flash",
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as any;
    const texto = String(j?.choices?.[0]?.message?.content ?? "").trim().toLowerCase();
    const hit = ids.find((id) => texto === id || texto.includes(id));
    return hit ?? null;
  } catch (e) {
    console.warn("[especialidades] Z.ai falhou:", (e as Error).message);
    return null;
  }
}

export async function detectarEspecialidade(
  nome: string,
  funcao = "",
  opts?: { forcarId?: string | null; desligar?: boolean },
): Promise<Deteccao> {
  if (opts?.desligar) {
    const padrao = porId(idPadrao());
    return { especialidade: padrao, confianca: 1, metodo: "default", motivo: "desligado → assistente geral" };
  }
  const lista = listarEspecialidades();
  if (opts?.forcarId) {
    const esp = porId(opts.forcarId) ?? porId(idPadrao());
    return { especialidade: esp, confianca: 1, metodo: "manual", motivo: esp ? "escolhido na UI" : "id invalido → default" };
  }
  const kw = detectarPorKeywords(nome, funcao);
  if (kw.especialidade && kw.confianca >= CONFIANCA_MIN) return kw;
  const candidatos = (kw.candidatos?.length
    ? kw.candidatos.map((c) => porId(c.id)!).filter(Boolean)
    : lista).slice(0, 12) as Especialidade[];
  const id = await classificarComLlm(nome, funcao, candidatos);
  if (id) {
    const esp = porId(id);
    return {
      especialidade: esp,
      confianca: 0.8,
      metodo: "llm",
      candidatos: kw.candidatos,
      motivo: `llm escolheu ${id} (keywords conf=${kw.confianca.toFixed(2)})`,
    };
  }
  if (kw.especialidade) return { ...kw, motivo: `${kw.motivo}; llm sem resposta` };
  const padrao = porId(idPadrao());
  return { especialidade: padrao, confianca: 0.4, metodo: "default", candidatos: kw.candidatos, motivo: "sem match → default" };
}

export function porId(id: string | null | undefined): Especialidade | null {
  if (!id) return null;
  return listarEspecialidades().find((e) => e.id === id) ?? null;
}

export function lerSkillMarkdown(skillId: string): string | null {
  const p = path.join(caminhoSkills(), skillId, "SKILL.md");
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

export function carregarSkillsDaEspecialidade(esp: Especialidade | null): Array<{ id: string; titulo: string; conteudo: string }> {
  if (!esp?.skills?.length) return [];
  const out: Array<{ id: string; titulo: string; conteudo: string }> = [];
  for (const id of esp.skills) {
    const md = lerSkillMarkdown(id);
    if (!md) continue;
    out.push({ id, titulo: `Skill: ${id}`, conteudo: md });
  }
  return out;
}

/**
 * Monta o prompt. `soulBase` deve ser soulBlock() do caller (evita import circular).
 */
export function montarPersonaComEspecialidade(name: string, role: string, esp: Especialidade | null, soulBase: string): string {
  const roleFinal = (role || esp?.nome || "Assistente").trim();
  const skillsCarregadas = carregarSkillsDaEspecialidade(esp);
  const skillsBloco = esp?.skills?.length
    ? [
        "",
        "## Skills / ferramentas da especialidade",
        ...esp.skills.map((s) => `- ${s}`),
        esp.ferramentas?.length ? `\nFerramentas MyBots sugeridas: ${esp.ferramentas.join(", ")}.` : "",
        esp.mcpOpcionais?.length
          ? `\nMCP opcionais (desligados no motor direct; só se o engine opencode conectar sem inventar chave): ${esp.mcpOpcionais.map((m) => m.nome).join(", ")}.`
          : "",
        "Use as ferramentas do MyBots que cobrirem essas skills. Navegação web: use a ferramenta navegador no PC DESTE bot (visível na aba Meu PC). fetch_url só como fallback.",
        skillsCarregadas.length
          ? ["", "### Instruções das skills", ...skillsCarregadas.map((s) => `#### ${s.id}\n${s.conteudo}`)].join("\n")
          : "",
      ].filter(Boolean).join("\n")
    : "";

  const aviso = esp?.aviso ? `\n\n## Aviso importante\n${esp.aviso}` : "";

  const espBloco = esp
    ? [
        "",
        esp.soul,
        aviso,
        skillsBloco,
        "",
        "## Primeira tarefa (onboarding)",
        esp.onboarding,
        `Emoji sugerido: ${esp.emoji} · Cor sugerida: ${esp.cor}`,
      ].join("\n")
    : "";

  return [
    soulBase,
    "",
    `# ${name}`,
    "",
    `Você é ${name}, ${roleFinal} da equipe de Bots da sua empresa.`,
    "Seu chefe é o Thiago. Você fala em português, de forma direta, curta e simpática.",
    esp ? `Você NASCEU especialista em: ${esp.nome}.` : "Você NASCEU como Assistente geral.",
    "",
    "## O que você faz",
    esp
      ? `- Atua como especialista em ${esp.nome}, conforme o bloco da especialidade abaixo.`
      : `- (descreva aqui as tarefas típicas de ${name})`,
    "- Mantém um LOG.md no workspace com o que fez.",
    "- Quando precisa de algo de outra área, consulta o Bot certo (ask_bot).",
    "",
    "## Regras",
    "- Comece sempre com 1–2 frases curtas que resumem a resposta (serão lidas em voz alta); listas e detalhes vêm depois.",
    "- Antes de qualquer ação crítica (apagar, pagar, enviar, publicar, instalar), peça aprovação do Thiago.",
    "- Se faltar um detalhe que VOCÊ pode decidir (nome de arquivo, formato, modelo de exemplo), decida, diga qual escolheu e siga.",
    "- Pergunte só quando errar custa caro — dinheiro, mensagem para cliente, algo que não dá para desfazer.",
    "- Quando terminar algo, avise o chefe com uma frase.",
    "- Nunca exponha chaves, senhas ou dados de cliente.",
    "- Controle: supervisionado. Nunca assuma modo Total/deus.",
    "",
    "## Como você entrega",
    "- Mostra em vez de descrever: manda a imagem do que fez (screenshot, câmera, arquivo).",
    "- Adianta o passo óbvio do pedido, sem esperar ser mandado de novo.",
    "- Termina com uma sugestão concreta do que pode fazer em seguida.",
    "- Cria rotina (schedule) quando o trabalho precisa continuar depois.",
    "- Guarda na memória da equipe (remember) o que os outros bots vão precisar, e consulta (recall, search_knowledge) antes de perguntar de novo.",
    "",
    "## Você nasce sabendo",
    "A casa tem uma base de conhecimento comum — identidade, procedimentos, skills, ferramentas, APIs, MCPs e a história do chefe.",
    "Ela é de TODOS os bots. O índice completo vem no seu prompt.",
    "- Para ler um documento: search_knowledge com o id.",
    "- Para procurar por assunto: search_knowledge com palavras-chave.",
    "- Antes de dizer \"não sei\" sobre algo da casa, BUSQUE.",
    "- O que aprender e servir para a equipe, grave com learn_knowledge.",
    espBloco,
  ].filter((l) => l !== "").join("\n");
}

/** Resumo seguro para a UI (sem soul gigante). */
export function resumoParaUi(esp: Especialidade) {
  return {
    id: esp.id,
    nome: esp.nome,
    categoria: esp.categoria ?? "geral",
    emoji: esp.emoji,
    cor: esp.cor,
    skills: esp.skills,
    ferramentas: esp.ferramentas ?? [],
    mcpOpcionais: (esp.mcpOpcionais ?? []).map((m) => ({ id: m.id, nome: m.nome, enabled: false, chave: m.chave })),
    onboarding: esp.onboarding,
    aviso: esp.aviso ?? null,
    keywords: esp.keywords,
  };
}
