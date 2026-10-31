// A folha de apresentação tem de sair com a cara de QUALQUER empresa nova.
// Empresa com ficha cheia mostra casa, serviços, time e contato.
// Empresa só com o nome não deixa seção vazia, e nada da instalação antiga entra.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { Db } from "../packages/hub/src/db.js";
import {
  conteudoDaFolha, htmlDoRecap, iniciais, montarApresentacao, paletaDasCores, paletaDoLogo,
  PALETA_PADRAO, pdfDeHtml, pngSolido, renderizarFolha, textoDaEmpresa,
  type FichaApresentacao,
} from "../packages/hub/src/folha.js";
import { PrimeirosPassos, proximoDepoisDe, type HubParaPassos } from "../packages/hub/src/primeirospassos.js";

const PROIBIDO = /Balão|Balao|Campinas|34\.397|exemplo\.com\.br|balaoconta|Castelo|E52521|E10600/i;

function binarioAusente(erro: unknown): boolean {
  return (erro as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** Roda pdfinfo/pdftotext. Sem o binário (poppler) devolve undefined em vez de quebrar o teste. */
function executarPoppler(cmd: string, args: string[]): string | undefined {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" });
  } catch (e) {
    if (binarioAusente(e)) return undefined;
    throw e;
  }
}

/** A4 = 595,28 × 841,89 pt. O Chrome arredonda (ex.: 594,96 × 841,92) e o pdfinfo ainda chama de A4. */
function caixaA4(x0: number, y0: number, x1: number, y1: number): boolean {
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  const menor = Math.min(w, h);
  const maior = Math.max(w, h);
  return Math.abs(menor - 595.28) <= 1.5 && Math.abs(maior - 841.89) <= 1.5;
}

/**
 * Páginas e tamanho, lidos do próprio PDF quando não há pdfinfo.
 * O Chrome deixa /Count e /MediaBox em claro. Orçamento, venda e NF
 * têm de caber numa folha A4 — a mesma caixa que a apresentação usa.
 */
function medidasDoPdf(buf: Buffer): { paginas: number; a4: boolean } {
  const s = buf.toString("latin1");
  const dict = /\/Type\s*\/Pages\b([\s\S]{0,500}?)>>/.exec(s);
  const count = dict ? /\/Count\s+(\d+)/.exec(dict[1]) : null;
  const soltas = s.match(/\/Type\s*\/Page(?!s)\b/g);
  const paginas = count ? Number(count[1]) : (soltas?.length ?? 0);
  const boxes = [...s.matchAll(/\/MediaBox\s*\[\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\]/g)];
  const a4 = boxes.length > 0 && boxes.every((b) => caixaA4(Number(b[1]), Number(b[2]), Number(b[3]), Number(b[4])));
  return { paginas, a4 };
}

function todasAsPaginasA4(info: string): boolean {
  const linhas = info.match(/^Page(?:\s+\d+)? size:.*$/gm) ?? [];
  return linhas.length > 0 && linhas.every((l) => /\(A4\)/.test(l));
}

const HERRERA: FichaApresentacao = {
  nome: "Herrera HOUSE IA",
  site: "herrerahouse.ia",
  instagram: "@herrerahouse",
  segmento: "Inteligência artificial para empresas",
  resumo: "A Herrera HOUSE IA desenha agentes e fluxos de trabalho com inteligência artificial para empresas que querem uma equipe digital de verdade — com o tom, os documentos e as regras da própria casa.",
  regras: [
    "- Agentes sob medida para o jeito da casa, não um chat genérico",
    "- Integração com WhatsApp, e-mail e o sistema que a empresa já usa",
    "- Os bots nunca expõem chave de API",
  ].join("\n"),
  contatos: { email: "contato@herrerahouse.ia", whatsapp: "11987654321", endereco: "São Paulo — atendimento remoto" },
  time: [
    { nome: "Gerente Geral — Herrera HOUSE IA", funcao: "Recebe o dono, apresenta a casa e monta a equipe" },
    { nome: "Atendimento", funcao: "Responde no WhatsApp no tom da casa" },
    { nome: "Conteúdo", funcao: "Prepara posts e a folha" },
  ],
  anotacoes: [
    { titulo: "Oficina de agentes", texto: "Desenho de fluxos com os documentos da própria empresa.", tipo: "produto" },
    { titulo: "Recepção", texto: "E-mail ola@herrerahouse.ia", tipo: "contato" },
  ],
  quando: new Date("2026-10-31T15:00:00Z"),
};

test("iniciais ignoram da/de e param em três letras", () => {
  assert.equal(iniciais("Herrera HOUSE IA"), "HHI");
  assert.equal(iniciais("Ateliê Norte"), "AN");
  assert.equal(iniciais("Balão da Informática"), "BI");
  assert.equal(iniciais("Acme"), "AC");
});

test("empresa cheia leva casa, serviços, time e contato — e esconde regra interna", () => {
  const c = conteudoDaFolha(HERRERA);
  assert.equal(c.nome, "Herrera HOUSE IA");
  assert.equal(c.segmento, "Inteligência artificial para empresas");
  assert.match(c.lead ?? "", /equipe digital/);
  assert.ok(c.diferenciais.some((d) => /Oficina de agentes/.test(d)));
  assert.ok(c.diferenciais.some((d) => /Agentes sob medida/.test(d)));
  assert.ok(!c.diferenciais.some((d) => /chave de API|bots nunca/i.test(d)), "regra de bot não é diferencial");
  assert.ok(c.time[0]?.nome.startsWith("Gerente"));
  assert.equal(c.time.length, 3);
  assert.ok(c.contatos.some((x) => x.valor === "contato@herrerahouse.ia"));
  assert.ok(c.contatos.some((x) => x.valor === "ola@herrerahouse.ia"));
  assert.ok(c.qrSite?.startsWith("https://"));
  assert.ok(c.qrWhats?.startsWith("https://wa.me/55"));
  assert.equal(c.temMiolo, true);
  assert.doesNotMatch(JSON.stringify(c), PROIBIDO);
});

test("empresa só com o nome não abre seção vazia", () => {
  const c = conteudoDaFolha({ nome: "Ateliê Norte" });
  assert.equal(c.segmento, undefined);
  assert.equal(c.lead, undefined);
  assert.equal(c.quemSomos, undefined);
  assert.deepEqual(c.diferenciais, []);
  assert.deepEqual(c.time, []);
  assert.deepEqual(c.contatos, []);
  assert.equal(c.qrSite, undefined);
  assert.equal(c.qrWhats, undefined);
  assert.equal(c.temMiolo, false);
  assert.match(textoDaEmpresa({ nome: "Ateliê Norte" }), /só tenho o nome/);
});

test("o html da empresa magra não tem buraco nem dado de outra casa", async () => {
  const html = await renderizarFolha({ nome: "Ateliê Norte", quando: new Date("2026-10-31T15:00:00Z") });
  assert.match(html, /Ateliê Norte/);
  assert.match(html, />AN</);
  assert.doesNotMatch(html, /Quem somos|Serviços e diferenciais|A equipe|Contato/);
  assert.doesNotMatch(html, /undefined|null|>\s*<\/(h2|li|p)>/);
  assert.doesNotMatch(html, PROIBIDO);
});

test("o html da empresa cheia traz as seções e o QR, com a cor do logo", async () => {
  const png = pngSolido(12, 12, [11, 110, 106]);
  const paleta = await paletaDoLogo(png, ".png");
  assert.equal(paleta.origem, "logo");
  assert.notEqual(paleta.acento.toLowerCase(), PALETA_PADRAO.acento);
  const html = await renderizarFolha(HERRERA, { paleta, logoHtml: `<img src="data:image/png;base64,${png.toString("base64")}" alt="">` });
  assert.match(html, /Quem somos|Serviços e diferenciais/);
  assert.match(html, /Serviços e diferenciais/);
  assert.match(html, /A equipe/);
  assert.match(html, /Atendimento/);
  assert.match(html, /Contato/);
  assert.match(html, /wa\.me\/5511987654321/);
  assert.match(html, new RegExp(paleta.cover.replace("#", "")));
  assert.doesNotMatch(html, /chave de API/);
  assert.doesNotMatch(html, PROIBIDO);
});

test("svg de duas cores: o acento é o claro e a capa escurece o escuro", () => {
  const paleta = paletaDasCores([
    { rgb: [16, 36, 63], n: 4 },
    { rgb: [196, 165, 116], n: 2 },
  ]);
  assert.equal(paleta.origem, "logo");
  const acento = paleta.acentoCapa;
  const r = parseInt(acento.slice(1, 3), 16);
  const g = parseInt(acento.slice(3, 5), 16);
  const b = parseInt(acento.slice(5, 7), 16);
  assert.ok(r > b, `acento da capa deveria puxar o dourado, veio ${acento}`);
  assert.ok(g > 80);
  const coverR = parseInt(paleta.cover.slice(1, 3), 16);
  assert.ok(coverR < 40, `capa deveria ser escura, veio ${paleta.cover}`);
});

test("logo do site entra pela apple-touch-icon, sem rede de verdade", async () => {
  const png = pngSolido(8, 8, [180, 60, 40]);
  const html = `<html><head><link rel="apple-touch-icon" href="/marca.png"></head></html>`;
  const buscar = (async (url: string) => {
    if (String(url).endsWith(".png")) return new Response(png, { headers: { "content-type": "image/png" } });
    return new Response(html, { status: 200 });
  }) as typeof fetch;
  const out = await montarApresentacao({ nome: "Casa Nova", site: "https://casa.example" }, { buscar });
  assert.match(out, /data:image\/png;base64,/);
  assert.match(out, /Casa Nova/);
  assert.doesNotMatch(out, PROIBIDO);
});

test("a ficha gravada sobrevive a um patch só das regras, e o saber de outra empresa não vaza", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-ficha-"));
  const db = new Db(path.join(dir, "t.db"));
  db.ensureManagedTable();
  db.saveEmpresa({
    id: "hh", nome: "Herrera HOUSE IA", regras: "regra um",
    ficha: { site: "herrerahouse.ia", instagram: "@herrera", resumo: "agentes da casa" },
  });
  db.saveEmpresa({ id: "hh", nome: "Herrera HOUSE IA", regras: "regra dois" });
  const e = db.getEmpresa("hh")!;
  assert.equal(e.regras, "regra dois");
  assert.equal(e.ficha?.site, "herrerahouse.ia");
  assert.equal(e.ficha?.instagram, "@herrera");
  assert.equal(e.ficha?.resumo, "agentes da casa");
  db.saveSaber({ id: "da-casa", titulo: "Oficina", resumo: "", conteudo: "fluxos", tipo: "produto", tags: [], empresaId: "hh" } as any);
  db.saveSaber({ id: "universal", titulo: "Loja antiga", resumo: "", conteudo: "endereço de Campinas", tipo: "conhecimento", tags: [] } as any);
  const soDela = db.saberesDaEmpresa("hh").map((s) => s.titulo);
  assert.deepEqual(soDela, ["Oficina"]);
});

