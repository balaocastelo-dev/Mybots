import fs from "node:fs";
import path from "node:path";
import { fichaDaCasa, type FichaCasa } from "@mybots/shared";
import { config, raizDoProjeto } from "./config.js";

/** O que o menu da conta pode mostrar. Variáveis vazias não viram link. */
export function fichaPublica(env: NodeJS.ProcessEnv = process.env): FichaCasa {
  return fichaDaCasa(env, env.MYBOTS_VERSAO?.trim() || config.version);
}

/**
 * O APK publicado em /downloads/MyBots.apk. Primeiro a pasta downloads;
 * se ela estiver vazia, o arquivo que o Gradle já gera no projeto.
 */
export function arquivoDoApk(raiz = raizDoProjeto()): string | null {
  const candidatos = [
    path.join(raiz, "downloads", "MyBots.apk"),
    path.join(raiz, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
  ];
  for (const arquivo of candidatos) {
    try {
      if (fs.statSync(arquivo).isFile()) return arquivo;
    } catch { /* ainda não publicado */ }
  }
  return null;
}
