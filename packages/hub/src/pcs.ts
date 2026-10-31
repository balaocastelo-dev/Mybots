/**
 * Um PC por bot.
 *
 * O container é `mybots-bot-<botId>`, com volume próprio e portas estáveis na
 * mesma faixa da tela (127.0.0.1:7901–8100 e depurador 9301–9500). A 8787 e a
 * 8791 não entram. O container nasce desligado: sobe quando a tela abre ou o
 * bot recebe uma tarefa, e para depois de N minutos sem ninguém olhando e sem
 * tarefa. O volume fica.
 *
 * Navegador: o Chromium da imagem pinada. O Google Chrome não vem nessa imagem;
 * ver NAVEGADOR_DO_PC.
 *
 * O celular não mora aqui. O registro só guarda a rota /android/<botId>/.
 * Quem resolve aparelho ou container é o provedor em android.ts — e nenhum
 * container Android é ligado por este módulo.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { rotaAndroid } from "./android.js";
import {
  IMAGEM_PC, MARCA_RAIZ, docker, garantirPonte, limpo, nomesDeContainerEmpresa,
  portaIntocavel, portasDaChave, raizMaquinas, temDocker,
} from "./dockerPc.js";
import { portaCdpPermitida } from "./gravacao.js";
import { idSeguro, portaDeEmpresaPermitida } from "./ponteVnc.js";

export const NAVEGADOR_DO_PC = {
  binario: "chromium" as const,
  imagem: IMAGEM_PC,
  motivo:
    "A imagem pinada (Selkies 2.1, desktop na raiz da porta 3000, websocket em /api/websockets) traz o Chromium, não o Google Chrome. " +
    "Instalar o Chrome exigiria outra imagem e um download, e a ponte da tela foi testada nesta tag. " +
    "O Chromium da imagem fala a mesma porta de depuração (9222) e obedece CHROME_CLI.",
};

export type RegistroPc = {
  botId: string;
  empresaId: string | null;
  nome: string;
  container: string;
  indice: number;
  portaTela: number;
  portaCdp: number;
  /** Caminho relativo à pasta das máquinas. O volume antigo da empresa não é este. */
  volume: string;
  criadoEm: number;
  android: { rota: string };
};

export type EstadoPc = RegistroPc & {
  estado: "ligada" | "desligada" | "sem-docker" | "nao-criada";
  telaUrl?: string;
  erro?: string;
  navegador: "chromium";
  limites: { memoria: string; cpus: string; ociosoMin: number };
};

export type BotParaPc = {
  id: string;
  nome?: string;
  empresaId: string | null;
  gerente?: boolean;
  createdAt?: number;
};

const uso = new Map<string, number>();
const olhos = new Map<string, number>();
const ligando = new Map<string, Promise<EstadoPc | null>>();
/** Bot ainda sem container e sem imagem local: não consulta o Docker a cada mensagem. */
const semImagemAte = new Map<string, number>();
let cacheMapa: { raiz: string; mtime: number; mapa: Record<string, RegistroPc> } | null = null;

export function politicaDoPc(env: NodeJS.ProcessEnv = process.env) {
  const bruto = Number(env.MYBOTS_PC_OCIOSO_MIN);
  let ociosoMin = 15;
  if (Number.isFinite(bruto) && bruto > 0) {
    // Abaixo de 1 minuto só existe para o teste de ociosidade (fração, mínimo 1 s).
    ociosoMin = bruto < 1 ? Math.max(1 / 60, bruto) : Math.min(24 * 60, Math.round(bruto));
  }
  const memoria = validarMemoria(env.MYBOTS_PC_MEMORIA) ?? "2560m";
  const cpus = validarCpu(env.MYBOTS_PC_CPU) ?? "1";
  const imagemBruta = (env.MYBOTS_PC_IMAGEM ?? "").trim() || IMAGEM_PC;
  if (!/^[\w./:@-]{1,200}$/.test(imagemBruta)) throw new Error("MYBOTS_PC_IMAGEM inválida");
  const comando = (env.MYBOTS_PC_COMANDO ?? "").trim();
  const args = comando ? comando.split(/\s+/).filter(Boolean) : [];
  for (const a of args) {
    if (!/^[\w./:@+=,-]{1,80}$/.test(a)) throw new Error("MYBOTS_PC_COMANDO inválido");
  }
  return {
    ociosoMin,
    ociosoMs: Math.round(ociosoMin * 60_000),
    memoria,
    cpus,
    shm: "1g",
    imagem: imagemBruta,
    comando: args,
  };
}

