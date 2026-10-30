// A chamada de voz é telefone: o bot fala enquanto escreve, e cala quando o chefe fala.
// O que estes testes guardam:
//  (1) só sai do corte FRASE INTEIRA — meia frase vira som truncado e a voz "gagueja";
//  (2) o primeiro pedaço é curto, senão o chefe espera demais pelo primeiro som;
//  (3) o alto-falante que volta pelo microfone é reconhecido como eco e NÃO vira pergunta;
//  (4) dinheiro é lido como gente lê: "R$ 3058,00" é três mil e cinquenta e oito reais.
import assert from "node:assert";
import { test } from "node:test";
import { cortarFala, ehRuido, pareceEco, numeroPorExtenso, dinheiroPorExtenso, cleanForSpeech, FALA_PRIMEIRO } from "../packages/shared/src/speech.js";

test("frase pela metade espera; frase inteira já vira som", () => {
  const a = cortarFala("Olá chefe, o preço", true);
  assert.deepEqual(a.pedacos, [], "sem ponto final não fala");
  assert.equal(a.resto, "Olá chefe, o preço");
  const b = cortarFala("Olá chefe, o preço caiu. Agora", true);
  assert.deepEqual(b.pedacos, ["Olá chefe, o preço caiu."]);
  assert.equal(b.resto, " Agora");
});

test("o primeiro pedaço é curto; o resto vem em blocos maiores", () => {
  const frase = "Essa é uma frase bem comprida para empurrar o limite do primeiro pedaço da fala. ";
  const { pedacos } = cortarFala(frase.repeat(4), true);
  assert.ok(pedacos.length >= 2, "texto longo sai em mais de um pedaço");
  assert.ok(pedacos[0].length <= frase.length + FALA_PRIMEIRO, "o primeiro pedaço não espera o texto todo");
});

test("bloco de código aberto segura a fala até fechar", () => {
  const { pedacos, resto } = cortarFala("Fiz assim. ```bash\nls -la. ", true);
  assert.deepEqual(pedacos, ["Fiz assim."]);
  assert.ok(resto.includes("```"), "o código fica guardado para não ser soletrado");
});

test("o fim leva o que sobrou, mesmo sem ponto final", () => {
  const { pedacos, resto } = cortarFala("já mando o link", false, true);
  assert.deepEqual(pedacos, ["já mando o link"]);
  assert.equal(resto, "");
});

test("o que o bot acabou de dizer, voltando pelo microfone, é eco e não pergunta", () => {
  const falou = "O SSD de um tera está três mil e cinquenta e oito reais à vista.";
  assert.equal(pareceEco("o ssd está três mil reais", falou), true);
  assert.equal(pareceEco("não, quero o de dois teras", falou), false, "fala nova nunca pode ser tomada por eco");
  assert.equal(ehRuido("Legendas pela comunidade Amara.org"), true, "alucinação do whisper no silêncio");
  assert.equal(ehRuido("beleza"), false);
});

test("dinheiro é falado como gente fala", () => {
  assert.equal(numeroPorExtenso(3058), "três mil e cinquenta e oito");
  assert.equal(numeroPorExtenso(1000), "mil");
  assert.equal(numeroPorExtenso(1299), "mil duzentos e noventa e nove");
  assert.equal(dinheiroPorExtenso("R$ 3058,00"), "três mil e cinquenta e oito reais");
  assert.equal(dinheiroPorExtenso("R$ 3.058,00"), "três mil e cinquenta e oito reais");
  assert.equal(dinheiroPorExtenso("R$ 1,50"), "um real e cinquenta centavos");
  assert.equal(dinheiroPorExtenso("R$ 1.299,90"), "mil duzentos e noventa e nove reais e noventa centavos");
  assert.ok(cleanForSpeech("Sai por R$ 3058,00 à vista.").includes("três mil e cinquenta e oito reais"),
    "a limpeza da fala tem de converter o preço antes de mandar para o TTS");
  assert.equal(dinheiroPorExtenso("12x de R$ 254,83"),
    "12 vezes de duzentos e cinquenta e quatro reais e oitenta e três centavos",
    "parcela vira 'vezes' (o TTS lê 12 certo; '12x' ele soletra)");
});
