// Camada cliente do Cofre. O Hub (outro agente) responde mascarado. Se a rota
// ainda não existe, os itens de exemplo ficam só na memória desta aba: a senha
// e o número completo não são guardados, nem no modo exemplo nem no estado da tela.

import { api } from "../api";
import {
  type GravacaoCofre,
  type ItemCofre,
  type LinhaAuditoria,
  type PermissaoCofre,
  botIdsSeguros,
  itemSeguro,
  linhaAuditoriaSegura,
  mascararGravacao,
} from "./segredos";
import type { Transporte, Origem } from "./maquinas";

export interface PacoteCofre {
  origem: Origem;
  itens: ItemCofre[];
  erro?: string;
}

export interface StatusCofre {
  ativo: boolean;
  motivo: string;
  origem: Origem;
}

function motivoVisivel(v: unknown): string {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 180) : "";
  if (!s || /\b[A-Za-z0-9+/=_-]{24,}\b/.test(s)) return "O cofre está desligado.";
  return s;
}

let origem: Origem | null = null;
let motivoHub = "";
let itens: ItemCofre[] | null = null;
let auditoria: LinhaAuditoria[] | null = null;
const permissoes = new Map<string, string[]>();

export function resetarCofreParaTeste() {
  origem = null;
  motivoHub = "";
  itens = null;
  auditoria = null;
  permissoes.clear();
}

function base(agora = Date.now()): ItemCofre[] {
  return [
    {
      id: "login-painel", tipo: "login", nome: "Painel do fornecedor",
      site: "https://fornecedor.exemplo", usuario: "ana@casa.exemplo", senhaMascarada: "••••••••",
      titular: "", finalNumero: "", validade: "", criadoEm: agora - 86_400_000, atualizadoEm: agora - 86_400_000,
    },
    {
      id: "login-email", tipo: "login", nome: "E-mail da loja",
      site: "https://mail.exemplo", usuario: "loja@casa.exemplo", senhaMascarada: "••••••••",
      titular: "", finalNumero: "", validade: "", criadoEm: agora - 3_600_000, atualizadoEm: agora - 3_600_000,
    },
    {
      id: "cartao-visa", tipo: "cartao", nome: "Visa da empresa",
      site: "", usuario: "", senhaMascarada: "",
      titular: "Casa Exemplo", finalNumero: "4242", validade: "08/28", criadoEm: agora - 7_200_000, atualizadoEm: agora - 7_200_000,
    },
    {
      id: "cartao-master", tipo: "cartao", nome: "Mastercard reservas",
      site: "", usuario: "", senhaMascarada: "",
      titular: "Casa Exemplo", finalNumero: "1881", validade: "03/27", criadoEm: agora - 600_000, atualizadoEm: agora - 600_000,
    },
  ];
}

function garantirItens(): ItemCofre[] {
  if (!itens) {
    itens = base();
    permissoes.set("login-painel", ["gerente-exemplo"]);
    auditoria = [
      { id: "aud-1", itemId: "login-painel", nome: "Painel do fornecedor", acao: "criar", resultado: "ok", quem: "painel", em: Date.now() - 86_400_000 },
      { id: "aud-2", itemId: "cartao-visa", nome: "Visa da empresa", acao: "preencher", resultado: "ok", quem: "painel", em: Date.now() - 7_200_000 },
    ];
  }
  return itens;
}

function registrar(acao: LinhaAuditoria["acao"], item: { id: string; nome: string }) {
  const lista = auditoria ?? [];
  auditoria = [{ id: `aud-${Date.now().toString(36)}`, itemId: item.id, nome: item.nome, acao, resultado: "ok", quem: "painel", em: Date.now() }, ...lista].slice(0, 40);
}

async function detectar(transporte: Transporte): Promise<Origem> {
  if (origem) return origem;
  try {
    const r = await transporte("/cofre/status");
    if (r.ok) {
      const bruto: unknown = await r.json().catch(() => null);
      const o = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : {};
      if (typeof o.ativo === "boolean") {
        origem = "hub";
        motivoHub = o.ativo ? "" : motivoVisivel(o.motivo);
        return origem;
      }
    }
  } catch { /* segue para a lista */ }
  try {
    const r = await transporte("/cofre/itens");
    if (r.ok) {
      origem = "hub";
      return origem;
    }
  } catch { /* exemplo */ }
  origem = "exemplo";
  garantirItens();
  return origem;
}

function lerItens(bruto: unknown): ItemCofre[] | null {
  const lista = Array.isArray(bruto) ? bruto : (bruto && typeof bruto === "object" && Array.isArray((bruto as { itens?: unknown }).itens) ? (bruto as { itens: unknown[] }).itens : null);
  if (!lista) return null;
  return lista.map((x) => itemSeguro(x)).filter((x): x is ItemCofre => x !== null);
}

export async function listarItens(transporte: Transporte = api): Promise<PacoteCofre> {
  const modo = await detectar(transporte);
  if (modo === "exemplo") return { origem: modo, itens: garantirItens().map((i) => ({ ...i })) };
  try {
    const r = await transporte("/cofre/itens");
    if (!r.ok) return { origem: "hub", itens: [], erro: "Não consegui ler o cofre." };
    const lista = lerItens(await r.json());
    if (!lista) return { origem: "hub", itens: [] };
    return { origem: "hub", itens: lista };
  } catch {
    return { origem: "hub", itens: [], erro: "Não consegui ler o cofre." };
  }
}

