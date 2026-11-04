import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Db } from "../packages/hub/src/db.ts";
import { podeVerArquivo } from "../packages/hub/src/biblioteca.ts";
import {
  ROTINAS_VAZIAS, agruparBiblioteca, frequenciaDaRotina, grupoDoArquivo, normalizarPerfilVoz,
} from "../packages/shared/src/perfil.ts";

test("voz do perfil persiste e o hello do nó não apaga", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-voz-"));
  const db = new Db(path.join(dir, "h.db"));
  db.upsertBot({ id: "ana", name: "Ana", role: "Assistente", voice: "pt-BR-AntonioNeural" }, {});
  const salvo = normalizarPerfilVoz({ voice: "pt-BR-ThalitaNeural", rate: 1.4, lang: "en" });
  assert.ok(!("error" in salvo));
  db.salvarVozPerfil("ana", "Ana", salvo);
  const lido = db.lerVozPerfil("ana");
  assert.deepEqual(lido, { voice: "pt-BR-ThalitaNeural", rate: 1.4, lang: "en" });
  db.upsertBot({ id: "ana", name: "Ana", role: "Assistente", voice: "pt-BR-FranciscaNeural" }, {});
  const bot = db.listBots().find((b) => b.id === "ana");
  assert.equal(bot?.voice, "pt-BR-ThalitaNeural");
  assert.equal(bot?.voiceRate, 1.4);
  assert.equal(bot?.voiceLang, "en");
  assert.equal(db.lerVozPerfil("ana")?.voice, "pt-BR-ThalitaNeural");
  db.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("voz robótica e velocidade fora da faixa são recusadas", () => {
  assert.ok("error" in normalizarPerfilVoz({ voice: "Microsoft Maria Desktop" }));
  assert.ok("error" in normalizarPerfilVoz({ rate: 3 }));
  assert.ok("error" in normalizarPerfilVoz({ rate: 0.4 }));
  const lenta = normalizarPerfilVoz({ rate: 0.5, voice: "pt-BR-AntonioNeural", lang: "auto" });
  const rapida = normalizarPerfilVoz({ rate: 2 });
  assert.ok(!("error" in lenta) && lenta.rate === 0.5);
  assert.ok(!("error" in rapida) && rapida.rate === 2);
  assert.equal(ROTINAS_VAZIAS, "Rotinas são tarefas recorrentes... peça no chat para configurar uma.");
  assert.equal(frequenciaDaRotina("0 8 * * 1"), "toda segunda às 8h");
  assert.equal(frequenciaDaRotina("*/10 * * * *"), "a cada 10 minutos");
});

test("biblioteca agrupa Hoje, Esta semana e Antes sem repetir o dia", () => {
  const agora = new Date(2026, 10, 4, 15).getTime();
  const hoje = new Date(2026, 10, 4, 9).getTime();
  const hojeTarde = new Date(2026, 10, 4, 14).getTime();
  const ontem = new Date(2026, 10, 3, 11).getTime();
  const domingo = new Date(2026, 10, 1, 12).getTime();
  const antigo = new Date(2026, 9, 1, 12).getTime();
  assert.equal(grupoDoArquivo(hoje, agora), "hoje");
  assert.equal(grupoDoArquivo(ontem, agora), "semana");
  assert.equal(grupoDoArquivo(domingo, agora), "antes");
  assert.equal(grupoDoArquivo(antigo, agora), "antes");
  const grupos = agruparBiblioteca([
    { id: "antigo", quando: antigo },
    { id: "hoje-cedo", quando: hoje },
    { id: "ontem", quando: ontem },
    { id: "hoje-tarde", quando: hojeTarde },
    { id: "domingo", quando: domingo },
  ], agora);
  assert.deepEqual(grupos.map((g) => g.titulo), ["Hoje", "Esta semana", "Antes"]);
  assert.deepEqual(grupos[0].itens.map((i) => i.id), ["hoje-tarde", "hoje-cedo"]);
  assert.deepEqual(grupos[1].itens.map((i) => i.id), ["ontem"]);
  assert.deepEqual(grupos[2].itens.map((i) => i.id), ["domingo", "antigo"]);
  assert.equal(grupos.reduce((n, g) => n + g.itens.length, 0), 5);
});

test("cliente não vê arquivo de outro dono; owner vê; anônimo não vê", () => {
  const itens = [
    { id: "meu", dono: "cli-a" },
    { id: "alheio", dono: "cli-b" },
    { id: "sem-dono", dono: null as string | null },
  ];
  const ver = (visao: Parameters<typeof podeVerArquivo>[0]) => itens.filter((i) => podeVerArquivo(visao, i.dono)).map((i) => i.id);
  assert.deepEqual(ver({ tipo: "usuario", papel: "cliente", id: "cli-a" }), ["meu"]);
  assert.deepEqual(ver({ tipo: "usuario", papel: "owner", id: "dono" }), ["meu", "alheio", "sem-dono"]);
  assert.deepEqual(ver({ tipo: "anonimo" }), []);
  assert.deepEqual(ver({ tipo: "local" }), ["meu", "alheio", "sem-dono"]);
  assert.deepEqual(ver({ tipo: "bot", donoDoBot: "cli-a", donoEhOwner: false }), ["meu"]);
  assert.deepEqual(ver({ tipo: "bot", donoDoBot: "dono", donoEhOwner: true }), ["meu", "alheio", "sem-dono"]);
  assert.deepEqual(ver({ tipo: "bot", donoDoBot: null, donoEhOwner: false }), []);
});
