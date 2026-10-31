import { api } from "../api";
import { amostra } from "./amostra";
import {
  ajudandoDasTarefas,
  normalizarAuditoria,
  normalizarConversas,
  normalizarMensagens,
  normalizarSalas,
  normalizarTarefas,
} from "./normalizar";
import type { PacoteColab, Tarefa } from "./tipos";

/**
 * Cliente de /api/colab. Não envia mensagem a bot nenhum: a tela só lê e cancela.
 * Se a rota ainda não existe (404), devolve a amostra e avisa na própria tela.
 */

const AVISO_EXEMPLO = "Dados de exemplo: o Hub ainda não respondeu /api/colab. Quando o backend entrar, esta tela usa a API de verdade.";

function url(path: string): string {
  const extra = location.search;
  if (!extra) return `/api${path}`;
  if (path.includes("?")) return `/api${path}&${extra.slice(1)}`;
  return `/api${path}${extra}`;
}

type Resposta = { ok: boolean; ausente: boolean; json: unknown; erro: string };

async function pedir(path: string): Promise<Resposta> {
  try {
    const r = await fetch(url(path), { headers: { accept: "application/json" } });
    if (r.status === 404 || r.status === 501) return { ok: false, ausente: true, json: null, erro: "" };
    if (!r.ok) return { ok: false, ausente: false, json: null, erro: `resposta ${r.status}` };
    return { ok: true, ausente: false, json: await r.json(), erro: "" };
  } catch {
    return { ok: false, ausente: false, json: null, erro: "sem ligação com o Hub" };
  }
}

function vazio(erro: string): PacoteColab {
  return {
    fonte: "api",
    aviso: erro ? `Não consegui ler a colaboração (${erro}).` : "",
    tarefas: [],
    conversas: [],
    mensagens: [],
    salas: [],
    auditoria: [],
    ajudando: {},
  };
}

async function mensagensDas(conversas: { id: string }[]): Promise<PacoteColab["mensagens"]> {
  const fatia = conversas.slice(0, 12);
  const listas = await Promise.all(fatia.map(async (c) => {
    const r = await pedir(`/colab/conversas/${encodeURIComponent(c.id)}/mensagens`);
    return r.ok ? normalizarMensagens(r.json, c.id) : [];
  }));
  return listas.flat();
}

export async function carregarColab(forcarExemplo: boolean): Promise<PacoteColab> {
  if (forcarExemplo) return amostra();
  const tarefasRes = await pedir("/colab/tarefas");
  if (tarefasRes.ausente || tarefasRes.erro === "sem ligação com o Hub") {
    return { ...amostra(), aviso: AVISO_EXEMPLO };
  }
  if (!tarefasRes.ok) return vazio(tarefasRes.erro);
  const [conversasRes, salasRes, audRes] = await Promise.all([
    pedir("/colab/conversas"),
    pedir("/colab/salas"),
    pedir("/colab/auditoria"),
  ]);
  const conversas = conversasRes.ok ? normalizarConversas(conversasRes.json) : [];
  const mensagens = await mensagensDas(conversas);
  const tarefas = normalizarTarefas(tarefasRes.json);
  return {
    fonte: "api",
    aviso: "",
    tarefas,
    conversas,
    mensagens,
    salas: salasRes.ok ? normalizarSalas(salasRes.json) : [],
    auditoria: audRes.ok ? normalizarAuditoria(audRes.json) : [],
    ajudando: ajudandoDasTarefas(tarefas),
  };
}

export async function pedirCancelamento(id: string): Promise<unknown | null> {
  try {
    const r = await api(`/colab/tarefas/${encodeURIComponent(id)}/cancelar`, { method: "POST" });
    if (!r.ok) return null;
    try { return await r.json(); } catch { return { id, status: "cancelled" }; }
  } catch {
    return null;
  }
}

export async function pedirTarefa(id: string): Promise<Tarefa | null> {
  const r = await pedir(`/colab/tarefas/${encodeURIComponent(id)}`);
  if (!r.ok) return null;
  const lista = normalizarTarefas(Array.isArray(r.json) ? r.json : { tarefas: [r.json] });
  return lista[0] ?? null;
}
