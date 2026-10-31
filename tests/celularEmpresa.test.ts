// Um Android por empresa: descoberta, pareamento, reconexão e trava.
// Nada aqui fala com um aparelho de verdade.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acaoSensivel, enderecoParaReconectar, escolherReconexao, hostsParaVarredura, lerMdns, lerPareamento,
  pacoteValido, resumoDoCelular, TravaDosCelulares, varrerPorta,
  type ServicoAdb, type VinculoCelular,
} from "../packages/hub/src/celularEmpresa.ts";

const MDNS = [
  "List of discovered mdns services",
  "adb-poco-loja	_adb-tls-connect._tcp	192.168.15.20:42111",
  "adb-poco-loja	_adb-tls-pairing._tcp	192.168.15.20:42112",
  "adb-outro	_adb-tls-connect._tcp	192.168.15.21:43000",
  "adb-ruim	_adb-tls-connect._tcp	192.168.15.9:8787",
  "adb-octeto	_adb-tls-connect._tcp	192.168.15.999:5555",
].join("\n");

const POCO: VinculoCelular = {
  nomeMdns: "adb-poco-loja", modelo: "POCO X5", serial: "192.168.15.4:42111", host: "192.168.15.4", porta: 42111,
};

test("mdns lê conexão e pareamento e descarta a 8787", () => {
  const s = lerMdns(MDNS);
  assert.deepEqual(s.map((x) => x.tipo), ["connect", "pairing", "connect"]);
  assert.equal(s[0].nome, "adb-poco-loja");
  assert.equal(s[0].host, "192.168.15.20");
  assert.equal(s[0].porta, 42111);
  assert.equal(s.some((x) => x.porta === 8787), false);
  assert.equal(s.some((x) => x.host.endsWith(".999")), false);
  assert.deepEqual(lerMdns(""), []);
});

test("pareamento aceita 6 dígitos ou o texto do QR, e não guarda a porta 8787", () => {
  assert.deepEqual(lerPareamento("123456"), { codigo: "123456" });
  assert.deepEqual(lerPareamento("123 456"), { codigo: "123456" });
  const qr = lerPareamento("WIFI:T:ADB;S:adb-poco-loja;P:654321;;");
  assert.equal(qr?.codigo, "654321");
  assert.equal(qr?.nome, "adb-poco-loja");
  const comIp = lerPareamento("WIFI:T:ADB;S:adb-poco-loja;P:654321;192.168.15.20:42112;;");
  assert.equal(comIp?.host, "192.168.15.20");
  assert.equal(comIp?.porta, 42112);
  const proibida = lerPareamento("WIFI:T:ADB;S:x;P:654321;192.168.15.9:8787;;");
  assert.equal(proibida?.codigo, "654321");
  assert.equal(proibida?.host, undefined);
  assert.equal(proibida?.porta, undefined);
  assert.equal(lerPareamento("12345"), null);
  assert.equal(lerPareamento("oi"), null);
});

test("reconexão segue o nome mDNS e não pega o celular do vizinho", () => {
  const servicos = lerMdns(MDNS);
  const novo = escolherReconexao(POCO, servicos);
  assert.deepEqual(novo, { host: "192.168.15.20", porta: 42111 });
  const semNome: VinculoCelular = { modelo: "POCO", serial: "192.168.15.21:43000", host: "192.168.15.21", porta: 43000 };
  assert.deepEqual(escolherReconexao(semNome, servicos), { host: "192.168.15.21", porta: 43000 });
  const sumiu: VinculoCelular = { nomeMdns: "adb-sumiu", modelo: "X", serial: "1.2.3.4:1", host: "192.168.15.21", porta: 43000 };
  assert.equal(escolherReconexao(sumiu, servicos), null);
});

