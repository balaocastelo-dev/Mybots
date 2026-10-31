import fs from "node:fs";
import path from "node:path";
import {
  IMAGEM_PC, MARCA_RAIZ, docker, garantirPonte, limpo, nomeDeContainerEmpresa,
  portasDaChave, raizMaquinas, temDocker,
} from "./dockerPc.js";

/**
 * O PC DA EMPRESA (compatibilidade)
 *
 * Cada empresa ganha um Linux só dela, num container, na mesma máquina onde o Hub
 * roda. Três motivos para ser assim, e não um PC físico nem uma VM na nuvem:
 *
 * - Fica LOGADO. O perfil do navegador mora num volume próprio, então a sessão do
 *   Instagram, do portal do fornecedor e do banco continua valendo amanhã.
 * - Sai do IP DA EMPRESA. O Hub já roda dentro da empresa; uma VM na nuvem teria IP
 *   de datacenter, e aí Instagram, Google e banco pedem verificação toda hora e
 *   acabam bloqueando a conta.
 * - DÁ PARA VER. A imagem traz o Selkies: a tela do Linux abre no painel, então o
 *   chefe assiste o bot trabalhando em vez de ler um relatório do que ele fez.
 *
 * Uma empresa, um container, um volume. Nada vaza de uma empresa para a outra.
 *
 * Bot novo não usa mais este container: o PC dele está em pcs.ts (`mybots-bot-<id>`).
 * Este arquivo continua de pé para o container antigo, até a rota /pc/<empresa>/
 * apontar para o bot padrão da empresa. O volume daqui não é apagado na migração.
 */

const IMAGEM = IMAGEM_PC;

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

export { temDocker };
export function nomeDoContainer(empresaId: string) { return nomeDeContainerEmpresa(empresaId); }

/** Portas fixas por empresa: a tela precisa do mesmo endereço amanhã. */
function portasDe(empresaId: string): { portaTela: number; portaCdp: number } {
  const p = portasDaChave(empresaId);
  return { portaTela: p.portaTela, portaCdp: p.portaCdp };
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
    setTimeout(() => void garantirPonte(atual.container, path.join(raizMaquinas(), limpo(empresaId))), 12000);
    return { ...deNovo, estado: "ligada", telaUrl: `http://127.0.0.1:${atual.portaTela}/` };
  }

  const volume = path.join(raizMaquinas(), limpo(empresaId));
  fs.mkdirSync(volume, { recursive: true });
  const r = await docker([
    "run", "-d",
    "--name", atual.container,
    "--restart", "unless-stopped",
    // o Chrome quebra com a /dev/shm minúscula padrão do Docker
    "--shm-size=1g",
    "-p", `127.0.0.1:${atual.portaTela}:3000`,
    "-p", `127.0.0.1:${atual.portaCdp}:9223`,
    "-v", `${volume}:/config`,
    "-e", "TZ=America/Sao_Paulo",
    "-e", `TITLE=${nomeEmpresa || empresaId}`,
    "-e", MARCA_RAIZ,
    // o 9222 ouvindo em 0.0.0.0 é preciso para o Hub alcançar de fora do container
    "-e", "CHROME_CLI=--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --remote-allow-origins=* --start-maximized",
    IMAGEM,
  ], 180000);
  if (!r.ok) return { ...atual, erro: r.saida.slice(0, 400) };
  // o Chromium leva uns segundos para abrir; a ponte só vale depois dele
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

/** Apaga o container E o perfil: a empresa perde as sessões abertas nele. */
export async function apagar(empresaId: string): Promise<{ ok: boolean }> {
  const container = nomeDoContainer(empresaId);
  await docker(["rm", "-f", container], 60000);
  try { fs.rmSync(path.join(raizMaquinas(), limpo(empresaId)), { recursive: true, force: true }); } catch { /* já foi */ }
  return { ok: true };
}

export async function imagemPronta(): Promise<boolean> {
  const r = await docker(["image", "inspect", IMAGEM, "--format", "{{.Id}}"], 20000);
  return r.ok;
}