test("o roteiro anda um passo por vez e cada um pode ser pulado", async () => {
  assert.equal(proximoDepoisDe("ola", false), "empresa");
  assert.equal(proximoDepoisDe("ola", true), "time");
  assert.equal(proximoDepoisDe("empresa", true), "imagem");
  assert.equal(proximoDepoisDe("time", true), "whatsapp");
  assert.equal(proximoDepoisDe("imagem", true), "resumo");
  assert.equal(proximoDepoisDe("imagem", false), "celular");
  assert.equal(proximoDepoisDe("celular", false), "whatsapp");
  assert.equal(proximoDepoisDe("celular", true), "whatsapp");

  const falas: string[] = [];
  const perguntas: Array<{ id: string; texto: string }> = [];
  const chamadas: string[] = [];
  const estado = new Map<string, unknown>();
  const hub = {
    falar: (_b: string, texto: string) => { falas.push(texto); },
    perguntar: (_b: string, id: string, texto: string) => { perguntas.push({ id, texto }); },
    fecharPergunta: () => {},
    salvarArquivo: (_b: string, nome: string, mime: string) => ({ id: "1", name: nome, url: "/f/" + nome, mime }),
    empresa: () => ({ id: "hh", nome: "Herrera HOUSE IA", resumo: "Desenha agentes para empresas.", site: "herrerahouse.ia" }),
    time: () => [{ nome: "Gerente Geral — Herrera HOUSE IA", funcao: "Coordena" }, { nome: "Atendimento", funcao: "WhatsApp" }],
    anotacoes: () => [],
    memoria: () => [],
    whats: { estado: () => ({ empresaId: "hh", estado: "conectado", numero: "5511" }), conectar: async () => ({}), enviar: async () => ({ ok: true, detalhe: "" }), enviarArquivo: async () => ({ ok: true, detalhe: "" }) },
    lerEstado: (k: string) => estado.get(k),
    gravarEstado: (k: string, v: unknown) => { estado.set(k, v); },
    audit: () => {},
    raizDoProjeto: process.cwd(),
  } as unknown as HubParaPassos;
  const gerar = (async (passo: string) => {
    chamadas.push(passo);
    return { tipo: passo, titulo: passo, texto: "ok", url: "/f/" + passo, nome: passo + ".bin" };
  }) as any;

  const pp = new PrimeirosPassos(hub, gerar);
  await pp.iniciar("gerente-hh", "hh");
  assert.equal(chamadas.length, 0, "a abertura não gera arquivo");
  assert.equal(perguntas.length, 1);
  assert.match(falas[0], /aos poucos/);

  await pp.responder(perguntas.at(-1)!.id, "Pode seguir");
  assert.deepEqual(chamadas, [], "os dados da empresa são texto, ainda sem PDF");
  assert.match(falas.at(-1)!, /Desenha agentes/);

  await pp.responder(perguntas.at(-1)!.id, "Pode seguir");
  assert.deepEqual(chamadas, ["pdf"]);
  assert.match(falas.join("\n"), /Atendimento/);
  assert.match(perguntas.at(-1)!.texto, /imagem/i);

  await pp.responder(perguntas.at(-1)!.id, "Pular");
  assert.deepEqual(chamadas, ["pdf"], "pular a imagem não gera imagem");
  assert.match(falas.at(-1)!, /WhatsApp/);
});

