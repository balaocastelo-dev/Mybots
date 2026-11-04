/**
 * Receber um bot pelo link público https://x.ai/bot/<id>.
 * O Hub busca a página (sem seguir redirect para outro domínio), lê o Open Graph
 * e as cores do compartilhamento, e — no modo confirmar — cria um managed bot
 * do usuário logado.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BotManager, soulBlock } from "./botManager.js";
import { carregarReceita, type Receita } from "./receitas.js";

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_048_576;
const MAX_REDIRECTS = 3;
const ID_RE = /^[A-Za-z0-9_-]+$/;

/** Nomes da equipe inicial (receitas/_base/equipe-inicial.json), já normalizados. */
const RECEITA_POR_NOME: Record<string, string> = {
  director: "director",
  programador: "programador-pro",
  "seo e aeo desk": "seo-aeo-desk",
  "seo aeo desk": "seo-aeo-desk",
};

export type CoresShare = {
  accent: string | null;
  coatLight: string | null;
  coatDark: string | null;
};

export type FichaLink = {
  nome: string;
  descricao: string;
  avatar: string | null;
  cor: string | null;
  cores: CoresShare;
  receitaId: string | null;
};

export type PlanoImportacao = FichaLink & {
  id: string;
  idExterno: string;
  url: string;
  persona: string;
  ownerUserId?: string;
  empresaId: string;
  role: string;
};

type UsuarioMin = { id: string; role: string } | null;

export type DepsImportarLink = {
  authOnlineAtivo: () => boolean;
  usuarioDoReq: (req: FastifyRequest) => UsuarioMin;
  nodeAuthorized: (req: FastifyRequest) => string | null;
  existe: (id: string) => boolean;
  empresaDe: (req: FastifyRequest) => string | null;
  criar: (plano: PlanoImportacao) => Promise<{ id: string; name: string } | { error: string }>;
  buscar?: typeof buscarPaginaBot;
};

export function validarUrlBotX(bruto: unknown): { ok: true; url: string; id: string } | { ok: false; erro: string } {
  const texto = String(bruto ?? "").trim();
  if (!texto) return { ok: false, erro: "informe o link do bot" };
  let u: URL;
  try { u = new URL(texto); } catch { return { ok: false, erro: "só aceito https://x.ai/bot/<id>" }; }
  if (u.protocol !== "https:") return { ok: false, erro: "só aceito https://x.ai/bot/<id>" };
  if (u.username || u.password) return { ok: false, erro: "link inválido" };
  if (u.hostname !== "x.ai") return { ok: false, erro: "só aceito o domínio x.ai" };
  if (u.port) return { ok: false, erro: "link inválido" };
  if (u.search || u.hash) return { ok: false, erro: "o link não pode ter parâmetros" };
  let caminho = u.pathname;
  try { caminho = decodeURIComponent(u.pathname); } catch { return { ok: false, erro: "link inválido" }; }
  if (caminho !== u.pathname && /%[0-9a-f]{2}/i.test(u.pathname)) {
    // percent-encoding no caminho esconde barra ou ponto. Só o id cru passa.
    return { ok: false, erro: "link inválido" };
  }
  if (caminho.length > 1 && caminho.endsWith("/")) caminho = caminho.slice(0, -1);
  const partes = caminho.split("/");
  // ["", "bot", id]
  if (partes.length !== 3 || partes[0] !== "" || partes[1] !== "bot" || !ID_RE.test(partes[2])) {
    return { ok: false, erro: "o link precisa ser https://x.ai/bot/<id>" };
  }
  const id = partes[2];
  return { ok: true, url: `https://x.ai/bot/${id}`, id };
}

export function limparTituloOg(titulo: string): string {
  const s = decodificarHtml(titulo).replace(/\s+/g, " ").trim();
  if (!s) return "";
  const sem = s.replace(/\s*(?:[|·•:—–\-]\s*)?\b(?:by|por)\b\s+\S.*$/i, "").trim();
  return sem || s;
}

