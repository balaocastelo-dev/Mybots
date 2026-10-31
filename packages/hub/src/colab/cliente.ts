// Cliente HTTP das rotas de tarefa, usado pelo MCP (os bots opencode).
// O engine direct faz a mesma chamada a partir do nó. Os dois passam por /api/colab/tarefas.

import { config } from "../config.js";

export async function chamarColabLocal(botId: string, method: string, caminho: string, body?: unknown): Promise<{ status: number; corpo: any }> {
  const token = config.nodeTokens.get(botId) || config.hubToken || "dev";
  const res = await fetch(`http://127.0.0.1:${config.port}${caminho}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-mybots-bot": botId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const corpo = await res.json().catch(() => ({ error: "resposta inválida do hub" }));
  return { status: res.status, corpo };
}
