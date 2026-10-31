import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { FAIXA_TELA_EMPRESA } from "./ponteVnc.js";

/**
 * O PC DA EMPRESA
 *
 * Cada empresa ganha um Linux so dela, num container, na mesma maquina onde o Hub
 * roda. Tres motivos para ser assim, e nao um PC fisico nem uma VM na nuvem:
 *
 * - Fica LOGADO. O perfil do navegador mora num volume proprio, entao a sessao do
 *   Instagram, do portal do fornecedor e do banco continua valendo amanha.
 * - Sai do IP DA EMPRESA. O Hub ja roda dentro da empresa; uma VM na nuvem teria IP
 *   de datacenter, e ai Instagram, Google e banco pedem verificacao toda hora e
 *   acabam bloqueando a conta.
 * - DA PARA VER. A imagem traz o Selkies: a tela do Linux abre no painel, entao o
 *   chefe assiste o bot trabalhando em vez de ler um relatorio do que ele fez.
 *
 * Uma empresa, um container, um volume. Nada vaza de uma empresa para a outra.
 */

/**
 * Tag fixa, a mesma que foi testada com o Selkies 2.1.0 (Wayland, servidor em
 * 127.0.0.1:8082). O `latest` dessa leva, com SUBFOLDER, serve "Welcome to nginx!"
 * na raiz da porta 3000. Sem SUBFOLDER o desktop fica em /.
 */
const IMAGEM = "lscr.io/linuxserver/chromium:1aca5d17-ls61";
const MARCA_RAIZ = "MYBOTS_TELA=raiz";
const PORTA_BASE_TELA = FAIXA_TELA_EMPRESA.min;   // GUI do container (noVNC / Selkies)
const PORTA_BASE_CDP = 9301;    // o navegador, para os bots
const RAIZ = path.resolve(process.cwd(), "dados", "maquinas");
const MAPA = path.join(RAIZ, "portas.json");

export type Maquina = {
  empresaId: string;
  container: string;
  portaTela: number;
  portaCdp: number;
  estado: "ligada" | "desligada" | "sem-docker" | "nao-criada";
  telaUrl?: string;
  /** O painel consegue embutir esta tela. */
  telaNoPainel?: boolean;
  /**
   * Container antigo: a imagem foi criada com SUBFOLDER=/pc/<id>/. A raiz da porta
   * publicada é a página "Welcome to nginx!"; o desktop só existe embaixo da subpasta.
   */
  subpastaAntiga?: boolean;
  erro?: string;
};

/** Caminho da tela no Hub. Dentro do container o desktop fica na raiz. */
export function subpastaDa(empresaId: string) {
  return `/pc/${empresaId}/`;
}

function linhaEnv(saida: string, nome: string): string | undefined {
  const prefixo = nome + "=";
  const linha = saida.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith(prefixo));
  return linha?.slice(prefixo.length);
}

function docker(args: string[], msTeto = 60000): Promise<{ ok: boolean; saida: string }> {
  return new Promise((resolve) => {
    execFile("docker", args, { timeout: msTeto, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (e, out, err) => {
      resolve({ ok: !e, saida: (out || "") + (err || "") });
    });
  });
}

export async function temDocker(): Promise<boolean> {
  return (await docker(["info", "--format", "{{.ServerVersion}}"], 20000)).ok;
}


/**
 * O Chromium IGNORA --remote-debugging-address e so escuta em 127.0.0.1 dentro do
 * container -- entao o Docker nao tem como publicar a porta dele. A saida e uma
 * ponte TCP de 0.0.0.0:9223 para 127.0.0.1:9222, rodando dentro do proprio
 * container. A imagem nao traz socat, mas traz python3: nada a instalar, nada que
 * dependa de internet na hora de subir a maquina da empresa.
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

/** Sobe a ponte dentro do container. Chamar de novo nao faz mal: a segunda nao
 *  consegue a porta e morre sozinha. */
async function garantirPonte(container: string, volume: string) {
  try { fs.writeFileSync(path.join(volume, "ponte.py"), PONTE_PY); } catch { /* volume ainda montando */ }
  await docker(["exec", "-d", container, "/lsiopy/bin/python3", "/config/ponte.py"], 20000);
}
function limpo(id: string) { return id.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 40); }
export function nomeDoContainer(empresaId: string) { return "mybots-" + limpo(empresaId); }

/** Portas fixas por empresa: a tela precisa do mesmo endereco amanha. */
function portasDe(empresaId: string): { portaTela: number; portaCdp: number } {
  fs.mkdirSync(RAIZ, { recursive: true });
  let mapa: Record<string, number> = {};
  try { mapa = JSON.parse(fs.readFileSync(MAPA, "utf8")); } catch { mapa = {}; }
  if (mapa[empresaId] === undefined) {
    const usados = new Set(Object.values(mapa));
    const teto = FAIXA_TELA_EMPRESA.max - PORTA_BASE_TELA;
    let i = 0; while (usados.has(i) && i <= teto) i++;
    if (i > teto) throw new Error("não há porta livre na faixa da tela");
    mapa[empresaId] = i;
    fs.writeFileSync(MAPA, JSON.stringify(mapa, null, 2));
  }
  const i = mapa[empresaId];
  return { portaTela: PORTA_BASE_TELA + i, portaCdp: PORTA_BASE_CDP + i };
}

