/** Base da UI (Vite). Em producao online: /mybots */
export const UI_BASE = (import.meta.env?.BASE_URL || "/").replace(/\/$/, "");

/** Chamadas da interface. Sem corpo, sem content-type: o Fastify recusa JSON vazio com 400. */
export const api = (path: string, init?: RequestInit) =>
  fetch(`${UI_BASE}/api${path}${location.search}`, {
    credentials: "include",
    ...(init?.body === undefined
      ? { ...init }
      : { headers: { "content-type": "application/json" }, ...init }),
  });
