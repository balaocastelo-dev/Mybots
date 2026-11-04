// Padrão 8Token, troca do Vigia e pipeline de vídeo (quadros + transcrição).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  EIGHTTOKEN_BASE_URL,
  EIGHTTOKEN_KEY_ENV,
  EIGHTTOKEN_MODEL,
  MARCA_VISAO_WEB,
  PADRAO_DA_CASA,
  aplicarPadrao,
  baseDo8token,
  blocoVisaoEWeb,
  decidirPadrao,
  escolhaDoInput,
  instantesDosQuadros,
  modeloAceitaVideo,
  planoDoAnexo,
} from "../packages/shared/src/padrao.ts";
import { extratorFfmpeg, pipelineDeVideo } from "../packages/hub/src/videoPipeline.ts";
import { provedorFallback } from "../packages/node/src/continuarTarefa.ts";
import { selecionarKitFerramentas } from "../packages/node/src/kitFerramentas.ts";
import { linksDaBusca, textoDaBusca } from "../packages/node/src/buscaWeb.ts";
import { visionPlan } from "../packages/node/src/vision.ts";
import { OpenAICompatProvider } from "../packages/node/src/providers/openaiCompat.ts";
import { TOOL_DEFS } from "../packages/node/src/tools.ts";

test("todo bot nasce no 8token, claude-fable-5.1, base OpenAI /v1", () => {
  assert.equal(PADRAO_DA_CASA.provider, "8token");
  assert.equal(PADRAO_DA_CASA.model, EIGHTTOKEN_MODEL);
  assert.equal(PADRAO_DA_CASA.model, "claude-fable-5.1");
  assert.equal(PADRAO_DA_CASA.baseURL, EIGHTTOKEN_BASE_URL);
  assert.equal(PADRAO_DA_CASA.baseURL, "https://8token.tech/v1");
  assert.equal(PADRAO_DA_CASA.keyEnv, EIGHTTOKEN_KEY_ENV);
  assert.equal(PADRAO_DA_CASA.keyEnv, "EIGHTTOKEN_API_KEY");
  assert.equal(PADRAO_DA_CASA.engine, "direct");
  assert.equal(baseDo8token("https://8token.tech"), "https://8token.tech/v1");
  assert.equal(baseDo8token("https://8token.tech/v1"), "https://8token.tech/v1");
  assert.equal(escolhaDoInput({}), "padrao");
  assert.equal(escolhaDoInput({ provider: { kind: "8token", model: "claude-fable-5.1" } }), "padrao");
  assert.equal(escolhaDoInput({ provider: { kind: "groq", model: "qwen/qwen3.8-27b" } }), "manual");
});

test("migração da equipe inicial é idempotente e não pisa escolha manual", () => {
  const inicial = { id: "programador-pro-casa", receitaId: "programador-pro", provider: { kind: "zai", model: "glm-4.5-flash" } };
  assert.equal(decidirPadrao(inicial), "aplicar");
  const aplicado = aplicarPadrao(inicial);
  assert.equal(aplicado.provider.kind, "8token");
  assert.equal(aplicado.provider.model, "claude-fable-5.1");
  assert.equal(aplicado.provider.baseURL, "https://8token.tech/v1");
  assert.equal(aplicado.providerEscolha, "padrao");
  assert.equal(aplicado.capacidades?.visao, true);
  assert.equal(aplicado.capacidades?.navegacaoWeb, true);
  assert.equal(decidirPadrao(aplicado), "ja-esta");
  assert.equal(decidirPadrao(aplicarPadrao(aplicado)), "ja-esta");

  const gerente = { id: "gerente-casa", gerente: true, provider: { kind: "gemini", model: "gemini-3.8-flash" } };
  assert.equal(decidirPadrao(gerente), "aplicar");

  const manual = { id: "programador-pro-casa", providerEscolha: "manual" as const, provider: { kind: "groq", model: "qwen/qwen3.8-27b" } };
  assert.equal(decidirPadrao(manual), "preservar");

  const comChave = { id: "cofre-casa", cofre: true, provider: { kind: "zai", model: "glm-4.5-flash", apiKey: "colada-pelo-dono" } };
  assert.equal(decidirPadrao(comChave), "preservar");

  const modeloProprio = { id: "director-casa", provider: { kind: "ollama", model: "qwen2.5vl:7b" } };
  assert.equal(decidirPadrao(modeloProprio), "preservar");

  const outroBot = { id: "bia-tela", provider: { kind: "zai", model: "glm-4.5-flash" } };
  assert.equal(decidirPadrao(outroBot), "preservar");
});

