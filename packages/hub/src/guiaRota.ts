// Rotas do guia. O Gerente fala no chat; a verificação mora no servidor.
import type { FastifyInstance } from "fastify";
import { dmConversation } from "@mybots/shared";
import type { Hub } from "./hub.js";
import {
  PASSOS_GUIA, TITULOS, LEGENDAS, confirmacao, conferirPasso, ehPasso, progressoNovo,
  buscarCnpj, validarCnpj, sugerirTime, type DepsGuia, type PassoGuia, type ProgressoGuia, type Resultado,
} from "./guia.js";
import { estadoDa, ligar } from "./maquinas.js";
import * as celular from "./celular.js";
import { pecaDaDemo } from "./demo.js";

const CHAVE = (id: string) => `guia:${id}`;

function semSegredo<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor, (k, v) => (k === "chave" || k === "cifra" || k === "token" ? undefined : v)));
}

export function registrarGuia(app: FastifyInstance, hub: Hub) {
  const depsDe = (empresaId: string): DepsGuia => ({
    ler: (id) => hub.db.getSetting<ProgressoGuia>(CHAVE(id)),
    gravar: (p) => hub.db.setSetting(CHAVE(p.empresaId), semSegredo(p)),
    salvarDados: (id, dados) => {
      const emp = hub.db.getEmpresa(id);
      if (!emp) return false;
      hub.db.saveEmpresa({
        id, nome: dados.nome, regras: emp.regras, cor: dados.cor || emp.cor, idioma: emp.idioma,
        ficha: { ...(emp.ficha ?? {}), cnpj: dados.cnpj, segmento: dados.segmento, corPrimaria: dados.cor },
      });
      return !!hub.db.getEmpresa(id)?.ficha?.cnpj;
    },
    salvarResponsavel: (id, r) => {
      const emp = hub.db.getEmpresa(id);
      if (!emp) return;
      hub.db.saveEmpresa({
        id, nome: emp.nome, regras: emp.regras, cor: emp.cor, idioma: emp.idioma,
        ficha: { ...(emp.ficha ?? {}), responsavel: r, contatos: { ...(emp.ficha?.contatos ?? {}), email: r.email, telefone: r.telefone } },
      });
    },
    pc: (id) => conferirPc(hub, id),
    celular: async () => {
      const lista = await celular.listar();
      const ok = lista.filter((a) => a.estado === "device");
      if (!ok.length) return { ok: false, motivo: "Nenhum celular Android apareceu nesta rede. Ligue a depuração sem fio e tente de novo." };
      const a = ok[0];
      return { ok: true, motivo: `Vi o ${a.modelo || "celular"}.` };
    },
    testarChave: testarChave,
    guardarChave: (id, provedor, cifra) => hub.db.setSetting(`guia.chave:${id}:${provedor}`, cifra),
    canais: async (id) => {
      const e = hub.whats.estado(id);
      if (e.estado === "conectado") return { ok: true, motivo: "WhatsApp conectado pelo QR." };
      return { ok: false, motivo: "O WhatsApp ainda não está conectado. Use o QR oficial. Não peça senha." };
    },
    criarRotina: async (id) => {
      const g = gerenteDe(hub, id);
      if (!g) return { ok: false, motivo: "Esta empresa ainda não tem Gerente Geral." };
      const criado = hub.createRoutine(g.id, "Teste da casa", "0 9 * * 1", "Diga em uma linha que a casa acordou.");
      if ("error" in criado) return { ok: false, motivo: criado.error };
      const achou = hub.db.listRoutines(g.id).some((r) => r.id === criado.id);
      return achou ? { ok: true, motivo: "Rotina de teste criada, toda segunda às 9h." } : { ok: false, motivo: "A rotina não ficou gravada." };
    },
    gerarPdf: (id) => gerarPdf(hub, id),
  });

  app.get("/api/empresas/:id/guia", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!hub.db.getEmpresa(id)) return reply.code(404).send({ error: "empresa não encontrada" });
    return semSegredo(depsDe(id).ler(id) ?? progressoNovo(id));
  });

  app.post("/api/empresas/:id/guia/abrir", async (req, reply) => {
    const id = (req.params as any).id as string;
    const emp = hub.db.getEmpresa(id);
    if (!emp) return reply.code(404).send({ error: "empresa não encontrada" });
    const g = gerenteDe(hub, id);
    if (!g) return reply.code(400).send({ error: "Crie o Gerente Geral desta empresa antes do guia." });
    const pedido = String((req.body as any)?.passo ?? "");
    const progresso = depsDe(id).ler(id) ?? progressoNovo(id);
    const passo: PassoGuia = ehPasso(pedido) ? pedido : progresso.passo;
    progresso.passo = passo;
    depsDe(id).gravar(progresso);
    await conduzirAbertura(hub, g.id, id, passo, progresso);
    return semSegredo(depsDe(id).ler(id) ?? progresso);
  });

  app.post("/api/empresas/:id/guia/:passo", async (req, reply) => {
    const id = (req.params as any).id as string;
    const passoBruto = String((req.params as any).passo ?? "");
    if (!ehPasso(passoBruto)) return reply.code(400).send({ error: "passo desconhecido" });
    if (!hub.db.getEmpresa(id)) return reply.code(404).send({ error: "empresa não encontrada" });
    const g = gerenteDe(hub, id);
    if (!g) return reply.code(400).send({ error: "Crie o Gerente Geral desta empresa antes do guia." });
    const body = (req.body ?? {}) as { acao?: string; campos?: Record<string, string> };
    const acao = body.acao === "pular" ? "pular" : body.acao === "tentar" ? "tentar" : "conferir";
    const campos = corpoSemEco(body.campos ?? {});
    if (passoBruto === "dados" && acao !== "pular" && campos.cnpj) {
      const cnpj = validarCnpj(campos.cnpj);
      if (cnpj.ok && !campos.nome) {
        const busca = await buscarCnpj(cnpj.digitos);
        if (busca.ok && busca.nome) campos.nome = busca.fantasia || busca.nome;
      }
    }
    const botId = g.id;
    hub.setStatusFromMcp(botId, "Digitando", true);
    falar(hub, botId, confirmacao(passoBruto));
    hub.setStatusFromMcp(botId, "Conferindo", true);
    const r = await conferirPasso(depsDe(id), id, passoBruto, campos, acao);
    const item = r.progresso.itens[passoBruto];
    const texto = item.status === "ok"
      ? r.resultado.motivo
      : item.status === "pulado"
        ? "Pulei este passo. Ele não fica marcado como feito. O link continua valendo para voltar."
        : r.resultado.motivo + " Pode tentar de novo.";
    falar(hub, botId, texto, { guiaResultado: { passo: passoBruto, status: item.status, motivo: r.resultado.motivo } });
    hub.setStatusFromMcp(botId, "Disponível", false);
    return semSegredo({ progresso: r.progresso, resultado: { ok: r.resultado.ok, pular: !!r.resultado.pular, motivo: r.resultado.motivo } });
  });

  app.get("/api/empresas/:id/guia/sugestao", async (req) => {
    const id = (req.params as any).id as string;
    const emp = hub.db.getEmpresa(id);
    return { bots: sugerirTime(emp?.ficha?.segmento ?? emp?.nome ?? "") };
  });
}

