// Gravação da tela do PC da empresa: limites, endereço do navegador preso
// no loopback, quadros-chave, e o vídeo do chat atrás da senha da interface.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Gravacoes, codificarMp4, enderecoDoDepurador, limitesDaGravacao, portaCdpPermitida,
  quadrosChave, temFfmpeg, videoExigeSenha, type Quadro,
} from "../packages/hub/src/gravacao.ts";

function quadro(n: number): Quadro {
  const b = Buffer.alloc(Math.max(4, n), 0x11);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff;
  return b;
}

test("limites e senha do vídeo", () => {
  assert.equal(limitesDaGravacao({}).maxSeg, 180);
  assert.equal(limitesDaGravacao({}).maxBytes, 40 * 1024 * 1024);
  assert.equal(limitesDaGravacao({ MYBOTS_GRAVACAO_MAX_SEG: "10", MYBOTS_GRAVACAO_MAX_MB: "8" }).maxSeg, 10);
  assert.equal(limitesDaGravacao({ MYBOTS_GRAVACAO_MAX_SEG: "99999" }).maxSeg, 600);
  assert.equal(limitesDaGravacao({ MYBOTS_GRAVACAO_MAX_SEG: "1" }).maxSeg, 5);
  assert.equal(videoExigeSenha("video/mp4"), true);
  assert.equal(videoExigeSenha("video/webm"), true);
  assert.equal(videoExigeSenha("image/png"), false);
  assert.equal(videoExigeSenha("application/pdf"), false);
});

test("quadros-chave: um no começo e o último", () => {
  assert.deepEqual(quadrosChave(0), []);
  assert.deepEqual(quadrosChave(1), [0]);
  assert.deepEqual(quadrosChave(4), [1, 3]);
  assert.deepEqual(quadrosChave(8), [2, 7]);
});

test("o depurador do Chrome só aponta para 127.0.0.1 na faixa do Hub", () => {
  assert.equal(
    enderecoDoDepurador("ws://172.17.0.2:9222/devtools/page/ABC", 9305),
    "ws://127.0.0.1:9305/devtools/page/ABC",
  );
  assert.equal(enderecoDoDepurador("ws://evil.example/devtools/page/ABC", 8787), null);
  assert.equal(enderecoDoDepurador("ws://127.0.0.1:9222/json", 9301), null);
  assert.equal(enderecoDoDepurador("ws://127.0.0.1:9222/devtools/../etc", 9301), null);
  assert.equal(portaCdpPermitida(9301), true);
  assert.equal(portaCdpPermitida(8787), false);
  assert.equal(portaCdpPermitida(443), false);
});

test("uma gravação por empresa, com legenda e corte no tamanho", async () => {
  const g = new Gravacoes({
    limites: { maxSeg: 30, maxBytes: 1_000_000, fps: 8 },
    ligarFonte: async (_id, onFrame) => {
      onFrame(quadro(32));
      onFrame(quadro(32));
      onFrame(quadro(32));
      return { cortar: () => {} };
    },
  });
  const a = await g.iniciar({ empresaId: "balao", por: "ana", nome: "Ana", conversationId: "dm:ana" });
  assert.equal(a.ok, true);
  const deNovo = await g.iniciar({ empresaId: "balao", por: "bia", nome: "Bia" });
  assert.equal(deNovo.ok, false);
  if (!deNovo.ok) assert.match(deNovo.erro, /Ana/);
  assert.equal(g.estado("balao").gravando, true);
  const fim = g.parar("balao", "criei a chave, copiei, revoguei");
  assert.equal(fim.ok, true);
  if (fim.ok) {
    assert.equal(fim.legenda, "criei a chave, copiei, revoguei");
    assert.equal(fim.frames.length, 3);
    assert.equal(fim.chaves.length, 2);
    assert.equal(fim.por, "ana");
    assert.equal(JSON.stringify(fim).includes("senha-super-secreta"), false);
  }
  assert.equal(g.parar("balao").ok, false);

  let estourou = 0;
  const curta = new Gravacoes({
    limites: { maxSeg: 30, maxBytes: 70, fps: 8 },
    ligarFonte: async (_id, onFrame) => {
      onFrame(quadro(40));
      onFrame(quadro(40));
      onFrame(quadro(40));
      return { cortar: () => {} };
    },
    aoLimite: (id) => { estourou++; curta.parar(id); },
  });
  await curta.iniciar({ empresaId: "loja", por: "bia", nome: "Bia" });
  assert.equal(estourou, 1);
  assert.equal(curta.estado("loja").gravando, false);
});

