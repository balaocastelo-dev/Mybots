// Guia de empresa nova. O Gerente conduz no chat, um passo por vez.
// O ✓ só existe quando a verificação de verdade passou. Pular não conta como feito.
// Segredo de chave não volta na resposta.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

export const PASSOS_GUIA = ["dados", "responsavel", "pc", "celular", "chaves", "canais", "time", "rotina", "pronto"] as const;
export type PassoGuia = (typeof PASSOS_GUIA)[number];
export type StatusPasso = "aberto" | "ok" | "pulado" | "falhou";

export type ItemGuia = { status: StatusPasso; motivo?: string; em?: number };
export type ProgressoGuia = {
  empresaId: string;
  passo: PassoGuia;
  itens: Record<PassoGuia, ItemGuia>;
  atualizado: number;
  planoTime?: Array<{ nome: string; funcao: string }>;
  pdf?: string;
};

export type Resultado = { ok: boolean; motivo: string; pular?: boolean };

export const TITULOS: Record<PassoGuia, string> = {
  dados: "Dados da empresa",
  responsavel: "Responsável",
  pc: "PC da empresa",
  celular: "Celular Android",
  chaves: "Chaves de IA",
  canais: "WhatsApp e canais",
  time: "Time de bots",
  rotina: "Primeira rotina",
  pronto: "Apresentação",
};

export const LEGENDAS: Record<PassoGuia, string> = {
  dados: "Peça ao cliente o CNPJ, o nome, o ramo, a logo e duas cores. Não peça senha de banco nem de rede.",
  responsavel: "Peça o nome de quem administra, o e-mail e o telefone. Sem senha.",
  pc: "Eu subo o computador desta empresa e só sigo se a tela abrir de verdade.",
  celular: "O Android precisa estar nesta rede, com a depuração sem fio. Eu confirmo o modelo.",
  chaves: "Peça a chave de IA pelo painel do provedor. Nunca peça senha de banco, de e-mail ou de rede. Eu testo e guardo cifrada.",
  canais: "O WhatsApp entra pelo QR oficial. Não peça a senha do WhatsApp.",
  time: "Eu sugiro os bots pelo ramo. Você confirma, e eu gravo o time.",
  rotina: "Uma tarefa de teste, de verdade, para ver se a casa acorda sozinha.",
  pronto: "A folha de apresentação em PDF. Só marco pronto se o arquivo sair.",
};

export function progressoNovo(empresaId: string, agora = Date.now()): ProgressoGuia {
  const itens = {} as ProgressoGuia["itens"];
  for (const p of PASSOS_GUIA) itens[p] = { status: "aberto" };
  return { empresaId, passo: "dados", itens, atualizado: agora };
}

export function contagem(p: ProgressoGuia): { ok: number; total: number } {
  return { ok: PASSOS_GUIA.filter((x) => p.itens[x]?.status === "ok").length, total: PASSOS_GUIA.length };
}

export function aplicar(p: ProgressoGuia, passo: PassoGuia, r: Resultado, agora = Date.now()): ProgressoGuia {
  const item: ItemGuia = r.pular
    ? { status: "pulado", em: agora }
    : r.ok
      ? { status: "ok", motivo: r.motivo, em: agora }
      : { status: "falhou", motivo: r.motivo || "Não passou.", em: agora };
  const itens = { ...p.itens, [passo]: item };
  let atual = p.passo;
  if (r.ok || r.pular) {
    const i = PASSOS_GUIA.indexOf(passo);
    atual = PASSOS_GUIA.slice(i + 1).find((x) => itens[x].status !== "ok" && itens[x].status !== "pulado") ?? passo;
  } else {
    atual = passo;
  }
  return { ...p, passo: atual, itens, atualizado: agora };
}

export function linkDoPasso(empresaId: string, passo: PassoGuia): string {
  return `#/onboarding/${encodeURIComponent(empresaId)}/${passo}`;
}

export function lerLink(hash: string): { empresaId: string; passo: PassoGuia } | null {
  const m = /^#\/onboarding\/([^/]+)\/([a-z]+)$/.exec(String(hash ?? "").trim());
  if (!m) return null;
  const passo = decodeURIComponent(m[2]) as PassoGuia;
  if (!PASSOS_GUIA.includes(passo)) return null;
  const empresaId = decodeURIComponent(m[1]);
  if (!/^[a-zA-Z0-9_.-]{1,60}$/.test(empresaId)) return null;
  return { empresaId, passo };
}

export function ehPasso(s: string): s is PassoGuia {
  return (PASSOS_GUIA as readonly string[]).includes(s);
}