test("Vigia troca de provedor quando o 8token falha, sem repetir o mesmo", () => {
  const fb = provedorFallback(
    { ZAI_API_KEY: "z", EIGHTTOKEN_API_KEY: "e", MYBOTS_FALLBACK_ORDEM: "8token,zai,ollama" },
    { exceto: "8token" },
  );
  assert.ok(fb);
  assert.equal(fb.kind, "zai");
  assert.notEqual(fb.kind, "8token");

  const soOllama = provedorFallback(
    { EIGHTTOKEN_API_KEY: "e", MYBOTS_FALLBACK_ORDEM: "8token,ollama" },
    { exceto: "8token" },
  );
  assert.equal(soOllama?.kind, "ollama");

  const padrao = provedorFallback({ ZAI_API_KEY: "z" }, { exceto: "8token" });
  assert.equal(padrao?.kind, "zai");
  assert.equal(provedorFallback({}).kind, "ollama");
});

test("claude-fable não recebe vídeo; imagem vai multimodal e vídeo vira quadros", () => {
  assert.equal(modeloAceitaVideo("8token", "claude-fable-5.1"), false);
  assert.equal(planoDoAnexo("image/png", "8token", "claude-fable-5.1"), "imagem");
  assert.equal(planoDoAnexo("video/mp4", "8token", "claude-fable-5.1"), "video-quadros");
  assert.equal(planoDoAnexo("video/mp4", "gemini", "gemini-3.8-flash"), "video-nativo");
  assert.deepEqual(instantesDosQuadros(4, 8).length >= 2, true);
  const plano = visionPlan({
    provider: { kind: "8token", model: "claude-fable-5.1" },
    capacidades: { visao: true, navegacaoWeb: true },
  } as never);
  assert.equal(plano.modo, "nativo");
  const cego = visionPlan({
    provider: { kind: "8token", model: "claude-fable-5.1" },
    capacidades: { visao: false, navegacaoWeb: true },
  } as never);
  assert.equal(cego.modo, "sem-visao");
});

test("pipeline de vídeo: quadros e transcrição entram no contexto", async () => {
  const r = await pipelineDeVideo("video.mp4", {
    duracao: async () => 4,
    quadro: async (_a, segundo) => Buffer.from([0xff, 0xd8, segundo]),
    audio: async () => Buffer.from("audio"),
    transcrever: async () => " o bot diz olá ",
  }, { maxQuadros: 4 });
  assert.equal(r.duracao, 4);
  assert.ok(r.quadros.length >= 2);
  assert.equal(r.quadros[0].jpeg[0], 0xff);
  assert.equal(r.transcricao, "o bot diz olá");
  assert.equal(r.audioExtraido, true);
  const semStt = await pipelineDeVideo("video.mp4", {
    duracao: async () => 2,
    quadro: async () => Buffer.from([0xff, 0xd8]),
    audio: async () => Buffer.from("audio"),
  });
  assert.equal(semStt.transcricao, "");
  assert.equal(semStt.audioExtraido, true);
});

