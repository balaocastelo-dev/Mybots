/** A rota antiga /bots/importar-link abre o diálogo real de Receber por link. */
export function ehImportarPorLink(): boolean {
  const caminho = location.pathname.replace(/\/+$/, "");
  const hash = location.hash.replace(/\/+$/, "");
  return caminho.endsWith("/bots/importar-link") || hash === "#/bots/importar-link" || hash.startsWith("#/bots/importar-link?");
}
