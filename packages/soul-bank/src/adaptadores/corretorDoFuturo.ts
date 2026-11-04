/**
 * Adaptador do corretordofuturo.app.
 *
 * O site público não publica OpenAPI: /api, /docs e /openapi.json devolvem a página
 * de apresentação, e app.corretordofuturo.app é o painel. Este cliente fala um
 * contrato mínimo, configurado por URL e token que vêm do cofre (variáveis de
 * ambiente), nunca do manifesto da alma.
 *
 * Perguntas em aberto: ver contratos/corretordofuturo.json e o README do pacote.
 */

export type BuscaImoveis = {
  q?: string;
  bairro?: string;
  tipo?: string;
  precoMin?: number;
  precoMax?: number;
  pagina?: number;
};

export type Lead = {
  nome: string;
  telefone: string;
  email?: string;
  mensagem?: string;
  imovelId?: string;
};

export type Visita = {
  imovelId: string;
  quando: string;
  nome: string;
  telefone: string;
  observacao?: string;
};

export type Operacao = "buscar" | "detalhe" | "lead" | "visita";

export const CAMINHOS = {
  buscar: "/v1/imoveis",
  detalhe: (id: string) => `/v1/imoveis/${encodeURIComponent(id)}`,
  lead: "/v1/leads",
  visita: "/v1/visitas",
} as const;

const ID_SEGURO = /^[A-Za-z0-9_-]{1,80}$/;

export type ResultadoCorretor =
  | { ok: true; dados: unknown }
  | { ok: false; erro: string; precisaConfirmacao?: boolean };

export async function chamarCorretor(opts: {
  baseUrl: string;
  token: string;
  operacao: Operacao;
  entrada?: Record<string, unknown>;
  confirmado?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<ResultadoCorretor> {
  const base = opts.baseUrl.trim().replace(/\/$/, "");
  if (!base) return { ok: false, erro: "Falta o item do cofre corretor.base-url. A alma não guarda o endereço." };
  if (!opts.token.trim()) return { ok: false, erro: "Falta o item do cofre corretor.token. A alma não guarda o token." };
  let urlBase: URL;
  try { urlBase = new URL(base); } catch { return { ok: false, erro: "A URL do cofre corretor.base-url não é válida." }; }
  if (urlBase.protocol !== "https:" && urlBase.hostname !== "127.0.0.1" && urlBase.hostname !== "localhost") {
    return { ok: false, erro: "A URL do corretor precisa ser https." };
  }

  const entrada = opts.entrada ?? {};
  const destrutiva = opts.operacao === "lead" || opts.operacao === "visita";
  if (destrutiva && opts.confirmado !== true) {
    return { ok: false, precisaConfirmacao: true, erro: "Criar lead e agendar visita pedem confirmação. Nada foi enviado." };
  }

  let caminho = "";
  let metodo = "GET";
  let corpo: string | undefined;
  if (opts.operacao === "buscar") {
    const busca = urlBase;
    busca.pathname = juntar(busca.pathname, CAMINHOS.buscar);
    const q = busca.searchParams;
    for (const [k, v] of Object.entries(entrada)) {
      if (k === "confirmado" || v === undefined || v === null || v === "") continue;
      q.set(k, String(v));
    }
    return executar(busca, "GET", undefined, opts);
  }
  if (opts.operacao === "detalhe") {
    const id = String(entrada.id ?? "");
    if (!ID_SEGURO.test(id)) return { ok: false, erro: "Id de imóvel inválido." };
    caminho = CAMINHOS.detalhe(id);
  } else if (opts.operacao === "lead") {
    caminho = CAMINHOS.lead;
    metodo = "POST";
    corpo = JSON.stringify(semConfirmacao(entrada));
  } else {
    const id = String(entrada.imovelId ?? "");
    if (!ID_SEGURO.test(id)) return { ok: false, erro: "Id de imóvel inválido." };
    caminho = CAMINHOS.visita;
    metodo = "POST";
    corpo = JSON.stringify(semConfirmacao(entrada));
  }
  urlBase.pathname = juntar(urlBase.pathname, caminho);
  urlBase.search = "";
  return executar(urlBase, metodo, corpo, opts);
}

function juntar(basePath: string, extra: string): string {
  const esquerda = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  return `${esquerda}${extra.startsWith("/") ? extra : `/${extra}`}` || extra;
}

function semConfirmacao(entrada: Record<string, unknown>): Record<string, unknown> {
  const copia = { ...entrada };
  delete copia.confirmado;
  return copia;
}

async function executar(url: URL, metodo: string, corpo: string | undefined, opts: { token: string; fetchImpl?: typeof fetch }): Promise<ResultadoCorretor> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: metodo,
      redirect: "error",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${opts.token}`,
        ...(corpo ? { "content-type": "application/json" } : {}),
      },
      body: corpo,
    });
  } catch (e) {
    return { ok: false, erro: `Não consegui falar com o corretor: ${(e as Error).message}` };
  }
  const texto = await res.text();
  if (!res.ok) return { ok: false, erro: `O corretor respondeu HTTP ${res.status}.` };
  try { return { ok: true, dados: texto ? JSON.parse(texto) : null }; }
  catch { return { ok: true, dados: { texto } }; }
}
