// Estado da máquina onde o Hub roda: memória, placa de vídeo e o tamanho da base.
// Existe porque o painel mostra a reserva do sistema — calculada do tamanho real desta
// máquina — e um número inventado ali seria pior do que número nenhum.
import os from "node:os";
import { limitesDaMaquina } from "@mybots/shared";
import { execFile } from "node:child_process";

export type Maquina = {
  ram: { usadaGb: number; totalGb: number };
  vram: { usadaGb: number; totalGb: number; nome: string } | null;
  reserva: { ramGb: number; vramGb: number };
  cpus: number;
  host: string;
};

/** A reserva desta máquina, em GB: percentual do total, com piso e teto (ver @mybots/shared). */
export function reservaDaMaquina(ramTotalGb: number, vramTotalGb?: number) {
  const l = limitesDaMaquina(ramTotalGb, vramTotalGb);
  return { ramGb: l.ram, vramGb: l.vram };
}

const GB = 1024 ** 3;
const arredonda = (n: number) => Math.round(n * 10) / 10;

/** nvidia-smi em MiB; devolve null quando não há placa NVIDIA ou o comando falha. */
function placa(): Promise<Maquina["vram"]> {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=memory.used,memory.total,name", "--format=csv,noheader,nounits"],
      { timeout: 4000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        const linha = String(stdout).split("\n")[0]?.trim();
        if (!linha) return resolve(null);
        const [usada, total, ...nome] = linha.split(",").map((s) => s.trim());
        const u = Number(usada), t = Number(total);
        if (!Number.isFinite(u) || !Number.isFinite(t) || t <= 0) return resolve(null);
        resolve({ usadaGb: arredonda(u / 1024), totalGb: arredonda(t / 1024), nome: nome.join(",").trim() || "GPU" });
      },
    );
  });
}

// a placa muda devagar e nvidia-smi custa ~200 ms: uma leitura por 5 s basta
let cache: { em: number; vram: Maquina["vram"] } = { em: 0, vram: null };

export async function lerMaquina(): Promise<Maquina> {
  const agora = Date.now();
  if (agora - cache.em > 5000) cache = { em: agora, vram: await placa() };
  const total = os.totalmem(), livre = os.freemem();
  return {
    ram: { usadaGb: arredonda((total - livre) / GB), totalGb: arredonda(total / GB) },
    vram: cache.vram,
    reserva: reservaDaMaquina(total / GB, cache.vram?.totalGb),
    cpus: os.cpus().length,
    host: os.hostname(),
  };
}