export async function statusCofre(transporte: Transporte = api): Promise<StatusCofre> {
  const modo = await detectar(transporte);
  if (modo === "exemplo") return { ativo: true, motivo: "", origem: modo };
  return { ativo: motivoHub === "", motivo: motivoHub, origem: modo };
}

function corpo(g: GravacaoCofre): Record<string, string> {
  const o: Record<string, string> = { tipo: g.tipo === "cartao" ? "cartao" : "login", nome: g.nome.trim() };
  const por = (chave: string, valor: string | undefined) => {
    if (valor && valor.trim()) o[chave] = valor.trim();
  };
  if (o.tipo === "login") {
    por("site", g.site);
    por("usuario", g.usuario);
    por("senha", g.senha);
    por("notas", g.notas);
  } else {
    por("titular", g.titular);
    por("numero", g.numero);
    por("validade", g.validade);
    por("cvv", g.cvv);
  }
  return o;
}

export async function criarItem(g: GravacaoCofre, transporte: Transporte = api): Promise<ItemCofre | null> {
  const nome = g.nome.trim();
  if (!nome) return null;
  const modo = await detectar(transporte);
  if (modo === "hub") {
    try {
      const r = await transporte("/cofre/itens", { method: "POST", body: JSON.stringify(corpo(g)) });
      if (!r.ok) return null;
      return itemSeguro(await r.json());
    } catch {
      return null;
    }
  }
  const id = `item-${Date.now().toString(36)}`;
  const item = mascararGravacao(g, id, null);
  if (!item.nome) return null;
  garantirItens().unshift(item);
  registrar("criar", item);
  return { ...item };
}

export async function editarItem(id: string, g: GravacaoCofre, transporte: Transporte = api): Promise<ItemCofre | null> {
  const modo = await detectar(transporte);
  if (modo === "hub") {
    try {
      const r = await transporte(`/cofre/itens/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(corpo(g)) });
      if (!r.ok) return null;
      return itemSeguro(await r.json(), id);
    } catch {
      return null;
    }
  }
  const lista = garantirItens();
  const i = lista.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const item = mascararGravacao(g, id, lista[i]);
  lista[i] = item;
  registrar("editar", item);
  return { ...item };
}

export async function apagarItem(id: string, transporte: Transporte = api): Promise<boolean> {
  const modo = await detectar(transporte);
  if (modo === "hub") {
    try {
      const r = await transporte(`/cofre/itens/${encodeURIComponent(id)}`, { method: "DELETE" });
      return r.ok;
    } catch {
      return false;
    }
  }
  const lista = garantirItens();
  const atual = lista.find((x) => x.id === id);
  if (!atual) return false;
  itens = lista.filter((x) => x.id !== id);
  permissoes.delete(id);
  registrar("apagar", atual);
  return true;
}

export async function lerPermissoes(id: string, transporte: Transporte = api): Promise<PermissaoCofre[]> {
  const modo = await detectar(transporte);
  if (modo === "hub") {
    try {
      const r = await transporte(`/cofre/itens/${encodeURIComponent(id)}/permissoes`);
      if (!r.ok) return [];
      return botIdsSeguros(await r.json()).map((botId) => ({ botId, liberado: true }));
    } catch {
      return [];
    }
  }
  return (permissoes.get(id) ?? []).map((botId) => ({ botId, liberado: true }));
}

export async function gravarPermissoes(id: string, lista: PermissaoCofre[], transporte: Transporte = api): Promise<boolean> {
  const ids = [...new Set(lista.filter((p) => p.liberado).map((p) => p.botId))].filter((botId) => /^[A-Za-z0-9_.-]{1,80}$/.test(botId));
  const modo = await detectar(transporte);
  if (modo === "hub") {
    try {
      const r = await transporte(`/cofre/itens/${encodeURIComponent(id)}/permissoes`, {
        method: "PUT",
        body: JSON.stringify({ botIds: ids }),
      });
      return r.ok;
    } catch {
      return false;
    }
  }
  if (!garantirItens().some((x) => x.id === id)) return false;
  permissoes.set(id, ids);
  const item = garantirItens().find((x) => x.id === id);
  if (item) registrar("permissao", item);
  return true;
}

export async function lerAuditoria(transporte: Transporte = api): Promise<LinhaAuditoria[]> {
  const modo = await detectar(transporte);
  if (modo === "hub") {
    try {
      const r = await transporte("/cofre/auditoria");
      if (!r.ok) return [];
      const bruto: unknown = await r.json();
      const lista = Array.isArray(bruto) ? bruto : (bruto && typeof bruto === "object" && Array.isArray((bruto as { itens?: unknown }).itens) ? (bruto as { itens: unknown[] }).itens : []);
      return lista.map(linhaAuditoriaSegura).filter((l): l is LinhaAuditoria => l !== null);
    } catch {
      return [];
    }
  }
  garantirItens();
  return (auditoria ?? []).map((l) => ({ ...l }));
}
