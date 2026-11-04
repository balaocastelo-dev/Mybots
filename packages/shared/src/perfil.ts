/**
 * Perfil do bot: voz neural, cadência, idioma da escuta e a biblioteca por data.
 * A fala de verdade continua no Hub (Edge). Aqui só fica o que a interface e o
 * banco concordam em guardar.
 */

export const VELOCIDADE_PADRAO = 1.1;

/** Vozes neurais pt-BR do Edge. A MacerioMultilingual cortava o áudio e a
 *  interface caía na voz robótica do navegador — ela não entra. */
export const VOZES_NEURAIS_PT: Array<{ id: string; nome: string; genero: string }> = [
  { id: "pt-BR-ThalitaNeural", nome: "Thalita", genero: "feminina" },
  { id: "pt-BR-FranciscaNeural", nome: "Francisca", genero: "feminina" },
  { id: "pt-BR-AntonioNeural", nome: "Antonio", genero: "masculina" },
  { id: "pt-BR-ThalitaMultilingualNeural", nome: "Thalita multilíngue", genero: "feminina" },
];

export const IDIOMAS_FALA: Array<{ id: string; nome: string }> = [
  { id: "auto", nome: "Auto-detect" },
  { id: "pt", nome: "Português" },
  { id: "en", nome: "English" },
  { id: "es", nome: "Español" },
  { id: "fr", nome: "Français" },
  { id: "de", nome: "Deutsch" },
  { id: "it", nome: "Italiano" },
  { id: "ja", nome: "日本語" },
  { id: "zh", nome: "中文" },
  { id: "ko", nome: "한국어" },
  { id: "ru", nome: "Русский" },
];

export const ROTINAS_VAZIAS = "Rotinas são tarefas recorrentes... peça no chat para configurar uma.";

export type PerfilVoz = { voice: string; rate: number; lang: string };

export function vozExplicita(voice: string): boolean {
  if (VOZES_NEURAIS_PT.some((v) => v.id === voice)) return true;
  return /^clone:[a-z0-9_-]{1,40}$/i.test(voice);
}

function rateOk(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0.5 && n <= 2;
}

function roundRate(n: number): number {
  return Math.round(n * 10) / 10;
}

function idiomaOk(id: unknown): id is string {
  return typeof id === "string" && IDIOMAS_FALA.some((i) => i.id === id);
}

/** Junta o que veio do pedido com o que já estava salvo. Recusa voz robótica
 *  e velocidade fora de 0.5x–2x. */
export function normalizarPerfilVoz(
  input: Partial<PerfilVoz> | null | undefined,
  atual?: Partial<PerfilVoz> | null,
): PerfilVoz | { error: string } {
  const base: PerfilVoz = {
    voice: atual?.voice && (atual.voice === "" || vozExplicita(atual.voice)) ? atual.voice : "",
    rate: rateOk(atual?.rate) ? roundRate(atual.rate) : VELOCIDADE_PADRAO,
    lang: idiomaOk(atual?.lang) ? atual.lang : "auto",
  };
  const next = { ...base };
  if (input && input.voice !== undefined) {
    if (input.voice !== "" && !vozExplicita(input.voice)) return { error: "Escolha uma voz neural em português." };
    next.voice = input.voice;
  }
  if (input && input.rate !== undefined) {
    const n = Number(input.rate);
    if (!rateOk(n)) return { error: "A velocidade fica entre 0.5x e 2x." };
    next.rate = roundRate(n);
  }
  if (input && input.lang !== undefined) {
    if (!idiomaOk(input.lang)) return { error: "Idioma inválido." };
    next.lang = input.lang;
  }
  return next;
}

const DIAS = [
  { nome: "domingo", art: "todo" },
  { nome: "segunda", art: "toda" },
  { nome: "terça", art: "toda" },
  { nome: "quarta", art: "toda" },
  { nome: "quinta", art: "toda" },
  { nome: "sexta", art: "toda" },
  { nome: "sábado", art: "todo" },
];

function horaLegivel(min: string, hora: string): string | null {
  if (!/^\d{1,2}$/.test(hora) || !/^\d{1,2}$/.test(min)) return null;
  const h = Number(hora);
  const m = Number(min);
  if (h > 23 || m > 59) return null;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** Cron de 5 campos em português. O que não reconhecer volta cru. */
export function frequenciaDaRotina(cron: string): string {
  const p = cron.trim().split(/\s+/);
  if (p.length < 5) return cron.trim();
  const [min, hora, dia, mes, sem] = p;
  const cada = /^\*\/(\d+)$/.exec(min);
  if (cada && hora === "*" && dia === "*" && mes === "*" && sem === "*") return `a cada ${cada[1]} minutos`;
  if (min === "0" && hora === "*" && dia === "*" && mes === "*" && sem === "*") return "de hora em hora";
  const quando = horaLegivel(min, hora);
  if (quando && dia === "*" && mes === "*" && sem === "*") return `todo dia às ${quando}`;
  if (quando && dia === "*" && mes === "*" && sem === "1-5") return `segunda a sexta às ${quando}`;
  if (quando && dia === "*" && mes === "*" && /^[0-6]$/.test(sem)) {
    const d = DIAS[Number(sem)];
    return `${d.art} ${d.nome} às ${quando}`;
  }
  return cron.trim();
}

export type GrupoBiblioteca = "hoje" | "semana" | "antes";

export const TITULO_GRUPO: Record<GrupoBiblioteca, string> = {
  hoje: "Hoje",
  semana: "Esta semana",
  antes: "Antes",
};

/** Segunda 00:00 no fuso local. Domingo conta como o fim da semana anterior. */
export function inicioDaSemana(agora: number): number {
  const a = new Date(agora);
  const inicio = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const dia = inicio.getDay();
  inicio.setDate(inicio.getDate() - (dia === 0 ? 6 : dia - 1));
  inicio.setHours(0, 0, 0, 0);
  return inicio.getTime();
}

export function grupoDoArquivo(quando: number, agora = Date.now()): GrupoBiblioteca {
  const d = new Date(quando);
  const a = new Date(agora);
  if (d.getFullYear() === a.getFullYear() && d.getMonth() === a.getMonth() && d.getDate() === a.getDate()) return "hoje";
  if (quando >= inicioDaSemana(agora)) return "semana";
  return "antes";
}

export function agruparBiblioteca<T extends { quando: number }>(itens: T[], agora = Date.now()): Array<{ id: GrupoBiblioteca; titulo: string; itens: T[] }> {
  const ordem: GrupoBiblioteca[] = ["hoje", "semana", "antes"];
  const grupos = ordem.map((id) => ({ id, titulo: TITULO_GRUPO[id], itens: [] as T[] }));
  const ix: Record<GrupoBiblioteca, number> = { hoje: 0, semana: 1, antes: 2 };
  for (const item of [...itens].sort((a, b) => b.quando - a.quando)) grupos[ix[grupoDoArquivo(item.quando, agora)]].itens.push(item);
  return grupos.filter((g) => g.itens.length > 0);
}