function validarMemoria(valor: string | undefined): string | null {
  const v = (valor ?? "").trim();
  if (!v) return null;
  if (!/^\d+(\.\d+)?[kmg]$/i.test(v) && !/^\d+$/.test(v)) return null;
  return v;
}

function validarCpu(valor: string | undefined): string | null {
  const v = (valor ?? "").trim();
  if (!v) return null;
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  return v;
}

function arquivoPcs(raiz = raizMaquinas()) {
  return path.join(raiz, "pcs.json");
}

function lerMapa(): Record<string, RegistroPc> {
  const raiz = raizMaquinas();
  const arq = arquivoPcs(raiz);
  let st: fs.Stats | null = null;
  try { st = fs.statSync(arq); } catch {
    if (cacheMapa && cacheMapa.raiz === raiz && cacheMapa.mtime === 0) return cacheMapa.mapa;
    cacheMapa = { raiz, mtime: 0, mapa: {} };
    return cacheMapa.mapa;
  }
  if (cacheMapa && cacheMapa.raiz === raiz && cacheMapa.mtime === st.mtimeMs && cacheMapa.mapa) return cacheMapa.mapa;
  let mapa: Record<string, RegistroPc> = {};
  try { mapa = JSON.parse(fs.readFileSync(arq, "utf8").replace(/^\uFEFF/, "")); } catch { mapa = {}; }
  cacheMapa = { raiz, mtime: st.mtimeMs, mapa };
  return mapa;
}

function gravarMapa(mapa: Record<string, RegistroPc>) {
  const raiz = raizMaquinas();
  fs.mkdirSync(raiz, { recursive: true });
  const arq = arquivoPcs(raiz);
  fs.writeFileSync(arq, JSON.stringify(mapa, null, 2));
  const st = fs.statSync(arq);
  cacheMapa = { raiz, mtime: st.mtimeMs, mapa };
}

export function lerRegistro(botId: string): RegistroPc | null {
  return lerMapa()[botId] ?? null;
}

export function listarRegistros(): RegistroPc[] {
  return Object.values(lerMapa()).sort((a, b) => a.criadoEm - b.criadoEm || a.botId.localeCompare(b.botId));
}

export function temRegistro(botId: string): boolean {
  return !!lerMapa()[botId];
}

function hashCurto(id: string) {
  return createHash("sha256").update(id).digest("hex").slice(0, 6);
}

/** Nome estável e sem colidir com `mybots-<empresa>` nem com outro bot. */
export function nomeDoContainerBot(botId: string, ocupados: Set<string>): string {
  const sanit = botId.replace(/[^a-zA-Z0-9_.-]/g, "-");
  const base = sanit.slice(0, 40);
  const hash = hashCurto(botId);
  let nome = `mybots-bot-${base}`.slice(0, 63);
  if (sanit !== botId || ocupados.has(nome)) nome = `mybots-bot-${base.slice(0, 32)}-${hash}`.slice(0, 63);
  if (ocupados.has(nome)) nome = `mybots-bot-${hash}-${base.slice(0, 24)}`.slice(0, 63);
  return nome;
}

function pastaDoVolume(botId: string): string {
  const base = limpo(botId);
  if (base === botId) return path.join("bots", base);
  return path.join("bots", `${base.slice(0, 32)}-${hashCurto(botId)}`);
}

function validarBotId(botId: string) {
  if (!idSeguro(botId)) throw new Error("id de bot inválido");
}

/**
 * Cria o registro e a pasta do volume. Não chama o Docker.
 * Na segunda vez devolve o mesmo registro (as portas não mudam).
 */
