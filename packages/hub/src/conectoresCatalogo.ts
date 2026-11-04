// Catálogo declarativo dos aplicativos que a conta pode conectar.
// Não há segredo aqui: client id e client secret vêm do ambiente, no momento
// do OAuth, e o token de cada conta fica cifrado no cofre.

export type CategoriaConector =
  | "senhas"
  | "produtividade"
  | "comunicacao"
  | "design"
  | "codigo"
  | "marketing"
  | "financas";

export type EstiloOAuth = "google" | "form" | "notion" | "slack" | "github" | "shopify";

export type CampoConector = {
  id: string;
  rotulo: string;
  segredo: boolean;
  obrigatorio: boolean;
};

export type OAuthConector = {
  clientIdEnv: string;
  clientSecretEnv: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  estilo: EstiloOAuth;
};

export type ConectorDef = {
  id: string;
  nome: string;
  categoria: CategoriaConector;
  descricao: string;
  /** URL MCP (Streamable HTTP). `{loja}` só entra depois de validada. */
  mcpUrl: string;
  auth: "oauth" | "chave" | "oauth_ou_chave";
  /** Gerenciador de senha: o bot não recebe o conteúdo do cofre. */
  entregaSegredo: boolean;
  oauth?: OAuthConector;
  campos: CampoConector[];
};

const GOOGLE_ID = "MYBOTS_OAUTH_GOOGLE_CLIENT_ID";
const GOOGLE_SECRET = "MYBOTS_OAUTH_GOOGLE_CLIENT_SECRET";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

function google(scopes: string[]): OAuthConector {
  return {
    clientIdEnv: GOOGLE_ID,
    clientSecretEnv: GOOGLE_SECRET,
    authUrl: GOOGLE_AUTH,
    tokenUrl: GOOGLE_TOKEN,
    scopes,
    estilo: "google",
  };
}

const CHAVE: CampoConector = { id: "chave", rotulo: "Chave de acesso", segredo: true, obrigatorio: true };
const LOJA: CampoConector = { id: "loja", rotulo: "Loja (minhaloja.myshopify.com)", segredo: false, obrigatorio: true };

