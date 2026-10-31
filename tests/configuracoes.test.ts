import { test } from "node:test";
import assert from "node:assert/strict";
import { ESTADOS_MAQUINA, finalDoNumero, itemSeguro, linhaAuditoriaSegura, mascararGravacao } from "../packages/ui/src/configuracoes/segredos.ts";
import {
  caminhoDoCelular,
  definirAcesso,
  ligarMaquina,
  listarMaquinas,
  resetarMaquinasParaTeste,
  type Transporte,
} from "../packages/ui/src/configuracoes/maquinas.ts";
import { criarItem, listarItens, resetarCofreParaTeste } from "../packages/ui/src/configuracoes/cofre.ts";
import { lerStatusPareamento, parearCelular, resetarPareamentoParaTeste, validarPareamento } from "../packages/ui/src/configuracoes/pareamento.ts";

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

const silencio = async (fn: () => Promise<void>) => {
  const nomes = ["log", "info", "debug", "warn", "error"] as const;
  const antes = nomes.map((n) => console[n]);
  const vistos: unknown[][] = [];
  for (const n of nomes) console[n] = (...a: unknown[]) => { vistos.push(a); };
  try {
    await fn();
    const texto = JSON.stringify(vistos);
    assert.equal(texto.includes("segredo-real"), false);
    assert.equal(texto.includes("4111111111111111"), false);
    assert.equal(vistos.length, 0);
  } finally {
    nomes.forEach((n, i) => { console[n] = antes[i]; });
  }
};

test("máscara de cofre não devolve senha, número nem cvv", () => {
  const item = mascararGravacao({
    tipo: "cartao",
    nome: "Visa",
    numero: "4111111111111111",
    cvv: "123",
    validade: "08/28",
    titular: "Casa",
  }, "c1");
  const cru = JSON.stringify(item);
  assert.equal(item.finalNumero, "1111");
  assert.equal(cru.includes("4111111111111111"), false);
  assert.equal(cru.includes("123"), false);
  assert.equal("numero" in item, false);
  assert.equal("cvv" in item, false);

  const login = mascararGravacao({ tipo: "login", nome: "Painel", senha: "segredo-real", usuario: "ana", notas: "segredo-real-nota" }, "l1");
  assert.equal(JSON.stringify(login).includes("segredo-real"), false);
  assert.equal("notas" in login, false);
  assert.equal(login.senhaMascarada, "••••••••");

  const curto = mascararGravacao({ tipo: "cartao", nome: "Curto", numero: "4242", titular: "Casa", validade: "08/28", cvv: "123" }, "c2");
  assert.equal(curto.finalNumero, "");
  assert.equal(finalDoNumero("4242"), "");
});

test("resposta do Hub com segredo em claro é descartada", () => {
  const item = itemSeguro({
    id: "x",
    tipo: "login",
    titulo: "Caixa",
    senha: "segredo-real",
    senhaMascarada: "segredo-real",
    numero: "4111111111111111",
    cvv: "999",
    finalNumero: "4111111111111111",
  });
  assert.ok(item);
  const cru = JSON.stringify(item);
  assert.equal(cru.includes("segredo-real"), false);
  assert.equal(cru.includes("4111111111111111"), false);
  assert.equal(cru.includes("999"), false);
  assert.equal(item.senhaMascarada, "••••••••");
  assert.equal(item.finalNumero, "");
  const cartao = itemSeguro({ id: "c", tipo: "cartao", nome: "Visa", titular: "Casa", numero: "4111111111111111", cvv: "999", validade: "08/28", finalNumero: "4111111111111111" });
  assert.equal(cartao?.finalNumero, "1111");
  assert.equal(JSON.stringify(cartao).includes("4111111111111111"), false);
  assert.equal(JSON.stringify(cartao).includes("999"), false);

  const aud = linhaAuditoriaSegura({ id: 4, acao: "criar", nome: "Caixa", quando: 1, quem: "painel", resultado: "ok", detalhe: "senha segredo-real", senha: "segredo-real" });
  assert.equal(JSON.stringify(aud).includes("segredo-real"), false);
});

test("lista de exemplo cobre todos os estados e não usa 8787 nem 8791", async () => {
  resetarMaquinasParaTeste();
  const pacote = await listarMaquinas(async () => new Response("no", { status: 404 }));
  assert.equal(pacote.origem, "exemplo");
  for (const tipo of ["pc", "android"] as const) {
    for (const estado of ESTADOS_MAQUINA) {
      assert.ok(pacote.itens.some((m) => m.tipo === tipo && m.estado === estado), `${tipo}:${estado}`);
    }
  }
  for (const m of pacote.itens) {
    assert.notEqual(m.porta, 8787);
    assert.notEqual(m.porta, 8791);
  }
  const vendas = pacote.itens.filter((m) => m.botId === "vendas-exemplo");
  assert.equal(vendas.every((m) => m.acessoLiberado), vendas[0].acessoLiberado);
});

