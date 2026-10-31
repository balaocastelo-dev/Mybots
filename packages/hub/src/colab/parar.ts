// A delegação escuta isto para marcar as tarefas do alvo como cancelled.
// Este módulo não grava tarefa.

export type ParadaColab = { alvo: "todos" | string[]; por: string };

const ouvintes: Array<(e: ParadaColab) => void> = [];

export function registrarAoParar(fn: (e: ParadaColab) => void): () => void {
  ouvintes.push(fn);
  return () => {
    const i = ouvintes.indexOf(fn);
    if (i >= 0) ouvintes.splice(i, 1);
  };
}

export function notificarParada(e: ParadaColab) {
  for (const fn of [...ouvintes]) {
    try { fn(e); } catch { /* um ouvinte não derruba o parar */ }
  }
}
