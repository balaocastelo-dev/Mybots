/**
 * Tira chave de API de um texto antes dele virar log, erro ou resposta.
 *
 * O Gemini (e outros) põem a chave na URL. O erro HTTP repetia essa URL
 * inteira — a chave saía no chat, no log do nó e no diagnóstico do Hub.
 * Isto apaga o valor. Não tenta adivinhar senha de usuário: isso é o cofre.
 */

const TROCA: Array<[RegExp, string]> = [
  // Bearer primeiro: senão o sk- de dentro do token vira "sk-***" e o Bearer fica pela metade.
  [/\bBearer\s+[A-Za-z0-9._\-~+/]{8,}/gi, "Bearer ***"],
  [/\bsk-[A-Za-z0-9_\-]{8,}/g, "sk-***"],
  [/\bgsk_[A-Za-z0-9_\-]{8,}/g, "gsk_***"],
  [/\bxai-[A-Za-z0-9_\-]{8,}/g, "xai-***"],
  [/\bAIza[0-9A-Za-z_\-]{10,}/g, "AIza***"],
  [/([?&#](?:key|api_key|apikey|access_token|token|secret)=)[^&\s"'#]+/gi, "$1***"],
  [/\b(x-api-key["'\s:=]+)[A-Za-z0-9._\-]{8,}/gi, "$1***"],
];

export function redigirSegredos(texto: string): string {
  let s = String(texto ?? "");
  for (const [re, por] of TROCA) s = s.replace(re, por);
  return s;
}
