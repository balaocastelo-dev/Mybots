/**
 * Adaptador do celular para o registro de provedores.
 *
 * O PR do PC por bot (android.ts) ainda não está na main. Este arquivo NÃO
 * importa esse módulo: o Hub de hoje sobe com o registro local daqui e a tela
 * em /android/<botId>/ continua no server.ts. Se android.ts aparecer (rebase
 * sobre aquele PR), publicarNoRegistroOficial() entrega os mesmos objetos
 * para registrarProvedorAndroid de lá.
 *
 * O aparelho real é o provedor `aparelho`, prioridade 10. O redroid é o
 * provedor `redroid`, prioridade 1. Quem ganha é o de maior prioridade.
 * aoLigarPc e aoDesligarPc são opcionais: avisarProvedores percorre o
 * registro e chama quem tiver o método. O #13 não importa androidHook.ts.
 */
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CadastroAndroid } from "./androidBot.js";
import { modoFallbackDoAmbiente, nomeDoContainerAndroid } from "./androidFallback.js";

/** A mesma ordem que o teste do registro usa: aparelho 10, redroid 1. */
export const PRIORIDADE_APARELHO = 10;
export const PRIORIDADE_REDROID = 1;

export type AlvoAparelho = { tipo: "aparelho"; serial: string; host: string; porta: number };
export type AlvoContainer = { tipo: "container"; nome: string; host: string; porta: number };
export type AlvoAndroid = AlvoAparelho | AlvoContainer;

export type EstadoRelatado = "ligado" | "desligado" | "ligando" | "erro" | "sem-provedor";

export type RelatoAndroid = {
  estado: EstadoRelatado;
  porta?: number | null;
  ultimoUso?: number | null;
};

/**
 * Igual ao ProvedorAndroid do registro do #13, com o ciclo do PC opcional.
 * O registro chama aoLigarPc/aoDesligarPc quando o método existe. Quem não
 * tem o método é pulado.
 */
export type ProvedorAndroid = {
  id: string;
  prioridade: number;
  resolver(botId: string): Promise<AlvoAndroid | null>;
  relatar?(botId: string): Promise<RelatoAndroid | null>;
  aoLigarPc?(botId: string): Promise<void>;
  aoDesligarPc?(botId: string): Promise<void>;
};

export type FonteDoProvedor = {
  cadastro(botId: string): CadastroAndroid | null;
  conectado(botId: string): Promise<boolean>;
  uso(botId: string): number | null;
  reconectar(botId: string): Promise<void>;
  abrirWhatsapp(botId: string): Promise<void>;
  pararTela(botId: string): void;
  subirFallback(botId: string): Promise<void>;
};

const provedores = new Map<string, ProvedorAndroid>();

function portaUsavel(porta: number): boolean {
  return Number.isInteger(porta) && porta >= 1 && porta <= 65535 && porta !== 8787 && porta !== 8791;
}

export function registrarProvedorAndroid(p: ProvedorAndroid): void {
  if (!/^[a-zA-Z0-9_.-]{1,40}$/.test(p.id)) throw new Error("id de provedor android inválido");
  if (!Number.isFinite(p.prioridade)) throw new Error("prioridade de provedor android inválida");
  provedores.set(p.id, p);
}

export function limparProvedoresAndroid(): void {
  provedores.clear();
}

export function listarProvedoresAndroid(): Array<{ id: string; prioridade: number }> {
  return ordem().map((p) => ({ id: p.id, prioridade: p.prioridade }));
}

function ordem(): ProvedorAndroid[] {
  return [...provedores.values()].sort((a, b) => b.prioridade - a.prioridade || a.id.localeCompare(b.id));
}

function alvoAceito(alvo: AlvoAndroid): boolean {
  if (!portaUsavel(alvo.porta)) return false;
  if (!alvo.host || alvo.host.length > 200 || /[\s/\\]/.test(alvo.host)) return false;
  if (alvo.tipo === "aparelho") return !!alvo.serial && alvo.serial.length < 200 && !alvo.serial.includes("..");
  return !!alvo.nome && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(alvo.nome);
}

export async function resolverAlvoAndroid(botId: string): Promise<AlvoAndroid | null> {
  for (const p of ordem()) {
    let alvo: AlvoAndroid | null = null;
    try { alvo = await p.resolver(botId); } catch { continue; }
    if (!alvo || !alvoAceito(alvo)) continue;
    return alvo;
  }
  return null;
}

const ESTADOS = new Set<EstadoRelatado>(["ligado", "desligado", "ligando", "erro", "sem-provedor"]);