export const CONECTORES: ConectorDef[] = [
  {
    id: "bitwarden",
    nome: "Bitwarden",
    categoria: "senhas",
    descricao: "Gerenciador de senha no plano grátis. A chave fica no cofre do servidor. Os bots não recebem as senhas.",
    mcpUrl: "",
    auth: "chave",
    entregaSegredo: false,
    campos: [{ ...CHAVE, rotulo: "Token de acesso da conta Bitwarden" }],
  },
  {
    id: "google-drive",
    nome: "Google Drive",
    categoria: "produtividade",
    descricao: "Arquivos do Drive. Plano Google grátis. Só leitura.",
    mcpUrl: "https://drivemcp.googleapis.com/mcp/v1",
    auth: "oauth",
    entregaSegredo: true,
    oauth: google(["https://www.googleapis.com/auth/drive.readonly"]),
    campos: [],
  },
  {
    id: "google-docs",
    nome: "Google Docs",
    categoria: "produtividade",
    descricao: "Documentos do Docs. Plano Google grátis. Só leitura.",
    mcpUrl: "https://docsmcp.googleapis.com/mcp/v1",
    auth: "oauth",
    entregaSegredo: true,
    oauth: google([
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/documents.readonly",
    ]),
    campos: [],
  },
  {
    id: "google-calendar",
    nome: "Google Calendar",
    categoria: "produtividade",
    descricao: "Agenda. Plano Google grátis. Só leitura.",
    mcpUrl: "https://calendarmcp.googleapis.com/mcp/v1",
    auth: "oauth",
    entregaSegredo: true,
    oauth: google([
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.freebusy",
      "https://www.googleapis.com/auth/calendar.events.readonly",
    ]),
    campos: [],
  },
  {
    id: "notion",
    nome: "Notion",
    categoria: "produtividade",
    descricao: "Páginas e bases do Notion no plano grátis.",
    mcpUrl: "https://mcp.notion.com/mcp",
    auth: "oauth_ou_chave",
    entregaSegredo: true,
    oauth: {
      clientIdEnv: "MYBOTS_OAUTH_NOTION_CLIENT_ID",
      clientSecretEnv: "MYBOTS_OAUTH_NOTION_CLIENT_SECRET",
      authUrl: "https://api.notion.com/v1/oauth/authorize",
      tokenUrl: "https://api.notion.com/v1/oauth/token",
      scopes: [],
      estilo: "notion",
    },
    campos: [{ ...CHAVE, rotulo: "Token de integração do Notion" }],
  },
  {
    id: "gmail",
    nome: "Gmail",
    categoria: "comunicacao",
    descricao: "Caixa do Gmail. Plano Google grátis. Só leitura — enviar continua pedindo o chefe.",
    mcpUrl: "https://gmailmcp.googleapis.com/mcp/v1",
    auth: "oauth",
    entregaSegredo: true,
    oauth: google(["https://www.googleapis.com/auth/gmail.readonly"]),
    campos: [],
  },
  {
    id: "slack",
    nome: "Slack",
    categoria: "comunicacao",
    descricao: "Canais do workspace grátis. Leitura. Enviar mensagem continua pedindo o chefe.",
    mcpUrl: "https://mcp.slack.com/mcp",
    auth: "oauth_ou_chave",
    entregaSegredo: true,
    oauth: {
      clientIdEnv: "MYBOTS_OAUTH_SLACK_CLIENT_ID",
      clientSecretEnv: "MYBOTS_OAUTH_SLACK_CLIENT_SECRET",
      authUrl: "https://slack.com/oauth/v2/authorize",
      tokenUrl: "https://slack.com/api/oauth.v2.access",
      scopes: ["channels:read", "channels:history", "users:read"],
      estilo: "slack",
    },
    campos: [{ ...CHAVE, rotulo: "Bot token do Slack" }],
  },
  {
    id: "figma",
    nome: "Figma",
    categoria: "design",
    descricao: "Arquivos do Figma no plano grátis (leitura).",
    mcpUrl: "https://mcp.figma.com/mcp",
    auth: "oauth_ou_chave",
    entregaSegredo: true,
    oauth: {
      clientIdEnv: "MYBOTS_OAUTH_FIGMA_CLIENT_ID",
      clientSecretEnv: "MYBOTS_OAUTH_FIGMA_CLIENT_SECRET",
      authUrl: "https://www.figma.com/oauth",
      tokenUrl: "https://api.figma.com/v1/oauth/token",
      scopes: ["file_content:read"],
      estilo: "form",
    },
    campos: [{ ...CHAVE, rotulo: "Personal access token do Figma" }],
  },
  {
    id: "github",
    nome: "GitHub",
    categoria: "codigo",
    descricao: "Repositórios no GitHub Free. OAuth ou personal access token.",
    mcpUrl: "https://api.githubcopilot.com/mcp/",
    auth: "oauth_ou_chave",
    entregaSegredo: true,
    oauth: {
      clientIdEnv: "MYBOTS_OAUTH_GITHUB_CLIENT_ID",
      clientSecretEnv: "MYBOTS_OAUTH_GITHUB_CLIENT_SECRET",
      authUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scopes: ["read:user", "repo"],
      estilo: "github",
    },
    campos: [{ ...CHAVE, rotulo: "Personal access token do GitHub" }],
  },
  {
    id: "vercel",
    nome: "Vercel",
    categoria: "codigo",
    descricao: "Projetos no plano Hobby (grátis). OAuth ou token.",
    mcpUrl: "https://mcp.vercel.com",
    auth: "oauth_ou_chave",
    entregaSegredo: true,
    oauth: {
      clientIdEnv: "MYBOTS_OAUTH_VERCEL_CLIENT_ID",
      clientSecretEnv: "MYBOTS_OAUTH_VERCEL_CLIENT_SECRET",
      authUrl: "https://vercel.com/oauth/authorize",
      tokenUrl: "https://api.vercel.com/login/oauth/token",
      scopes: [],
      estilo: "form",
    },
    campos: [{ ...CHAVE, rotulo: "Token da Vercel" }],
  },
  {
    id: "cloudflare",
    nome: "Cloudflare",
    categoria: "codigo",
    descricao: "Conta Cloudflare no plano Free. OAuth ou API token.",
    mcpUrl: "https://mcp.cloudflare.com/mcp",
    auth: "oauth_ou_chave",
    entregaSegredo: true,
    oauth: {
      clientIdEnv: "MYBOTS_OAUTH_CLOUDFLARE_CLIENT_ID",
      clientSecretEnv: "MYBOTS_OAUTH_CLOUDFLARE_CLIENT_SECRET",
      authUrl: "https://dash.cloudflare.com/oauth2/auth",
      tokenUrl: "https://dash.cloudflare.com/oauth2/token",
      scopes: ["account:read", "zone:read"],
      estilo: "form",
    },
    campos: [{ ...CHAVE, rotulo: "API token da Cloudflare" }],
  },
  {
    id: "shopify",
    nome: "Shopify",
    categoria: "marketing",
    descricao: "Catálogo da loja. Parceiro Shopify sem mensalidade do app. OAuth ou token de admin.",
    mcpUrl: "https://{loja}.myshopify.com/api/mcp",
    auth: "oauth_ou_chave",
    entregaSegredo: true,
    oauth: {
      clientIdEnv: "MYBOTS_OAUTH_SHOPIFY_CLIENT_ID",
      clientSecretEnv: "MYBOTS_OAUTH_SHOPIFY_CLIENT_SECRET",
      authUrl: "https://{loja}.myshopify.com/admin/oauth/authorize",
      tokenUrl: "https://{loja}.myshopify.com/admin/oauth/access_token",
      scopes: ["read_products", "read_orders"],
      estilo: "shopify",
    },
    campos: [LOJA, { ...CHAVE, rotulo: "Admin API access token" }],
  },
  {
    id: "stripe",
    nome: "Stripe",
    categoria: "financas",
    descricao: "Modo de teste, sem cartão. Use uma chave restrita. Pagar e reembolsar continuam pedindo o chefe.",
    mcpUrl: "https://mcp.stripe.com",
    auth: "oauth_ou_chave",
    entregaSegredo: true,
    oauth: {
      clientIdEnv: "MYBOTS_OAUTH_STRIPE_CLIENT_ID",
      clientSecretEnv: "MYBOTS_OAUTH_STRIPE_CLIENT_SECRET",
      authUrl: "https://connect.stripe.com/oauth/authorize",
      tokenUrl: "https://connect.stripe.com/oauth/token",
      scopes: ["read_only"],
      estilo: "form",
    },
    campos: [{ ...CHAVE, rotulo: "Chave restrita de teste" }],
  },
];

const POR_ID = new Map(CONECTORES.map((c) => [c.id, c]));

export function conectorPorId(id: string): ConectorDef | undefined {
  return POR_ID.get(id);
}

export function oauthConfigurado(def: ConectorDef, env: NodeJS.ProcessEnv): { ok: boolean; faltando: string[] } {
  if (!def.oauth) return { ok: false, faltando: [] };
  const faltando = [def.oauth.clientIdEnv, def.oauth.clientSecretEnv].filter((nome) => String(env[nome] ?? "").trim().length < 8);
  return { ok: faltando.length === 0, faltando };
}

/** Domínio *.myshopify.com. Recusa URL de outro site. */
export function lojaShopify(bruta: string): string | null {
  let s = String(bruta ?? "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!s) return null;
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) return null;
  return s;
}

export function urlComLoja(modelo: string, loja: string | undefined): string | null {
  if (!modelo.includes("{loja}")) return modelo;
  const ok = loja ? lojaShopify(loja) : null;
  if (!ok) return null;
  return modelo.replaceAll("{loja}", ok);
}
