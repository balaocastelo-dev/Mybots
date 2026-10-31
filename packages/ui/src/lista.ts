/** Ordem da barra: fixados na grade; o resto em lista plana (gerente primeiro). */

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

/**
 * Perfil único: sem agrupamento por empresa.
 * Fixados saem da lista (viram a grade). O resto fica numa lista plana,
 * gerentes na frente e o restante em ordem alfabética.
 * O parâmetro empresas é ignorado (mantido só pela assinatura antiga).
 */
export function montarLista(
  bots: BotDaLista[],
  _empresas: { id: string; nome: string }[] = [],
): { fixados: string[]; grupos: GrupoDaLista[]; ids: string[] } {
  const fixados = bots.filter((b) => b.fixado).map((b) => b.id);
  const resto = bots
    .filter((b) => !b.fixado)
    .slice()
    .sort((a, b) =>
      Number(ehGerente(b)) - Number(ehGerente(a))
      || a.nome.localeCompare(b.nome, "pt"),
    );
  const ids = resto.map((b) => b.id);
  // Um único "grupo" interno só para quem ainda itera grupos; a UI usa ids.
  const grupos: GrupoDaLista[] = ids.length ? [{ titulo: "Bots", ids }] : [];
  return { fixados, grupos, ids };
}
