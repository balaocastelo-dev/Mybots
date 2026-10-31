// O scrcpy do celular abre sem áudio. No POCO Android 14 o AudioEncoder
// cancela o buffer e mata a sessão; H.264 é a segunda tentativa.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  argumentosScrcpy, audioLigado, codecDoEnv, fallbackLigado, falhaDeCaptura, proximaTentativa,
} from "../packages/hub/src/scrcpy.ts";

const LOG_POCO = [
  "[server] ERROR: Capture/encoding error: java.lang.IllegalStateException: Pending dequeue output buffer request cancelled",
  "Exception on thread audio-in ... MediaCodec$CodecException at AudioEncoder",
  "Device disconnected",
  "Killed",
].join("\n");

test("áudio desligado por padrão, codec só quando o ambiente pede", () => {
  assert.equal(audioLigado({}), false);
  assert.equal(audioLigado({ MYBOTS_SCRCPY_AUDIO: "1" }), true);
  assert.equal(audioLigado({ MYBOTS_SCRCPY_AUDIO: "sim" }), true);
  assert.equal(audioLigado({ MYBOTS_SCRCPY_AUDIO: "0" }), false);
  assert.equal(codecDoEnv({}), undefined);
  assert.equal(codecDoEnv({ MYBOTS_SCRCPY_VIDEO_CODEC: "h264" }), "h264");
  assert.equal(codecDoEnv({ MYBOTS_SCRCPY_VIDEO_CODEC: "vp9" }), undefined);
  assert.equal(fallbackLigado({}), true);
  assert.equal(fallbackLigado({ MYBOTS_SCRCPY_FALLBACK: "0" }), false);

  const args = argumentosScrcpy({ serial: "192.168.15.4:5555", titulo: "Celular da Loja", audio: false });
  assert.ok(args.includes("--no-audio"));
  assert.ok(args.includes("--serial=192.168.15.4:5555"));
  assert.equal(args.some((a) => a.startsWith("--video-codec=")), false);

  const comAudio = argumentosScrcpy({ audio: true, codec: "h265" });
  assert.equal(comAudio.includes("--no-audio"), false);
  assert.ok(comAudio.includes("--video-codec=h265"));
});

test("o log do POCO pede uma segunda abertura sem áudio e em H.264", () => {
  assert.equal(falhaDeCaptura(LOG_POCO), true);
  assert.equal(falhaDeCaptura("Device disconnected"), false);

  const deNovo = proximaTentativa(
    { serial: "192.168.15.4:5555", titulo: "Celular da Loja", audio: false },
    LOG_POCO,
  );
  assert.ok(deNovo);
  assert.equal(deNovo?.audio, false);
  assert.equal(deNovo?.codec, "h264");
  assert.ok(argumentosScrcpy(deNovo!).includes("--no-audio"));
  assert.ok(argumentosScrcpy(deNovo!).includes("--video-codec=h264"));

  const comAudio = proximaTentativa({ audio: true, serial: "x" }, LOG_POCO);
  assert.equal(comAudio?.audio, false);
  assert.equal(comAudio?.codec, "h264");

  assert.equal(proximaTentativa({ audio: false, codec: "h264" }, LOG_POCO), null);
  assert.equal(proximaTentativa({ audio: false }, LOG_POCO, { fallback: false }), null);
  assert.equal(proximaTentativa({ audio: false }, LOG_POCO, { codecTravado: true })?.codec, undefined);
  assert.equal(proximaTentativa({ audio: false }, "serial desconhecido"), null);
});