export function registrarPc(p: { botId: string; empresaId: string | null; nome?: string }): RegistroPc {
  validarBotId(p.botId);
  const empresaId = p.empresaId && idSeguro(p.empresaId) ? p.empresaId : null;
  const mapa = lerMapa();
  const atual = mapa[p.botId];
  if (atual) {
    if (p.nome) atual.nome = p.nome;
    atual.empresaId = empresaId;
    if (!atual.android?.rota) atual.android = { rota: rotaAndroid(p.botId) };
    gravarMapa(mapa);
    return atual;
  }
  const portas = portasDaChave(`bot:${p.botId}`);
  if (portaIntocavel(portas.portaTela) || portaIntocavel(portas.portaCdp)) {
    throw new Error("porta intocável na alocação do bot");
  }
  const ocupados = nomesDeContainerEmpresa();
  for (const r of Object.values(mapa)) ocupados.add(r.container);
  const volume = pastaDoVolume(p.botId);
  fs.mkdirSync(path.join(raizMaquinas(), volume), { recursive: true });
  const reg: RegistroPc = {
    botId: p.botId,
    empresaId,
    nome: (p.nome ?? p.botId).slice(0, 80),
    container: nomeDoContainerBot(p.botId, ocupados),
    indice: portas.indice,
    portaTela: portas.portaTela,
    portaCdp: portas.portaCdp,
    volume,
    criadoEm: Date.now(),
    android: { rota: rotaAndroid(p.botId) },
  };
  mapa[p.botId] = reg;
  gravarMapa(mapa);
  return reg;
}

export function atualizarEmpresaDoPc(botId: string, empresaId: string | null, nome?: string): RegistroPc | null {
  if (!lerRegistro(botId)) return null;
  return registrarPc({ botId, empresaId, nome });
}

/**
 * Registra o PC de cada bot. Idempotente. Não sobe container e não apaga
 * volume — nem o novo, nem o da empresa (`dados/maquinas/<empresa>`).
 */
export function migrarRegistros(bots: BotParaPc[]): { criados: string[]; jaExistiam: string[] } {
  const criados: string[] = [];
  const jaExistiam: string[] = [];
  const ordem = [...bots].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id));
  for (const b of ordem) {
    if (!idSeguro(b.id)) continue;
    const antes = lerRegistro(b.id);
    registrarPc({ botId: b.id, empresaId: b.empresaId, nome: b.nome });
    if (antes) jaExistiam.push(b.id);
    else criados.push(b.id);
  }
  return { criados, jaExistiam };
}

/** Gerente da empresa, senão o bot mais antigo que já tem PC registrado. */
export function botPadraoDaEmpresa(empresaId: string, bots: BotParaPc[]): string | null {
  if (!empresaId) return null;
  const regs = lerMapa();
  const da = bots.filter((b) => b.empresaId === empresaId && regs[b.id]);
  const porIdade = (a: BotParaPc, b: BotParaPc) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id);
  const gerentes = da.filter((b) => b.gerente).sort(porIdade);
  if (gerentes[0]) return gerentes[0].id;
  da.sort(porIdade);
  return da[0]?.id ?? null;
}

/**
 * `/pc/<empresa>/` continua sendo a URL antiga. `/pc/<botId>/` é o PC do bot.
 * Se o mesmo texto for os dois, a URL antiga fica com a empresa.
 */
export function classificarRotaPc(id: string, temEmpresa: boolean, temPcDeBot: boolean): "empresa" | "bot" | "nenhum" {
  if (!idSeguro(id)) return "nenhum";
  if (temEmpresa) return "empresa";
  if (temPcDeBot) return "bot";
  return "nenhum";
}

export function tocarPc(botId: string, agora = Date.now()) {
  if (!botId) return;
  uso.set(botId, agora);
}

export function abrirTela(botId: string, agora = Date.now()) {
  olhos.set(botId, (olhos.get(botId) ?? 0) + 1);
  tocarPc(botId, agora);
}

export function fecharTela(botId: string, agora = Date.now()) {
  olhos.set(botId, Math.max(0, (olhos.get(botId) ?? 1) - 1));
  tocarPc(botId, agora);
}

export function espectadores(botId: string) {
  return olhos.get(botId) ?? 0;
}

