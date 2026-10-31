// Redação do Hub: chave de API, valor do cofre e variável sensível do .env
// não podem aparecer em log nem em mensagem de erro. O padrão (sk-, AIza, …)
// mora em @mybots/shared. Aqui entram os valores que só este processo conhece.
import { redigirSegredos } from "@mybots/shared";

const extras = new Set<string>();

const NOME_SENSIVEL = /(KEY|TOKEN|SECRET|PASSWORD|SENHA|VAULT|PASSWD|BEARER)/i;

/** Guarda um valor do cofre para que, se vazar num log, saia mascarado. */
export function registrarSegredo(valor: string | undefined | null) {
  const v = String(valor ?? "");
  if (v.length >= 3) extras.add(v);
}

export function esquecerSegredo(valor: string | undefined | null) {
  extras.delete(String(valor ?? ""));
}

function valoresDoAmbiente(): string[] {
  const out: string[] = [];
  for (const [nome, valor] of Object.entries(process.env)) {
    if (!valor || valor.length < 12) continue;
    if (!NOME_SENSIVEL.test(nome)) continue;
    if (/^(true|false|yes|no)$/i.test(valor)) continue;
    out.push(valor);
  }
  return out;
}

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aplicarValor(texto: string, valor: string): string {
  if (!valor || !texto.includes(valor)) return texto;
  if (valor.length >= 8) return texto.split(valor).join("••••");
  return texto.replace(new RegExp(`(?<![A-Za-z0-9])${escapar(valor)}(?![A-Za-z0-9])`, "g"), "••••");
}

/** Mascara chaves, segredos do cofre e variáveis sensíveis do ambiente. */
export function redigir(texto: string): string {
  let s = redigirSegredos(String(texto ?? ""));
  const valores = [...valoresDoAmbiente(), ...extras].sort((a, b) => b.length - a.length);
  for (const v of valores) s = aplicarValor(s, v);
  return s;
}

export function textoSeguro(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "erro");
  return redigir(msg).trim() || "erro";
}

/** Objeto ou texto que vai para a interface, o nó ou a auditoria. */
export function semSegredo<T>(valor: T): T {
  try {
    if (typeof valor === "string") return redigir(valor) as T;
    if (valor == null) return valor;
    return JSON.parse(redigir(JSON.stringify(valor))) as T;
  } catch {
    return valor;
  }
}

let consoleInstalado = false;

/** Todo console.* do processo do Hub passa pela redação. Idempotente. */
export function instalarRedacao() {
  if (consoleInstalado) return;
  consoleInstalado = true;
  for (const metodo of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[metodo].bind(console);
    console[metodo] = (...args: unknown[]) => {
      original(...args.map((a) => {
        if (typeof a === "string") return redigir(a);
        if (a instanceof Error) return textoSeguro(a);
        if (typeof Buffer !== "undefined" && Buffer.isBuffer(a)) return a;
        if (a instanceof Uint8Array) return a;
        if (a && typeof a === "object") return semSegredo(a);
        return a;
      }));
    };
  }
}
