/**
 * Provedores do celular, no registro oficial de android.ts.
 *
 * `aparelho` (prioridade 10) é o telefone na Wi-Fi. `redroid` (prioridade 1)
 * é o container, e só sobe com MYBOTS_ANDROID_FALLBACK. O registro chama
 * aoLigarPc/aoDesligarPc quando o PC do bot liga ou desliga.
 */
import type { CadastroAndroid } from "./androidBot.js";
import { modoFallbackDoAmbiente, nomeDoContainerAndroid } from "./androidFallback.js";
import { registrarProvedorAndroid, type AlvoAndroid, type ProvedorAndroid, type RelatoAndroid } from "./android.js";

/** A mesma ordem que o teste do registro usa: aparelho 10, redroid 1. */
export const PRIORIDADE_APARELHO = 10;
export const PRIORIDADE_REDROID = 1;

export type FonteDoProvedor = {
  cadastro(botId: string): CadastroAndroid | null;
  conectado(botId: string): Promise<boolean>;
  uso(botId: string): number | null;
  reconectar(botId: string): Promise<void>;
  abrirWhatsapp(botId: string): Promise<void>;
  pararTela(botId: string): void;
  subirFallback(botId: string): Promise<void>;
};

function portaUsavel(porta: number): boolean {
  return Number.isInteger(porta) && porta >= 1 && porta <= 65535 && porta !== 8787 && porta !== 8791;
}

export function provedorAparelho(fonte: FonteDoProvedor): ProvedorAndroid {
  return {
    id: "aparelho",
    prioridade: PRIORIDADE_APARELHO,
    async resolver(botId): Promise<AlvoAndroid | null> {
      const c = fonte.cadastro(botId);
      if (!c || c.modo !== "aparelho" || !portaUsavel(c.portaConexao)) return null;
      return { tipo: "aparelho", serial: c.serial, host: c.ip, porta: c.portaConexao };
    },
    async relatar(botId): Promise<RelatoAndroid | null> {
      const c = fonte.cadastro(botId);
      if (!c || c.modo !== "aparelho") return null;
      const on = await fonte.conectado(botId);
      return { estado: on ? "ligado" : "desligado", porta: portaUsavel(c.portaConexao) ? c.portaConexao : null, ultimoUso: fonte.uso(botId) };
    },
    async aoLigarPc(botId) {
      await fonte.reconectar(botId);
      if (await fonte.conectado(botId)) await fonte.abrirWhatsapp(botId);
    },
    aoDesligarPc(botId) {
      fonte.pararTela(botId);
      return Promise.resolve();
    },
  };
}

export function provedorRedroid(fonte: FonteDoProvedor): ProvedorAndroid {
  return {
    id: "redroid",
    prioridade: PRIORIDADE_REDROID,
    async resolver(botId): Promise<AlvoAndroid | null> {
      const c = fonte.cadastro(botId);
      if (!c || (c.modo !== "redroid" && c.modo !== "emulador") || !portaUsavel(c.portaConexao)) return null;
      return { tipo: "container", nome: nomeDoContainerAndroid(botId), host: "127.0.0.1", porta: c.portaConexao };
    },
    async relatar(botId): Promise<RelatoAndroid | null> {
      const c = fonte.cadastro(botId);
      if (!c || (c.modo !== "redroid" && c.modo !== "emulador")) return null;
      const on = await fonte.conectado(botId);
      return { estado: on ? "ligado" : "desligado", porta: portaUsavel(c.portaConexao) ? c.portaConexao : null, ultimoUso: fonte.uso(botId) };
    },
    async aoLigarPc(botId) {
      const c = fonte.cadastro(botId);
      if (c?.modo === "aparelho" || c?.modo === "redroid" || c?.modo === "emulador") return;
      if (!modoFallbackDoAmbiente()) return;
      await fonte.subirFallback(botId);
    },
  };
}

export function instalarProvedores(fonte: FonteDoProvedor): void {
  registrarProvedorAndroid(provedorAparelho(fonte));
  registrarProvedorAndroid(provedorRedroid(fonte));
}
