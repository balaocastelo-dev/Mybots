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
import { htmlDoRecap, montarApresentacao, pdfDeHtml, type FichaApresentacao } from "./folha.js";

export type PecaDemo = { tipo: string; titulo: string; texto: string; url?: string; nome?: string; erro?: string };
export type Dados = FichaApresentacao;
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

/** 2. Folha de apresentação: capa, dados da casa, equipe e contatos. 1 a 3 páginas. */
async function peçaPdf(d: Dados, salvar: Salvar, imagem?: PecaDemo): Promise<PecaDemo> {
  const base: PecaDemo = { tipo: "pdf", titulo: "Um PDF, com a sua cara", texto: `Esta é a folha de apresentação da ${d.nome}: a casa e o time. É o mesmo caminho que gera orçamento e relatório.` };
  const arte = d.arte || (imagem?.url && (/^(data:|https?:|\/|[A-Za-z]:\\)/.test(imagem.url) || imagem.url.includes(":\\")) ? imagem.url : undefined);
  try {
    const html = await montarApresentacao({ ...d, arte });
    const data = await pdfDeHtml(html);
    const f = salvar(`${slug(d.nome)}-apresentacao.pdf`, "application/pdf", data);
    return { ...base, url: f.url, nome: f.name };
  } catch (e) {
    return { ...base, erro: `O PDF não saiu (${(e as Error).message}). Normalmente é o Python ou o Chrome que não foram encontrados.` };
  }
}

/** Recibo do que foi ligado no fim do roteiro. Não é a folha da empresa. */
async function peçaRecap(d: Dados, salvar: Salvar): Promise<PecaDemo> {
  const base: PecaDemo = { tipo: "pdf", titulo: "O resumo", texto: `O que ficou ligado na ${d.nome}.` };
  const linhas = String(d.regras ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  try {
    const data = await pdfDeHtml(htmlDoRecap(d.nome, linhas));
    const f = salvar(`${slug(d.nome)}-resumo.pdf`, "application/pdf", data);
    return { ...base, url: f.url, nome: f.name };
  } catch (e) {
    return { ...base, erro: `O PDF não saiu (${(e as Error).message}).` };
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
    case "pdf": return peçaPdf(d, salvar, imagem);
    case "recap": return peçaRecap(d, salvar);
    case "video": return peçaVideo(d, imagem, salvar);
    case "link": return peçaLink(d);
    default: return { tipo: "erro", titulo: "Passo desconhecido", texto: "", erro: `Não existe o passo "${passo}".` };
  }
}

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

