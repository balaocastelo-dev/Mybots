// O que a aba Permissões pode mostrar de um item do cofre. Senha, número e cvv
// nem entram na frase, mesmo se o JSON vier com eles.

export type ItemParaLinha = {
  nome?: string;
  tipo?: string;
  usuario?: string;
  senhaMascarada?: string;
  titular?: string;
  finalNumero?: string;
  senha?: string;
  numero?: string;
  cvv?: string;
  notas?: string;
};

export type LinhaPermissao = { nome: string; detalhe: string; quem: string };

export function linhaDoCofre(item: ItemParaLinha, quem: string[]): LinhaPermissao {
  const nome = String(item.nome || "Item").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120) || "Item";
  const pessoas = quem.map((n) => n.replace(/[\u0000-\u001f]/g, "").trim()).filter(Boolean);
  let detalhe: string;
  if (item.tipo === "cartao") {
    const final = typeof item.finalNumero === "string" && /^\d{4}$/.test(item.finalNumero) ? item.finalNumero : "";
    const titular = String(item.titular || "").replace(/[\u0000-\u001f]/g, "").trim();
    detalhe = [titular, final ? `final ${final}` : "••••"].filter(Boolean).join(" · ");
  } else {
    const usuario = String(item.usuario || "").replace(/[\u0000-\u001f]/g, "").trim();
    const bruta = typeof item.senhaMascarada === "string" ? item.senhaMascarada : "";
    const mascara = /^[•*·.]{4,12}$/.test(bruta) ? bruta : "••••••••";
    detalhe = [usuario, `senha ${mascara}`].filter(Boolean).join(" · ");
  }
  return { nome, detalhe, quem: pessoas.length ? pessoas.join(", ") : "ninguém" };
}
