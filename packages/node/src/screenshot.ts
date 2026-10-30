// Captura de tela do PC do Bot (para o chefe ver o que está acontecendo).
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PS_CAPTURE = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$bmp.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
`;

export function captureScreen(dir: string): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `tela-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
  return new Promise((resolve, reject) => {
    const done = (err: Error | null) => {
      if (err) return reject(err);
      if (!fs.existsSync(out) || fs.statSync(out).size === 0) return reject(new Error("captura vazia"));
      resolve(out);
    };
    const plat = os.platform();
    if (plat === "win32") {
      const script = path.join(os.tmpdir(), "mybots-capture.ps1");
      fs.writeFileSync(script, PS_CAPTURE, "utf8");
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, out], { windowsHide: true, timeout: 20_000 }, (e) => done(e));
    } else if (plat === "darwin") {
      execFile("screencapture", ["-x", out], { timeout: 20_000 }, (e) => done(e));
    } else {
      // Linux: tenta ImageMagick, depois scrot, depois gnome-screenshot
      execFile("import", ["-window", "root", out], { timeout: 20_000 }, (e1) => {
        if (!e1) return done(null);
        execFile("scrot", [out], { timeout: 20_000 }, (e2) => {
          if (!e2) return done(null);
          execFile("gnome-screenshot", ["-f", out], { timeout: 20_000 }, (e3) => done(e3 ? new Error("nenhuma ferramenta de captura encontrada (import/scrot/gnome-screenshot)") : null));
        });
      });
    }
  });
}

export function mimeOf(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".json": "application/json", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".zip": "application/zip" } as Record<string, string>)[ext] ?? "application/octet-stream";
}
