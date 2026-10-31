/** A lista da barra: fixados no topo, o resto agrupado pela empresa. */

export type BotNaLista = {
  id: string;
  fixado?: boolean;
  secao?: string;
  empresaId?: string | null;
};

export type GrupoDaLista = { titulo: string; ids: string[] };

export function agruparPorEmpresa(
  bots: BotNaLista[],
  empresas: { id: string; nome: string }[],
): GrupoDaLista[] {
  const nomeDe = (id?: string | null) => {
    if (!id) return "Sistema";
    return empresas.find((e) => e.id === id)?.nome || id;
  };
  const fixados = bots.filter((b) => b.fixado);
  const mapa = new Map<string, string[]>();
  for (const b of bots) {
    if (b.fixado) continue;
    const base = nomeDe(b.empresaId);
    const titulo = b.secao ? `${base} · ${b.secao}` : base;
    const arr = mapa.get(titulo) ?? [];
    arr.push(b.id);
    mapa.set(titulo, arr);
  }
  const ordemEmpresa = (titulo: string) => {
    if (titulo === "Sistema" || titulo.startsWith("Sistema · ")) return 10_000;
    const i = empresas.findIndex((e) => titulo === e.nome || titulo.startsWith(e.nome + " · "));
    return i < 0 ? 9_000 : i;
  };
  const titulos = [...mapa.keys()].sort((a, b) => ordemEmpresa(a) - ordemEmpresa(b) || a.localeCompare(b, "pt"));
  const saida: GrupoDaLista[] = [];
  if (fixados.length) saida.push({ titulo: "Fixados", ids: fixados.map((b) => b.id) });
  for (const titulo of titulos) saida.push({ titulo, ids: mapa.get(titulo)! });
  return saida;
}
