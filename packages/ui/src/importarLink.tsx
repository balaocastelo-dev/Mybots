/** A importação de bot por link ainda não está na main. A rota prevista já abre esta tela. */
export function ehImportarPorLink(): boolean {
  const caminho = location.pathname.replace(/\/+$/, "");
  const hash = location.hash.replace(/\/+$/, "");
  return caminho.endsWith("/bots/importar-link") || hash === "#/bots/importar-link" || hash.startsWith("#/bots/importar-link?");
}

export function TelaImportarLink({ onVoltar }: { onVoltar: () => void }) {
  return (
    <div className="importar-link">
      <h1>Importar bot por link</h1>
      <p>Cole aqui o link de um modelo de bot. Esta versão ainda não traz a importação; a rota <code>/bots/importar-link</code> já está reservada.</p>
      <button className="btn primary" type="button" onClick={onVoltar}>Voltar ao painel</button>
    </div>
  );
}