export async function estadoDa(empresaId: string): Promise<Maquina> {
  const container = nomeDoContainer(empresaId);
  const { portaTela, portaCdp } = portasDe(empresaId);
  const base: Maquina = { empresaId, container, portaTela, portaCdp, estado: "nao-criada", telaNoPainel: false };
  if (!(await temDocker())) return { ...base, estado: "sem-docker", erro: "o Docker nao esta no ar nesta maquina" };
  const r = await docker(["inspect", "-f", "{{.State.Running}}\n{{range .Config.Env}}{{println .}}{{end}}", container], 20000);
  if (!r.ok) return base;
  const [linha, ...resto] = r.saida.replace(/^\uFEFF/, "").split(/\r?\n/);
  const ligada = linha.trim() === "true";
  const env = resto.join("\n");
  const subpastaAntiga = linhaEnv(env, "SUBFOLDER") === subpastaDa(empresaId);
  const naRaiz = linhaEnv(env, "MYBOTS_TELA") === "raiz";
  return {
    ...base,
    estado: ligada ? "ligada" : "desligada",
    telaNoPainel: naRaiz || subpastaAntiga,
    subpastaAntiga,
    telaUrl: ligada ? `http://127.0.0.1:${portaTela}/` : undefined,
  };
}

export async function ligar(empresaId: string, nomeEmpresa = ""): Promise<Maquina> {
  const atual = await estadoDa(empresaId);
  if (atual.estado === "sem-docker") return atual;
  if (atual.estado === "ligada") {
    // A imagem nova não serve o desktop na raiz quando nasceu com SUBFOLDER.
    if (atual.subpastaAntiga) return recriar(empresaId, nomeEmpresa);
    return atual;
  }

  if (atual.estado === "desligada") {
    const r = await docker(["start", atual.container], 60000);
    if (!r.ok) return { ...atual, erro: r.saida.slice(0, 300) };
    const deNovo = await estadoDa(empresaId);
    if (deNovo.subpastaAntiga) return recriar(empresaId, nomeEmpresa);
    setTimeout(() => void garantirPonte(atual.container, path.join(RAIZ, limpo(empresaId))), 12000);
    return { ...deNovo, estado: "ligada", telaUrl: `http://127.0.0.1:${atual.portaTela}/` };
  }

  const volume = path.join(RAIZ, limpo(empresaId));
  fs.mkdirSync(volume, { recursive: true });
  const r = await docker([
    "run", "-d",
    "--name", atual.container,
    "--restart", "unless-stopped",
    // o Chrome quebra com a /dev/shm minuscula padrao do Docker
    "--shm-size=1g",
    "-p", `127.0.0.1:${atual.portaTela}:3000`,
    "-p", `127.0.0.1:${atual.portaCdp}:9223`,
    "-v", `${volume}:/config`,
    "-e", "TZ=America/Sao_Paulo",
    "-e", `TITLE=${nomeEmpresa || empresaId}`,
    "-e", MARCA_RAIZ,
    // o 9222 ouvindo em 0.0.0.0 e preciso para o Hub alcancar de fora do container
    "-e", "CHROME_CLI=--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --remote-allow-origins=* --start-maximized",
    IMAGEM,
  ], 180000);
  if (!r.ok) return { ...atual, erro: r.saida.slice(0, 400) };
  // o Chromium leva uns segundos para abrir; a ponte so vale depois dele
  setTimeout(() => void garantirPonte(atual.container, volume), 15000);
  return { ...atual, estado: "ligada", telaNoPainel: true, subpastaAntiga: false, telaUrl: `http://127.0.0.1:${atual.portaTela}/` };
}

const recriando = new Set<string>();

/** Sobe de novo, com o mesmo volume, um PC que ainda está na subpasta antiga. */
export async function garantirDesktopNaRaiz(empresaId: string, nomeEmpresa = ""): Promise<Maquina> {
  const atual = await estadoDa(empresaId);
  if (atual.estado !== "ligada" || !atual.subpastaAntiga || recriando.has(empresaId)) return atual;
  recriando.add(empresaId);
  try {
    console.log(`[maquina] ${empresaId}: a tela está na subpasta antiga (nginx na raiz). Recriando o container; os logins ficam.`);
    return await recriar(empresaId, nomeEmpresa);
  } finally {
    recriando.delete(empresaId);
  }
}

/** Apaga o container e sobe de novo com a tela no painel. O volume (os logins) fica. */
export async function recriar(empresaId: string, nomeEmpresa = ""): Promise<Maquina> {
  await docker(["rm", "-f", nomeDoContainer(empresaId)], 60000);
  return ligar(empresaId, nomeEmpresa);
}

export async function desligar(empresaId: string): Promise<Maquina> {
  const atual = await estadoDa(empresaId);
  if (atual.estado !== "ligada") return atual;
  await docker(["stop", atual.container], 60000);
  return { ...atual, estado: "desligada", telaUrl: undefined };
}

/** Apaga o container E o perfil: a empresa perde as sessoes abertas nele. */
export async function apagar(empresaId: string): Promise<{ ok: boolean }> {
  const container = nomeDoContainer(empresaId);
  await docker(["rm", "-f", container], 60000);
  try { fs.rmSync(path.join(RAIZ, limpo(empresaId)), { recursive: true, force: true }); } catch { /* ja foi */ }
  return { ok: true };
}

export async function imagemPronta(): Promise<boolean> {
  const r = await docker(["image", "inspect", IMAGEM, "--format", "{{.Id}}"], 20000);
  return r.ok;
}