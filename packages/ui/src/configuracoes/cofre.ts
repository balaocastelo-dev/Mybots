// Camada cliente do Cofre. O Hub (outro agente) responde mascarado. Se a rota
// ainda não existe, os itens de exemplo ficam só na memória desta aba: a senha
// e o número completo não são guardados, nem no modo exemplo nem no estado da tela.

import { api } from "../api";
import {
  type GravacaoCofre,
  type ItemCofre,
  type LinhaAuditoria,
  type PermissaoCofre,
  itemSeguro,
  linhaAuditoriaSegura,
  mascararGravacao,
  permissaoSegura,
} from "./segredos";
import type { Transporte, Origem } from "./maquinas";

export interface PacoteCofre {
  origem: Origem;
  itens: ItemCofre[];
  erro?: string;
}

export interface StatusCofre {
  pronto: boolean;
  total: number;
  origem: Origem;
}

let origem: Origem | null = null;
let itens: ItemCofre[] | null = null;
let auditoria: LinhaAuditoria[] | null = null;
const permissoes = new Map<string, PermissaoCofre[]>();

export function resetarCofreParaTeste() {
  origem = null;
  itens = null;
  auditoria = null;
  permissoes.clear();
}

function base(agora = Date.now()): ItemCofre[] {
  return [
    {
      id: "login-painel", tipo: "login", titulo: "Painel do fornecedor",
      usuario: "ana@casa.exemplo", url: "https://fornecedor.exemplo", senhaMascarada: "••••••••",
      bandeira: "", nomeNoCartao: "", finalNumero: "", validade: "", atualizadoEm: agora - 86_400_000,
    },
    {
      id: "login-email", tipo: "login", titulo: "E-mail da loja",
      usuario: "loja@casa.exemplo", url: "https://mail.exemplo", senhaMascarada: "••••••••",
      bandeira: "", nomeNoCartao: "", finalNumero: "", validade: "", atualizadoEm: agora - 3_600_000,
    },
    {
      id: "cartao-visa", tipo: "cartao", titulo: "Visa da empresa",
      usuario: "", url: "", senhaMascarada: "",
      bandeira: "Visa", nomeNoCartao: "Casa Exemplo", finalNumero: "4242", validade: "08/28", atualizadoEm: agora - 7_200_000,
    },
    {
      id: "cartao-master", tipo: "cartao", titulo: "Mastercard reservas",
      usuario: "", url: "", senhaMascarada: "",
      bandeira: "Mastercard", nomeNoCartao: "Casa Exemplo", finalNumero: "1881", validade: "03/27", atualizadoEm: agora - 600_000,
    },
  ];
}

function garantirItens(): ItemCofre[] {
  if (!itens) {
    itens = base();
    permissoes.set("login-painel", [{ botId: "gerente-exemplo", liberado: true }]);
    auditoria = [
      { id: "aud-1", itemId: "login-painel", titulo: "Painel do fornecedor", acao: "criou", quem: "painel", em: Date.now() - 86_400_000 },
      { id: "aud-2", itemId: "cartao-visa", titulo: "Visa da empresa", acao: "leu", quem: "painel", em: Date.now() - 7_200_000 },
    ];
  }
  return itens;
}

function registrar(acao: LinhaAuditoria["acao"], item: { id: string; titulo: string }) {
  const lista = auditoria ?? [];
  auditoria = [{ id: `aud-${Date.now().toString(36)}`, itemId: item.id, titulo: item.titulo, acao, quem: "painel", em: Date.now() }, ...lista].slice(0, 40);
}

async function detectar(transporte: Transporte): Promise<Origem> {
  if (origem) return origem;
  try {
    const r = await transporte("/cofre/status");
    if (r.ok) {
      origem = "hub";
      return origem;
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
  if (modo === "exemplo") return { pronto: true, total: garantirItens().length, origem: modo };
  try {
    const r = await transporte("/cofre/status");
    if (!r.ok) return { pronto: false, total: 0, origem: modo };
    const bruto: unknown = await r.json();
    const o = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : {};
    const total = typeof o.total === "number" ? o.total : typeof o.itens === "number" ? o.itens : 0;
    return { pronto: o.pronto !== false && o.ok !== false, total, origem: modo };
  } catch {
    return { pronto: false, total: 0, origem: modo };
  }
}

function corpo(g: GravacaoCofre): Record<string, string> {
  const o: Record<string, string> = { tipo: g.tipo === "cartao" ? "cartao" : "login", titulo: g.titulo.trim() };
  const por = (chave: string, valor: string | undefined) => {
    if (valor && valor.trim()) o[chave] = valor.trim();
  };
  por("usuario", g.usuario);
  por("url", g.url);
  por("senha", g.senha);
  por("bandeira", g.bandeira);
  por("nomeNoCartao", g.nomeNoCartao);
  por("numero", g.numero);
  por("validade", g.validade);
  por("cvv", g.cvv);
  return o;
}

export async function criarItem(g: GravacaoCofre, transporte: Transporte = api): Promise<ItemCofre | null> {
  const titulo = g.titulo.trim();
  if (!titulo) return null;
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
  if (!item.titulo) return null;
  garantirItens().unshift(item);
  registrar("criou", item);
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
  registrar("editou", item);
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
  registrar("apagou", atual);
  return true;
}

export async function lerPermissoes(id: string, transporte: Transporte = api): Promise<PermissaoCofre[]> {
  const modo = await detectar(transporte);
  if (modo === "hub") {
    try {
      const r = await transporte(`/cofre/itens/${encodeURIComponent(id)}/permissoes`);
      if (!r.ok) return [];
      const bruto: unknown = await r.json();
      const lista = Array.isArray(bruto) ? bruto : (bruto && typeof bruto === "object" && Array.isArray((bruto as { permissoes?: unknown }).permissoes) ? (bruto as { permissoes: unknown[] }).permissoes : []);
      return lista.map(permissaoSegura).filter((p): p is PermissaoCofre => p !== null);
    } catch {
      return [];
    }
  }
  return (permissoes.get(id) ?? []).map((p) => ({ ...p }));
}

export async function gravarPermissoes(id: string, lista: PermissaoCofre[], transporte: Transporte = api): Promise<boolean> {
  const limpa = lista.map(permissaoSegura).filter((p): p is PermissaoCofre => p !== null);
  const modo = await detectar(transporte);
  if (modo === "hub") {
    try {
      const r = await transporte(`/cofre/itens/${encodeURIComponent(id)}/permissoes`, {
        method: "PUT",
        body: JSON.stringify({ permissoes: limpa }),
      });
      return r.ok;
    } catch {
      return false;
    }
  }
  if (!garantirItens().some((x) => x.id === id)) return false;
  permissoes.set(id, limpa);
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
