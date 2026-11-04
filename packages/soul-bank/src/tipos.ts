/** Nível de uma permissão. Ação que muda o mundo de verdade não pode ser "sim": nasce em "confirma". */
export type NivelPermissao = "nao" | "sim" | "confirma";

export type Permissoes = {
  rede: NivelPermissao;
  enviarMensagens: NivelPermissao;
  gravarDados: NivelPermissao;
  gastarDinheiro: NivelPermissao;
  apagar: NivelPermissao;
  publicar: NivelPermissao;
};

export type Segredo = {
  /** Id do item no cofre. A alma nunca guarda o valor. */
  cofreId: string;
  uso: string;
  /** Nome da variável que o processo lê, se o cofre injetar uma. Sem valor. */
  env?: string;
};

export type ArquivoPinado = {
  caminho: string;
  sha256: string;
};

export type ItemAllowlist = {
  id: string;
  tipo: "skill" | "mcp";
  nome: string;
  descricao?: string;
  repositorio?: string;
  commit?: string;
  versao?: string;
  npm?: string;
  integridade?: string;
  url?: string;
  comando?: string[];
  checksums?: Record<string, string>;
  artefato?: string;
  pastaVendor?: string;
  pastaDestino?: string;
  arquivos?: ArquivoPinado[];
  contrato?: string;
  contratoSha256?: string;
  opcional?: boolean;
  padrao?: boolean;
  skill?: string;
  segredos?: Segredo[];
  permissoes?: Permissoes;
  opencode?: Record<string, unknown>;
};

export type Allowlist = {
  versao: 1;
  regra: string;
  itens: ItemAllowlist[];
  proibidos: Array<{ id: string; motivo: string; padroes: string[] }>;
};

export type Alma = {
  id: string;
  nome: string;
  avatar: string;
  funcao: string;
  resumo: string;
  persona: string;
  skills: string[];
  mcps: string[];
  permissoes: Permissoes;
  segredos: Segredo[];
};

export type PedidoNascimento = {
  almaId?: string | null;
  opcionais?: string[];
  confirmar?: boolean;
};

export type Plano = {
  id: string | null;
  nome: string;
  avatar: string;
  funcao: string;
  persona: string;
  permissoes: Permissoes;
  exigeConfirmacao: boolean;
  segredos: Segredo[];
  skills: ItemAllowlist[];
  mcps: ItemAllowlist[];
  opcionais: string[];
};
