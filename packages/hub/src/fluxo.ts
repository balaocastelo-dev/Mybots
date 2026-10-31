/**
 * O que já pode aparecer na bolha enquanto o modelo ainda escreve.
 *
 * O pensamento em inglês não chega aqui: quem chama já passou pelo filtro.
 * O primeiro pedaço espera uma palavra (espaço ou pontuação) ou 8 letras,
 * para não pintar uma letra que ainda pode mudar de ideia. Depois disso,
 * cada pedaço novo sai na hora — a tela não espera a resposta inteira.
 */
export function devePublicar(answer: string, mostrado: string): boolean {
  if (!answer || answer === mostrado) return false;
  if (mostrado) return true;
  return answer.length >= 8 || /[\s.!?…]/.test(answer);
}