/** A aba Computadores lê isto. Não chama adb connect nem docker. */
export async function relatoDoAndroid(botId: string): Promise<{ estado: EstadoRelatado; porta: number | null; ultimoUso: number | null }> {
  const lista = ordem();
  if (!lista.length) return { estado: "sem-provedor", porta: null, ultimoUso: null };
  for (const p of lista) {
    if (!p.relatar) continue;
    try {
      const r = await p.relatar(botId);
      if (!r || !ESTADOS.has(r.estado)) continue;
      const ultimo = typeof r.ultimoUso === "number" && Number.isFinite(r.ultimoUso) ? r.ultimoUso : null;
      const porta = r.porta == null ? null : (portaUsavel(r.porta) ? r.porta : null);
      return { estado: r.estado, porta, ultimoUso: ultimo };
    } catch { /* o próximo ainda pode responder */ }
  }
  const alvo = await resolverAlvoAndroid(botId);
  if (alvo) return { estado: "ligado", porta: alvo.porta, ultimoUso: null };
  return { estado: "sem-provedor", porta: null, ultimoUso: null };
}

/** O registro chama o método opcional de cada provedor, do mais prioritário ao menor. */
export async function avisarProvedores(evento: "ligar" | "desligar", botId: string): Promise<void> {
  for (const p of ordem()) {
    const fn = evento === "ligar" ? p.aoLigarPc : p.aoDesligarPc;
    if (!fn) continue;
    try { await fn.call(p, botId); } catch { /* o próximo ainda corre */ }
  }
}

export function provedorAparelho(fonte: FonteDoProvedor): ProvedorAndroid {
  return {
    id: "aparelho",
    prioridade: PRIORIDADE_APARELHO,
    async resolver(botId) {
      const c = fonte.cadastro(botId);
      if (!c || c.modo !== "aparelho" || !portaUsavel(c.portaConexao)) return null;
      return { tipo: "aparelho", serial: c.serial, host: c.ip, porta: c.portaConexao };
    },
    async relatar(botId) {
      const c = fonte.cadastro(botId);
      if (!c || c.modo !== "aparelho") return null;
      const on = await fonte.conectado(botId);
      return { estado: on ? "ligado" : "desligado", porta: portaUsavel(c.portaConexao) ? c.portaConexao : null, ultimoUso: fonte.uso(botId) };
    },
    async aoLigarPc(botId) {
      await fonte.reconectar(botId);
      if (await fonte.conectado(botId)) await fonte.abrirWhatsapp(botId);
    },
    aoDesligarPc(botId) {
      fonte.pararTela(botId);
      return Promise.resolve();
    },
  };
}

export function provedorRedroid(fonte: FonteDoProvedor): ProvedorAndroid {
  return {
    id: "redroid",
    prioridade: PRIORIDADE_REDROID,
    async resolver(botId) {
      const c = fonte.cadastro(botId);
      if (!c || (c.modo !== "redroid" && c.modo !== "emulador") || !portaUsavel(c.portaConexao)) return null;
      return { tipo: "container", nome: nomeDoContainerAndroid(botId), host: "127.0.0.1", porta: c.portaConexao };
    },
    async relatar(botId) {
      const c = fonte.cadastro(botId);
      if (!c || (c.modo !== "redroid" && c.modo !== "emulador")) return null;
      const on = await fonte.conectado(botId);
      return { estado: on ? "ligado" : "desligado", porta: portaUsavel(c.portaConexao) ? c.portaConexao : null, ultimoUso: fonte.uso(botId) };
    },
    async aoLigarPc(botId) {
      const c = fonte.cadastro(botId);
      if (c?.modo === "aparelho" || c?.modo === "redroid" || c?.modo === "emulador") return;
      if (!modoFallbackDoAmbiente()) return;
      await fonte.subirFallback(botId);
    },
  };
}

export function instalarProvedores(fonte: FonteDoProvedor): void {
  registrarProvedorAndroid(provedorAparelho(fonte));
  registrarProvedorAndroid(provedorRedroid(fonte));
}

/**
 * Se o registro oficial (android.ts do PR do PC) estiver no disco, entrega
 * os provedores já instalados aqui. Na main de hoje o arquivo não existe
 * e isto devolve "local" sem lançar.
 */
export async function publicarNoRegistroOficial(): Promise<"oficial" | "local"> {
  const arquivo = fileURLToPath(new URL("./android.ts", import.meta.url));
  if (!fs.existsSync(arquivo)) return "local";
  try {
    const mod = await import(pathToFileURL(arquivo).href) as { registrarProvedorAndroid?: (p: ProvedorAndroid) => void };
    if (typeof mod.registrarProvedorAndroid !== "function") return "local";
    for (const p of ordem()) mod.registrarProvedorAndroid(p);
    return "oficial";
  } catch {
    return "local";
  }
}
