export const ABAS_CONFIG = [
  { id: "geral", nome: "Geral", detalhe: "Tema, voz e idioma" },
  { id: "computadores", nome: "Computador", detalhe: "Este PC e o celular" },
  { id: "permissoes", nome: "Permissões", detalhe: "Microfone, avisos e cofre" },
  { id: "cofre", nome: "Cofre", detalhe: "Nomes e senhas mascaradas" },
  { id: "uso", nome: "Uso", detalhe: "Plano desta casa" },
  { id: "atualizacoes", nome: "Atualizações", detalhe: "Celular e Windows" },
] as const;

export type AbaConfig = (typeof ABAS_CONFIG)[number]["id"];
