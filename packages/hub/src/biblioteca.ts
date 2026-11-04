/**
 * Quem pode ver um arquivo.
 *
 * A mesma regra da lista e do download: dono da casa vê tudo; cliente só o
 * que é dele; sem sessão, com o login online ligado, não vê nada. Fora do
 * login online (o Hub nesta máquina) a lista continua aberta.
 */

export type VisaoArquivo =
  | { tipo: "local" }
  | { tipo: "loopback" }
  | { tipo: "usuario"; papel: "owner" | "cliente"; id: string }
  | { tipo: "bot"; donoDoBot: string | null; donoEhOwner: boolean }
  | { tipo: "anonimo" };

export function podeVerArquivo(visao: VisaoArquivo, dono: string | null): boolean {
  if (visao.tipo === "local" || visao.tipo === "loopback") return true;
  if (visao.tipo === "usuario") return visao.papel === "owner" || (!!dono && dono === visao.id);
  if (visao.tipo === "bot") {
    if (!visao.donoDoBot) return false;
    if (visao.donoDoBot === dono) return true;
    return visao.donoEhOwner;
  }
  return false;
}
