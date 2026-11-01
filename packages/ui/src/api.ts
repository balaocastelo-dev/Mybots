/** Base da UI (Vite). Em producao online: /mybots. Sem o Vite (teste no Node) fica /. */
const baseVite = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL;
export const UI_BASE = (baseVite || "/").replace(/\/$/, "");

/** Chamadas da interface. Sem corpo, sem content-type: o Fastify recusa JSON vazio com 400. */
export const api = (path: string, init?: RequestInit) =>
  fetch(`${UI_BASE}/api${path}${location.search}`, {
    credentials: "include",
    ...(init?.body === undefined
      ? { ...init }
      : { headers: { "content-type": "application/json" }, ...init }),
  });
