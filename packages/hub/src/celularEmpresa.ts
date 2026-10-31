/**
 * Um celular Android por empresa.
 *
 * A descoberta vem do `adb mdns services` (depuração sem fio). O pareamento é o
 * código de 6 dígitos ou o texto do QR do Android 11+. O aparelho fica vinculado
 * pelo nome mDNS: se o IP mudar, a reconexão acha o mesmo nome.
 *
 * Dois bots não mexem juntos. A trava é da empresa e vale alguns segundos depois
 * da última ação; o dono, quando assume, segura até devolver.
 */

export type ServicoAdb = {
  nome: string;
  tipo: "connect" | "pairing";
  host: string;
  porta: number;
};

export type VinculoCelular = {
  nomeMdns?: string;
  modelo: string;
  serial: string;
  host?: string;
  porta?: number;
};

export type TravaCelular = {
  id: string;
  nome: string;
  ate: number;
  dono: boolean;
};

const PACOTE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

export function pacoteValido(pacote: string): boolean {
  return PACOTE.test(pacote) && pacote.length <= 120;
}

/** Lê a saída de `adb mdns services`. Porta 8787 nunca entra. */
export function lerMdns(saida: string): ServicoAdb[] {
  const fora: ServicoAdb[] = [];
  for (const linha of String(saida ?? "").split(/\r?\n/)) {
    const m = linha.match(/(\S+)\s+_adb-tls-(connect|pairing)\._tcp\.?\s+(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})/i);
    if (!m) continue;
    const porta = Number(m[4]);
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535 || porta === 8787) continue;
    const host = m[3];
    if (host.split(".").some((p) => Number(p) > 255)) continue;
    fora.push({
      nome: m[1],
      tipo: m[2].toLowerCase() === "pairing" ? "pairing" : "connect",
      host,
      porta,
    });
  }
  return fora;
}

/** Código de 6 dígitos, ou o texto do QR `WIFI:T:ADB;...;P:123456;;`. */
export function lerPareamento(bruto: string): { codigo: string; host?: string; porta?: number; nome?: string } | null {
  const s = String(bruto ?? "").trim();
  const soDigitos = s.replace(/\D/g, "");
  if (/^\d{6}$/.test(s.replace(/\s/g, ""))) return { codigo: s.replace(/\s/g, "") };
  const codigo = s.match(/(?:^|[;,&])P:(\d{6})/i)?.[1] ?? (soDigitos.length === 6 ? soDigitos : "");
  if (!/^\d{6}$/.test(codigo)) return null;
  const nome = s.match(/(?:^|[;])S:([^;]+)/i)?.[1];
  const ende = s.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})/);
  const porta = ende ? Number(ende[2]) : undefined;
  if (porta === 8787) return { codigo, nome };
  return { codigo, nome, host: ende?.[1], porta: porta && porta > 0 && porta < 65536 ? porta : undefined };
}

/** Mesmo aparelho, IP novo: casa pelo nome mDNS de conexão. Não chuta outro telefone da rede. */
export function escolherReconexao(salvo: VinculoCelular, servicos: ServicoAdb[]): { host: string; porta: number } | null {
  const conexoes = servicos.filter((s) => s.tipo === "connect");
  if (salvo.nomeMdns) {
    const achou = conexoes.find((s) => s.nome === salvo.nomeMdns);
    return achou ? { host: achou.host, porta: achou.porta } : null;
  }
  if (salvo.host && salvo.porta && conexoes.some((s) => s.host === salvo.host && s.porta === salvo.porta)) {
    return { host: salvo.host, porta: salvo.porta };
  }
  return null;
}

/**
 * Caiu: tenta o último endereço. IP mudou: o nome mDNS manda.
 * Se esse IP já anunciou outro nome, não conecta — seria outro aparelho.
 */
export function enderecoParaReconectar(salvo: VinculoCelular, servicos: ServicoAdb[]): { host: string; porta: number } | null {
  const porNome = escolherReconexao(salvo, servicos);
  if (porNome) return porNome;
  if (!salvo.host || !salvo.porta || salvo.porta === 8787) return null;
  const ocupado = servicos.some((s) => s.tipo === "connect" && s.host === salvo.host && s.porta === salvo.porta && s.nome !== salvo.nomeMdns);
  if (ocupado) return null;
  return { host: salvo.host, porta: salvo.porta };
}