export function deveParar(o: { agora: number; ultimoUso: number; espectadores: number; ociosoMs: number; rodando: boolean }): boolean {
  if (!o.rodando) return false;
  if (o.espectadores > 0) return false;
  if (!Number.isFinite(o.ociosoMs) || o.ociosoMs <= 0) return false;
  return o.agora - o.ultimoUso >= o.ociosoMs;
}

function limitesAtuais() {
  const p = politicaDoPc();
  return { memoria: p.memoria, cpus: p.cpus, ociosoMin: p.ociosoMin };
}

function volumeAbsoluto(reg: RegistroPc) {
  return path.isAbsolute(reg.volume) ? reg.volume : path.join(raizMaquinas(), reg.volume);
}

let imagemCache: { imagem: string; em: number; ok: boolean } | null = null;

async function imagemLocal(imagem: string): Promise<boolean> {
  if (imagemCache && imagemCache.imagem === imagem && Date.now() - imagemCache.em < 60_000) return imagemCache.ok;
  const ok = (await docker(["image", "inspect", imagem, "--format", "{{.Id}}"], 20000)).ok;
  imagemCache = { imagem, em: Date.now(), ok };
  return ok;
}

export async function estadoDoPc(botId: string): Promise<EstadoPc | null> {
  const reg = lerRegistro(botId);
  if (!reg) return null;
  const base: EstadoPc = { ...reg, estado: "nao-criada", navegador: "chromium", limites: limitesAtuais() };
  if (!(await temDocker())) return { ...base, estado: "sem-docker", erro: "o Docker não está no ar nesta máquina" };
  const r = await docker(["inspect", "-f", "{{.State.Running}}", reg.container], 20000);
  if (!r.ok) return base;
  const ligada = r.saida.replace(/^\uFEFF/, "").trim() === "true";
  return {
    ...base,
    estado: ligada ? "ligada" : "desligada",
    telaUrl: ligada ? `http://127.0.0.1:${reg.portaTela}/` : undefined,
  };
}

function argumentosDeSubida(reg: RegistroPc): string[] {
  const pol = politicaDoPc();
  if (portaIntocavel(reg.portaTela) || portaIntocavel(reg.portaCdp)) throw new Error("porta intocável");
  if (!portaDeEmpresaPermitida(reg.portaTela) || !portaCdpPermitida(reg.portaCdp)) throw new Error("porta fora da faixa");
  const args = [
    "run", "-d", "--pull=never",
    "--name", reg.container,
    "--restart", "no",
    "--memory", pol.memoria,
    "--memory-swap", pol.memoria,
    "--cpus", pol.cpus,
    "--shm-size", pol.shm,
    "-p", `127.0.0.1:${reg.portaTela}:3000`,
    "-p", `127.0.0.1:${reg.portaCdp}:9223`,
    "-v", `${volumeAbsoluto(reg)}:/config`,
    "-e", "TZ=America/Sao_Paulo",
    "-e", `TITLE=${(reg.nome || reg.botId).replace(/[\r\n]/g, " ").slice(0, 80)}`,
    "-e", MARCA_RAIZ,
    "-e", "CHROME_CLI=--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --remote-allow-origins=* --start-maximized",
    pol.imagem,
    ...pol.comando,
  ];
  return args;
}

/** Liga se já existe o registro. Não cria o registro e não puxa imagem da rede. */
export function acordarPc(botId: string, agora = Date.now()): Promise<EstadoPc | null> {
  const ja = ligando.get(botId);
  if (ja) return ja;
  const p = acordarMesmo(botId, agora).finally(() => ligando.delete(botId));
  ligando.set(botId, p);
  return p;
}