function corpoSemEco(c: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) {
    if (k === "chave") out.chave = String(v ?? "");
    else out[k] = String(v ?? "").slice(0, 200);
  }
  return out;
}

function gerenteDe(hub: Hub, empresaId: string) {
  const bots = hub.db.listBots().filter((b) => b.empresaId === empresaId);
  return bots.find((b) => /gerente/i.test(`${b.role} ${b.name}`)) ?? null;
}

function falar(hub: Hub, botId: string, texto: string, meta?: Record<string, unknown>) {
  hub.storeMessage(dmConversation(botId), hub.botSender(botId), texto, meta);
}

async function conduzirAbertura(hub: Hub, botId: string, empresaId: string, passo: PassoGuia, progresso: ProgressoGuia) {
  hub.setStatusFromMcp(botId, "Digitando", true);
  const n = PASSOS_GUIA.indexOf(passo) + 1;
  falar(hub, botId, `Passo ${n} de ${PASSOS_GUIA.length}: ${TITULOS[passo]}.`, {
    guia: { empresaId, passo, titulo: TITULOS[passo], legenda: LEGENDAS[passo], link: `#/onboarding/${encodeURIComponent(empresaId)}/${passo}` },
  });
  falar(hub, botId, LEGENDAS[passo]);
  hub.setStatusFromMcp(botId, "Disponível", false);
  void progresso;
}

