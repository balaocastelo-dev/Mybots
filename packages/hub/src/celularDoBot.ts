/**
 * Qual aparelho a ferramenta `celular` usa.
 *
 * Primeiro o cadastro Android deste bot (ServicoAndroid.cadastro).
 * O vínculo da empresa só entra se o bot não tiver o dele — na main as
 * empresas ainda existem, então o caminho antigo continua valendo.
 */

export type AlvoDoCelular = {
  serial: string;
  modelo: string;
  origem: "bot" | "empresa";
  /** chave da trava: um bot não segura o celular de outro */
  trava: string;
};

export function escolherAlvoDoCelular(o: {
  botId: string;
  cadastro: { serial?: string } | null;
  empresaId: string | null;
  vinculo: { serial: string; modelo?: string } | null;
}): AlvoDoCelular | null {
  const doBot = String(o.cadastro?.serial ?? "").trim();
  if (doBot) return { serial: doBot, modelo: doBot, origem: "bot", trava: `bot:${o.botId}` };
  const serial = String(o.vinculo?.serial ?? "").trim();
  if (o.empresaId && serial) {
    return { serial, modelo: String(o.vinculo?.modelo ?? "").trim() || serial, origem: "empresa", trava: o.empresaId };
  }
  return null;
}
