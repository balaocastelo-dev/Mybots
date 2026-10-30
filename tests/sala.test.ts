// A sala tem um perigo só: rodar sozinha. Cada teste aqui cobre uma trava que
// impede isso — não o caminho feliz, que é o que menos quebra.
import test from "node:test";
import assert from "node:assert/strict";
import { SalaDeConversa, nadaAAcrescentar, type PontesDaSala } from "../packages/hub/src/sala.js";

type Chamado = { botId: string; texto: string };

function bancada(membros: string[], offline: string[] = []) {
  const acordados: Chamado[] = [];
  const anotacoes: string[] = [];
  const pontes: PontesDaSala = {
    membrosDoGrupo: (g) => (g === "g1" ? membros : undefined),
    nomeDoBot: (b) => b.toUpperCase(),
    acordarBot: (botId, _conv, texto) => {
      if (offline.includes(botId)) return false;
      acordados.push({ botId, texto });
      return true;
    },
    anotar: (_conv, texto) => { anotacoes.push(texto); },
  };
  return { sala: new SalaDeConversa(pontes), acordados, anotacoes };
}

/** Responde pelo último bot que foi acordado. */
const responder = (b: ReturnType<typeof bancada>, texto: string) =>
  b.sala.respondeu("group:g1", b.acordados[b.acordados.length - 1].botId, texto);

test("a sala nunca passa do número de falas combinado", async () => {
  const b = bancada(["a", "b", "c"]);
  b.sala.abrir("g1", "preço do SSD", { voltas: 1, pausaSeg: 0 });
  for (let i = 0; i < 3; i++) {
    responder(b, `fala ${i}`);
    await new Promise((r) => setTimeout(r, 12));
  }
  assert.equal(b.acordados.length, 3, "3 membros × 1 volta = 3 falas, nem uma a mais");
  assert.equal(b.sala.ativas().length, 0, "a sala se fecha sozinha ao fim das falas");
  assert.match(b.anotacoes.at(-1)!, /encerrada/i);
});

test("o chefe falando fecha a sala na hora", () => {
  const b = bancada(["a", "b"]);
  b.sala.abrir("g1", "assunto", { voltas: 3, pausaSeg: 0 });
  assert.equal(b.sala.ativas().length, 1);
  b.sala.pausarPorHumano("group:g1");
  assert.equal(b.sala.ativas().length, 0);
  assert.match(b.anotacoes.at(-1)!, /chefe entrou/i);
});

test("dois 'nada a acrescentar' seguidos encerram o assunto", async () => {
  const b = bancada(["a", "b", "c"]);
  b.sala.abrir("g1", "assunto", { voltas: 4, pausaSeg: 0 });
  responder(b, "nada a acrescentar");
  await new Promise((r) => setTimeout(r, 12));
  responder(b, "Nada a acrescentar.");
  await new Promise((r) => setTimeout(r, 12));
  assert.equal(b.sala.ativas().length, 0);
  assert.match(b.anotacoes.at(-1)!, /esgotado/i);
});

test("um 'nada a acrescentar' no meio não encerra: o contador zera na próxima fala útil", async () => {
  const b = bancada(["a", "b", "c"]);
  b.sala.abrir("g1", "assunto", { voltas: 2, pausaSeg: 0 });
  responder(b, "nada a acrescentar");
  await new Promise((r) => setTimeout(r, 12));
  responder(b, "o custo está em R$ 800, a margem fecha em 66%");
  await new Promise((r) => setTimeout(r, 12));
  assert.equal(b.sala.ativas().length, 1, "a sala continua");
  responder(b, "nada a acrescentar");
  await new Promise((r) => setTimeout(r, 12));
  assert.equal(b.sala.ativas().length, 1, "um vazio sozinho não fecha nada");
});

test("bot offline não gasta a vez de quem está de pé", () => {
  const b = bancada(["a", "b", "c"], ["a"]);
  b.sala.abrir("g1", "assunto", { voltas: 1, pausaSeg: 0 });
  assert.equal(b.acordados[0].botId, "b", "pula o offline e dá a vez ao próximo");
  assert.equal(b.sala.ativas()[0].turno, 1, "o turno gasto é o de quem realmente falou");
});

test("sala sem ninguém online se fecha em vez de ficar esperando", () => {
  const b = bancada(["a", "b"], ["a", "b"]);
  b.sala.abrir("g1", "assunto", { voltas: 2, pausaSeg: 0 });
  assert.equal(b.sala.ativas().length, 0);
  assert.match(b.anotacoes.at(-1)!, /nenhum rob/i);
});

test("não dá para abrir duas vezes a mesma sala, nem sala de um robô só", () => {
  const b = bancada(["a", "b"]);
  b.sala.abrir("g1", "assunto", { pausaSeg: 0 });
  const repetida = b.sala.abrir("g1", "outro assunto", { pausaSeg: 0 });
  assert.ok("error" in repetida && /já está aberta/.test(repetida.error));

  const sozinho = bancada(["a"]);
  const r = sozinho.sala.abrir("g1", "assunto", { pausaSeg: 0 });
  assert.ok("error" in r && /pelo menos 2/.test(r.error));
});

test("o recado do turno proíbe executar e cobra uma coisa concreta", () => {
  const b = bancada(["a", "b"]);
  b.sala.abrir("g1", "trocar o fornecedor de SSD", { pausaSeg: 0 });
  const recado = b.acordados[0].texto;
  assert.match(recado, /trocar o fornecedor de SSD/, "o assunto vai junto");
  assert.match(recado, /nada de enviar, publicar, pagar/i, "sala é conversa, não execução");
  assert.match(recado, /nada a acrescentar/, "o bot precisa saber como sair");
  assert.match(recado, /4 linhas/, "turno curto, senão a conta sobe");
});

test("reconhece 'nada a acrescentar' escrito de outros jeitos — e não confunde com texto longo", () => {
  for (const t of ["nada a acrescentar", "Nada a acrescentar.", "NADA A ACRESCENTAR!", "  nada a acrescentar  ", ""]) {
    assert.equal(nadaAAcrescentar(t), true, `devia contar como vazio: "${t}"`);
  }
  for (const t of ["nada a acrescentar sobre o preço, mas o prazo do fornecedor me preocupa e eu checaria antes", "o custo é R$ 800"]) {
    assert.equal(nadaAAcrescentar(t), false, `NÃO devia contar como vazio: "${t}"`);
  }
});
