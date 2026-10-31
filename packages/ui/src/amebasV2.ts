/** Amebas v2 (PNG) — mapeamento dos 23 + helper p/ bots novos. */
export const AMEBAS_V2_POR_BOT: Record<string, string> = {
  "chaves": "042",
  "gerente-meu-bling": "091",
  "meubling-vendas": "043",
  "meubling-assistencia": "065",
  "meubling-financeiro": "092",
  "meubling-fiscal": "098",
  "meubling-estoque": "036",
  "meubling-jarvis": "046",
  "gerente-herrera-house-ia": "041",
  "herrera-imoveis": "045",
  "herrera-crm": "061",
  "herrera-captacao": "084",
  "herrera-condominios": "001",
  "herrera-conteudo": "094",
  "herrera-escritorio": "095",
  "herrera-painel": "077",
  "herrera-config": "038",
  "gerente-escola-de-bots": "031",
  "escola-cine": "068",
  "escola-conector": "082",
  "escola-navegador": "021",
  "escola-pixel": "071",
  "escola-rotineiro": "067"
};

/** Famílias 001–100 (10 por família). Especialidade → faixa preferida. */
export const AMEBA_V2_FAMILIAS: Record<string, [number, number]> = {
  email: [11, 20],
  seguranca: [91, 100],
  voip: [61, 70],
  financeiro: [91, 100],
  fiscal: [91, 100],
  vendas: [41, 50],
  estoque: [31, 40],
  assistencia: [61, 70],
  crm: [61, 70],
  imoveis: [41, 50],
  conteudo: [91, 100],
  midia: [61, 70],
  config: [31, 40],
  painel: [71, 80],
  escola: [31, 40],
  default: [1, 100],
};

export function amebaV2Path(num: string | number): string {
  const n = String(num).replace(/\D/g, "").padStart(3, "0");
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${base}/amebas/v2/ameba-v2-${n}.png`;
}

/** Resolve PNG: avatar já é path v2, ou mapeamento fixo dos 23. */
export function amebaV2Url(botId: string, avatar?: string | null): string | null {
  if (avatar && /(?:^|\/)amebas\/v2\/ameba-v2-\d{3}\.png$/.test(avatar)) return avatar;
  const n = AMEBAS_V2_POR_BOT[botId];
  return n ? amebaV2Path(n) : null;
}

/** Sorteia ameba na faixa da especialidade (estável por seed). */
export function sortearAmebaV2(seed: string, especialidadeId?: string | null): string {
  const faixa = AMEBA_V2_FAMILIAS[especialidadeId || ""] || AMEBA_V2_FAMILIAS.default;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const span = faixa[1] - faixa[0] + 1;
  const n = faixa[0] + (Math.abs(h) % span);
  return amebaV2Path(n);
}
