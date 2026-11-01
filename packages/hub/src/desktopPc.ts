/**
 * Desktop leve no PC do bot (labwc/openbox + painel + wallpaper MyBots).
 * Grava no volume do container; a imagem mybots/pc-desktop traz tint2/pcmanfm-qt/swaybg.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARCA = "mybots-desktop-v2";

function skelRaiz(): string {
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const cand = [
    path.resolve(aqui, "..", "pc-desktop", "root", "config-skel"),
    path.resolve(process.cwd(), "packages", "hub", "pc-desktop", "root", "config-skel"),
    path.resolve(process.cwd(), "pc-desktop", "root", "config-skel"),
  ];
  for (const c of cand) {
    if (
      fs.existsSync(path.join(c, ".config", "labwc", "autostart")) ||
      fs.existsSync(path.join(c, ".config", "openbox", "autostart"))
    ) {
      return c;
    }
  }
  return cand[0];
}

function copiarDir(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, ent.name);
    const b = path.join(dest, ent.name);
    if (ent.isDirectory()) copiarDir(a, b);
    else {
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.copyFileSync(a, b);
    }
  }
}

/** Escreve wallpaper, ícones, autostart e init no volume do bot. Idempotente. */
export function garantirDesktop(volumeAbs: string): { ok: boolean; motivo?: string } {
  try {
    fs.mkdirSync(volumeAbs, { recursive: true });
    const marca = path.join(volumeAbs, ".mybots-desktop");
    const skel = skelRaiz();
    if (!fs.existsSync(skel)) return { ok: false, motivo: `skel ausente: ${skel}` };
    copiarDir(skel, volumeAbs);
    for (const rel of [
      path.join(".config", "labwc", "autostart"),
      path.join(".config", "openbox", "autostart"),
      path.join("custom-cont-init.d", "90-mybots-desktop.sh"),
    ]) {
      const p = path.join(volumeAbs, rel);
      try { fs.chmodSync(p, 0o755); } catch { /* windows */ }
    }
    try {
      for (const f of fs.readdirSync(path.join(volumeAbs, "Desktop"))) {
        if (f.endsWith(".desktop")) {
          try { fs.chmodSync(path.join(volumeAbs, "Desktop", f), 0o755); } catch { /* */ }
        }
      }
    } catch { /* */ }
    fs.writeFileSync(marca, `${MARCA}\n${new Date().toISOString()}\n`);
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
}
