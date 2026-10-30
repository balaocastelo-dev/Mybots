// Reserva de máquina: o que os bots NUNCA podem invadir, para o PC não travar.
// É percentual, não número fixo, porque o MyBots instala tanto num PC de 8 GB quanto
// num servidor de 128 GB: 15% do que a máquina tem, com piso (senão vira reserva de
// mentira na máquina pequena) e teto (senão rouba a máquina grande dos bots).
// E um teto sobre o teto: a reserva nunca passa de 25% do total, ou seja, o bot fica
// sempre com pelo menos três quartos do PC. Reserva que engole a máquina derrota o
// motivo de ela existir.

export const RESERVA = {
  pct: 0.15,
  ramMinGb: 2,
  ramMaxGb: 12,
  vramMinGb: 1,
  vramMaxGb: 4,
  /** a reserva nunca passa disto, por maior que a conta dê */
  tetoDaMaquina: 0.25,
};

/** Reserva em GB para um total conhecido. Sem total, devolve o piso. */
export function reservaGb(totalGb: number | undefined, minGb: number, maxGb: number, pct = RESERVA.pct): number {
  const t = Number(totalGb);
  if (!Number.isFinite(t) || t <= 0) return minGb;
  const teto = Math.min(maxGb, t * RESERVA.tetoDaMaquina);
  const v = Math.min(Math.max(t * pct, minGb), teto);
  return Math.round(Math.max(v, 0) * 10) / 10;
}

/** Os dois limites, calculados do tamanho real da máquina. */
export function limitesDaMaquina(ramTotalGb?: number, vramTotalGb?: number, pct = RESERVA.pct): ResourceLimits {
  return {
    ram: reservaGb(ramTotalGb, RESERVA.ramMinGb, RESERVA.ramMaxGb, pct),
    vram: reservaGb(vramTotalGb, RESERVA.vramMinGb, RESERVA.vramMaxGb, pct),
  };
}

/** Usados só quando o tamanho da máquina não é conhecido. */
export const RESERVE_RAM_GB = RESERVA.ramMinGb;
export const RESERVE_VRAM_GB = RESERVA.vramMinGb;

export type ResourceReading = {
  ramFreeGb: number;
  ramTotalGb: number;
  /** ausente quando não há GPU NVIDIA ou o nvidia-smi não respondeu */
  vramFreeGb?: number;
  vramTotalGb?: number;
};

export type ResourceLimits = { ram: number; vram: number };

export const defaultLimits = (reading?: ResourceReading): ResourceLimits =>
  limitesDaMaquina(reading?.ramTotalGb, reading?.vramTotalGb);

export type ResourceVerdict = {
  ok: boolean;
  /** explicação curta em português, pronta para o bot ler */
  reason: string;
  ramFreeGb: number;
  vramFreeGb?: number;
  /** quanto o bot ainda pode consumir sem invadir a reserva */
  ramHeadroomGb: number;
  vramHeadroomGb?: number;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Decide se dá para começar um trabalho pesado agora.
 * `needRamGb`/`needVramGb` são estimativas do próprio trabalho (0 = desconhecido).
 */
export function checkResources(
  reading: ResourceReading,
  needRamGb = 0,
  needVramGb = 0,
  limits: ResourceLimits = defaultLimits(reading),
): ResourceVerdict {
  const ramHeadroomGb = r1(reading.ramFreeGb - limits.ram);
  const vramHeadroomGb = reading.vramFreeGb === undefined ? undefined : r1(reading.vramFreeGb - limits.vram);

  const faltas: string[] = [];
  if (reading.ramFreeGb - needRamGb < limits.ram) {
    faltas.push(
      `RAM: livres ${r1(reading.ramFreeGb)} GB de ${r1(reading.ramTotalGb)} GB` +
      (needRamGb ? `, o trabalho pede ~${r1(needRamGb)} GB` : "") +
      `, e ${limits.ram} GB são reservados para o sistema`,
    );
  }
  if (reading.vramFreeGb !== undefined && reading.vramFreeGb - needVramGb < limits.vram) {
    faltas.push(
      `VRAM: livres ${r1(reading.vramFreeGb)} GB` +
      (needVramGb ? `, o trabalho pede ~${r1(needVramGb)} GB` : "") +
      `, e ${limits.vram} GB são reservados para o sistema`,
    );
  }

  if (faltas.length) {
    return { ok: false, reason: faltas.join(" · "), ramFreeGb: r1(reading.ramFreeGb), vramFreeGb: reading.vramFreeGb === undefined ? undefined : r1(reading.vramFreeGb), ramHeadroomGb, vramHeadroomGb };
  }
  return {
    ok: true,
    reason: `Cabe: ${ramHeadroomGb} GB de RAM` + (vramHeadroomGb === undefined ? "" : ` e ${vramHeadroomGb} GB de VRAM`) + " acima da reserva do sistema.",
    ramFreeGb: r1(reading.ramFreeGb),
    vramFreeGb: reading.vramFreeGb === undefined ? undefined : r1(reading.vramFreeGb),
    ramHeadroomGb,
    vramHeadroomGb,
  };
}

/** Comandos que costumam comer a máquina inteira e por isso passam pela trava. */
const HEAVY = [
  /\bffmpeg\b/i, /\bffprobe\s+.*-f\s+lavfi/i,
  /\bpython\w*\b/i, /\bconda\b/i, /\buv\b\s+run/i,
  /comfy/i, /\bollama\b/i, /\bllama[-_.]?(cpp|server)\b/i, /lm[-\s]?studio/i,
  /stable[-\s]?diffusion/i, /\bwan2\b|\bminimax\b|\bh3\b.*\b(gerar|render)/i,
  /\bblender\b/i, /\bhandbrake\b/i, /\bdocker\b\s+(run|compose)/i,
  /npm\s+(run\s+)?(build|ci)\b/i, /\bvite\s+build\b/i, /\btsc\b\s+(-b|--build)/i,
  /\btorch(run)?\b/i, /\baccelerate\b\s+launch/i,
];

/** true quando o comando merece checar memória antes de rodar. */
export function isHeavyCommand(cmd: string): boolean {
  return HEAVY.some((re) => re.test(cmd));
}

/** Linha que entra no prompt de sistema de todo bot. */
export function resourcePromptLine(limits: ResourceLimits = defaultLimits()): string {
  return (
    `- LIMITE DE MÁQUINA (regra absoluta, vale em qualquer modo de controle, inclusive MODO DEUS EXTREMO): ` +
    `deixe SEMPRE livres pelo menos ${limits.ram} GB de RAM e ${limits.vram} GB de memória de vídeo para o sistema. ` +
    `Antes de qualquer trabalho pesado (vídeo, ComfyUI/Stable Diffusion, modelos locais, builds grandes, Blender, Docker), ` +
    `use a ferramenta system_resources para conferir se cabe. Se não couber, NÃO inicie: ` +
    `reduza resolução/lote/passos/quantidade de quadros, feche o que você mesmo abriu, ou avise o chefe e espere liberar. ` +
    `O MyBots bloqueia comandos pesados automaticamente quando a reserva seria invadida — não tente contornar isso. ` +
    `Travar o PC do chefe é pior do que demorar.`
  );
}
