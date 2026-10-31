/** Chamadas da interface. Sem corpo, sem content-type: o Fastify recusa JSON vazio com 400. */
export const api = (path: string, init?: RequestInit) =>
  fetch(`/api${path}${location.search}`, init?.body === undefined ? { ...init } : { headers: { "content-type": "application/json" }, ...init });