async function acordarMesmo(botId: string, agora: number): Promise<EstadoPc | null> {
  const reg = lerRegistro(botId);
  if (!reg) return null;
  tocarPc(botId, agora);
  const pol = politicaDoPc();
  const base: EstadoPc = { ...reg, estado: "nao-criada", navegador: "chromium", limites: limitesAtuais() };
  const adiado = semImagemAte.get(botId) ?? 0;
  if (adiado > agora) return { ...base, erro: "a imagem do PC não está neste computador (não vou baixar)" };
  if (!(await temDocker())) {
    return { ...base, estado: "sem-docker", erro: "o Docker não está no ar nesta máquina" };
  }
  const atual = await estadoDoPc(botId);
  if (!atual) return null;
  if (atual.estado === "ligada") return atual;
  if (atual.estado === "desligada") {
    console.log(`[pc] ${botId}: ligando ${reg.container} em 127.0.0.1:${reg.portaTela}`);
    const r = await docker(["start", reg.container], 60000);
    if (!r.ok) return { ...atual, erro: r.saida.slice(0, 300) };
    if (process.env.MYBOTS_PC_PONTE !== "0") setTimeout(() => void garantirPonte(reg.container, volumeAbsoluto(reg)), 12000);
    return { ...atual, estado: "ligada", telaUrl: `http://127.0.0.1:${reg.portaTela}/` };
  }
  // Container ainda não existe. Sem a imagem local não há o que criar — e não baixamos.
  if (!(await imagemLocal(pol.imagem))) {
    semImagemAte.set(botId, agora + 60_000);
    return { ...atual, erro: "a imagem do PC não está neste computador (não vou baixar)" };
  }
  console.log(`[pc] ${botId}: criando ${reg.container} memória=${pol.memoria} cpu=${pol.cpus} porta=${reg.portaTela}`);
  const r = await docker(argumentosDeSubida(reg), 180000);
  if (!r.ok) return { ...atual, erro: r.saida.slice(0, 400) };
  if (process.env.MYBOTS_PC_PONTE !== "0") setTimeout(() => void garantirPonte(reg.container, volumeAbsoluto(reg)), 15000);
  return { ...atual, estado: "ligada", telaUrl: `http://127.0.0.1:${reg.portaTela}/` };
}

/** Para o container. O volume e o registro ficam. */
export async function pararPc(botId: string): Promise<EstadoPc | null> {
  const atual = await estadoDoPc(botId);
  if (!atual) return null;
  if (atual.estado !== "ligada") return atual;
  await docker(["stop", atual.container], 60000);
  return { ...atual, estado: "desligada", telaUrl: undefined };
}

/**
 * Para quem está ligado, sem espectador e sem uso dentro da janela.
 * Bot ocupado (ainda trabalhando) não conta como ocioso.
 * A primeira vez que o Hub vê o container ligado, a janela começa agora —
 * um reinício do Hub não derruba a tela no mesmo instante.
 */
export async function varrerOciosos(op?: { agora?: number; ocupado?: (botId: string) => boolean }): Promise<string[]> {
  const agora = op?.agora ?? Date.now();
  const pol = politicaDoPc();
  const parados: string[] = [];
  for (const reg of listarRegistros()) {
    if (op?.ocupado?.(reg.botId)) {
      tocarPc(reg.botId, agora);
      continue;
    }
    const est = await estadoDoPc(reg.botId);
    if (!est || est.estado !== "ligada") continue;
    if (!uso.has(reg.botId)) {
      tocarPc(reg.botId, agora);
      continue;
    }
    if (!deveParar({
      agora,
      ultimoUso: uso.get(reg.botId) ?? agora,
      espectadores: espectadores(reg.botId),
      ociosoMs: pol.ociosoMs,
      rodando: true,
    })) continue;
    await pararPc(reg.botId);
    parados.push(reg.botId);
    console.log(`[pc] ${reg.botId}: container ${reg.container} parado por ociosidade (${pol.ociosoMin} min sem tela e sem tarefa)`);
  }
  return parados;
}

export function iniciarVarreduraOciosa(op: { ocupado: (botId: string) => boolean; aoParar?: (ids: string[]) => void; intervaloMs?: number }) {
  const t = setInterval(() => {
    void varrerOciosos({ ocupado: op.ocupado })
      .then((ids) => { if (ids.length) op.aoParar?.(ids); })
      .catch((e) => console.error(`[pc] ociosidade: ${(e as Error).message}`));
  }, op.intervaloMs ?? 30_000);
  t.unref?.();
  return t;
}

/** Usado pelo teste para não herdar relógio de outro caso. */
export function zerarUsoParaTeste() {
  uso.clear();
  olhos.clear();
  ligando.clear();
  semImagemAte.clear();
  imagemCache = null;
  cacheMapa = null;
}
