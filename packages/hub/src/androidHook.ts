/**
 * Atalho local, só enquanto o registro de provedores do PR do PC não está na main.
 *
 * Aquele PR não importa este arquivo. O ciclo do PC chama os métodos opcionais
 * aoLigarPc/aoDesligarPc do provedor, pelo registro (avisarProvedores). Este
 * gancho só repete essa chamada para quem ainda estiver na main de hoje.
 * No rebase ele sai. Ver docs/ANDROID.md.
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