test("quando cai, tenta o último IP; se o IP virou outro aparelho, não conecta", () => {
  const servicos: ServicoAdb[] = [];
  assert.deepEqual(enderecoParaReconectar(POCO, servicos), { host: "192.168.15.4", porta: 42111 });
  const ocupado: ServicoAdb[] = [{ nome: "adb-vizinho", tipo: "connect", host: "192.168.15.4", porta: 42111 }];
  assert.equal(enderecoParaReconectar(POCO, ocupado), null);
  const proibida: VinculoCelular = { modelo: "X", serial: "127.0.0.1:8787", host: "127.0.0.1", porta: 8787 };
  assert.equal(enderecoParaReconectar(proibida, []), null);
});

test("a varredura fica no /24 privado e só sonda a 5555", async () => {
  const hosts = hostsParaVarredura(["192.168.15.7", "8.8.8.8", "10.0.0.2", "172.16.0.1", "192.168.15.7"]);
  assert.equal(hosts.includes("192.168.15.7"), false);
  assert.equal(hosts.includes("192.168.15.1"), true);
  assert.equal(hosts.includes("8.8.8.8"), false);
  assert.equal(hosts.filter((h) => h.startsWith("10.")).length, 253);
  assert.equal(hosts.some((h) => h.startsWith("172.")), false);
  assert.equal(hostsParaVarredura(["1.2.3.4"]).length, 0);

  const chamadas: string[] = [];
  const achados = await varrerPorta(["192.168.15.4", "192.168.15.5"], 5555, async (h) => {
    chamadas.push(h);
    return h.endsWith(".4");
  });
  assert.deepEqual(achados, ["192.168.15.4"]);
  assert.equal(chamadas.length, 2);
  const nada = await varrerPorta(["192.168.15.9"], 8787, async () => true);
  assert.deepEqual(nada, []);
});

test("dois bots não mexem juntos; o dono assume e segura depois do prazo", () => {
  let t = 1_000;
  const trava = new TravaDosCelulares(8000, () => t);
  assert.deepEqual(trava.pegar("loja", "bia", "Bia"), { ok: true });
  assert.deepEqual(trava.pegar("loja", "caio", "Caio"), { ok: false, nome: "Bia" });
  assert.equal(trava.pegar("loja", "bia", "Bia").ok, true);
  t += 8000;
  assert.equal(trava.ver("loja"), null);
  assert.equal(trava.pegar("loja", "caio", "Caio").ok, true);
  const dono = trava.pegar("loja", "chefe", "você", true);
  assert.equal(dono.ok, true);
  assert.deepEqual(trava.pegar("loja", "bia", "Bia"), { ok: false, nome: "você" });
  t += 60_000;
  assert.equal(trava.ver("loja")?.id, "chefe");
  trava.soltar("loja", "chefe");
  assert.equal(trava.ver("loja"), null);
});

test("pagamento, apagar e mensagem pedem aprovação; o pacote não aceita shell", () => {
  assert.equal(acaoSensivel("digitar", "manda o pix de 40"), true);
  assert.equal(acaoSensivel("tocar", "pagar agora"), true);
  assert.equal(acaoSensivel("abrir", "", "com.whatsapp"), true);
  assert.equal(acaoSensivel("abrir", "", "com.android.settings"), true);
  assert.equal(acaoSensivel("tocar", "abrir a calculadora"), false);
  assert.equal(acaoSensivel("print", "pix"), false);
  assert.equal(acaoSensivel("tecla", "voltar"), false);
  assert.equal(pacoteValido("com.whatsapp"), true);
  assert.equal(pacoteValido("com.android.vending"), true);
  assert.equal(pacoteValido("com.whatsapp;rm -rf"), false);
  assert.equal(pacoteValido("a"), false);
  assert.equal(pacoteValido("../etc"), false);
});

test("o histórico do celular não guarda o que foi digitado", () => {
  const segredo = "senha-super-secreta-nao-mostrar";
  const r = resumoDoCelular("digitar", segredo);
  assert.equal(r, "digitou no celular");
  assert.equal(r.includes(segredo), false);
  assert.equal(resumoDoCelular("abrir", "com.android.calculator2"), "abriu com.android.calculator2");
  assert.equal(resumoDoCelular("tecla", "voltar"), "tecla voltar");
});
