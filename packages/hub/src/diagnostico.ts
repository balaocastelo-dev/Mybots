// Por que um bot não subiu.
//
// Existe por causa de um buraco real: em 29/10 uma vírgula faltando no código
// fez o esbuild parar, TODOS os nós morreram ao nascer, o Hub tentou reiniciar
// dez vezes e desistiu — em silêncio. Ninguém foi avisado. Um bot que nem
// compila é exatamente o tipo de coisa que o Médico do Sistema deveria ver.
//
// A ideia aqui é entregar a CAUSA mastigada, em vez de deixar o modelo
// adivinhar lendo log: o log de um nó quebrado tem dezenas de linhas de pilha
// do Node e uma única linha que importa.
import fs from "node:fs";
import path from "node:path";
import { redigir } from "./redacao.js";

export type Queda = {
  classe: "config-invalido" | "nao-compila" | "falta-modulo" | "chave-recusada" | "porta-ocupada" | "sem-rede" | "desconhecido" | "sem-log";
  resumo: string;
  /** o que fazer, em português, para quem vai consertar */
  conserto: string;
  trecho: string;
};

const PADROES: Array<{ re: RegExp; classe: Queda["classe"]; resumo: string; conserto: string }> = [
  // ANTES do padrao de sintaxe, de proposito: um mybots-node.json quebrado
  // tambem levanta SyntaxError, e dizer "o codigo nao compila" mandaria quem
  // for consertar olhar packages/node, que nao tem nada a ver com isso.
  { re: /in JSON at position|in JSON at line|JSON\.parse|mybots-node\.json/i,
    classe: "config-invalido",
    resumo: "o arquivo de configuracao deste bot esta quebrado",
    conserto: "O mybots-node.json da pasta do bot nao e JSON valido. Da para regravar pelo painel (abrir o bot, editar e salvar) ou corrigir o arquivo a mao." },
  { re: /TransformError|Expected .* but found|SyntaxError|Unexpected token/i,
    classe: "nao-compila",
    resumo: "o código do nó não compila",
    conserto: "Alguém editou um arquivo de packages/node e deixou erro de sintaxe. O log diz o arquivo e a linha. Rode `npm test` na raiz do mybots: ele pega isso em segundos." },
  { re: /Cannot find module|ERR_MODULE_NOT_FOUND|Failed to resolve import/i,
    classe: "falta-modulo",
    resumo: "falta um pacote instalado",
    conserto: "Rode `npm install` na raiz do mybots." },
  { re: /401|403|invalid[_ ]api[_ ]key|authentication_error|x-api-key/i,
    classe: "chave-recusada",
    resumo: "o provedor recusou a chave",
    conserto: "Confira ANTHROPIC_API_KEY no .env da raiz. Não imprima o valor: só diga se está presente ou vazia." },
  { re: /EADDRINUSE|address already in use/i,
    classe: "porta-ocupada",
    resumo: "a porta que o nó queria já está ocupada",
    conserto: "Veja quem está na porta. Lembrando: a porta 8787 é de outro sistema do o chefe e NUNCA deve ser encerrada." },
  { re: /ECONNREFUSED|ENOTFOUND|getaddrinfo|fetch failed/i,
    classe: "sem-rede",
    resumo: "o nó não conseguiu alcançar quem precisava",
    conserto: "Pode ser o Hub fora do ar, o Ollama desligado ou a internet. Confira o que o endereço do log aponta." },
];

/** Lê o fim do node.log e diz, em português, por que o bot não subiu. */
export function motivoDaQueda(dirDoBot: string, linhas = 60): Queda {
  const arquivo = path.join(dirDoBot, "node.log");
  let texto = "";
  try {
    const cru = fs.readFileSync(arquivo, "utf8");
    texto = cru.split("\n").slice(-linhas).join("\n");
  } catch {
    return { classe: "sem-log", resumo: "não existe node.log para este bot", conserto: "O bot pode nunca ter sido iniciado.", trecho: "" };
  }
  if (!texto.trim()) {
    return { classe: "sem-log", resumo: "o node.log está vazio", conserto: "O bot pode nunca ter sido iniciado.", trecho: "" };
  }
  for (const p of PADROES) {
    if (p.re.test(texto)) {
      // a linha que casou é a que interessa; a pilha do Node só atrapalha
      const linha = texto.split("\n").find((l) => p.re.test(l))?.trim() ?? "";
      return { classe: p.classe, resumo: p.resumo, conserto: p.conserto, trecho: redigir(linha.slice(0, 500)) };
    }
  }
  const uteis = texto.split("\n").filter((l) => l.trim() && !/^\s+at /.test(l)).slice(-6);
  return {
    classe: "desconhecido",
    resumo: "o nó morreu e o motivo não é um dos conhecidos",
    conserto: "Leia o node.log inteiro do bot antes de mexer em qualquer coisa.",
    trecho: redigir(uteis.join("\n").slice(0, 700)),
  };
}

/** Texto pronto para entregar ao Médico, sem ele precisar ler log nenhum. */
export function recadoDaQueda(botId: string, nome: string, q: Queda, tentativas: number, desistiu: boolean): string {
  return [
    desistiu
      ? `O bot "${nome}" (${botId}) NÃO SOBE. O Hub tentou ${tentativas} vezes e parou de tentar.`
      : `O bot "${nome}" (${botId}) morreu logo depois de subir (tentativa ${tentativas}).`,
    ``,
    `Causa provável: ${q.resumo}.`,
    q.trecho ? `No log:\n${q.trecho}` : ``,
    ``,
    `Como costuma se consertar: ${q.conserto}`,
    ``,
    `Confira se é isso mesmo antes de mexer. Se o conserto for seguro e estiver na sua alçada, faça e avise o chefe em uma linha dizendo o que era e o que você fez. Se precisar mexer em código do projeto, não conserte sozinho: explique o problema ao chefe e proponha o conserto.`,
  ].filter(Boolean).join("\n");
}
