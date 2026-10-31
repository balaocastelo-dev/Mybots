// Chave mestra e AES-256-GCM do cofre.
// A chave não mora no repositório: ou vem de MYBOTS_VAULT_KEY no .env,
// ou (no Windows, se a variável não existir) de um arquivo protegido com DPAPI
// em %LOCALAPPDATA%\MyBots\vault.key.
import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ChaveMestra =
  | { ativo: true; chave: Buffer; origem: "env" | "dpapi" }
  | { ativo: false; motivo: string };

const AVISO_SEM_CHAVE = "Cofre desativado: no Windows a chave é criada com DPAPI fora do repositório; nos outros sistemas defina MYBOTS_VAULT_KEY no .env do Hub (32 bytes em hex ou base64, ou uma frase de pelo menos 8 caracteres). Sem chave, nada é gravado.";

/** 32 bytes a partir do que está no .env. Frase curta vira chave via scrypt. */
export function chaveDeMaterial(material: string): Buffer | null {
  const t = material.trim();
  if (!t) return null;
  if (/^[0-9a-fA-F]{64}$/.test(t)) return Buffer.from(t, "hex");
  if (t.length >= 43 && !/\s/.test(t)) {
    try {
      const b = Buffer.from(t, "base64");
      if (b.length === 32) return b;
    } catch { /* não era base64 */ }
  }
  if (t.length < 8) return null;
  return scryptSync(t, "mybots-cofre-v1", 32);
}

function arquivoDpapi(): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "MyBots", "vault.key");
}

function powershell(script: string, entrada: string): string {
  // A chave vai na entrada padrão, não na linha de comando: a lista de
  // processos não pode mostrar o segredo.
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    input: entrada,
    encoding: "utf8",
    timeout: 15_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

const SCRIPT_PROTEGER = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$b64 = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($b64)
$prot = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($prot))
`;

const SCRIPT_ABRIR = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$b64 = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($b64)
$puro = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($puro))
`;

function chaveDpapi(): Buffer {
  const arquivo = arquivoDpapi();
  if (fs.existsSync(arquivo)) {
    const blob = fs.readFileSync(arquivo, "utf8").trim();
    const aberto = powershell(SCRIPT_ABRIR, blob);
    const chave = Buffer.from(aberto, "base64");
    if (chave.length !== 32) throw new Error("arquivo DPAPI não tem 32 bytes");
    return chave;
  }
  const nova = randomBytes(32);
  const protegida = powershell(SCRIPT_PROTEGER, nova.toString("base64"));
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, protegida + "\n", { mode: 0o600 });
  return nova;
}

/**
 * Ordem: MYBOTS_VAULT_KEY, se estiver definida (Linux, teste, ou quem quiser
 * fixar a chave). Senão, no Windows, DPAPI. Senão, cofre desativado.
 */
export function carregarChaveMestra(env: NodeJS.ProcessEnv = process.env): ChaveMestra {
  const material = String(env.MYBOTS_VAULT_KEY ?? "").trim();
  if (material) {
    const chave = chaveDeMaterial(material);
    if (!chave) return { ativo: false, motivo: "Cofre desativado: MYBOTS_VAULT_KEY está no .env mas não serve. Use 32 bytes em hex ou base64, ou uma frase de pelo menos 8 caracteres." };
    return { ativo: true, chave, origem: "env" };
  }
  if (process.platform === "win32") {
    try {
      return { ativo: true, chave: chaveDpapi(), origem: "dpapi" };
    } catch {
      return { ativo: false, motivo: "Cofre desativado: o DPAPI do Windows não guardou a chave e MYBOTS_VAULT_KEY não está no .env." };
    }
  }
  return { ativo: false, motivo: AVISO_SEM_CHAVE };
}

export function cifrar(chave: Buffer, texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave, iv);
  const enc = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return "v1:" + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decifrar(chave: Buffer, blob: string): string {
  const cru = String(blob ?? "");
  if (!cru.startsWith("v1:")) throw new Error("não consegui decifrar");
  const buf = Buffer.from(cru.slice(3), "base64");
  if (buf.length < 12 + 16 + 1) throw new Error("não consegui decifrar");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  try {
    const d = createDecipheriv("aes-256-gcm", chave, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch {
    throw new Error("não consegui decifrar");
  }
}
