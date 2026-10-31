import assert from "node:assert/strict";
import test from "node:test";
import {
  PASSOS_GUIA, aplicar, buscarCnpj, cifrarChave, conferirPasso, contagem, decifrarChave,
  lerLink, linkDoPasso, progressoNovo, sugerirTime, validarCnpj, validarCampos, type DepsGuia, type ProgressoGuia,
} from "../packages/hub/src/guia.ts";

test("CNPJ: letra não passa, dígito errado não passa, número bom passa", () => {
  assert.equal(validarCnpj("ab.345.678/0001-95").ok, false);
  assert.match(validarCnpj("12.345").ok ? "" : validarCnpj("12.345").motivo, /14 números|letra/);
  assert.equal(validarCnpj("11.111.111/1111-11").ok, false);
  const bom = validarCnpj("00.000.000/0001-91");
  assert.equal(bom.ok, true);
  if (bom.ok) assert.equal(bom.digitos, "00000000000191");
});

test("formulário numérico recusa texto e o passo não fica concluído", async () => {
  const mem = memoria();
  const r = await conferirPasso(mem.deps, "loja", "dados", { nome: "Loja", cnpj: "texto-no-lugar" }, "conferir");
  assert.equal(r.resultado.ok, false);
  assert.equal(r.progresso.itens.dados.status, "falhou");
  assert.equal(contagem(r.progresso).ok, 0);
  assert.match(JSON.stringify(r), /letra|números/);
});

test("pular não conta como feito e dá para voltar no link", async () => {
  const mem = memoria();
  const r = await conferirPasso(mem.deps, "loja", "pc", {}, "pular");
  assert.equal(r.progresso.itens.pc.status, "pulado");
  assert.equal(contagem(r.progresso).ok, 0);
  assert.equal(linkDoPasso("loja", "pc"), "#/onboarding/loja/pc");
  assert.deepEqual(lerLink("#/onboarding/loja/celular"), { empresaId: "loja", passo: "celular" });
  assert.equal(lerLink("#/onboarding/loja/naoexiste"), null);
});

test("PC e PDF só marcam ok quando a verificação passa", async () => {
  const mem = memoria();
  mem.pc = async () => ({ ok: false, motivo: "A porta abriu a página do nginx, não o desktop." });
  let r = await conferirPasso(mem.deps, "loja", "pc", {}, "conferir");
  assert.equal(r.progresso.itens.pc.status, "falhou");
  assert.match(r.resultado.motivo, /nginx/);
  mem.pc = async () => ({ ok: true, motivo: "A tela abriu." });
  r = await conferirPasso(mem.deps, "loja", "pc", {}, "tentar");
  assert.equal(r.progresso.itens.pc.status, "ok");

  mem.pdf = async () => ({ ok: false, motivo: "O PDF não saiu." });
  r = await conferirPasso(mem.deps, "loja", "pronto", {}, "conferir");
  assert.equal(r.progresso.itens.pronto.status, "falhou");
  assert.equal(contagem(r.progresso).ok, 1);
  mem.pdf = async () => ({ ok: true, motivo: "Folha pronta.", nome: "loja.pdf" });
  r = await conferirPasso(mem.deps, "loja", "pronto", {}, "conferir");
  assert.equal(r.progresso.itens.pronto.status, "ok");
  assert.equal(r.progresso.pdf, "loja.pdf");
});

test("chave é testada, cifrada, e não volta na resposta", async () => {
  const mem = memoria();
  const segredo = "sk-teste-nao-mostrar-123456";
  mem.testar = async (_p, chave) => chave === segredo ? { ok: true, motivo: "" } : { ok: false, motivo: "recusou" };
  const ruim = await conferirPasso(mem.deps, "loja", "chaves", { provedor: "groq", chave: "curta" }, "conferir");
  assert.equal(ruim.resultado.ok, false);
  assert.equal(mem.caixas.length, 0);
  const bom = await conferirPasso(mem.deps, "loja", "chaves", { provedor: "groq", chave: segredo }, "conferir");
  assert.equal(bom.resultado.ok, true);
  assert.equal(JSON.stringify(bom).includes(segredo), false);
  assert.equal(mem.caixas.length, 1);
  assert.notEqual(mem.caixas[0].cifra, segredo);
  assert.equal(decifrarChave(mem.caixas[0].cifra), segredo);
  const outra = cifrarChave("abcdefghijkl");
  assert.notEqual(outra, "abcdefghijkl");
});

test("checklist só sobe quando o passo passa, e o time sai do ramo", async () => {
  const mem = memoria();
  await conferirPasso(mem.deps, "loja", "dados", { nome: "Loja", cnpj: "00000000000191", segmento: "informática" }, "conferir");
  const time = sugerirTime("informática");
  assert.ok(time.some((b) => b.nome === "Técnico"));
  const r = await conferirPasso(mem.deps, "loja", "time", { segmento: "informática" }, "conferir");
  assert.equal(r.progresso.itens.time.status, "ok");
  assert.equal(contagem(r.progresso).ok, 2);
  assert.equal(PASSOS_GUIA.length, 9);
});

test("busca de CNPJ usa a resposta da Receita e não inventa se vier 404", async () => {
  const nao = await buscarCnpj("00000000000191", async () => new Response("no", { status: 404 }));
  assert.equal(nao.ok, false);
  const sim = await buscarCnpj("00000000000191", async () => new Response(JSON.stringify({ razao_social: "Banco do Brasil", nome_fantasia: "BB" }), { status: 200 }));
  assert.equal(sim.ok, true);
  assert.equal(sim.nome, "Banco do Brasil");
});

test("cor e e-mail ruins não concluem o passo", () => {
  const cor = validarCampos("dados", { nome: "A", cnpj: "00000000000191", cor: "azul" });
  assert.equal(cor?.ok, false);
  const mail = validarCampos("responsavel", { nome: "Ana", email: "ana-sem-arroba" });
  assert.equal(mail?.ok, false);
});

function memoria() {
  let p: ProgressoGuia | undefined;
  const caixas: Array<{ cifra: string }> = [];
  let pc: DepsGuia["pc"] = async () => ({ ok: true, motivo: "ok" });
  let pdf: DepsGuia["gerarPdf"] = async () => ({ ok: true, motivo: "pdf", nome: "a.pdf" });
  let testar: DepsGuia["testarChave"] = async () => ({ ok: false, motivo: "não" });
  const deps: DepsGuia = {
    ler: () => p,
    gravar: (n) => { p = n; },
    salvarDados: () => true,
    salvarResponsavel: () => {},
    pc: (id) => pc(id),
    celular: async () => ({ ok: false, motivo: "Nenhum celular nesta rede." }),
    testarChave: (prov, chave) => testar(prov, chave),
    guardarChave: (_e, _prov, cifra) => { caixas.push({ cifra }); },
    canais: async () => ({ ok: false, motivo: "WhatsApp sem QR." }),
    gerarPdf: (id) => pdf(id),
    criarRotina: async () => ({ ok: true, motivo: "Rotina criada." }),
  };
  return {
    deps, caixas,
    set pc(fn: DepsGuia["pc"]) { pc = fn; },
    set pdf(fn: DepsGuia["gerarPdf"]) { pdf = fn; },
    set testar(fn: DepsGuia["testarChave"]) { testar = fn; },
  };
}