test("ffmpeg extrai jpeg de um vídeo curto", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-video-"));
  const mp4 = path.join(dir, "curto.mp4");
  await new Promise<void>((resolve, reject) => {
    execFile("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "color=c=red:s=160x120:d=1",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", mp4,
    ], { timeout: 30_000 }, (e) => (e ? reject(e) : resolve()));
  });
  const r = await pipelineDeVideo(mp4, { ...extratorFfmpeg(), transcrever: async () => "tom de teste" }, { maxQuadros: 2 });
  assert.ok(r.quadros.length >= 1, "sem quadro");
  assert.equal(r.quadros[0].jpeg[0], 0xff);
  assert.equal(r.quadros[0].jpeg[1], 0xd8);
  assert.equal(r.transcricao, "tom de teste");
  assert.equal(r.audioExtraido, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("navegação e visão entram no kit e no prompt base", () => {
  const kit = selecionarKitFerramentas(TOOL_DEFS, { role: "Assistente geral", botId: "ana" });
  for (const nome of ["buscar_web", "navegador", "fetch_url", "read_attachment"]) {
    assert.ok(kit.incluidas.includes(nome), `faltou ${nome}: ${kit.incluidas.join(", ")}`);
  }
  const semWeb = selecionarKitFerramentas(TOOL_DEFS, { role: "Assistente", navegacaoWeb: false, visao: false });
  assert.equal(semWeb.incluidas.includes("buscar_web"), false);
  const bloco = blocoVisaoEWeb();
  assert.ok(bloco.startsWith(MARCA_VISAO_WEB));
  assert.match(bloco, /multimodal/);
  assert.match(bloco, /ffmpeg/);
  assert.match(bloco, /buscar_web/);
  assert.match(bloco, /navegador/);
  assert.match(bloco, /até o fim/i);
});

test("busca devolve o link limpo, sem o redirect do buscador", () => {
  const html = `<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F&amp;rut=1">Example Domain</a>`;
  const links = linksDaBusca(html, 5);
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://example.com/");
  assert.match(links[0].titulo, /Example Domain/);
  assert.match(textoDaBusca("example", links), /navegador/);
});

test("mock: imagem multimodal, quadros de vídeo e página — sem chave real", async () => {
  const pedidos: Array<{ model?: string; content?: unknown }> = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const ultima = body.messages?.at(-1);
      pedidos.push({ model: body.model, content: ultima?.content });
      const texto = Array.isArray(ultima?.content)
        ? ultima.content.filter((p: { type?: string }) => p.type === "text").map((p: { text?: string }) => p.text).join("\n")
        : String(ultima?.content ?? "");
      const imagens = Array.isArray(ultima?.content) ? ultima.content.filter((p: { type?: string }) => p.type === "image_url").length : 0;
      let reply = "sem mídia";
      if (/quadro do vídeo/i.test(texto)) reply = imagens === 1 ? "Vi 1 quadro e a fala transcrita no texto." : `Vi ${imagens} quadros e a fala transcrita no texto.`;
      else if (imagens) reply = "Vejo um retângulo vermelho sólido, sem texto.";
      else if (/example domain/i.test(texto)) reply = "A página Example Domain explica que o domínio serve para exemplos.";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const porta = (server.address() as { port: number }).port;
  const prov = new OpenAICompatProvider("8token", "claude-fable-5.1", `http://127.0.0.1:${porta}/v1`, "k-teste");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
  try {
    const img = await prov.chat({
      system: "descreva",
      messages: [{ role: "user", content: "o que tem nesta imagem?", media: [{ mime: "image/png", dataBase64: png.toString("base64") }] }],
      tools: [],
    });
    const video = await prov.chat({
      system: "descreva",
      messages: [{
        role: "user",
        content: "quadro do vídeo aos 0.5s\n--- conteudo do arquivo ---\ntom de teste\n--- fim do arquivo ---",
        media: [{ mime: "image/jpeg", dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64"), name: "quadro-1.jpg" }],
      }],
      tools: [],
    });
    let pagina = "Example Domain\nThis domain is for use in illustrative examples in documents.";
    try {
      const r = await fetch("https://example.com", { signal: AbortSignal.timeout(8000) });
      if (r.ok) pagina = (await r.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 400);
    } catch { /* segue com o texto fixo */ }
    const web = await prov.chat({
      system: "resuma",
      messages: [{ role: "user", content: `Página aberta no navegador deste bot:\n${pagina}` }],
      tools: [],
    });
    assert.match(img.text, /vermelho/i);
    assert.match(video.text, /quadro/);
    assert.match(web.text, /Example Domain|exemplos/i);
    const primeiro = pedidos[0].content;
    assert.ok(Array.isArray(primeiro));
    assert.equal(primeiro.some((p: { type?: string }) => p.type === "image_url"), true);
    assert.equal(primeiro.some((p: { type?: string }) => p.type === "video_url"), false);
    assert.equal(pedidos[0].model, "claude-fable-5.1");

    const dir = "/opt/cursor/artifacts/padrao-8token";
    fs.mkdirSync(dir, { recursive: true });
    const html = `<!doctype html><meta charset="utf-8"><title>Ensaio visão e web</title>
<style>body{font:16px/1.4 sans-serif;background:#111;color:#eee;margin:24px} h1{font-size:22px} .aviso{background:#5a2a00;padding:12px;border-radius:8px} article{background:#1c1c1c;padding:12px;margin:12px 0;border-radius:8px} img{width:80px;height:80px;background:red}</style>
<h1>Ensaio com mock — visão, vídeo e página</h1>
<p class="aviso">EIGHTTOKEN_API_KEY não está neste ambiente. Isto não é o modelo real. O teste real (um bot descrevendo imagem, vídeo curto e uma página) precisa ser feito no Hub, com a chave no .env.</p>
<article><h2>Imagem</h2><div style="width:120px;height:80px;background:#e10600;border-radius:6px"></div><p>${img.text}</p></article>
<article><h2>Vídeo (quadros + transcrição)</h2><p>${video.text}</p><p>Transcrição injetada: tom de teste</p></article>
<article><h2>Página</h2><p>${web.text}</p></article>`;
    const arquivo = path.join(dir, "ensaio.html");
    fs.writeFileSync(arquivo, html);
    const pngOut = path.join(dir, "ensaio.png");
    await new Promise<void>((resolve) => {
      execFile("google-chrome", ["--headless", "--disable-gpu", "--no-sandbox", "--timeout=8000", `--screenshot=${pngOut}`, "--window-size=1100,980", `file://${arquivo}`], { timeout: 20_000 }, () => resolve());
    });
    if (fs.existsSync(pngOut)) assert.ok(fs.statSync(pngOut).size > 1000);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