const PORT = 18793;
const SENHA = "senha-da-gravacao";

test("vídeo do chat exige a senha; imagem continua abrindo", { timeout: 40_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-grav-"));
  fs.mkdirSync(path.join(tmp, "bots"), { recursive: true });
  const raiz = path.resolve(import.meta.dirname, "..");
  const hubDir = path.join(raiz, "packages/hub");
  const hub: ChildProcess = spawn(process.execPath, ["--import", "tsx", path.join(hubDir, "src/index.ts")], {
    cwd: hubDir,
    env: {
      ...process.env,
      MYBOTS_HUB_HOST: "127.0.0.1",
      MYBOTS_HUB_PORT: String(PORT),
      MYBOTS_HUB_TOKEN: "token-teste-gravacao",
      MYBOTS_UI_PASSWORD: SENHA,
      MYBOTS_DB: path.join(tmp, "hub.sqlite"),
      MYBOTS_BOTS_DIR: path.join(tmp, "bots"),
      MYBOTS_UI_DIST: path.join(tmp, "sem-ui"),
      TELEGRAM_BOT_TOKEN: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = `http://127.0.0.1:${PORT}`;
  const matar = () => { try { hub.kill("SIGTERM"); } catch { /* já saiu */ } };
  try {
    const fim = Date.now() + 20_000;
    let noAr = false;
    while (Date.now() < fim) {
      try {
        const r = await fetch(`${base}/api/health?k=${encodeURIComponent(SENHA)}`);
        if (r.ok) { noAr = true; break; }
      } catch { /* subindo */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(noAr, true, "o hub de teste não subiu");

    const subir = async (mime: string, nome: string, corpo: string) => {
      const r = await fetch(`${base}/api/upload?k=${encodeURIComponent(SENHA)}`, {
        method: "POST",
        headers: { "content-type": mime, "x-file-name": encodeURIComponent(nome) },
        body: corpo,
      });
      assert.equal(r.ok, true, `upload ${mime} falhou`);
      return (await r.json()) as { url: string };
    };
    const video = await subir("video/mp4", "tela.mp4", "bytes-de-video-de-teste-0123456789");
    const foto = await subir("image/png", "print.png", "png");

    const sem = await fetch(`${base}${video.url}`);
    assert.equal(sem.status, 401, "o vídeo abriu sem senha");
    const com = await fetch(`${base}${video.url}?k=${encodeURIComponent(SENHA)}`);
    assert.equal(com.status, 200);
    const faixa = await fetch(`${base}${video.url}?k=${encodeURIComponent(SENHA)}`, { headers: { range: "bytes=0-4" } });
    assert.equal(faixa.status, 206);
    assert.match(faixa.headers.get("content-range") ?? "", /^bytes 0-4\//);
    const img = await fetch(`${base}${foto.url}`);
    assert.equal(img.status, 200, "a imagem do chat devia continuar sem senha");
  } finally { matar(); }
});

test("ffmpeg junta quadros num mp4 com player", { timeout: 30_000 }, async () => {
  if (!(await temFfmpeg())) return;
  // JPEG mínimo válido (1x1). O ffmpeg escala para tamanho par.
  const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxMTEhUTExMWFRUXGBcYGBgYGBgYGBgYGBgYGBgYGBgYHSggGBolHxcVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAQABEQMBIgACEQEDEQH/xAAbAAABBQEBAAAAAAAAAAAAAAADAAIEBQYBB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AqoD/2Q==", "base64");
  const mp4 = await codificarMp4([jpeg, jpeg, jpeg, jpeg], 8);
  assert.equal(mp4.ok, true, !mp4.ok ? mp4.erro : "");
  if (mp4.ok) assert.equal(mp4.data.subarray(4, 8).toString(), "ftyp");
});