/** CNPJ: só número, 14 dígitos, dígitos verificadores. Letra não passa. */
export function validarCnpj(bruto: string): { ok: true; digitos: string } | { ok: false; motivo: string } {
  const t = String(bruto ?? "").trim();
  if (!t) return { ok: false, motivo: "Falta o CNPJ." };
  if (/[a-zA-Z]/.test(t)) return { ok: false, motivo: "CNPJ só tem números. Tem letra aí." };
  const d = t.replace(/\D/g, "");
  if (d.length !== 14) return { ok: false, motivo: "CNPJ precisa de 14 números." };
  if (/^(\d)\1+$/.test(d)) return { ok: false, motivo: "Esse CNPJ não existe." };
  const dv = (base: string) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const ch of base) {
      soma += Number(ch) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (dv(d.slice(0, 12)) !== Number(d[12]) || dv(d.slice(0, 13)) !== Number(d[13])) {
    return { ok: false, motivo: "Os dígitos do CNPJ não fecham. Confira o número." };
  }
  return { ok: true, digitos: d };
}

export function validarHex(cor: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(String(cor ?? "").trim());
}

export function validarEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s ?? "").trim());
}

export function validarTelefone(s: string): boolean {
  const t = String(s ?? "").trim();
  if (!t) return false;
  if (/[a-zA-Z]/.test(t)) return false;
  const d = t.replace(/\D/g, "");
  return d.length >= 10 && d.length <= 13;
}

export function sugerirTime(segmento: string): Array<{ nome: string; funcao: string }> {
  const s = String(segmento ?? "").toLowerCase();
  const lista = [
    { nome: "Atendente", funcao: "responde o cliente" },
    { nome: "Financeiro", funcao: "contas e boletos" },
  ];
  if (/imob|corretor|casa/.test(s)) lista.push({ nome: "Corretor", funcao: "visitas e propostas" });
  if (/inform|assist|loja|tecnic/.test(s)) lista.push({ nome: "Técnico", funcao: "ordens de serviço" });
  if (/escola|curso|aula/.test(s)) lista.push({ nome: "Professor", funcao: "turmas e material" });
  return lista.slice(0, 4);
}

export type Campos = Record<string, string>;

export function validarCampos(passo: PassoGuia, c: Campos): Resultado | null {
  if (passo === "dados") {
    if (!String(c.nome ?? "").trim()) return { ok: false, motivo: "Falta o nome da empresa." };
    const cnpj = validarCnpj(c.cnpj ?? "");
    if (!cnpj.ok) return cnpj;
    if (c.cor && !validarHex(c.cor)) return { ok: false, motivo: "A cor precisa ser assim: #1A2B3C." };
    return null;
  }
  if (passo === "responsavel") {
    if (!String(c.nome ?? "").trim()) return { ok: false, motivo: "Falta o nome de quem administra." };
    if (c.email && !validarEmail(c.email)) return { ok: false, motivo: "Esse e-mail não fecha." };
    if (c.telefone && !validarTelefone(c.telefone)) return { ok: false, motivo: "Telefone só com números, com DDD." };
    return null;
  }
  if (passo === "chaves") {
    const chave = String(c.chave ?? "");
    if (/senha de |banco|instagram|whatsapp/i.test(chave)) {
      return { ok: false, motivo: "Isso parece senha de banco ou de rede. Aqui só entra chave de IA." };
    }
    if (chave.trim().length < 12) return { ok: false, motivo: "A chave está curta demais." };
    return null;
  }
  return null;
}

function segredo(): Buffer {
  const s = process.env.MYBOTS_CIFRA || process.env.MYBOTS_HUB_TOKEN || "mybots-guia-local";
  return scryptSync(s, "mybots-guia", 32);
}

