// Busca na web sem chave: a página HTML do DuckDuckGo, só título e URL.
// O bot abre o link no navegador do PRÓPRIO PC (ferramenta navegador).

export function urlLimpa(href: string): string {
  const bruto = href.replace(/&amp;/g, "&").trim();
  if (!bruto) return "";
  try {
    const u = new URL(bruto, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    const destino = uddg ? new URL(uddg) : u;
    if (destino.protocol !== "http:" && destino.protocol !== "https:") return "";
    return destino.toString();
  } catch {
    return "";
  }
}

export function linksDaBusca(html: string, limite = 5): Array<{ titulo: string; url: string }> {
  const out: Array<{ titulo: string; url: string }> = [];
  const vistos = new Set<string>();
  const tags = html.match(/<a\b[^>]*result__a[^>]*>[\s\S]*?<\/a>/gi) ?? [];
  for (const tag of tags) {
    const href = /href="([^"]+)"/i.exec(tag)?.[1] ?? "";
    const url = urlLimpa(href);
    if (!url || vistos.has(url)) continue;
    const titulo = tag
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    vistos.add(url);
    out.push({ titulo: titulo || url, url });
    if (out.length >= limite) break;
  }
  return out;
}

export function textoDaBusca(consulta: string, links: Array<{ titulo: string; url: string }>): string {
  if (!links.length) {
    return `A busca por "${consulta}" não devolveu links. Tente outras palavras ou abra um endereço direto com a ferramenta navegador, no PC deste bot.`;
  }
  const linhas = links.map((l, i) => `${i + 1}. ${l.titulo}\n   ${l.url}`);
  return [
    `Busca: ${consulta}`,
    ...linhas,
    "Abra o melhor link com navegador acao=abrir (PC deste bot) e leia a página com acao=ler antes de responder. Vá até o fim.",
  ].join("\n");
}
