// Camada cliente das máquinas. As rotas entram com o PR #13 e ainda não estão
// na main: se o Hub não responder, a tela usa a memória de exemplo daqui.
// Ligar no modo exemplo não chama Docker e não abre porta nenhuma.

import { api } from "../api";
import {
  type EstadoMaquina,
  type Maquina,
  type TipoMaquina,
  normalizarMaquina,
} from "./segredos";

export type Transporte = (path: string, init?: RequestInit) => Promise<Response>;
export type Origem = "hub" | "exemplo";

export interface PacoteMaquinas {
  origem: Origem;
  itens: Maquina[];
}

const CHAVE = (m: { botId: string; tipo: TipoMaquina }) => `${m.botId}:${m.tipo}`;

let origem: Origem | null = null;
let memoria: Maquina[] | null = null;
const pendentes = new Set<string>();
const relogios = new Map<string, ReturnType<typeof setTimeout>>();
const ouvintes = new Set<() => void>();

export function aoMudarMaquinas(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

function avisar() {
  for (const fn of ouvintes) fn();
}

export function resetarMaquinasParaTeste() {
  origem = null;
  memoria = null;
  pendentes.clear();
  for (const t of relogios.values()) clearTimeout(t);
  relogios.clear();
  ouvintes.clear();
}

export function maquinasDeExemplo(agora = Date.now()): Maquina[] {
  const casa = "casa-exemplo";
  const loja = "loja-exemplo";
  const linha = (
    botId: string, empresaId: string, tipo: TipoMaquina, estado: EstadoMaquina,
    porta: number | null, usoHaMs: number | null, acessoLiberado: boolean,
  ): Maquina => ({
    botId, empresaId, tipo, estado, porta,
    ultimoUso: usoHaMs == null ? null : agora - usoHaMs,
    acessoLiberado,
  });
  return [
    linha("gerente-exemplo", casa, "pc", "ligado", 7901, 2 * 60_000, true),
    linha("gerente-exemplo", casa, "android", "desligado", null, 3 * 60 * 60_000, true),
    linha("vendas-exemplo", casa, "pc", "ligando", 7902, 30_000, true),
    linha("vendas-exemplo", casa, "android", "erro", 9302, 20 * 60_000, true),
    linha("suporte-exemplo", loja, "pc", "desligado", null, null, false),
    linha("suporte-exemplo", loja, "android", "sem-provedor", null, null, false),
    linha("financeiro-exemplo", loja, "pc", "erro", 7904, 50 * 60_000, true),
    linha("financeiro-exemplo", loja, "android", "ligado", 9304, 5 * 60_000, true),
    linha("estoque-exemplo", casa, "pc", "sem-provedor", null, null, false),
    linha("estoque-exemplo", casa, "android", "ligando", 9305, 90_000, false),
  ];
}

async function lerLista(transporte: Transporte): Promise<Maquina[] | null> {
  try {
    const r = await transporte("/maquinas");
    if (!r.ok) return null;
    const bruto: unknown = await r.json();
    const lista = Array.isArray(bruto) ? bruto : (bruto && typeof bruto === "object" && Array.isArray((bruto as { itens?: unknown }).itens) ? (bruto as { itens: unknown[] }).itens : null);
    if (!lista) return null;
    return lista.map(normalizarMaquina).filter((m): m is Maquina => m !== null);
  } catch {
    return null;
  }
}

function garantirMemoria(): Maquina[] {
  if (!memoria) memoria = maquinasDeExemplo();
  return memoria;
}

export async function listarMaquinas(transporte: Transporte = api): Promise<PacoteMaquinas> {
  if (origem === "exemplo") return { origem, itens: garantirMemoria().map((m) => ({ ...m })) };
  const remota = await lerLista(transporte);
  if (remota) {
    origem = "hub";
    return { origem, itens: remota };
  }
  origem = "exemplo";
  return { origem, itens: garantirMemoria().map((m) => ({ ...m })) };
}

async function exigir(transporte: Transporte): Promise<Origem> {
  if (!origem) await listarMaquinas(transporte);
  return origem ?? "exemplo";
}

/** Tela do celular publicada pelo Hub. O stream mora em `/android/<bot>/ws`; esta aba não abre esse socket. */
export function caminhoDoCelular(botId: string): string {
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(botId)) return "";
  return `/android/${encodeURIComponent(botId)}/`;
}