/** Cifra a chave. O texto puro não volta. */
export function cifrarChave(pura: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", segredo(), iv);
  const enc = Buffer.concat([c.update(pura, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decifrarChave(caixa: string): string {
  const b = Buffer.from(caixa, "base64");
  const iv = b.subarray(0, 12);
  const tag = b.subarray(12, 28);
  const enc = b.subarray(28);
  const d = createDecipheriv("aes-256-gcm", segredo(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export type BuscaCnpj = (digitos: string) => Promise<{ ok: boolean; nome?: string; fantasia?: string; motivo?: string }>;

export async function buscarCnpj(digitos: string, pedir: typeof fetch = fetch): Promise<{ ok: boolean; nome?: string; fantasia?: string; motivo?: string }> {
  try {
    const r = await pedir(`https://brasilapi.com.br/api/cnpj/v1/${digitos}`, { signal: AbortSignal.timeout(8000) });
    if (r.status === 404) return { ok: false, motivo: "A Receita não achou esse CNPJ." };
    if (!r.ok) return { ok: false, motivo: "Não consegui consultar o CNPJ agora. Os números estão válidos; tente de novo." };
    const j = await r.json() as { razao_social?: string; nome_fantasia?: string };
    return { ok: true, nome: j.razao_social, fantasia: j.nome_fantasia };
  } catch {
    return { ok: false, motivo: "Sem rede para buscar o CNPJ. Os números estão válidos; tente de novo." };
  }
}

export type DepsGuia = {
  agora?: () => number;
  ler(empresaId: string): ProgressoGuia | undefined;
  gravar(p: ProgressoGuia): void;
  salvarDados(empresaId: string, dados: { nome: string; cnpj: string; segmento?: string; cor?: string }): boolean;
  salvarResponsavel(empresaId: string, r: { nome: string; email?: string; telefone?: string }): void;
  pc(empresaId: string): Promise<Resultado>;
  celular(empresaId: string): Promise<Resultado>;
  testarChave(provedor: string, chave: string): Promise<Resultado>;
  guardarChave(empresaId: string, provedor: string, cifra: string): void;
  canais(empresaId: string): Promise<Resultado>;
  gerarPdf(empresaId: string): Promise<Resultado & { nome?: string }>;
  criarRotina(empresaId: string): Promise<Resultado>;
};

export function confirmacao(passo: PassoGuia): string {
  return {
    dados: "Vou conferir o CNPJ agora.",
    responsavel: "Vou guardar o responsável agora.",
    pc: "Vou subir o PC e conferir a tela agora.",
    celular: "Vou procurar o celular nesta rede agora.",
    chaves: "Vou testar a chave agora. Ela não aparece de novo.",
    canais: "Vou ver se o WhatsApp está conectado.",
    time: "Vou montar o time pelo ramo agora.",
    rotina: "Vou criar a rotina de teste agora.",
    pronto: "Vou gerar a apresentação em PDF agora.",
  }[passo];
}

export async function conferirPasso(deps: DepsGuia, empresaId: string, passo: PassoGuia, campos: Campos, acao: "conferir" | "pular" | "tentar"): Promise<{ progresso: ProgressoGuia; resultado: Resultado; segredo?: never }> {
  const agora = deps.agora?.() ?? Date.now();
  const base = deps.ler(empresaId) ?? progressoNovo(empresaId, agora);
  if (acao === "pular") {
    const progresso = aplicar(base, passo, { ok: false, pular: true, motivo: "Pulado. Dá para voltar depois." }, agora);
    deps.gravar(progresso);
    return { progresso, resultado: { ok: false, pular: true, motivo: "Pulou este passo. Ele não conta como feito." } };
  }
  const invalido = validarCampos(passo, campos);
  if (invalido) {
    const progresso = aplicar(base, passo, invalido, agora);
    deps.gravar(progresso);
    return { progresso, resultado: invalido };
  }
  let resultado: Resultado = { ok: false, motivo: "Não conferi." };
  if (passo === "dados") {
    const cnpj = validarCnpj(campos.cnpj);
    if (!cnpj.ok) resultado = cnpj;
    else {
      const gravou = deps.salvarDados(empresaId, { nome: campos.nome.trim(), cnpj: cnpj.digitos, segmento: campos.segmento, cor: campos.cor });
      resultado = gravou
        ? { ok: true, motivo: `Empresa ${campos.nome.trim()} guardada.` }
        : { ok: false, motivo: "Não consegui gravar a empresa." };
    }
  } else if (passo === "responsavel") {
    deps.salvarResponsavel(empresaId, { nome: campos.nome.trim(), email: campos.email, telefone: campos.telefone });
    resultado = { ok: true, motivo: `${campos.nome.trim()} ficou como responsável.` };
  } else if (passo === "pc") resultado = await deps.pc(empresaId);
  else if (passo === "celular") resultado = await deps.celular(empresaId);
  else if (passo === "chaves") {
    const teste = await deps.testarChave(String(campos.provedor ?? "groq"), campos.chave);
    if (!teste.ok) resultado = { ok: false, motivo: teste.motivo };
    else {
      deps.guardarChave(empresaId, String(campos.provedor ?? "groq"), cifrarChave(campos.chave));
      resultado = { ok: true, motivo: "Chave testada e guardada cifrada. Ela não volta para a tela." };
    }
  } else if (passo === "canais") resultado = await deps.canais(empresaId);
  else if (passo === "time") {
    const lista = sugerirTime(campos.segmento ?? "");
    if (!lista.length) resultado = { ok: false, motivo: "Não tenho um time para sugerir." };
    else {
      const progresso = { ...base, planoTime: lista };
      deps.gravar(progresso);
      const deVolta = deps.ler(empresaId);
      resultado = deVolta?.planoTime?.length
        ? { ok: true, motivo: "Time sugerido e gravado: " + lista.map((b) => b.nome).join(", ") + "." }
        : { ok: false, motivo: "O time não ficou gravado." };
    }
  } else if (passo === "rotina") resultado = await deps.criarRotina(empresaId);
  else if (passo === "pronto") {
    const pdf = await deps.gerarPdf(empresaId);
    resultado = pdf.ok ? { ok: true, motivo: pdf.motivo || "A apresentação saiu." } : { ok: false, motivo: pdf.motivo || "O PDF não saiu." };
    if (pdf.ok && pdf.nome) {
      const atual = deps.ler(empresaId) ?? base;
      deps.gravar({ ...atual, pdf: pdf.nome });
    }
  }
  const fresco = deps.ler(empresaId) ?? base;
  const progresso = aplicar(fresco, passo, resultado, agora);
  deps.gravar(progresso);
  const publico = { ...resultado };
  return { progresso, resultado: publico };
}