export function normalizarNomeBot(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+bot$/, "");
}

/** Id da receita da equipe inicial, se o nome bater com Director, PROGRAMADOR ou SEO & AEO Desk. */
export function receitaInicialPorNome(nome: string): string | null {
  const n = normalizarNomeBot(nome);
  return RECEITA_POR_NOME[n] ?? null;
}

export function extrairFichaDoHtml(html: string): FichaLink | { erro: string } {
  const titulo = metaConteudo(html, "og:title") || metaConteudo(html, "twitter:title");
  const nome = limparTituloOg(titulo);
  if (!nome) return { erro: "a página não tem o nome do bot (og:title)" };
  const descricao = (metaConteudo(html, "og:description") || metaConteudo(html, "twitter:description") || "").trim();
  const imagem = metaConteudo(html, "og:image") || metaConteudo(html, "twitter:image");
  const accent = variavelCss(html, "share-accent");
  const coatLight = variavelCss(html, "share-coat-light");
  const coatDark = variavelCss(html, "share-coat-dark");
  const receitaId = receitaInicialPorNome(nome);
  return {
    nome: nome.slice(0, 80),
    descricao: descricao.slice(0, 2000),
    avatar: avatarHttps(imagem),
    cor: accent,
    cores: { accent, coatLight, coatDark },
    receitaId,
  };
}

export function montarPersonaImportada(nome: string, descricao: string, receita: Receita | null): string {
  const linhas = [
    `# ${nome}`,
    "",
    `Você é ${nome}.`,
    descricao.trim() || "Ajude o chefe no que esta página descreve.",
  ];
  if (receita) {
    linhas.push(
      "",
      "Esta é a inteligência completa que o MyBots já tem deste bot. Siga ela.",
      "",
    );
    if (receita.gettingStarted) {
      linhas.push("## Primeira conversa", receita.gettingStarted, "");
    }
    if (receita.memory?.length) {
      linhas.push("## Memória", ...receita.memory.map((m) => `- (${m.type}) ${m.content}`), "");
    }
    if (receita.skills?.length) {
      linhas.push("## Skills");
      for (const sk of receita.skills) {
        linhas.push("", `### ${sk.name}`, sk.description || "", "", sk.content || "");
      }
      linhas.push("");
    }
  } else {
    linhas.push(
      "",
      "Fale em português do Brasil, de forma direta e curta.",
      "Antes de apagar, pagar, enviar ou publicar, peça aprovação.",
      "",
    );
  }
  linhas.push(soulBlock());
  return linhas.join("\n").trim();
}

export function idDisponivel(nome: string, idExterno: string, existe: (id: string) => boolean): string {
  const base = BotManager.slug(nome);
  if (!existe(base)) return base;
  const curto = idExterno.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toLowerCase() || "link";
  let id = BotManager.slug(`${base}-${curto}`);
  let n = 2;
  while (existe(id)) {
    id = BotManager.slug(`${base}-${curto}-${n}`);
    n += 1;
    if (n > 50) break;
  }
  return id;
}

export function planoDeImportacao(ficha: FichaLink, opts: {
  idExterno: string;
  url: string;
  existe: (id: string) => boolean;
  ownerUserId?: string;
  empresaId: string;
  receita?: Receita | null;
}): PlanoImportacao {
  const receita = opts.receita === undefined ? (ficha.receitaId ? carregarReceita(ficha.receitaId) : null) : opts.receita;
  const role = (ficha.descricao || receita?.profile.description || ficha.nome).slice(0, 240);
  return {
    ...ficha,
    id: idDisponivel(ficha.nome, opts.idExterno, opts.existe),
    idExterno: opts.idExterno,
    url: opts.url,
    persona: montarPersonaImportada(ficha.nome, ficha.descricao, receita),
    ownerUserId: opts.ownerUserId,
    empresaId: opts.empresaId,
    role,
    receitaId: receita?.id ?? ficha.receitaId,
  };
}