const PRIVADA = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/;

/** Um /24 privado por interface, no máximo dois. Não varre a internet nem a 8787. */
export function hostsParaVarredura(locais: string[], maxPrefixos = 2): string[] {
  const fora: string[] = [];
  const prefixosVistos = new Set<string>();
  for (const ip of locais) {
    if (!PRIVADA.test(ip) || ip.split(".").some((p) => Number(p) > 255)) continue;
    const prefixo = ip.split(".").slice(0, 3).join(".");
    if (prefixosVistos.has(prefixo)) continue;
    if (prefixosVistos.size >= maxPrefixos) break;
    prefixosVistos.add(prefixo);
    for (let i = 1; i <= 254; i++) {
      const h = `${prefixo}.${i}`;
      if (h !== ip) fora.push(h);
    }
  }
  return fora;
}

/** Só a porta 5555 (adb tcpip). Qualquer outra, inclusive 8787, não é sondada. */
export async function varrerPorta(
  hosts: string[],
  porta: number,
  abrir: (host: string, porta: number) => Promise<boolean>,
  paralelo = 40,
): Promise<string[]> {
  if (porta !== 5555) return [];
  const fila = hosts.slice();
  const achados: string[] = [];
  const n = Math.max(1, Math.min(paralelo, fila.length || 1));
  await Promise.all(Array.from({ length: Math.min(n, Math.max(fila.length, 1)) }, async () => {
    for (;;) {
      const h = fila.shift();
      if (!h) return;
      if (await abrir(h, porta)) achados.push(h);
    }
  }));
  return achados;
}

export class TravaDosCelulares {
  private porEmpresa = new Map<string, TravaCelular>();

  constructor(private duracaoMs = 8000, private agora: () => number = () => Date.now()) {}

  ver(empresaId: string): TravaCelular | null {
    const t = this.porEmpresa.get(empresaId);
    if (!t) return null;
    if (!t.dono && t.ate <= this.agora()) { this.porEmpresa.delete(empresaId); return null; }
    return t;
  }

  /** O dono segura até soltar. Um bot renova a trava a cada ação. */
  pegar(empresaId: string, id: string, nome: string, dono = false): { ok: true } | { ok: false; nome: string } {
    const atual = this.ver(empresaId);
    if (atual && atual.id !== id && !(dono && !atual.dono)) return { ok: false, nome: atual.nome };
    this.porEmpresa.set(empresaId, { id, nome, dono, ate: this.agora() + this.duracaoMs });
    return { ok: true };
  }

  soltar(empresaId: string, id: string) {
    const t = this.porEmpresa.get(empresaId);
    if (t?.id === id) this.porEmpresa.delete(empresaId);
  }
}

const SENSIVEL = /\b(pagar|pagamento|pix|transferir|apagar|excluir|formatar|resetar|factory|enviar|mandar mensagem|whatsapp|banco)\b/i;
const PACOTE_SENSIVEL = /(bank|pagamento|pix|whatsapp|telegram|settings|configuracao)/i;

/** Pagamento, apagar dado e mandar mensagem no celular pedem o OK do chefe. */
export function acaoSensivel(acao: string, texto = "", pacote = ""): boolean {
  if (acao === "abrir" && PACOTE_SENSIVEL.test(pacote)) return true;
  if (acao === "digitar" || acao === "tocar" || acao === "abrir") return SENSIVEL.test(`${texto} ${pacote}`);
  return false;
}

export function resumoDoCelular(acao: string, texto = ""): string {
  switch (acao) {
    case "print": return "fotografou a tela do celular";
    case "arvore": return "leu a tela do celular";
    case "tocar": return "tocou na tela";
    case "deslizar": return "deslizou na tela";
    case "digitar": return "digitou no celular";
    case "tecla": return texto ? `tecla ${texto}` : "apertou uma tecla";
    case "abrir": return texto ? `abriu ${texto}` : "abriu um app";
    default: return "usou o celular";
  }
}
