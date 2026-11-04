import type { Usuario } from "./usuarios.js";
import { podeVerRecurso } from "./usuarios.js";
import { getUsuariosRepo } from "./authOnline.js";

export type EscopoOwner = "meus" | "clientes" | "todos";

export function escopoDeQuery(q: Record<string, unknown> | undefined, user: Usuario | null): EscopoOwner {
  if (!user || user.role !== "owner") return "todos";
  const raw = String(q?.escopo ?? "todos").toLowerCase();
  if (raw === "meus" || raw === "clientes" || raw === "todos") return raw;
  return "todos";
}

export function ownerUserIdDeBot(botId: string): string | null {
  return getUsuariosRepo()?.ownerUserIdDoBot(botId) ?? null;
}

export function filtrarBotsPorUsuario<T extends { id: string; ownerUserId?: string | null }>(
  bots: T[],
  user: Usuario | null,
  escopo: EscopoOwner = "todos",
): T[] {
  if (!user) return [];
  return bots.filter((b) => {
    const owner = b.ownerUserId ?? ownerUserIdDeBot(b.id);
    return podeVerRecurso(user, owner, user.role === "owner" ? escopo : undefined);
  });
}

export function filtrarPorOwnerUserId<T extends { ownerUserId?: string | null; owner_user_id?: string | null }>(
  items: T[],
  user: Usuario | null,
  escopo: EscopoOwner = "todos",
): T[] {
  if (!user) return [];
  return items.filter((it) => {
    const owner = (it.ownerUserId ?? it.owner_user_id ?? null) as string | null;
    return podeVerRecurso(user, owner, user.role === "owner" ? escopo : undefined);
  });
}

export function podeAcessarBot(user: Usuario | null, botId: string): boolean {
  if (!user) return false;
  if (user.role === "owner") return true;
  const owner = ownerUserIdDeBot(botId);
  return podeVerRecurso(user, owner);
}
