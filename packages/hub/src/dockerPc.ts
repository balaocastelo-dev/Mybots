/**
 * O que o PC da empresa e o PC do bot compartilham: a imagem pinada, a faixa de
 * portas e a ponte do depurador. A 8787 e a 8791 ficam de fora — são de outro
 * sistema e este módulo não publica nada nelas.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { portaCdpPermitida } from "./gravacao.js";
import { FAIXA_TELA_EMPRESA, portaDeEmpresaPermitida } from "./ponteVnc.js";

/** Tag fixa, a mesma testada com o Selkies 2.1 (desktop na raiz da porta 3000). */
/** Build local: packages/hub/pc-desktop (openbox+tint2+ícones). Base = IMAGEM_PC_BASE. */
export const IMAGEM_PC_BASE = "lscr.io/linuxserver/chromium:1aca5d17-ls61";
export const IMAGEM_PC = "mybots/pc-desktop:1aca5d17";
export const MARCA_RAIZ = "MYBOTS_TELA=raiz";
export const PORTA_BASE_TELA = FAIXA_TELA_EMPRESA.min;
export const PORTA_BASE_CDP = 9301;

/** Portas de outro sistema. Nunca entram na conta, nem como tela nem como depurador. */
export const PORTAS_INTOCÁVEIS = new Set([8787, 8791]);

export function portaIntocavel(porta: number): boolean {
  return PORTAS_INTOCÁVEIS.has(porta);
}

export function limpo(id: string) {
  return id.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 40);
}

export function nomeDeContainerEmpresa(empresaId: string) {
  return "mybots-" + limpo(empresaId);
}

export function raizMaquinas(): string {
  const custom = process.env.MYBOTS_MAQUINAS_DIR?.trim();
  if (custom) return path.resolve(custom);
  return path.resolve(process.cwd(), "dados", "maquinas");
}

function arquivoDePortas() {
  return path.join(raizMaquinas(), "portas.json");
}

export type ExecDocker = (args: string[], msTeto?: number) => Promise<{ ok: boolean; saida: string }>;

function dockerPadrao(args: string[], msTeto = 60000): Promise<{ ok: boolean; saida: string }> {
  return new Promise((resolve) => {
    execFile("docker", args, { timeout: msTeto, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (e, out, err) => {
      resolve({ ok: !e, saida: (out || "") + (err || "") });
    });
  });
}

let executar: ExecDocker = dockerPadrao;

/** Teste troca o executável. `null` devolve o docker de verdade. */
export function definirDocker(fn: ExecDocker | null) {
  executar = fn ?? dockerPadrao;
}

export function docker(args: string[], msTeto = 60000) {
  return executar(args, msTeto);
}

export async function temDocker(): Promise<boolean> {
  return (await docker(["info", "--format", "{{.ServerVersion}}"], 20000)).ok;
}

/**
 * O Chromium IGNORA --remote-debugging-address e só escuta em 127.0.0.1 dentro do
 * container — então o Docker não tem como publicar a porta dele. A saída é uma
 * ponte TCP de 0.0.0.0:9223 para 127.0.0.1:9222, rodando dentro do próprio
 * container. A imagem não traz socat, mas traz python3.
 */
const PONTE_PY = `import socket, threading

ALVO = ("127.0.0.1", 9222)

def jogar(a, b):
    try:
        while True:
            d = a.recv(65536)
            if not d:
                break
            b.sendall(d)
    except Exception:
        pass
    finally:
        for s in (a, b):
            try:
                s.close()
            except Exception:
                pass

def atender(c):
    try:
        s = socket.create_connection(ALVO, 10)
    except Exception:
        c.close()
        return
    threading.Thread(target=jogar, args=(c, s), daemon=True).start()
    threading.Thread(target=jogar, args=(s, c), daemon=True).start()

srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("0.0.0.0", 9223))
srv.listen(64)
while True:
    c, _ = srv.accept()
    atender(c)
`;

/** Sobe a ponte dentro do container. Chamar de novo não faz mal: a segunda não
 *  consegue a porta e morre sozinha. */
export async function garantirPonte(container: string, volume: string) {
  try { fs.writeFileSync(path.join(volume, "ponte.py"), PONTE_PY); } catch { /* volume ainda montando */ }
  await docker(["exec", "-d", container, "/lsiopy/bin/python3", "/config/ponte.py"], 20000);
}

function indiceServe(i: number): boolean {
  const tela = PORTA_BASE_TELA + i;
  const cdp = PORTA_BASE_CDP + i;
  if (portaIntocavel(tela) || portaIntocavel(cdp)) return false;
  return portaDeEmpresaPermitida(tela) && portaCdpPermitida(cdp);
}

/**
 * Portas fixas por chave. A chave da empresa é o id dela (o mapa antigo).
 * A chave do bot é `bot:<id>`, para não disputar o mesmo número com a empresa
 * quando os dois ids coincidem. O índice, uma vez gravado, não muda.
 */
export function portasDaChave(chave: string): { indice: number; portaTela: number; portaCdp: number } {
  if (!chave || chave.length > 80) throw new Error("chave de porta inválida");
  const raiz = raizMaquinas();
  fs.mkdirSync(raiz, { recursive: true });
  const arq = arquivoDePortas();
  let mapa: Record<string, number> = {};
  try { mapa = JSON.parse(fs.readFileSync(arq, "utf8").replace(/^\uFEFF/, "")); } catch { mapa = {}; }
  if (mapa[chave] === undefined) {
    const usados = new Set(Object.values(mapa));
    const teto = FAIXA_TELA_EMPRESA.max - PORTA_BASE_TELA;
    let i = 0;
    while ((usados.has(i) || !indiceServe(i)) && i <= teto) i++;
    if (i > teto) throw new Error("não há porta livre na faixa da tela");
    mapa[chave] = i;
    fs.writeFileSync(arq, JSON.stringify(mapa, null, 2));
  }
  const i = mapa[chave];
  const portaTela = PORTA_BASE_TELA + i;
  const portaCdp = PORTA_BASE_CDP + i;
  if (!indiceServe(i)) throw new Error(`a porta reservada de ${chave} caiu numa porta intocável`);
  return { indice: i, portaTela, portaCdp };
}

/** Nomes de container que o mapa antigo já pode ter criado (`mybots-<empresa>`). */
export function nomesDeContainerEmpresa(): Set<string> {
  let mapa: Record<string, number> = {};
  try { mapa = JSON.parse(fs.readFileSync(arquivoDePortas(), "utf8").replace(/^\uFEFF/, "")); } catch { mapa = {}; }
  const nomes = new Set<string>();
  for (const chave of Object.keys(mapa)) {
    if (chave.startsWith("bot:")) continue;
    nomes.add(nomeDeContainerEmpresa(chave));
  }
  return nomes;
}
