// Recado de outro bot no próximo turno. O papel no modelo continua "user"
// (a API não tem um terceiro papel); o texto deixa explícito que não é o chefe.

export function textoComRecadosDeBots(
  turno: { fromKind: string; fromName: string; text: string },
  recados: Array<{ nome: string; texto: string }>,
): string {
  const partes = recados.map((r) => `[Mensagem do Bot ${r.nome}]\n${r.texto}`);
  const base = turno.fromKind === "bot" ? `[Mensagem do Bot ${turno.fromName}]\n${turno.text}` : turno.text;
  return partes.length ? `${partes.join("\n\n")}\n\n${base}` : base;
}
