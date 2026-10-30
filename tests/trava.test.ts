// Trava do coração do sistema: o que nenhum bot apaga, em nenhum modo.
// Regra do chefe (30/10/2026): travado de verdade é só o que mantém o MyBots de
// pé e o conhecimento da casa; pasta de bot, workspace e log o Médico gerencia
// sozinho. O valor deste teste está tanto no que ele BLOQUEIA quanto no que ele
// LIBERA: uma trava que atrapalha o Médico de trabalhar seria desligada numa semana.
import { test } from "node:test";
import assert from "node:assert";
import { tocaCoracaoDoSistema } from "../packages/node/src/tools.ts";

const RAIZ = "C:\\Users\\user\\Desktop\\mybots";

const BLOQUEAR: Array<[string, string]> = [
  ["apagar o código do Hub", `Remove-Item -Path "${RAIZ}\\packages\\hub" -Recurse -Force`],
  ["apagar o banco da casa", `Remove-Item "${RAIZ}\\packages\\hub\\data\\mybots.sqlite"`],
  ["apagar as chaves", `del ${RAIZ}\\.env`],
  ["apagar node_modules", `rm -rf /c/Users/user/Desktop/mybots/node_modules`],
  ["mover a pasta de dados", `Move-Item "${RAIZ}\\dados" D:\\lixo`],
  ["apagar a pasta do Médico", `Remove-Item ${RAIZ}\\bots\\medico -Recurse`],
  ["sobrescrever as chaves", `Set-Content "${RAIZ}\\.env" "nada"`],
  ["matar tudo que é mybots (levaria o Hub junto)", `Get-Process | Where-Object { $_.Path -like "*mybots*" } | Stop-Process -Force`],
  ["matar a janela do Hub", `taskkill /F /FI "WINDOWTITLE eq MyBots Hub"`],
  ["apagar o package.json", `Remove-Item ${RAIZ}\\package.json`],
];

const LIBERAR: Array<[string, string]> = [
  ["apagar a pasta de um bot", `Remove-Item -Path "${RAIZ}\\bots\\joao-videomaker" -Recurse -Force`],
  ["matar o nó de um bot pela id dele", `Get-Process | Where-Object { $_.CommandLine -like "*joao-videomaker*" } | Stop-Process -Force`],
  ["matar um nó pelo pid", `Stop-Process -Id 34760 -Force`],
  ["apagar rascunho no workspace", `Remove-Item "${RAIZ}\\bots\\carlos\\workspace\\rascunho.txt"`],
  ["apagar log de bot", `Remove-Item ${RAIZ}\\bots\\seguranca\\node.log`],
  ["LER o código do Hub", `Get-Content "${RAIZ}\\packages\\hub\\src\\hub.ts"`],
  ["LISTAR a pasta de dados", `Get-ChildItem ${RAIZ}\\dados`],
  ["consertar código (o Médico conserta o sistema)", `Set-Content "${RAIZ}\\packages\\hub\\src\\hub.ts" "codigo consertado"`],
  ["rodar os testes", `npm test`],
];

test("trava: o coração do sistema não é apagado por bot nenhum", () => {
  for (const [nome, cmd] of BLOQUEAR) assert.ok(tocaCoracaoDoSistema(cmd), `deixou passar — ${nome}: ${cmd}`);
});

test("trava: o Médico continua podendo fazer o trabalho dele", () => {
  for (const [nome, cmd] of LIBERAR) {
    const r = tocaCoracaoDoSistema(cmd);
    assert.ok(!r, `bloqueou demais — ${nome}: ${cmd}\n   motivo dado: ${r}`);
  }
});
