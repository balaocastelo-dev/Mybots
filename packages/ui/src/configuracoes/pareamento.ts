// Pareamento do celular (PR #14). O código de 6 dígitos sai no POST e não fica
// na memória desta aba. A tela ao vivo continua em /android/<bot>/ — daqui não
// abre o WebSocket.

import { api } from "../api";
import type { Transporte } from "./maquinas";

export interface PedidoPareamento {
  ip: string;
  porta: number;
  codigo: string;
  portaConexao?: number | null;
}

export interface StatusPareamento {
  conectado: boolean;
  cadastrado: boolean;
  origem: "hub" | "exemplo";
}

const memoria = new Map<string, { conectado: boolean; cadastrado: boolean }>();

export function resetarPareamentoParaTeste() {
  memoria.clear();
}

function ipLocal(ip: string): boolean {
  const n = ip.split(".").map((p) => Number(p));
  if (n.length !== 4 || n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  if (n[0] === 10 || n[0] === 127) return true;
  if (n[0] === 192 && n[1] === 168) return true;
  return n[0] === 172 && n[1] >= 16 && n[1] <= 31;
}

export function validarPareamento(p: PedidoPareamento): string | null {
  const ip = p.ip.trim();
  if (!ipLocal(ip)) return "Use o IP da rede local.";
  const portaRuim = (n: number) => !Number.isInteger(n) || n < 1 || n > 65535;
  if (portaRuim(p.porta)) return "Porta de pareamento inválida.";
  if (p.porta === 8787 || p.porta === 8791) return "Essa porta não entra no pareamento.";
  if (p.portaConexao != null && p.portaConexao !== 0) {
    if (portaRuim(p.portaConexao)) return "Porta de conexão inválida.";
    if (p.portaConexao === 8787 || p.portaConexao === 8791) return "Essa porta não entra no pareamento.";
  }
  if (!/^\d{6}$/.test(p.codigo.trim())) return "O código tem 6 dígitos.";
  return null;
}

function rotaAusente(status: number, bruto: unknown): boolean {
  if (status !== 404 && status !== 501) return false;
  const o = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : {};
  if (typeof o.erro === "string" && o.erro.trim()) return false;
  return true;
}

export async function lerStatusPareamento(botId: string, transporte: Transporte = api): Promise<StatusPareamento> {
  const local = memoria.get(botId) ?? { conectado: false, cadastrado: false };
  try {
    const r = await transporte(`/bots/${encodeURIComponent(botId)}/android/status`);
    const bruto: unknown = await r.json().catch(() => null);
    if (!r.ok) {
      if (rotaAusente(r.status, bruto)) return { ...local, origem: "exemplo" };
      return { conectado: false, cadastrado: false, origem: "hub" };
    }
    const o = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : {};
    return { conectado: o.conectado === true, cadastrado: o.cadastrado === true, origem: "hub" };
  } catch {
    return { ...local, origem: "exemplo" };
  }
}

export async function parearCelular(botId: string, pedido: PedidoPareamento, transporte: Transporte = api): Promise<{ ok: boolean; erro?: string; origem: "hub" | "exemplo" }> {
  const erro = validarPareamento(pedido);
  if (erro) return { ok: false, erro, origem: "exemplo" };
  const antes = await lerStatusPareamento(botId, transporte);
  if (antes.origem === "exemplo") {
    memoria.set(botId, { cadastrado: true, conectado: false });
    return { ok: true, origem: "exemplo" };
  }
  const corpo: Record<string, string | number> = {
    ip: pedido.ip.trim(),
    porta: pedido.porta,
    codigo: pedido.codigo.trim(),
  };
  if (pedido.portaConexao) corpo.portaConexao = pedido.portaConexao;
  try {
    const r = await transporte(`/bots/${encodeURIComponent(botId)}/android/pair`, {
      method: "POST",
      body: JSON.stringify(corpo),
    });
    const bruto: unknown = await r.json().catch(() => null);
    if (rotaAusente(r.status, bruto)) {
      memoria.set(botId, { cadastrado: true, conectado: false });
      return { ok: true, origem: "exemplo" };
    }
    const o = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : {};
    if (!r.ok || o.ok === false) {
      const msg = typeof o.erro === "string" ? o.erro.slice(0, 180) : "Não pareou.";
      return { ok: false, erro: msg, origem: "hub" };
    }
    memoria.set(botId, { cadastrado: true, conectado: false });
    return { ok: true, origem: "hub" };
  } catch {
    memoria.set(botId, { cadastrado: true, conectado: false });
    return { ok: true, origem: "exemplo" };
  }
}