export async function ligarMaquina(botId: string, transporte: Transporte = api): Promise<Maquina | null> {
  if (await exigir(transporte) !== "hub") {
    const m = garantirMemoria().find((x) => x.botId === botId && x.tipo === "pc");
    if (!m || m.estado === "sem-provedor" || m.estado === "ligando" || m.estado === "ligado") return m ? { ...m } : null;
    m.estado = "ligando";
    if (m.porta == null) m.porta = 7906;
    const chave = CHAVE(m);
    pendentes.add(chave);
    const anterior = relogios.get(chave);
    if (anterior) clearTimeout(anterior);
    relogios.set(chave, setTimeout(() => {
      relogios.delete(chave);
      if (!pendentes.has(chave)) return;
      pendentes.delete(chave);
      const atual = memoria?.find((x) => CHAVE(x) === chave);
      if (atual && atual.estado === "ligando") {
        atual.estado = "ligado";
        atual.ultimoUso = Date.now();
        avisar();
      }
    }, 900));
    return { ...m };
  }
  try {
    const r = await transporte(`/maquinas/${encodeURIComponent(botId)}/ligar`, { method: "POST" });
    if (!r.ok) return null;
    const item = normalizarMaquina(await r.json());
    return item;
  } catch {
    return null;
  }
}

export async function desligarMaquina(botId: string, transporte: Transporte = api): Promise<Maquina | null> {
  if (await exigir(transporte) !== "hub") {
    const m = garantirMemoria().find((x) => x.botId === botId && x.tipo === "pc");
    if (!m || m.estado === "sem-provedor" || m.estado === "desligado") return m ? { ...m } : null;
    const chave = CHAVE(m);
    pendentes.delete(chave);
    const relogio = relogios.get(chave);
    if (relogio) clearTimeout(relogio);
    relogios.delete(chave);
    m.estado = "desligado";
    m.ultimoUso = Date.now();
    return { ...m };
  }
  try {
    const r = await transporte(`/maquinas/${encodeURIComponent(botId)}/desligar`, { method: "POST" });
    if (!r.ok) return null;
    return normalizarMaquina(await r.json());
  } catch {
    return null;
  }
}

/** O Hub libera o bot inteiro: PC e celular usam o mesmo `acessoLiberado`. */
export async function definirAcesso(botId: string, liberado: boolean, transporte: Transporte = api): Promise<{ botId: string; acessoLiberado: boolean } | null> {
  if (await exigir(transporte) !== "hub") {
    let achou = false;
    for (const m of garantirMemoria()) {
      if (m.botId !== botId) continue;
      m.acessoLiberado = liberado;
      achou = true;
    }
    return achou ? { botId, acessoLiberado: liberado } : null;
  }
  try {
    const r = await transporte(`/maquinas/${encodeURIComponent(botId)}/acesso`, {
      method: "PUT",
      body: JSON.stringify({ liberado }),
    });
    if (!r.ok) return null;
    const bruto: unknown = await r.json();
    const flag = bruto && typeof bruto === "object" && (bruto as { acessoLiberado?: unknown }).acessoLiberado;
    return { botId, acessoLiberado: flag === true };
  } catch {
    return null;
  }
}

export const NOMES_EXEMPLO: Record<string, string> = {
  "gerente-exemplo": "Gerente",
  "vendas-exemplo": "Vendas",
  "suporte-exemplo": "Suporte",
  "financeiro-exemplo": "Financeiro",
  "estoque-exemplo": "Estoque",
};

export const EMPRESAS_EXEMPLO: Record<string, string> = {
  "casa-exemplo": "Casa Exemplo",
  "loja-exemplo": "Loja Exemplo",
};
