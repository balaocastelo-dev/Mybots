/**
 * Abre a tela do celular com o scrcpy que vem em ferramentas/scrcpy.
 * Áudio desligado por padrão: no POCO com Android 14 o encoder de áudio
 * derruba a sessão inteira. Se a captura ainda falhar, tenta de novo em H.264.
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  argumentosScrcpy, audioLigado, codecDoEnv, fallbackLigado, proximaTentativa, type PedidoScrcpy,
} from "../packages/hub/src/scrcpy.ts";

const raiz = path.resolve(import.meta.dirname, "..");
const pasta = path.join(raiz, "ferramentas", "scrcpy");
const exe = path.join(pasta, process.platform === "win32" ? "scrcpy.exe" : "scrcpy");
const adb = path.join(pasta, process.platform === "win32" ? "adb.exe" : "adb");
const SERIAL = process.env.MYBOTS_CELULAR_SERIAL || "192.168.15.4:5555";

function rodar(bin: string, args: string[]): Promise<{ code: number; saida: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: path.dirname(bin), windowsHide: false, stdio: ["ignore", "pipe", "pipe"] });
    let saida = "";
    child.stdout?.on("data", (d) => { saida += d.toString(); process.stdout.write(d); });
    child.stderr?.on("data", (d) => { saida += d.toString(); process.stderr.write(d); });
    child.on("error", (e) => resolve({ code: 1, saida: saida + (e as Error).message }));
    child.on("close", (code) => resolve({ code: code ?? 1, saida }));
  });
}

function conectar(): Promise<void> {
  if (!fs.existsSync(adb)) return Promise.resolve();
  return new Promise((resolve) => {
    execFile(adb, ["connect", SERIAL], { windowsHide: true, timeout: 15000 }, () => resolve());
  });
}

async function main() {
  if (!fs.existsSync(exe)) {
    console.error(`não achei o scrcpy em ${exe}`);
    process.exit(1);
  }
  await conectar();
  const codecTravado = !!codecDoEnv();
  let pedido: PedidoScrcpy = {
    serial: SERIAL,
    titulo: "Celular da Loja",
    audio: audioLigado(),
    codec: codecDoEnv(),
  };
  for (let vez = 0; vez < 2; vez++) {
    const args = argumentosScrcpy(pedido);
    console.log(`[celular] scrcpy ${args.join(" ")}`);
    const r = await rodar(exe, args);
    if (r.code === 0) return;
    const seguinte = proximaTentativa(pedido, r.saida, { fallback: fallbackLigado(), codecTravado });
    if (!seguinte) process.exit(r.code);
    console.log("[celular] a captura caiu; abrindo de novo sem áudio e em H.264");
    pedido = seguinte;
  }
}

void main();
