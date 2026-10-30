// Sobe o Whisper local junto com o Hub, quando o MYBOTS_STT_URL aponta para esta máquina.
// Assim o chefe não precisa lembrar de abrir outra janela para mandar áudio.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ehLocal = (url: string) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(url);

async function responde(url: string, ms = 1500): Promise<boolean> {
  try {
    const base = new URL(url);
    const r = await fetch(`${base.protocol}//${base.host}/health`, { signal: AbortSignal.timeout(ms) });
    return r.ok;
  } catch { return false; }
}

/** Liga o servidor de voz se ele ainda não estiver no ar. Devolve o processo (ou nada). */
export async function startSttIfNeeded(sttUrl: string): Promise<{ stop: () => void } | undefined> {
  if (!sttUrl || !ehLocal(sttUrl)) return;
  if (process.env.MYBOTS_STT_AUTOSTART === "0") return;
  if (await responde(sttUrl)) { console.log("[stt] já estava no ar"); return; }

  const raiz = path.resolve(process.cwd(), "../..");           // packages/hub -> raiz do projeto
  const script = path.join(raiz, "scripts", "stt-server.py");
  if (!fs.existsSync(script)) { console.log(`[stt] não achei ${script}`); return; }

  const python = process.env.MYBOTS_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const porta = new URL(sttUrl).port || "8178";
  const log = fs.openSync(path.join(raiz, "stt.log"), "a");
  const filho = spawn(python, [script, "--port", porta], {
    cwd: raiz,
    detached: false,
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  filho.on("error", (e) => console.log(`[stt] não consegui iniciar (${python}): ${e.message}`));
  filho.on("exit", (code) => { if (code) console.log(`[stt] servidor de voz saiu com código ${code} — veja stt.log`); });

  // espera carregar o modelo (GPU costuma levar 2–20s)
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await responde(sttUrl)) { console.log(`[stt] Whisper local pronto em ${sttUrl}`); break; }
    if (filho.exitCode !== null) return;
  }
  return { stop: () => { try { filho.kill(); } catch { /* já morreu */ } } };
}
