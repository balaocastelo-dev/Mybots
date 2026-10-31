/** Uma frase curta quando o modelo parte para a ferramenta sem dizer nada. */

export function confirmacaoCurta(pedido: string, ferramentas: string[]): string {
  const p = pedido.toLowerCase();
  const f = ferramentas.map((n) => n.replace(/^mybots(-local)?_/, "")).join(" ");
  if (/pdf/.test(p) || /pdf|gerar_pdf/.test(f)) return "Vou montar o resumo em PDF agora.";
  if (/desktop|computador|screenshot/.test(p) || /screenshot|navegador/.test(f) || /tela do (pc|computador|mac)/.test(p)) return "Vou abrir a tela do computador agora.";
  if (/arquivo|planilha|documento/.test(p) || /send_file|write_file/.test(f)) return "Vou preparar o arquivo agora.";
  if (f.includes("ask_bot")) return "Vou perguntar para o colega agora.";
  if (f.includes("run_command")) return "Vou fazer isso no computador agora.";
  return "Vou cuidar disso agora.";
}
