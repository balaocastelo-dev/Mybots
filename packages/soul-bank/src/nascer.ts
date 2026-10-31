import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  auditar, carregarAllowlist, carregarAlmas, exigeConfirmacao, fundirPermissoes, itemPorId,
  repoRoot, raizDoBanco, temLatest, textoProibido, unirSegredos,
} from "./catalogo.js";
import type { Alma, ItemAllowlist, PedidoNascimento, Permissoes, Plano, Segredo } from "./tipos.js";

const VAZIO: Permissoes = {
  rede: "nao", enviarMensagens: "nao", gravarDados: "nao", gastarDinheiro: "nao", apagar: "nao", publicar: "nao",
};

export type Nascimento =
  | { ok: true; plano: Plano | null }
  | { ok: false; erro: string };

function copiarItem(item: ItemAllowlist): ItemAllowlist {
  return {
    ...item,
    segredos: item.segredos?.map((s) => ({ ...s })),
    opencode: item.opencode ? structuredClone(item.opencode) : undefined,
    comando: item.comando ? [...item.comando] : undefined,
  };
}

function entradaLimpa(item: ItemAllowlist): Record<string, unknown> | null {
  if (!item.opencode) return null;
  const entrada = structuredClone(item.opencode) as Record<string, unknown>;
  const texto = JSON.stringify(entrada);
  if (temLatest(texto) || textoProibido(texto)) return null;
  if (item.url && entrada.url && entrada.url !== item.url) return null;
  if (item.comando && JSON.stringify(entrada.command) !== JSON.stringify(item.comando)) return null;
  const env = entrada.environment;
  if (env && typeof env === "object") {
    for (const valor of Object.values(env as Record<string, unknown>)) {
      if (typeof valor !== "string" || !/^\{env:[A-Z0-9_]+\}$/.test(valor)) return null;
    }
  }
  return entrada;
}

export function prepararNascimento(pedido: PedidoNascimento): Nascimento {
  const problemas = auditar();
  if (problemas.length) return { ok: false, erro: `O banco de almas está inconsistente: ${problemas[0]}` };
  const almaId = pedido.almaId?.trim() || null;
  const opcionais = [...new Set((pedido.opcionais ?? []).map((s) => s.trim()).filter(Boolean))];
  if (!almaId && !opcionais.length) return { ok: true, plano: null };

  const allow = carregarAllowlist();
  let alma: Alma | undefined;
  if (almaId) {
    alma = carregarAlmas().find((a) => a.id === almaId);
    if (!alma) return { ok: false, erro: `Não existe a alma "${almaId}".` };
  }

  const skills: ItemAllowlist[] = [];
  const mcps: ItemAllowlist[] = [];
  const ver = (id: string, tipo: "skill" | "mcp") => {
    const item = itemPorId(id, allow);
    if (!item || item.tipo !== tipo) return `A alma cita "${id}", que não está na allowlist de ${tipo}.`;
    if (textoProibido(JSON.stringify(item))) return `"${id}" está na lista proibida e não pode nascer ligado.`;
    (tipo === "skill" ? skills : mcps).push(copiarItem(item));
    return "";
  };
  if (alma) {
    for (const id of alma.skills) {
      const erro = ver(id, "skill");
      if (erro) return { ok: false, erro };
    }
    for (const id of alma.mcps) {
      const erro = ver(id, "mcp");
      if (erro) return { ok: false, erro };
    }
  }

  let permissoes: Permissoes = alma?.permissoes ?? { ...VAZIO };
  const segredos: Segredo[][] = [alma?.segredos ?? []];
  for (const id of opcionais) {
    const item = itemPorId(id, allow);
    if (!item?.opcional) return { ok: false, erro: `"${id}" não é um complemento opcional do banco.` };
    if (item.tipo === "mcp") mcps.push(copiarItem(item));
    if (item.skill) {
      const skill = itemPorId(item.skill, allow);
      if (!skill || skill.tipo !== "skill") return { ok: false, erro: `O complemento ${id} aponta para a skill ${item.skill}, que não está pinada.` };
      skills.push(copiarItem(skill));
    }
    if (item.permissoes) permissoes = fundirPermissoes(permissoes, item.permissoes);
    if (item.segredos) segredos.push(item.segredos);
  }
  for (const item of [...skills, ...mcps]) if (item.segredos) segredos.push(item.segredos);

  const plano: Plano = {
    id: alma?.id ?? null,
    nome: alma?.nome ?? "Complementos",
    avatar: alma?.avatar ?? "🧩",
    funcao: alma?.funcao ?? "Assistente",
    persona: alma?.persona ?? "",
    permissoes,
    exigeConfirmacao: exigeConfirmacao(permissoes),
    segredos: unirSegredos(segredos),
    skills, mcps, opcionais,
  };
  if (plano.exigeConfirmacao && pedido.confirmar !== true) {
    const rotulo: Record<string, string> = {
      enviarMensagens: "enviar mensagens",
      gravarDados: "gravar dados",
      gastarDinheiro: "gastar dinheiro",
      apagar: "apagar",
      publicar: "publicar",
    };
    const quais = (Object.keys(rotulo) as Array<keyof typeof rotulo>).filter((k) => permissoes[k] === "confirma").map((k) => rotulo[k]);
    return {
      ok: false,
      erro: `Esta alma pode ${quais.join(", ")}. Confirme o nascimento (confirmarAlma: true) antes de criar o bot.`,
    };
  }
  return { ok: true, plano };
}

