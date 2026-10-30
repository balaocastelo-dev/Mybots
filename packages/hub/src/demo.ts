// A demonstração que o Gerente faz na hora em que lê o site da empresa.
//
// POR QUE GERAR DE VERDADE: um pacote de arquivos de exemplo embutidos provaria nada —
// o cliente veria uma foto genérica e um PDF de outra empresa. Aqui cada peça nasce com
// o nome, o resumo e as cores da casa que ele acabou de cadastrar. É a diferença entre
// "olha o que o sistema faz" e "olha o que o sistema já fez para você".
//
// E QUANDO FALHA: cada passo devolve o seu próprio erro, em português, e a sequência
// continua. Demonstração que quebra inteira porque o ffmpeg não está instalado é pior
// que demonstração com um item a menos dizendo por quê.
import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pollinationsImage } from "./media.js";
import { raizDoProjeto } from "./config.js";

export type PecaDemo = { tipo: string; titulo: string; texto: string; url?: string; nome?: string; erro?: string };
type Dados = { nome: string; site?: string; resumo?: string; regras?: string };
type Salvar = (nome: string, mime: string, data: Buffer) => { url: string; name: string };

const limpo = (s: string | undefined, n = 220) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** 1. Imagem de marca, gerada de graça (Pollinations, sem chave e sem tocar na placa). */
async function peçaImagem(d: Dados, salvar: Salvar): Promise<PecaDemo> {
  const base: PecaDemo = { tipo: "imagem", titulo: "Uma imagem, criada agora", texto: `Gerei esta imagem a partir do que li sobre a ${d.nome}. É assim que saem as artes para as redes.` };
  try {
    const prompt = `brand photograph for the company "${d.nome}": ${limpo(d.resumo, 180)}. clean professional studio lighting, modern, high detail, no text, no watermark`;
    const img = await pollinationsImage(prompt, "16:9");
    if (!img) throw new Error("o provedor de imagem não respondeu");
    const f = salvar(`demo-${Date.now()}.jpg`, img.mime || "image/jpeg", img.data);
    return { ...base, url: f.url, nome: f.name };
  } catch (e) {
    return { ...base, erro: `Não consegui gerar a imagem agora (${(e as Error).message}).` };
  }
}

/** 2. PDF de uma página, pelo Chrome sem janela, com os dados da empresa. */
async function peçaPdf(d: Dados, salvar: Salvar): Promise<PecaDemo> {
  const base: PecaDemo = { tipo: "pdf", titulo: "Um PDF, com a sua cara", texto: `Esta é a folha de apresentação da ${d.nome}. É o mesmo caminho que gera orçamento e relatório.` };
  const html = `<!doctype html><meta charset="utf-8"><style>
    @page{size:A4;margin:0} body{margin:0;font:16px/1.6 "Segoe UI",system-ui,sans-serif;color:#15161B}
    .capa{padding:56px 60px;background:#0A0A0B;color:#fff}
    .capa h1{margin:0;font-size:40px;letter-spacing:-.5px}
    .capa p{margin:10px 0 0;color:#E10600;letter-spacing:.3em;text-transform:uppercase;font-size:12px}
    .corpo{padding:44px 60px}
    h2{font-size:14px;letter-spacing:.18em;text-transform:uppercase;color:#6B6B76;margin:28px 0 10px}
    ul{margin:0;padding-left:20px} li{margin:6px 0}
    .pe{margin-top:40px;padding-top:16px;border-top:2px solid #E10600;color:#6B6B76;font-size:12px}
  </style><div class="capa"><h1>${esc(d.nome)}</h1><p>Ficha da casa · MyBots</p></div>
  <div class="corpo"><h2>Quem é</h2><p>${esc(limpo(d.resumo, 600))}</p>
  <h2>As regras da casa</h2><ul>${String(d.regras ?? "").split("\n").filter((l) => l.trim()).slice(0, 10).map((l) => `<li>${esc(l.replace(/^[-•]\s*/, ""))}</li>`).join("")}</ul>
  <div class="pe">Gerado automaticamente a partir de ${esc(d.site || "informações da empresa")} · ${new Date().toLocaleDateString("pt-BR")}</div></div>`;
  const saida = path.join(os.tmpdir(), `mybots-demo-${Date.now()}.pdf`);
  try {
    await rodarPython(["--html", "-", "--saida", saida, "--modelo", "nenhum", "--titulo", d.nome], html);
    const data = await readFile(saida);
    await unlink(saida).catch(() => {});
    const f = salvar(`${slug(d.nome)}-apresentacao.pdf`, "application/pdf", data);
    return { ...base, url: f.url, nome: f.name };
  } catch (e) {
    return { ...base, erro: `O PDF não saiu (${(e as Error).message}). Normalmente é o Python ou o Chrome que não foram encontrados.` };
  }
}