function ipPrivado(ip: string): boolean {
  const bruto = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (bruto.startsWith("::ffff:")) return ipPrivado(bruto.slice(7));
  if (!isIP(bruto)) return true;
  if (bruto.includes(":")) {
    if (bruto === "::1" || bruto === "::") return true;
    if (bruto.startsWith("fc") || bruto.startsWith("fd")) return true;
    if (bruto.startsWith("fe80")) return true;
    return false;
  }
  const p = bruto.split(".").map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

async function resolverPadrao(host: string): Promise<string[]> {
  const lista = await lookup(host, { all: true, verbatim: true });
  return lista.map((x) => x.address);
}

export async function buscarPaginaBot(url: string, opts: {
  fetchImpl?: typeof fetch;
  resolver?: (host: string) => Promise<string[]>;
  timeoutMs?: number;
  maxBytes?: number;
} = {}): Promise<{ ok: true; html: string; url: string; id: string } | { ok: false; erro: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const resolver = opts.resolver ?? resolverPadrao;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const primeiro = validarUrlBotX(url);
  if (!primeiro.ok) return primeiro;
  let atual = primeiro.url;
  const vistos = new Set<string>();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (vistos.has(atual)) return { ok: false, erro: "redirect em círculo" };
    vistos.add(atual);
    const v = validarUrlBotX(atual);
    if (!v.ok) return { ok: false, erro: "redirect para fora de https://x.ai/bot não é permitido" };
    let ips: string[];
    try { ips = await resolver("x.ai"); }
    catch { return { ok: false, erro: "não consegui resolver x.ai" }; }
    if (!ips.length || ips.some((ip) => ipPrivado(ip))) {
      return { ok: false, erro: "o endereço de x.ai não é um destino público" };
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(v.url, {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "MyBots/importar-link",
        },
      });
    } catch {
      return { ok: false, erro: "não consegui buscar a página do bot (tempo esgotado ou rede)" };
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location") || "";
      await cancelarCorpo(res);
      if (!loc) return { ok: false, erro: "redirect sem destino" };
      let prox: URL;
      try { prox = new URL(loc, v.url); } catch { return { ok: false, erro: "redirect inválido" }; }
      const nv = validarUrlBotX(prox.toString());
      if (!nv.ok) return { ok: false, erro: "redirect para fora de https://x.ai/bot não é permitido" };
      atual = nv.url;
      continue;
    }
    if (!res.ok) {
      await cancelarCorpo(res);
      return { ok: false, erro: `a página respondeu ${res.status}` };
    }
    const tipo = String(res.headers.get("content-type") || "");
    if (tipo && !/text\/html|application\/xhtml/i.test(tipo)) {
      await cancelarCorpo(res);
      return { ok: false, erro: "a página não é HTML" };
    }
    const lido = await lerComLimite(res, maxBytes);
    if (!lido.ok) return lido;
    return { ok: true, html: lido.html, url: v.url, id: v.id };
  }
  return { ok: false, erro: "redirects demais" };
}

