import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APK_PADRAO,
  MARCA_APP,
  USO_GRATIS,
  estaNoAplicativo,
  fichaDaCasa,
  normalizarFicha,
} from "@mybots/shared";
import { rotaPublicaOnline } from "../packages/hub/src/authOnline.ts";
import { arquivoDoApk } from "../packages/hub/src/casaArquivo.ts";
import { AVISO_SUPORTE, AVISO_WINDOWS, iniciais, itensDoMenu, nomeVisivel } from "../packages/ui/src/perfil.ts";
import { ABAS_CONFIG } from "../packages/ui/src/configuracoes/abas.ts";
import { linhaDoCofre } from "../packages/ui/src/configuracoes/permissoes.ts";

test("o menu da conta mostra uso, celular, Windows, suporte, configurações e sair", () => {
  const casa = fichaDaCasa({});
  assert.equal(casa.uso, USO_GRATIS);
  assert.equal(casa.apk, APK_PADRAO);
  assert.equal(casa.windows, "");
  const ids = itensDoMenu(casa, false).map((i) => i.id);
  assert.deepEqual(ids, ["uso", "apk", "windows", "suporte", "config", "sair"]);
  const win = itensDoMenu(casa, false).find((i) => i.id === "windows");
  assert.equal(win?.tipo, "aviso");
  assert.equal(win && win.tipo === "aviso" ? win.aviso : "", AVISO_WINDOWS);
  const suporte = itensDoMenu(casa, false).find((i) => i.id === "suporte");
  assert.equal(suporte?.tipo, "acao");
  assert.equal(AVISO_SUPORTE.includes("não foi publicado"), true);
});

test("no aplicativo o Windows some; no navegador a URL configurada entra", () => {
  const noApp = itensDoMenu(fichaDaCasa({ MYBOTS_WINDOWS_URL: "https://casa.exemplo/MyBots-Setup.exe" }), true);
  assert.equal(noApp.some((i) => i.id === "windows"), false);
  const nav = itensDoMenu(fichaDaCasa({ MYBOTS_WINDOWS_URL: "https://casa.exemplo/MyBots-Setup.exe" }), false);
  const win = nav.find((i) => i.id === "windows");
  assert.equal(win?.tipo, "link");
  assert.equal(win && win.tipo === "link" ? win.href : "", "https://casa.exemplo/MyBots-Setup.exe");
  assert.equal(estaNoAplicativo({ userAgent: `Chrome ${MARCA_APP}` }), true);
  assert.equal(estaNoAplicativo({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel; wv) AppleWebKit/537.36" }), true);
  assert.equal(estaNoAplicativo({ displayMode: "standalone" }), true);
  assert.equal(estaNoAplicativo({ userAgent: "Mozilla/5.0 Chrome/120.0.0.0", displayMode: "browser" }), false);
});

test("link de download não aceita javascript, senha na URL nem caminho fora da casa", () => {
  const ruim = fichaDaCasa({
    MYBOTS_APK_URL: "javascript:alert(1)",
    MYBOTS_WINDOWS_URL: "https://user:segredo-real@casa.exemplo/setup.exe",
    MYBOTS_SUPORTE_URL: "javascript:alert(1)",
  });
  const cru = JSON.stringify(ruim);
  assert.equal(ruim.apk, APK_PADRAO);
  assert.equal(ruim.windows, "");
  assert.equal(ruim.suporte, "");
  assert.equal(cru.includes("segredo-real"), false);
  assert.equal(cru.includes("javascript"), false);

  const local = fichaDaCasa({ MYBOTS_APK_URL: "/downloads/MyBots.apk", MYBOTS_SUPORTE_URL: "mailto:contato@herrerahouse.ia" });
  assert.equal(local.apk, "/downloads/MyBots.apk");
  assert.equal(local.suporte, "mailto:contato@herrerahouse.ia");
  assert.equal(caminhoFora(fichaDaCasa({ MYBOTS_APK_URL: "/downloads/../.env" }).apk), true);

  const resposta = normalizarFicha({ apk: "https://evil.exemplo/x.apk?token=segredo-real", windows: "file:///c:/setup.exe", uso: "<script>" });
  assert.equal(resposta.uso, USO_GRATIS);
  assert.equal(resposta.windows, "");
  assert.equal(JSON.stringify(resposta).includes("<script>"), false);
});

function caminhoFora(apk: string): boolean {
  return apk === APK_PADRAO;
}

test("a ficha e o APK são públicos; o resto de downloads não", () => {
  assert.equal(rotaPublicaOnline("/api/casa"), true);
  assert.equal(rotaPublicaOnline("/downloads/MyBots.apk"), true);
  assert.equal(rotaPublicaOnline("/downloads/segredo.env"), false);
  assert.equal(rotaPublicaOnline("/downloads/MyBots.apk.exe"), false);
  assert.equal(arquivoDoApk("/tmp/mybots-sem-apk-" + process.pid), null);
});

test("configurações têm as seis abas e o cofre só mostra nome e máscara", () => {
  assert.deepEqual(ABAS_CONFIG.map((a) => a.nome), ["Geral", "Computador", "Permissões", "Cofre", "Uso", "Atualizações"]);
  const linha = linhaDoCofre({
    nome: "Caixa",
    tipo: "login",
    usuario: "ana",
    senha: "segredo-real",
    senhaMascarada: "segredo-real",
    numero: "4111111111111111",
    cvv: "123",
    notas: "segredo-real",
  }, ["Bia"]);
  const cru = JSON.stringify(linha);
  assert.equal(cru.includes("segredo-real"), false);
  assert.equal(cru.includes("4111"), false);
  assert.equal(linha.detalhe.includes("••••••••"), true);
  assert.equal(linha.quem, "Bia");
  const cartao = linhaDoCofre({ tipo: "cartao", nome: "Visa", titular: "Casa", finalNumero: "4242", numero: "4111111111111111", cvv: "999" }, []);
  assert.equal(JSON.stringify(cartao).includes("4111111111111111"), false);
  assert.equal(cartao.detalhe, "Casa · final 4242");
  assert.equal(cartao.quem, "ninguém");

  const tela = readFileSync(new URL("../packages/ui/src/configuracoes/Permissoes.tsx", import.meta.url), "utf8");
  const cofre = readFileSync(new URL("../packages/ui/src/configuracoes/CofrePainel.tsx", import.meta.url), "utf8");
  assert.equal(/item\.senha\b/.test(tela), false);
  assert.equal(/item\.numero\b/.test(tela), false);
  assert.equal(/item\.cvv\b/.test(tela), false);
  assert.equal(/\{item\.senha\}/.test(cofre), false);
  assert.equal(cofre.includes("senhaMascarada"), true);
});

test("o nome do rodapé prefere o que a pessoa gravou e não mostra o e-mail inteiro", () => {
  assert.equal(nomeVisivel({ local: "Thiago", nome: "Outro", email: "a@b.co" }), "Thiago");
  assert.equal(nomeVisivel({ nome: "Thiago Herrera", email: "thiago@casa.exemplo" }), "Thiago Herrera");
  assert.equal(nomeVisivel({ email: "thiago.herrera@casa.exemplo" }), "thiago herrera");
  assert.equal(nomeVisivel({}), "Chefe");
  assert.equal(iniciais("Thiago Herrera"), "TH");
  assert.equal(iniciais("Chefe"), "CH");
});
