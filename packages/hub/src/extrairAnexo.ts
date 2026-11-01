/**
 * Extrai texto de anexos do chat (PDF, DOCX, texto) para o bot ler sem fetch HTTP.
 * PDF: pdftotext (Poppler/Git). DOCX: unzip word/document.xml. Texto: leitura direta.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LIMITE = 80_000;

export function ehDocumentoLivel(mime: string, nome: string): boolean {
  const m = (mime || "").toLowerCase();
  const n = (nome || "").toLowerCase();
  if (m.includes("pdf") || n.endsWith(".pdf")) return true;
  if (m.includes("wordprocessingml") || n.endsWith(".docx")) return true;
  if (m.startsWith("text/") || /\.(txt|md|csv|json|xml|html?|log|tsv)$/i.test(n)) return true;
  if (m.includes("opendocument.text") || n.endsWith(".odt")) return true;
  return false;
}

export function ehImagem(mime: string, nome: string): boolean {
  const m = (mime || "").toLowerCase();
  const n = (nome || "").toLowerCase();
  return m.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n);
}

function acharPdftotext(): string {
  const cand = [
    process.env.MYBOTS_PDFTOTEXT,
    path.join("C:", "Program Files", "Git", "mingw64", "bin", "pdftotext.exe"),
    path.join("C:", "Program Files", "Git", "usr", "bin", "pdftotext.exe"),
    "/usr/bin/pdftotext",
    "/opt/homebrew/bin/pdftotext",
  ].filter((c): c is string => Boolean(c));
  for (const c of cand) {
    try {
      if (fs.existsSync(c)) return c;
    } catch { /* next */ }
  }
  return "pdftotext";
}

async function pdfParaTexto(arquivo: string): Promise<string> {
  const bin = acharPdftotext();
  try {
    const { stdout } = await execFileAsync(bin, ["-layout", "-enc", "UTF-8", "-nopgbrk", arquivo, "-"], {
      maxBuffer: 12 * 1024 * 1024,
      timeout: 60_000,
      windowsHide: true,
    });
    return String(stdout || "");
  } catch (e) {
    const msg = (e as Error).message || String(e);
    throw new Error(`pdftotext falhou: ${msg.slice(0, 200)}`);
  }
}

async function docxParaTexto(arquivo: string): Promise<string> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-docx-"));
  try {
    const unzipGit = path.join("C:", "Program Files", "Git", "usr", "bin", "unzip.exe");
    const unzip = process.platform === "win32"
      ? (fs.existsSync(unzipGit) ? unzipGit : "unzip")
      : "unzip";
    await execFileAsync(unzip, ["-o", "-q", arquivo, "word/document.xml", "-d", tmp], {
      timeout: 30_000,
      windowsHide: true,
    });
    const xmlPath = path.join(tmp, "word", "document.xml");
    if (!fs.existsSync(xmlPath)) throw new Error("DOCX sem word/document.xml");
    const xml = fs.readFileSync(xmlPath, "utf8");
    return xml
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:tab[^/]*\/>/g, "\t")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ok */ }
  }
}

function textoDireto(arquivo: string): string {
  const buf = fs.readFileSync(arquivo);
  if (buf.length > 2 * 1024 * 1024) {
    return buf.subarray(0, 2 * 1024 * 1024).toString("utf8") + "\n…[arquivo truncado]";
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return buf.toString("latin1");
  }
}

/** Extrai texto legível. Devolve string vazia se não der (sem lançar). */
export async function extrairTextoDoArquivo(arquivo: string, mime: string, nome: string): Promise<{ texto: string; como: string } | { erro: string }> {
  if (!arquivo || !fs.existsSync(arquivo)) return { erro: "arquivo não encontrado no disco" };
  const m = (mime || "").toLowerCase();
  const n = (nome || "").toLowerCase();
  try {
    let bruto = "";
    let como = "";
    if (m.includes("pdf") || n.endsWith(".pdf")) {
      bruto = await pdfParaTexto(arquivo);
      como = "pdftotext";
    } else if (m.includes("wordprocessingml") || n.endsWith(".docx")) {
      bruto = await docxParaTexto(arquivo);
      como = "docx-xml";
    } else if (m.startsWith("text/") || /\.(txt|md|csv|json|xml|html?|log|tsv)$/i.test(n)) {
      bruto = textoDireto(arquivo);
      como = "texto";
    } else {
      return { erro: `tipo não suportado para extração: ${mime || nome}` };
    }
    const limpo = bruto.replace(/\u0000/g, "").trim();
    if (!limpo) return { erro: "extração veio vazia (PDF escaneado sem OCR?)" };
    const texto = limpo.length > LIMITE
      ? limpo.slice(0, LIMITE) + `\n…[cortado em ${LIMITE} caracteres; use read_attachment com parte=2…]`
      : limpo;
    return { texto, como };
  } catch (e) {
    return { erro: (e as Error).message || String(e) };
  }
}
