/**
 * O celular de cada bot: um aparelho Android de verdade, na mesma rede,
 * com depuração sem fio. O código de 6 dígitos pareia e não fica guardado.
 * No Android 11+ a porta do código e a porta do `adb connect` são diferentes.
 */
import { lerMdns } from "./celularEmpresa.js";
import { argumentosAcordar, argumentosWhatsapp, URL_WHATSAPP } from "./androidScrcpy.js";

export const PORTAS_PROIBIDAS = new Set([8787, 8790, 8791]);

export type CadastroAndroid = {
  modo: "aparelho" | "redroid" | "emulador";
  ip: string;
  portaConexao: number;
  serial: string;
  pareadoEm: number;
};

export type PedidoParear = {
  ip?: unknown;
  porta?: unknown;
  codigo?: unknown;
  portaConexao?: unknown;
};

export type ResultadoParear = { ok: true } | { ok: false; erro: string };
export type EstadoAndroid = { conectado: boolean; cadastrado: boolean };

export type AdbFn = (args: string[], ms?: number) => Promise<{ ok: boolean; saida: string }>;

export function ipv4Valido(ip: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const p = ip.split(".").map((x) => Number(x));
  if (p.some((n) => !Number.isInteger(n) || n > 255)) return false;
  if (p.every((n) => n === 0) || p.every((n) => n === 255)) return false;
  if (p[0] >= 224) return false;
  return true;
}

/** Só a rede da loja ou o loopback do fallback. O Hub não conecta num IP público. */
export function ipDeAparelho(ip: string): boolean {
  if (!ipv4Valido(ip)) return false;
  const [a, b] = ip.split(".").map(Number);
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function portaValida(porta: number): { ok: true; porta: number } | { ok: false; erro: string } {
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) return { ok: false, erro: "a porta precisa ser um número de 1 a 65535" };
  if (PORTAS_PROIBIDAS.has(porta)) return { ok: false, erro: `A porta ${porta} é de outro sistema e não entra no pareamento.` };
  return { ok: true, porta };
}

export function validarPareamento(body: PedidoParear):
  | { ok: true; ip: string; porta: number; codigo: string; portaConexao?: number }
  | { ok: false; erro: string } {
  const ip = String(body?.ip ?? "").trim();
  if (!ipDeAparelho(ip)) return { ok: false, erro: "preciso do IP do aparelho na rede local (192.168.x.x)" };
  const porta = portaValida(Number(body?.porta));
  if (!porta.ok) return porta;
  const codigo = String(body?.codigo ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(codigo)) return { ok: false, erro: "o código tem 6 dígitos, os que aparecem na depuração sem fio" };
  const brutoConexao = body?.portaConexao;
  if (brutoConexao === undefined || brutoConexao === null || brutoConexao === "") {
    return { ok: true, ip, porta: porta.porta, codigo };
  }
  const conexao = portaValida(Number(brutoConexao));
  if (!conexao.ok) return conexao;
  return { ok: true, ip, porta: porta.porta, codigo, portaConexao: conexao.porta };
}

/** Serial que o `adb connect` já deixou em `adb devices`, no formato IP:porta. */
export function serialTcpip(bruto: string):
  | { ok: true; ip: string; porta: number; serial: string }
  | { ok: false; erro: string } {
  const s = String(bruto ?? "").trim();
  const m = s.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
  if (!m) return { ok: false, erro: "o serial precisa ser IP:porta, como 192.168.15.5:5555" };
  if (!ipDeAparelho(m[1])) return { ok: false, erro: "use o IP do aparelho na rede local" };
  const porta = portaValida(Number(m[2]));
  if (!porta.ok) return porta;
  return { ok: true, ip: m[1], porta: porta.porta, serial: `${m[1]}:${porta.porta}` };
}

export function semSegredo(saida: string, codigo: string): string {
  return String(saida ?? "").split(codigo).join("******").replace(/\s+/g, " ").trim().slice(0, 240);
}

export function aparelhosDe(saida: string): { serial: string; estado: string }[] {
  const fora: { serial: string; estado: string }[] = [];
  for (const linha of String(saida ?? "").split(/\r?\n/)) {
    const l = linha.trim();
    if (!l || l.startsWith("List of") || l.startsWith("*")) continue;
    const m = l.match(/^(\S+)\s+(\S+)/);
    if (!m) continue;
    fora.push({ serial: m[1], estado: m[2] });
  }
  return fora;
}

export function idDeBotValido(id: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,60}$/.test(id);
}

function conectou(saida: string): boolean {
  const t = saida.toLowerCase();
  if (/failed|cannot|unable|refused|error/.test(t)) return false;
  return /connected to|already connected/.test(t);
}

function pareou(saida: string): boolean {
  return /successfully paired|already paired/i.test(saida);
}

export class PareamentoAndroid {
  private tentou = new Map<string, number>();

  constructor(private deps: {
    adb: AdbFn;
    ler: (botId: string) => CadastroAndroid | null;
    gravar: (botId: string, c: CadastroAndroid | null) => void;
    agora?: () => number;
  }) {}