async function conferirPc(hub: Hub, empresaId: string): Promise<Resultado> {
  const emp = hub.db.getEmpresa(empresaId);
  let m = await estadoDa(empresaId);
  if (m.estado === "sem-docker") return { ok: false, motivo: "O Docker não está no ar, então o PC desta empresa não sobe." };
  if (m.estado !== "ligada") {
    m = await ligar(empresaId, emp?.nome ?? "");
    if (m.estado !== "ligada") return { ok: false, motivo: m.erro || "Não consegui subir o PC." };
  }
  if (!m.telaUrl) return { ok: false, motivo: "O PC subiu, mas não tenho o endereço da tela." };
  try {
    const r = await fetch(m.telaUrl, { signal: AbortSignal.timeout(8000) });
    const t = await r.text();
    if (/Welcome to nginx/i.test(t)) return { ok: false, motivo: "A porta abriu, mas veio a página do nginx, não o desktop." };
    if (!r.ok || !/selkies|<!doctype html/i.test(t)) return { ok: false, motivo: "A tela não abriu o desktop." };
    return { ok: true, motivo: "A tela do PC abriu." };
  } catch {
    return { ok: false, motivo: "A tela não respondeu. Tente de novo em alguns segundos." };
  }
}

async function testarChave(provedor: string, chave: string): Promise<Resultado> {
  const p = provedor === "anthropic" ? "anthropic" : "groq";
  try {
    const r = p === "anthropic"
      ? await fetch("https://api.anthropic.com/v1/models", { headers: { "x-api-key": chave, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(8000) })
      : await fetch("https://api.groq.com/openai/v1/models", { headers: { authorization: "Bearer " + chave }, signal: AbortSignal.timeout(8000) });
    if (r.status === 401 || r.status === 403) return { ok: false, motivo: "O provedor recusou a chave." };
    if (!r.ok) return { ok: false, motivo: "Não consegui testar a chave agora. Nada foi gravado." };
    return { ok: true, motivo: "" };
  } catch {
    return { ok: false, motivo: "Sem rede para testar a chave. Nada foi gravado." };
  }
}

async function gerarPdf(hub: Hub, empresaId: string): Promise<Resultado & { nome?: string }> {
  const emp = hub.db.getEmpresa(empresaId);
  if (!emp) return { ok: false, motivo: "Empresa não encontrada." };
  const g = gerenteDe(hub, empresaId);
  try {
    const peca = await pecaDaDemo("pdf", {
      nome: emp.nome,
      segmento: emp.ficha?.segmento,
      resumo: emp.ficha?.resumo,
      site: emp.ficha?.site,
      contatos: emp.ficha?.contatos,
    }, (nome, mime, data) => {
      const f = hub.saveFile(g?.id ?? "guia", nome, mime, data);
      return { url: f.url, name: f.name };
    });
    if (peca.erro || !peca.url) return { ok: false, motivo: peca.erro || "O PDF não saiu." };
    if (g) falar(hub, g.id, "A apresentação está pronta.", { files: [{ id: peca.url, name: peca.nome ?? "apresentacao.pdf", url: peca.url, mime: "application/pdf" }] });
    return { ok: true, motivo: "A folha de apresentação saiu.", nome: peca.nome ?? "apresentacao.pdf" };
  } catch {
    return { ok: false, motivo: "Não consegui montar o PDF." };
  }
}