test("pular os dados da empresa não monta a folha; pular a imagem vai ao resumo", async () => {
  const perguntas: Array<{ id: string; texto: string }> = [];
  const chamadas: string[] = [];
  const estado = new Map<string, unknown>();
  const hub = {
    falar: () => {},
    perguntar: (_b: string, id: string, texto: string) => { perguntas.push({ id, texto }); },
    fecharPergunta: () => {},
    salvarArquivo: (_b: string, nome: string, mime: string) => ({ id: "1", name: nome, url: "/f/" + nome, mime }),
    empresa: () => ({ id: "a", nome: "Ateliê Norte" }),
    time: () => [],
    whats: { estado: () => ({ empresaId: "a", estado: "desligado" }), conectar: async () => ({}), enviar: async () => ({ ok: false, detalhe: "" }), enviarArquivo: async () => ({ ok: false, detalhe: "" }) },
    lerEstado: (k: string) => estado.get(k),
    gravarEstado: (k: string, v: unknown) => { estado.set(k, v); },
    audit: () => {},
    raizDoProjeto: process.cwd(),
  } as unknown as HubParaPassos;
  const pp = new PrimeirosPassos(hub, (async (passo: string) => {
    chamadas.push(passo);
    return { tipo: passo, titulo: passo, texto: "", url: "/f/" + passo, nome: passo };
  }) as any);
  await pp.iniciar("g", "a");
  await pp.responder(perguntas.at(-1)!.id, "Pode seguir");
  await pp.responder(perguntas.at(-1)!.id, "Pular");
  assert.deepEqual(chamadas, ["imagem"]);
});