  ler(botId: string): CadastroAndroid | null {
    const c = this.deps.ler(botId);
    if (!c || typeof c !== "object" || !c.serial || !c.ip) return null;
    return c;
  }

  private agora() { return this.deps.agora?.() ?? Date.now(); }

  async parear(botId: string, body: PedidoParear): Promise<ResultadoParear> {
    const pedido = validarPareamento(body ?? {});
    if (!pedido.ok) return pedido;
    const par = await this.deps.adb(["pair", `${pedido.ip}:${pedido.porta}`, pedido.codigo], 20000);
    const textoPar = semSegredo(par.saida, pedido.codigo);
    const jaEra = pareou(par.saida);
    if (!jaEra) return { ok: false, erro: textoPar || "não pareou" };
    let portaConexao = pedido.portaConexao;
    if (!portaConexao) {
      const md = await this.deps.adb(["mdns", "services"], 8000);
      const servicos = lerMdns(md.saida).filter((s) => s.tipo === "connect" && s.host === pedido.ip && s.porta !== pedido.porta);
      if (servicos.length) portaConexao = servicos[0].porta;
    }
    if (!portaConexao) {
      return {
        ok: false,
        erro: "Pareou, mas a porta de conexão não veio. No Android 11+ ela fica na tela Depuração sem fio, diferente da porta do código. Mande portaConexao.",
      };
    }
    const con = await this.deps.adb(["connect", `${pedido.ip}:${portaConexao}`], 20000);
    if (!conectou(con.saida)) return { ok: false, erro: semSegredo(con.saida, pedido.codigo) || "não conectou" };
    const serial = `${pedido.ip}:${portaConexao}`;
    this.deps.gravar(botId, {
      modo: "aparelho",
      ip: pedido.ip,
      portaConexao,
      serial,
      pareadoEm: this.agora(),
    });
    this.tentou.delete(botId);
    await this.abrirWhatsapp(serial);
    return { ok: true };
  }

  /**
   * Grava um serial que o adb deste PC já mostra como `device`.
   * Não chama `adb pair` nem `adb connect`: a sessão tcpip que já existe continua.
   */
  async adotar(botId: string, serialBruto: string): Promise<ResultadoParear> {
    const pedido = serialTcpip(serialBruto);
    if (!pedido.ok) return pedido;
    const r = await this.deps.adb(["devices", "-l"], 8000);
    const achou = aparelhosDe(r.saida).find((a) => a.serial === pedido.serial);
    if (!achou || achou.estado !== "device") {
      return {
        ok: false,
        erro: achou
          ? `o aparelho ${pedido.serial} está ${achou.estado}, não device`
          : `o adb não mostra ${pedido.serial} como device. Conecte com adb connect e tente de novo.`,
      };
    }
    this.deps.gravar(botId, {
      modo: "aparelho",
      ip: pedido.ip,
      portaConexao: pedido.porta,
      serial: pedido.serial,
      pareadoEm: this.agora(),
    });
    this.tentou.delete(botId);
    return { ok: true };
  }

  /** Aparelhos tcpip que `adb devices` já lista como device. Não conecta em ninguém. */
  async aparelhosConectados(): Promise<{ serial: string; estado: string }[]> {
    const r = await this.deps.adb(["devices", "-l"], 8000);
    return aparelhosDe(r.saida).filter((a) => a.estado === "device" && serialTcpip(a.serial).ok);
  }

  /** Acorda a tela e abre o Chrome no WhatsApp Web. Falha do Chrome não desfaz o pareamento. */
  async abrirWhatsapp(serial: string): Promise<{ ok: boolean; saida: string }> {
    await this.deps.adb(argumentosAcordar(serial), 8000);
    const comChrome = await this.deps.adb(argumentosWhatsapp(serial, true), 15000);
    if (comChrome.ok && !/error|Exception|does not exist/i.test(comChrome.saida)) return comChrome;
    return this.deps.adb(argumentosWhatsapp(serial, false), 15000);
  }

  async reconectar(botId: string): Promise<void> {
    const c = this.ler(botId);
    if (!c) return;
    if (await this.esta(c.serial)) return;
    const agora = this.agora();
    const ultimo = this.tentou.get(botId) ?? 0;
    if (agora - ultimo < 15_000) return;
    this.tentou.set(botId, agora);
    await this.deps.adb(["connect", `${c.ip}:${c.portaConexao}`], 20000);
  }

  private async esta(serial: string): Promise<boolean> {
    const r = await this.deps.adb(["devices", "-l"], 8000);
    return aparelhosDe(r.saida).some((a) => a.serial === serial && a.estado === "device");
  }

  /** Só lê `adb devices`. Não chama `adb connect` — a lista de máquinas não liga o aparelho. */
  async conectado(botId: string): Promise<boolean> {
    const c = this.ler(botId);
    if (!c) return false;
    return this.esta(c.serial);
  }

  async status(botId: string): Promise<EstadoAndroid> {
    const c = this.ler(botId);
    if (!c) return { conectado: false, cadastrado: false };
    await this.reconectar(botId);
    return { conectado: await this.esta(c.serial), cadastrado: true };
  }
}

export { URL_WHATSAPP };
