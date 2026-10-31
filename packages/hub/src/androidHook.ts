/**
 * Ponto de extensão do Android de cada bot.
 *
 * O PC do bot (container mybots-bot-<botId>, liga sob demanda, desliga ocioso)
 * mora em maquinas.ts — outro agente. Este arquivo NÃO mexe naquele módulo.
 * Quem liga e desliga o PC chama o gancho na hora da ação, não no import:
 *
 *   import { ganchoAndroid } from "./androidHook.js";
 *   await ganchoAndroid()?.aoLigarPc(botId);
 *   await ganchoAndroid()?.aoDesligarPc(botId);
 *
 * O Hub registra o gancho ao subir. Antes disso, ganchoAndroid() devolve null.
 * A tela em si não depende desta chamada: ela já está em /android/<botId>/.
 */

export type GanchoAndroid = {
  /** Caminho do stream no Hub. O painel embute este endereço. */
  caminho(botId: string): string;
  /** O PC do bot acabou de ligar. Reconecta o aparelho já pareado. */
  aoLigarPc(botId: string): Promise<void>;
  /** O PC ocioso desligou. O stream para; o pareamento fica. */
  aoDesligarPc(botId: string): Promise<void>;
};

let atual: GanchoAndroid | null = null;

export function registrarGanchoAndroid(g: GanchoAndroid): void {
  atual = g;
}

export function ganchoAndroid(): GanchoAndroid | null {
  return atual;
}