function copiarSkill(item: ItemAllowlist, dirBot: string) {
  if (!item.pastaVendor || !item.pastaDestino) return;
  const origem = path.join(raizDoBanco(), item.pastaVendor);
  for (const arq of item.arquivos ?? []) {
    const de = path.join(origem, arq.caminho);
    for (const raizSkill of ["skills", path.join(".opencode", "skills")]) {
      const para = path.join(dirBot, "workspace", raizSkill, item.pastaDestino, arq.caminho);
      fs.mkdirSync(path.dirname(para), { recursive: true });
      const buf = fs.readFileSync(de);
      const hash = crypto.createHash("sha256").update(buf).digest("hex");
      if (hash !== arq.sha256) throw new Error(`checksum mudou em ${item.id}/${arq.caminho}`);
      fs.writeFileSync(para, buf);
    }
  }
}

export function materializar(plano: Plano, dirBot: string) {
  fs.mkdirSync(path.join(dirBot, "workspace"), { recursive: true });
  for (const skill of plano.skills) copiarSkill(skill, dirBot);
  const mcp: Record<string, unknown> = {};
  for (const item of plano.mcps) {
    const entrada = entradaLimpa(item);
    if (!entrada) throw new Error(`MCP ${item.id} sem configuração pinada e limpa`);
    if (item.id === "casa.corretor-do-futuro") entrada.cwd = repoRoot();
    mcp[item.id] = entrada;
  }
  const manifesto = {
    id: plano.id,
    nome: plano.nome,
    opcionais: plano.opcionais,
    permissoes: plano.permissoes,
    skills: plano.skills.map((s) => ({
      id: s.id,
      commit: s.commit ?? null,
      versao: s.versao ?? null,
      arquivos: (s.arquivos ?? []).map((a) => ({ caminho: a.caminho, sha256: a.sha256 })),
    })),
    mcps: plano.mcps.map((m) => ({
      id: m.id,
      url: m.url ?? null,
      commit: m.commit ?? null,
      versao: m.versao ?? null,
      integridade: m.integridade ?? null,
    })),
    segredos: plano.segredos,
  };
  const texto = JSON.stringify(manifesto);
  if (textoProibido(texto)) throw new Error("a alma materializada caiu na lista proibida");
  fs.writeFileSync(path.join(dirBot, "alma.json"), JSON.stringify(manifesto, null, 2) + "\n");
  fs.writeFileSync(path.join(dirBot, "alma-mcp.json"), JSON.stringify(mcp, null, 2) + "\n");
}

export function listarParaUi() {
  const almas = carregarAlmas().map((a) => ({
    id: a.id,
    nome: a.nome,
    avatar: a.avatar,
    funcao: a.funcao,
    resumo: a.resumo,
    persona: a.persona,
    skills: a.skills,
    mcps: a.mcps,
    permissoes: a.permissoes,
    segredos: a.segredos,
    exigeConfirmacao: exigeConfirmacao(a.permissoes),
  }));
  const complementos = carregarAllowlist().itens.filter((i) => i.opcional).map((i) => ({
    id: i.id,
    nome: i.nome,
    descricao: i.descricao ?? "",
    exigeConfirmacao: i.permissoes ? exigeConfirmacao(i.permissoes) : false,
    permissoes: i.permissoes ?? null,
    segredos: i.segredos ?? [],
  }));
  return { almas, complementos };
}