test("o PDF impresso tem uma página quando só há o nome e não traz a casa antiga", async (t) => {
  const htmlMagra = await renderizarFolha({ nome: "Ateliê Norte", quando: new Date("2026-10-31T15:00:00Z") });
  const htmlCheia = await renderizarFolha({
    ...HERRERA,
    logo: undefined,
  }, {
    paleta: paletaDasCores([{ rgb: [16, 36, 63], n: 3 }, { rgb: [196, 165, 116], n: 2 }]),
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-pdf-"));
  const magra = await pdfDeHtml(htmlMagra);
  const cheia = await pdfDeHtml(htmlCheia);
  const arqMagra = path.join(dir, "magra.pdf");
  const arqCheia = path.join(dir, "cheia.pdf");
  fs.writeFileSync(arqMagra, magra);
  fs.writeFileSync(arqCheia, cheia);
  const infoMagra = executarPoppler("pdfinfo", [arqMagra]);
  const infoCheia = executarPoppler("pdfinfo", [arqCheia]);
  const tMagra = executarPoppler("pdftotext", ["-layout", arqMagra, "-"]);
  const tCheia = executarPoppler("pdftotext", ["-layout", arqCheia, "-"]);

  // Com pdfinfo, a contagem e o rótulo A4 vêm dele. Sem o poppler, o mesmo
  // critério sai do /Count e do MediaBox do arquivo.
  if (infoMagra && infoCheia) {
    const paginas = (info: string) => info.match(/Pages:\s+(\d+)/)?.[1];
    assert.equal(paginas(infoMagra), "1");
    assert.ok(todasAsPaginasA4(infoMagra), "a folha só com o nome tem de ser A4");
    const nCheia = Number(paginas(infoCheia));
    assert.ok(nCheia >= 2 && nCheia <= 3, `a folha cheia deveria ter 2 ou 3 páginas, tem ${nCheia}`);
    assert.ok(todasAsPaginasA4(infoCheia), "a folha cheia tem de ser A4");
  } else {
    const aviso = "pdfinfo (poppler) não está no PATH — páginas e tamanho A4 lidos do próprio PDF. Instale o poppler para conferir com o pdfinfo.";
    console.warn(aviso);
    t.diagnostic(aviso);
    const m = medidasDoPdf(magra);
    const c = medidasDoPdf(cheia);
    assert.equal(m.paginas, 1, "folha só com o nome deve ter 1 página");
    assert.ok(m.a4, "folha só com o nome deve ser A4");
    assert.ok(c.paginas >= 2 && c.paginas <= 3, `a folha cheia deveria ter 2 ou 3 páginas, tem ${c.paginas}`);
    assert.ok(c.a4, "folha cheia deve ser A4");
  }

  const semTexto = tMagra === undefined || tCheia === undefined;
  if (semTexto) {
    const aviso = "pdftotext (poppler) não está no PATH — texto do PDF não conferido. Instale o poppler para essa verificação.";
    console.warn(aviso);
    t.diagnostic(aviso);
  }
  await t.test("o texto impresso é desta empresa e não traz a casa antiga", {
    skip: semTexto ? "pdftotext (poppler) ausente" : false,
  }, () => {
    assert.ok(tMagra !== undefined && tCheia !== undefined);
    assert.match(tMagra, /Ateliê Norte/);
    assert.doesNotMatch(tMagra, /Quem somos|Serviços|A equipe|Contato|undefined/);
    assert.doesNotMatch(tMagra, PROIBIDO);
    assert.match(tCheia, /Herrera HOUSE IA/);
    assert.match(tCheia, /Atendimento/);
    assert.match(tCheia, /herrerahouse\.ia/);
    assert.doesNotMatch(tCheia, /chave de API/);
    assert.doesNotMatch(tCheia, PROIBIDO);
  });

  assert.match(htmlDoRecap("Ateliê Norte", ["WhatsApp: pulado"]), /Primeiros passos/);
  assert.doesNotMatch(htmlDoRecap("Ateliê Norte", []), PROIBIDO);
});
