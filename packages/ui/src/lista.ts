/** Ordem da barra: fixados na grade, e em cada empresa o gerente antes dos outros. */

export type BotDaLista = {
  id: string;
  nome: string;
  empresaId?: string | null;
  fixado?: boolean;
  gerente?: boolean;
  manages?: string[];
  role?: string;
};

export function ehGerente(b: Pick<BotDaLista, "gerente" | "manages" | "role" | "nome">): boolean {
  if (b.gerente) return true;
  if (b.manages && b.manages.length > 0) return true;
  return /gerente/i.test(`${b.role ?? ""} ${b.nome ?? ""}`);
}

export type GrupoDaLista = { titulo: string; ids: string[] };

/** Fixados saem da lista (viram a grade). O resto agrupa pela empresa, gerente primeiro. */
export function montarLista(
  bots: BotDaLista[],
  empresas: { id: string; nome: string }[],
): { fixados: string[]; grupos: GrupoDaLista[] } {
  const nomeDe = (id?: string | null) => {
    if (!id) return "Sistema";
    return empresas.find((e) => e.id === id)?.nome || id;
  };
  const fixados = bots.filter((b) => b.fixado).map((b) => b.id);
  const mapa = new Map<string, BotDaLista[]>();
  for (const b of bots) {
    if (b.fixado) continue;
    const titulo = nomeDe(b.empresaId);
    const arr = mapa.get(titulo) ?? [];
    arr.push(b);
    mapa.set(titulo, arr);
  }
  const ordem = (titulo: string) => {
    if (titulo === "Sistema") return 10_000;
    const i = empresas.findIndex((e) => e.nome === titulo);
    return i < 0 ? 9_000 : i;
  };
  const grupos = [...mapa.keys()]
    .sort((a, b) => ordem(a) - ordem(b) || a.localeCompare(b, "pt"))
    .map((titulo) => ({
      titulo,
      ids: mapa.get(titulo)!.slice().sort((a, b) =>
        Number(ehGerente(b)) - Number(ehGerente(a))
        || a.nome.localeCompare(b.nome, "pt"),
      ).map((b) => b.id),
    }));
  return { fixados, grupos };
}
