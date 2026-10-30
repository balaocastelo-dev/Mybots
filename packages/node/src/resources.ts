// Leitura de memória da máquina onde o nó roda (RAM pelo SO, VRAM pelo nvidia-smi).
import { execFile } from "node:child_process";
import os from "node:os";
import { type ResourceLimits, type ResourceReading, type ResourceVerdict, RESERVA, RESERVE_RAM_GB, RESERVE_VRAM_GB, checkResources, limitesDaMaquina, reservaGb } from "@mybots/shared";

const GB = 1024 ** 3;

let vramCache: { at: number; free?: number; total?: number } = { at: 0 };

/** Lê VRAM da primeira GPU NVIDIA. Sem GPU (ou sem nvidia-smi) devolve vazio. */
function readVram(): Promise<{ free?: number; total?: number }> {
  if (Date.now() - vramCache.at < 3000) return Promise.resolve({ free: vramCache.free, total: vramCache.total });
  return new Promise((resolve) => {
    const done = (free?: number, total?: number) => { vramCache = { at: Date.now(), free, total }; resolve({ free, total }); };
    try {
      const p = execFile(
        "nvidia-smi",
        ["--query-gpu=memory.free,memory.total", "--format=csv,noheader,nounits"],
        { timeout: 4000, windowsHide: true },
        (err, stdout) => {
          if (err || !stdout) return done();
          const [free, total] = String(stdout).split("\n")[0].split(",").map((s) => Number(s.trim()));
          if (!Number.isFinite(free) || !Number.isFinite(total)) return done();
          done(free / 1024, total / 1024); // MiB -> GiB
        },
      );
      p.on("error", () => done());
    } catch { done(); }
  });
}

export async function readResources(): Promise<ResourceReading> {
  const { free, total } = await readVram();
  return { ramFreeGb: os.freemem() / GB, ramTotalGb: os.totalmem() / GB, vramFreeGb: free, vramTotalGb: total };
}

/**
 * A reserva deste PC. Por padrão é percentual do que a máquina tem; MYBOTS_RESERVE_PCT
 * muda a porcentagem e MYBOTS_RESERVE_RAM_GB/_VRAM_GB fixam um valor em GB, nessa ordem.
 */
export function limitsFromEnv(reading?: ResourceReading): ResourceLimits {
  const ramTotal = reading?.ramTotalGb ?? os.totalmem() / GB;
  const vramTotal = reading?.vramTotalGb ?? vramCache.total;
  const pctEnv = Number(process.env.MYBOTS_RESERVE_PCT);
  const pct = Number.isFinite(pctEnv) && pctEnv > 0 && pctEnv < 1 ? pctEnv : RESERVA.pct;
  const base = limitesDaMaquina(ramTotal, vramTotal, pct);
  const n = (v: string | undefined, d: number) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : d; };
  return { ram: n(process.env.MYBOTS_RESERVE_RAM_GB, base.ram), vram: n(process.env.MYBOTS_RESERVE_VRAM_GB, base.vram) };
}

/** Confere agora. */
export async function checkNow(needRamGb = 0, needVramGb = 0): Promise<ResourceVerdict> {
  const leitura = await readResources();
  return checkResources(leitura, needRamGb, needVramGb, limitsFromEnv(leitura));
}

/**
 * Espera até caber na reserva (ou desistir). Usado antes de comandos pesados:
 * dá uma chance de a memória liberar em vez de recusar de cara.
 */
export async function waitForRoom(waitMs: number, signal?: AbortSignal, onWait?: (v: ResourceVerdict) => void): Promise<ResourceVerdict> {
  const deadline = Date.now() + Math.max(0, waitMs);
  let v = await checkNow();
  let avisou = false;
  while (!v.ok && Date.now() < deadline && !signal?.aborted) {
    if (!avisou) { onWait?.(v); avisou = true; }
    await new Promise((r) => setTimeout(r, 3000));
    v = await checkNow();
  }
  return v;
}

/** Texto curto para o bot/chefe ler. */
export function describe(v: ResourceVerdict, limits: ResourceLimits = limitsFromEnv()): string {
  return (
    `RAM livre: ${v.ramFreeGb} GB (reserva do sistema: ${limits.ram} GB)` +
    (v.vramFreeGb === undefined ? " · VRAM: sem GPU NVIDIA detectada" : ` · VRAM livre: ${v.vramFreeGb} GB (reserva: ${limits.vram} GB)`) +
    `\n${v.ok ? "PODE" : "NÃO PODE"} iniciar trabalho pesado agora. ${v.reason}`
  );
}
