// Imagem sem depender da RTX 4090: os provedores gratis da nuvem.
// O que estes testes guardam: (1) a ordem padrao nao comeca pela placa — senao o bot
// volta a esperar a GPU as 15h; (2) um provedor sem credencial se DESLIGA (null) em vez
// de estourar erro, para a vez passar ao proximo; (3) nenhum token vaza na URL.
import assert from "node:assert";
import { test } from "node:test";
import { MEDIA_PROVIDERS, DEFAULT_MEDIA_BUDGET } from "../packages/shared/src/media.js";
import { pollinationsImage, cloudflareImage, mediaSettings } from "../packages/hub/src/media.js";

const PNG = Buffer.alloc(4096, 7);
const originalFetch = globalThis.fetch;

/** Troca o fetch por um que grava a chamada e devolve o que o teste mandar. */
function comFetch(resposta: (url: string, init?: RequestInit) => Response) {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    chamadas.push({ url, init });
    return resposta(url, init);
  }) as typeof fetch;
  return chamadas;
}

test("a ordem padrao dos provedores comeca pelos gratis da nuvem, nao pela placa", () => {
  assert.equal(MEDIA_PROVIDERS[0], "pollinations", "o primeiro provedor tem de ser o gratis sem chave");
  assert.ok(MEDIA_PROVIDERS.indexOf("pollinations") < MEDIA_PROVIDERS.indexOf("comfy"), "a nuvem gratis vem antes da RTX 4090");
  assert.ok(MEDIA_PROVIDERS.indexOf("cloudflare") < MEDIA_PROVIDERS.indexOf("gemini"), "o gratis vem antes do pago");
  assert.deepEqual(DEFAULT_MEDIA_BUDGET.perProvider.pollinations, {}, "o gratis sem chave nao leva limite nosso");
});

test("pollinations devolve a imagem e nao precisa de chave nenhuma", async () => {
  const chamadas = comFetch(() => new Response(new Uint8Array(PNG), { status: 200, headers: { "content-type": "image/jpeg" } }));
  try {
    const out = await pollinationsImage("um gato de oculos na loja", "9:16");
    assert.ok(out, "devia ter gerado");
    assert.equal(out!.mime, "image/jpeg");
    assert.equal(out!.data.length, PNG.length);
    const { url, init } = chamadas[0];
    assert.match(url, /image\.pollinations\.ai\/prompt\//, "o pedido vai na propria URL");
    assert.match(url, /width=768&height=1344/, "9:16 tem de virar vertical");
    assert.equal((init?.headers as any)?.authorization, undefined, "sem token configurado, nao manda Authorization");
  } finally { globalThis.fetch = originalFetch; }
});

test("pollinations recusa resposta que nao e imagem, em vez de salvar lixo", async () => {
  comFetch(() => new Response("<html>fila cheia</html>", { status: 200, headers: { "content-type": "text/html" } }));
  try {
    await assert.rejects(() => pollinationsImage("teste"), /nao e uma imagem|não é uma imagem/);
  } finally { globalThis.fetch = originalFetch; }
});

test("cloudflare sem conta se desliga (null) em vez de quebrar o pedido", async () => {
  const acc = mediaSettings.cloudflareAccount, tok = mediaSettings.cloudflareToken;
  mediaSettings.cloudflareAccount = ""; mediaSettings.cloudflareToken = "";
  const chamadas = comFetch(() => new Response("", { status: 200 }));
  try {
    assert.equal(await cloudflareImage("teste"), null, "sem credencial a ferramenta nao existe");
    assert.equal(chamadas.length, 0, "e nem chega a bater na rede");
  } finally { globalThis.fetch = originalFetch; mediaSettings.cloudflareAccount = acc; mediaSettings.cloudflareToken = tok; }
});

test("cloudflare le a imagem base64 e manda o token no cabecalho, nunca na URL", async () => {
  const acc = mediaSettings.cloudflareAccount, tok = mediaSettings.cloudflareToken;
  mediaSettings.cloudflareAccount = "conta123"; mediaSettings.cloudflareToken = "segredo-abc";
  const chamadas = comFetch(() => new Response(JSON.stringify({ result: { image: PNG.toString("base64") }, success: true }), { status: 200, headers: { "content-type": "application/json" } }));
  try {
    const out = await cloudflareImage("encarte de SSD 1TB");
    assert.ok(out, "devia ter gerado");
    assert.equal(out!.data.length, PNG.length);
    const { url, init } = chamadas[0];
    assert.doesNotMatch(url, /segredo-abc/, "o token nunca aparece na URL");
    assert.equal((init?.headers as any)?.authorization, "Bearer segredo-abc");
  } finally { globalThis.fetch = originalFetch; mediaSettings.cloudflareAccount = acc; mediaSettings.cloudflareToken = tok; }
});