test("ligar o PC no Hub não manda corpo e o celular só ganha link, sem /ws", async () => {
  resetarMaquinasParaTeste();
  await silencio(async () => {
    const chamadas: { path: string; method?: string; body?: string }[] = [];
    const transporte: Transporte = async (path, init) => {
      chamadas.push({ path, method: init?.method, body: init?.body == null ? undefined : String(init.body) });
      if (!init?.method) {
        return json(200, [{
          botId: "bia", empresaId: "casa", tipo: "pc", estado: "desligado", porta: 7901, ultimoUso: null, acessoLiberado: true, senha: "segredo-real",
        }, {
          botId: "bia", empresaId: null, tipo: "android", estado: "sem-provedor", porta: null, ultimoUso: null, acessoLiberado: true,
        }]);
      }
      if (init.method === "POST") {
        return json(200, { botId: "bia", empresaId: "casa", tipo: "pc", estado: "ligando", porta: 7901, ultimoUso: null, acessoLiberado: true });
      }
      return json(200, { botId: "bia", acessoLiberado: false, senha: "segredo-real" });
    };
    const lista = await listarMaquinas(transporte);
    assert.equal(lista.origem, "hub");
    assert.equal(JSON.stringify(lista).includes("segredo-real"), false);
    const pc = await ligarMaquina("bia", transporte);
    assert.equal(pc?.estado, "ligando");
    assert.equal(pc?.tipo, "pc");
    const post = chamadas.find((c) => c.method === "POST");
    assert.equal(post?.path, "/maquinas/bia/ligar");
    assert.equal(post?.body, undefined);
    const acesso = await definirAcesso("bia", false, transporte);
    assert.deepEqual(acesso, { botId: "bia", acessoLiberado: false });
    const put = chamadas.find((c) => c.method === "PUT");
    assert.equal(put?.body, JSON.stringify({ liberado: false }));
    assert.equal(caminhoDoCelular("bia"), "/android/bia/");
    assert.equal(caminhoDoCelular("bia").includes("/ws"), false);
    assert.equal(caminhoDoCelular("../etc"), "");
  });
});

test("cofre de exemplo não reenvia a senha quando o Hub não responde", async () => {
  resetarCofreParaTeste();
  await silencio(async () => {
    const corpos: string[] = [];
    const transporte: Transporte = async (_path, init) => {
      if (init?.body != null) corpos.push(String(init.body));
      return new Response("no", { status: 404 });
    };
    const lista = await listarItens(transporte);
    assert.equal(lista.origem, "exemplo");
    const item = await criarItem({ tipo: "login", nome: "Caixa", site: "https://caixa.exemplo", senha: "segredo-real", usuario: "ana" }, transporte);
    assert.ok(item);
    assert.equal(JSON.stringify(item).includes("segredo-real"), false);
    assert.equal(item.senhaMascarada, "••••••••");
    assert.equal(corpos.some((c) => c.includes("segredo-real")), false);
  });
});

test("pareamento recusa 8787 e 8791 e não guarda o código", async () => {
  resetarPareamentoParaTeste();
  assert.match(validarPareamento({ ip: "192.168.15.20", porta: 8787, codigo: "123456" }) ?? "", /porta/i);
  assert.match(validarPareamento({ ip: "192.168.15.20", porta: 37123, codigo: "123456", portaConexao: 8791 }) ?? "", /porta/i);
  assert.equal(validarPareamento({ ip: "8.8.8.8", porta: 37123, codigo: "123456" }), "Use o IP da rede local.");
  assert.equal(validarPareamento({ ip: "192.168.15.20", porta: 37123, codigo: "123456", portaConexao: 42111 }), null);

  await silencio(async () => {
    const corpos: string[] = [];
    const transporte: Transporte = async (_path, init) => {
      if (init?.body != null) corpos.push(String(init.body));
      return new Response(JSON.stringify({ message: "Route not found", statusCode: 404 }), { status: 404 });
    };
    const ruim = await parearCelular("bia", { ip: "192.168.15.20", porta: 8787, codigo: "123456" }, transporte);
    assert.equal(ruim.ok, false);
    assert.equal(corpos.length, 0);
    const ok = await parearCelular("bia", { ip: "192.168.15.20", porta: 37123, codigo: "123456", portaConexao: 42111 }, transporte);
    assert.equal(ok.ok, true);
    assert.equal(ok.origem, "exemplo");
    assert.equal(JSON.stringify(ok).includes("123456"), false);
    assert.equal(corpos.some((c) => c.includes("123456")), false);
    const status = await lerStatusPareamento("bia", transporte);
    assert.equal(status.cadastrado, true);
    assert.equal(JSON.stringify(status).includes("123456"), false);
  });
});

test("cofre do Hub recebe a senha uma vez e a tela fica só com a máscara", async () => {
  resetarCofreParaTeste();
  await silencio(async () => {
    let corpo = "";
    const transporte: Transporte = async (path, init) => {
      if (path === "/cofre/status") return json(200, { pronto: true, total: 1 });
      if (init?.method === "POST") {
        corpo = String(init.body);
        const enviado = JSON.parse(corpo) as { senha?: string; nome?: string; site?: string };
        return json(200, { id: "novo", tipo: "login", nome: enviado.nome, site: enviado.site, usuario: "ana", senha: enviado.senha, senhaMascarada: enviado.senha, criadoEm: 1, atualizadoEm: 1 });
      }
      return json(200, []);
    };
    const item = await criarItem({ tipo: "login", nome: "Caixa", site: "https://caixa.exemplo", usuario: "ana", senha: "segredo-real" }, transporte);
    const enviado = JSON.parse(corpo) as Record<string, string>;
    assert.equal(enviado.nome, "Caixa");
    assert.equal(enviado.site, "https://caixa.exemplo");
    assert.equal(enviado.usuario, "ana");
    assert.equal("titulo" in enviado, false);
    assert.ok(corpo.includes("segredo-real"));
    assert.ok(item);
    assert.equal(JSON.stringify(item).includes("segredo-real"), false);
    assert.equal(item.senhaMascarada, "••••••••");
  });
});