export function registrarRotaImportarLink(app: FastifyInstance, deps: DepsImportarLink) {
  app.post("/api/bots/importar-link", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as { url?: unknown; modo?: unknown };
    const modo = body.modo === "confirmar" ? "confirmar" : body.modo === "preview" ? "preview" : "";
    if (!modo) return reply.code(400).send({ error: "modo deve ser preview ou confirmar" });
    const url = validarUrlBotX(body.url);
    if (!url.ok) return reply.code(400).send({ error: url.erro });

    if (deps.authOnlineAtivo()) {
      const user = deps.usuarioDoReq(req);
      if (!user && !deps.nodeAuthorized(req)) return reply.code(401).send({ error: "nao autenticado" });
      if (!user) return reply.code(401).send({ error: "nao autenticado" });
    }

    const buscar = deps.buscar ?? buscarPaginaBot;
    const pagina = await buscar(url.url);
    if (!pagina.ok) return reply.code(400).send({ error: pagina.erro });
    const ficha = extrairFichaDoHtml(pagina.html);
    if ("erro" in ficha) return reply.code(422).send({ error: ficha.erro });

    const previa = {
      modo: "preview" as const,
      url: pagina.url,
      idExterno: pagina.id,
      nome: ficha.nome,
      descricao: ficha.descricao,
      avatar: ficha.avatar,
      cor: ficha.cor,
      cores: ficha.cores,
      receitaConhecida: ficha.receitaId,
    };
    if (modo === "preview") return previa;

    const empresaId = deps.empresaDe(req);
    if (!empresaId) return reply.code(400).send({ error: "Crie a primeira empresa antes: todo bot pertence a uma empresa." });
    const user = deps.authOnlineAtivo() ? deps.usuarioDoReq(req) : null;
    const plano = planoDeImportacao(ficha, {
      idExterno: pagina.id,
      url: pagina.url,
      existe: deps.existe,
      ownerUserId: user?.id,
      empresaId,
    });
    const criado = await deps.criar(plano);
    if ("error" in criado) return reply.code(400).send(criado);
    return {
      modo: "confirmar" as const,
      ok: true,
      id: criado.id,
      nome: criado.name,
      descricao: ficha.descricao,
      avatar: ficha.avatar,
      cor: ficha.cor,
      cores: ficha.cores,
      receitaConhecida: plano.receitaId,
      ownerUserId: plano.ownerUserId ?? null,
    };
  });
}

function decodificarHtml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => ponto(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => ponto(Number(n)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function ponto(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try { return String.fromCodePoint(n); } catch { return ""; }
}

function metaConteudo(html: string, chave: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const alvo = chave.toLowerCase();
  for (const tag of tags) {
    const prop = (attr(tag, "property") || attr(tag, "name") || "").toLowerCase();
    if (prop !== alvo) continue;
    return decodificarHtml(attr(tag, "content") || "").trim();
  }
  return "";
}

function attr(tag: string, nome: string): string {
  const re = new RegExp(`\\b${nome}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = tag.match(re);
  return (m?.[2] ?? m?.[3] ?? m?.[4] ?? "").trim();
}

function variavelCss(html: string, nome: string): string | null {
  const re = new RegExp(`--${nome}\\s*:\\s*([^;\"']+)`, "i");
  const m = html.match(re);
  if (!m) return null;
  return corSegura(m[1].trim());
}

export function corSegura(valor: string): string | null {
  const s = valor.trim();
  if (!s || s.length > 40) return null;
  if (/url\s*\(|expression|script|\\|\/\*/i.test(s)) return null;
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
  if (/^(rgb|hsl)a?\(\s*[\d.%\s,/+-]+\)$/i.test(s)) return s;
  return null;
}

function avatarHttps(valor: string): string | null {
  const texto = decodificarHtml(valor).trim();
  if (!texto) return null;
  let u: URL;
  try { u = new URL(texto); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (isIP(host) && ipPrivado(host)) return null;
  return u.toString();
}

async function cancelarCorpo(res: Response) {
  try { await res.body?.cancel(); } catch { /* já fechado */ }
}

async function lerComLimite(res: Response, max: number): Promise<{ ok: true; html: string } | { ok: false; erro: string }> {
  const cl = Number(res.headers.get("content-length") || 0);
  if (Number.isFinite(cl) && cl > max) {
    await cancelarCorpo(res);
    return { ok: false, erro: "a página passou de 1 MB" };
  }
  if (!res.body) {
    const t = await res.text();
    if (Buffer.byteLength(t) > max) return { ok: false, erro: "a página passou de 1 MB" };
    return { ok: true, html: t };
  }
  const reader = res.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        return { ok: false, erro: "a página passou de 1 MB" };
      }
      pedacos.push(value);
    }
  } catch {
    return { ok: false, erro: "não consegui ler a página" };
  }
  return { ok: true, html: Buffer.concat(pedacos).toString("utf8") };
}
