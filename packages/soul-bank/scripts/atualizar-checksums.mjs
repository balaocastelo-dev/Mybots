import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arquivo = path.join(raiz, "allowlist.json");
const allow = JSON.parse(fs.readFileSync(arquivo, "utf8"));

function caminhar(dir) {
  const saida = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) saida.push(...caminhar(abs));
    else saida.push(abs);
  }
  return saida.sort();
}

function sha(abs) {
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

for (const item of allow.itens) {
  if (item.pastaVendor) {
    const abs = path.join(raiz, item.pastaVendor);
    item.arquivos = caminhar(abs).map((arq) => ({
      caminho: path.relative(abs, arq).split(path.sep).join("/"),
      sha256: sha(arq),
    }));
  }
  if (item.contrato) item.contratoSha256 = sha(path.join(raiz, item.contrato));
}

fs.writeFileSync(arquivo, JSON.stringify(allow, null, 2) + "\n");
console.log("checksums atualizados");
