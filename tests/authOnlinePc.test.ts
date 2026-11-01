import { test } from "node:test";
import assert from "node:assert/strict";
import { rotaPublicaOnline } from "../packages/hub/src/authOnline.ts";

test("assets da Selkies sob /pc/ nao sao publicos", () => {
  assert.equal(rotaPublicaOnline("/pc/salada/assets/index-BpOBp7NB.js"), false);
  assert.equal(rotaPublicaOnline("/pc/salada/icon.png"), false);
  assert.equal(rotaPublicaOnline("/pc/salada/"), false);
  assert.equal(rotaPublicaOnline("/android/salada/"), false);
});

test("assets da UI continuam publicos", () => {
  assert.equal(rotaPublicaOnline("/assets/index.js"), true);
  assert.equal(rotaPublicaOnline("/amebas/x.png"), true);
  assert.equal(rotaPublicaOnline("/api/health"), true);
});