/** 3. Vídeo curto a partir da imagem recém-criada: zoom lento e o nome da empresa. */
async function peçaVideo(d: Dados, imagem: PecaDemo | undefined, salvar: Salvar): Promise<PecaDemo> {
  const base: PecaDemo = { tipo: "video", titulo: "Um vídeo de 5 segundos", texto: "Feito a partir da imagem acima, sem nuvem nenhuma: é o mesmo caminho dos Reels." };
  if (!imagem?.url) return { ...base, erro: "Sem a imagem, não dá para montar o vídeo." };
  const entrada = path.join(os.tmpdir(), `mybots-demo-${Date.now()}.jpg`);
  const saida = entrada.replace(/\.jpg$/, ".mp4");
  try {
    const { writeFile } = await import("node:fs/promises");
    const img = await pollinationsImage(`brand photograph for "${d.nome}": ${limpo(d.resumo, 120)}, cinematic`, "16:9");
    if (!img) throw new Error("o provedor de imagem não respondeu");
    await writeFile(entrada, img.data);
    await rodar("ffmpeg", ["-y", "-loop", "1", "-i", entrada, "-t", "5",
      "-vf", "scale=1280:-2,zoompan=z='min(zoom+0.0012,1.18)':d=125:s=1280x720,format=yuv420p",
      "-r", "25", "-c:v", "libx264", "-preset", "veryfast", saida]);
    const data = await readFile(saida);
    await Promise.all([unlink(entrada).catch(() => {}), unlink(saida).catch(() => {})]);
    const f = salvar(`${slug(d.nome)}-demo.mp4`, "video/mp4", data);
    return { ...base, url: f.url, nome: f.name };
  } catch (e) {
    return { ...base, erro: `O vídeo não saiu (${(e as Error).message}). Em geral é o ffmpeg ausente do PATH.` };
  }
}

/** 4. O link do site com a foto que ele mesmo publica (og:image). */
async function peçaLink(d: Dados): Promise<PecaDemo> {
  const base: PecaDemo = { tipo: "link", titulo: "Um link, lido de verdade", texto: "Abri o seu site e trouxe o título, a descrição e a imagem que ele publica." };
  const url = (d.site ?? "").trim();
  if (!url) return { ...base, erro: "A empresa não informou o site." };
  const alvo = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const r = await fetch(alvo, { headers: { "user-agent": "Mozilla/5.0 (MyBots)" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
    const html = await r.text();
    const meta = (p: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)`, "i"))?.[1]
      ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, "i"))?.[1];
    const titulo = meta("og:title") ?? html.match(/<title[^>]*>([^<]+)/i)?.[1] ?? d.nome;
    const desc = meta("og:description") ?? meta("description") ?? "";
    let foto = meta("og:image") ?? "";
    if (foto && !/^https?:/i.test(foto)) foto = new URL(foto, alvo).toString();
    return { ...base, url: alvo, nome: limpo(titulo, 120), texto: `${base.texto}${desc ? ` — "${limpo(desc, 160)}"` : ""}`, erro: undefined, ...(foto ? { foto } as any : {}) };
  } catch (e) {
    return { ...base, erro: `Não consegui abrir o site (${(e as Error).message}).` };
  }
}

export async function pecaDaDemo(passo: string, d: Dados, salvar: Salvar, imagem?: PecaDemo): Promise<PecaDemo> {
  switch (passo) {
    case "imagem": return peçaImagem(d, salvar);
    case "pdf": return peçaPdf(d, salvar);
    case "video": return peçaVideo(d, imagem, salvar);
    case "link": return peçaLink(d);
    default: return { tipo: "erro", titulo: "Passo desconhecido", texto: "", erro: `Não existe o passo "${passo}".` };
  }
}

function esc(s: string) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }
function slug(s: string) { return String(s ?? "empresa").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "empresa"; }

function rodar(cmd: string, args: string[], entrada?: string): Promise<void> {
  return new Promise((ok, erro) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let saida = "";
    p.stderr.on("data", (d) => { saida += String(d); });
    p.on("error", (e) => erro(e));
    p.on("close", (c) => (c === 0 ? ok() : erro(new Error(saida.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 200) || `codigo ${c}`))));
    if (entrada !== undefined) { p.stdin.write(entrada); p.stdin.end(); }
  });
}

async function rodarPython(args: string[], entrada: string) {
  const script = path.join(raizDoProjeto(), "scripts", "documento.py");
  const tentativas = [process.env.MYBOTS_PYTHON, "python", "py", "python3"].filter(Boolean) as string[];
  const falhas: string[] = [];
  let real: Error | null = null;   // erro DO script, que vale mais que "não achei o exe"
  for (const exe of tentativas) {
    try { await rodar(exe, [script, ...args], entrada); return; }
    catch (e) {
      const err = e as Error & { code?: string };
      falhas.push(exe + ": " + (err.code === "ENOENT" ? "não está no PATH" : err.message));
      if (err.code !== "ENOENT") real = err;   // achou o Python, o que quebrou foi o script
    }
  }
  // Guardar só o último erro dizia "spawn python3 ENOENT" mesmo quando o problema era
  // outro — manda consertar o que não está quebrado. Agora a mensagem diz o que houve
  // com CADA tentativa, e o erro do script ganha do "não encontrei".
  if (real) throw real;
  throw new Error("nenhum Python encontrado pelo Hub (" + falhas.join("; ") + "). Defina MYBOTS_PYTHON no .env com o caminho completo do python.exe.");
}
