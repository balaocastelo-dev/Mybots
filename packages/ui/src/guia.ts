// A voz que recebe a empresa nos primeiros passos, no idioma que ela escolher.
//
// POR QUE EDGE E NAO A VOZ DO NAVEGADOR: o speechSynthesis do Chrome varia de máquina
// para máquina — às vezes é uma voz robótica, às vezes nem existe no idioma. O Edge
// soa igual em qualquer PC, é gratuito e já está no Hub. Se o Hub não responder,
// caímos na voz do navegador: guia mudo é pior que guia com voz feia.
//
// REGRA: fala uma vez por passo. Repetir a mesma frase a cada render é o jeito mais
// rápido de fazer alguém desligar o som — e quem desliga perde o guia inteiro.

export type Idioma = "pt" | "en" | "es" | "fr";

/** A voz da casa e a MESMA que narra a abertura. Em outro idioma, a nativa dele:
 *  voz brasileira falando ingles soa pior do que trocar de voz. */
function vozDaCasa(): string { const v = vozAtual(); return v.startsWith("pt-") ? VOZ_FRASE : v; }

const VELOCIDADE = 1.4; // instrução arrastada faz a pessoa pular o guia

/** Uma voz limpa e com energia por idioma. Todas do Edge. */
const VOZES: Record<Idioma, string> = {
  pt: "pt-BR-ThalitaNeural",
  en: "en-US-AriaNeural",
  es: "es-ES-ElviraNeural",
  fr: "fr-FR-DeniseNeural",
};

export const IDIOMAS: { id: Idioma; nome: string; bandeira: string; cod: string }[] = [
  { id: "pt", nome: "Português", bandeira: "🇧🇷", cod: "BR" },
  { id: "en", nome: "English", bandeira: "🇺🇸", cod: "EN" },
  { id: "es", nome: "Español", bandeira: "🇪🇸", cod: "ES" },
  { id: "fr", nome: "Français", bandeira: "🇫🇷", cod: "FR" },
];

let idioma: Idioma = "pt";
try { const g = localStorage.getItem("mybots.idioma") as Idioma | null; if (g) idioma = g; } catch { /* ignora */ }

export const idiomaAtual = (): Idioma => idioma;
export function definirIdioma(l: Idioma) {
  idioma = l;
  try { localStorage.setItem("mybots.idioma", l); document.documentElement.lang = l; } catch { /* ignora */ }
}
export const VOZES_PADRAO: { id: string; nome: string }[] = [
  { id: "pt-BR-ThalitaNeural", nome: "Thalita · português" },
  { id: "en-US-AriaNeural", nome: "Aria · English" },
  { id: "es-ES-ElviraNeural", nome: "Elvira · español" },
  { id: "fr-FR-DeniseNeural", nome: "Denise · français" },
];

/** Voz da casa. Sem escolha guardada, segue o idioma. */
export function vozPadrao(): string {
  try {
    const g = localStorage.getItem("mybots.voz");
    if (g && VOZES_PADRAO.some((v) => v.id === g)) return g;
  } catch { /* navegador privado ou teste sem localStorage */ }
  return VOZES[idioma] ?? VOZES.pt;
}

export function definirVozPadrao(id: string) {
  if (!VOZES_PADRAO.some((v) => v.id === id)) return;
  try { localStorage.setItem("mybots.voz", id); } catch { /* ignora */ }
  window.dispatchEvent(new CustomEvent("mybots-voz", { detail: id }));
}

const vozAtual = () => vozPadrao();
const tagDeFala = () => (idioma === "pt" ? "pt-BR" : idioma === "en" ? "en-US" : idioma === "es" ? "es-ES" : "fr-FR");

/** Dito na explosão, quando ainda não há idioma escolhido: por isso vai nos quatro. */
export const ESCOLHA_IDIOMA = "Escolha o seu idioma. Choose your language. Elige tu idioma. Choisissez votre langue.";

const BEM_VINDO: Record<Idioma, string> = {
  pt: "Vamos começar cadastrando a sua empresa. Digite o nome e, se tiver, o site e o Instagram: eu leio tudo e já sugiro as regras da casa. Depois a gente conecta o WhatsApp pelo QR code e a sua conta do Google, e aí o Gerente Geral monta a sua equipe.",
  en: "Let's start by registering your company. Type the name and, if you have them, your website and Instagram: I'll read everything and suggest the house rules. Then we connect WhatsApp through the QR code and your Google account, and the General Manager builds your team.",
  es: "Vamos a empezar registrando tu empresa. Escribe el nombre y, si los tienes, el sitio web y el Instagram: yo leo todo y ya sugiero las reglas de la casa. Después conectamos WhatsApp por el código QR y tu cuenta de Google, y el Gerente General arma tu equipo.",
  fr: "Commençons par enregistrer votre entreprise. Saisissez le nom et, si vous les avez, votre site web et votre Instagram : je lis tout et je propose les règles de la maison. Ensuite nous connectons WhatsApp par le code QR et votre compte Google, et le Directeur Général constitue votre équipe.",
};
export const boasVindas = (): string => BEM_VINDO[idioma] ?? BEM_VINDO.pt;

let tocando: HTMLAudioElement | null = null;
const ditos = new Set<string>();
const prontos = new Map<string, string>();

export function calar() {
  try { if (tocando) { tocando.pause(); tocando.src = ""; } } catch { /* ignora */ }
  tocando = null;
  try { speechSynthesis.cancel(); } catch { /* ignora */ }
}

export function mudo(): boolean {
  try { return localStorage.getItem("mybots.guia.mudo") === "1"; } catch { return false; }
}

export function alternarMudo(): boolean {
  const novo = !mudo();
  try { localStorage.setItem("mybots.guia.mudo", novo ? "1" : "0"); } catch { /* ignora */ }
  if (novo) calar();
  return novo;
}

/** Sintetiza antes da hora e guarda. Não toca nada — sintetizar leva um ou dois
 *  segundos, e guia que começa a falar depois de a tela trocar chega atrasado. */
export async function preparar(texto: string, chave: string) {
  if (prontos.has(chave) || mudo()) return;
  try {
    const r = await fetch("/api/tts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: texto, voice: vozDaCasa(), vel: VELOCIDADE }),
    });
    if (r.ok) prontos.set(chave, URL.createObjectURL(await r.blob()));
  } catch { /* sem adiantamento: falar() sintetiza na hora */ }
}

/** Fala uma vez. `chave` identifica o passo: a mesma chave não repete. */
export async function falar(texto: string, chave?: string) {
  const k = chave ?? texto;
  if (ditos.has(k) || mudo()) return;
  ditos.add(k);
  calar();
  const pronto = prontos.get(k);
  if (pronto) {
    const a = new Audio(pronto);
    // a velocidade ja vem do servidor, no proprio SSML: multiplicar aqui dobrava.
    tocando = a;
    try { await a.play(); return; } catch { /* cai no caminho normal */ }
  }
  try {
    const r = await fetch("/api/tts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: texto, voice: vozDaCasa(), vel: VELOCIDADE }),
    });
    if (!r.ok) throw new Error(String(r.status));
    const a = new Audio(URL.createObjectURL(await r.blob()));
    // a velocidade ja vem do servidor, no proprio SSML: multiplicar aqui dobrava.
    tocando = a;
    await a.play();
  } catch {
    try {
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = tagDeFala(); u.rate = VELOCIDADE;
      speechSynthesis.speak(u);
    } catch { /* sem voz: a tela continua funcionando */ }
  }
}

/* ── O convite das quatro línguas ──────────────────────────────────────────
   Antes era UMA frase com as quatro, dita pela voz brasileira: o inglês e o
   francês saíam com sotaque de robô. Agora são quatro clipes curtos, cada um
   sintetizado com a voz NATIVA daquele idioma, tocados em sequência. É mais
   trabalho e é a diferença entre soar como um produto e soar como um tradutor
   automático — que é a primeira coisa que o cliente ouve da casa. */
const CONVITE: Record<Idioma, string> = {
  pt: "Escolha o seu idioma.",
  en: "Choose your language.",
  es: "Elige tu idioma.",
  fr: "Choisissez votre langue.",
};
const VEL_CONVITE = 1.2; // frase curta a 1,4 sai cortada; aqui vale soar inteira
const clipes = new Map<Idioma, string>();
let ouvinte: ((l: Idioma | null) => void) | null = null;
/** A tela escuta aqui para acender o botao da lingua que esta sendo falada. */
export function aoConvidar(cb: ((l: Idioma | null) => void) | null) { ouvinte = cb; }

/** vel = a cadencia pedida ao servidor. O efeito de sussurro usa 1 e corrige no
 *  playbackRate de proposito (mais lento E mais grave); os demais pedem a sua
 *  cadencia aqui e tocam em 1.0, sem multiplicar nada. */
async function sintetizar(texto: string, voz: string, vel: number = VEL_CONVITE): Promise<string | null> {
  try {
    const r = await fetch("/api/tts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: texto, voice: voz, vel }),
    });
    return r.ok ? URL.createObjectURL(await r.blob()) : null;
  } catch { return null; }
}

/** Adianta os quatro clipes enquanto as partículas ainda estão na tela. */
export async function prepararConvite() {
  if (mudo() || clipes.size) return;
  await Promise.all(IDIOMAS.map(async (i) => {
    const u = await sintetizar(CONVITE[i.id], VOZES[i.id]);
    if (u) clipes.set(i.id, u);
  }));
}

/** Toca as quatro, cada uma na sua voz, uma depois da outra. */
export async function falarConvite() {
  if (ditos.has("convite") || mudo()) return;
  ditos.add("convite");
  calar();
  for (const i of IDIOMAS) {
    const url = clipes.get(i.id) ?? (await sintetizar(CONVITE[i.id], VOZES[i.id]));
    if (!url) continue;
    const a = new Audio(url);
    // velocidade pedida ao servidor; aqui seria multiplicacao em cima de multiplicacao.
    tocando = a;
    try {
      ouvinte?.(i.id);
      await a.play();
      await new Promise<void>((pronto) => { a.onended = () => pronto(); a.onerror = () => pronto(); });
      ouvinte?.(null);
      await new Promise((r) => setTimeout(r, 140)); // respiro entre as línguas
    } catch { /* som bloqueado pelo navegador: a tela continua */ }
  }
}
/* ── Os dois sussurros da abertura ────────────────────────────────────────
   Entram por cima das partículas, em inglês, no espírito da abertura do Need
   for Speed: baixo, lento e grave, como alguém falando perto do microfone.
   COMO SE FAZ SUSSURRO SEM SSML: o Edge não expõe o estilo "whispering" pela
   biblioteca que o Hub usa, então o efeito é construído na reprodução —
   volume baixo, velocidade reduzida (o que também baixa o tom) e um filtro
   que corta os agudos, deixando o ar e tirando o brilho da locução. */
const SUSSURROS: Record<string, { texto: string; voz: string }> = {
  // as duas metades de UMA frase: "esse e o futuro, sendo reescrito por Thiago Herrera"
  futuro: { texto: "This is the future,", voz: "en-US-AriaNeural" },
  // a MESMA voz do primeiro sussurro: os dois momentos sao a mesma presenca
  autor: { texto: "being rewritten by Thiago Herrera.", voz: "en-US-AriaNeural" },
};
const sussurrados = new Map<string, string>();

export async function prepararSussurros() {
  if (mudo() || sussurrados.size) return;
  await Promise.all(Object.entries(SUSSURROS).map(async ([k, s]) => {
    const u = await sintetizar(s.texto, s.voz, 1);
    if (u) sussurrados.set(k, u);
  }));
}

export async function sussurrar(chave: "futuro" | "autor") {
  if (ditos.has("sus-" + chave) || mudo()) return;
  ditos.add("sus-" + chave);
  const s = SUSSURROS[chave];
  const url = sussurrados.get(chave) ?? (await sintetizar(s.texto, s.voz, 1));
  if (!url) return;
  const a = new Audio(url);
  a.playbackRate = 0.82;   // mais lento e mais grave
  a.volume = 0.55;
  try {
    // corta os agudos: a voz perde o brilho de locução e vira ar
    const ctx = new AudioContext();
    const fonte = ctx.createMediaElementSource(a);
    const corte = ctx.createBiquadFilter();
    corte.type = "lowpass"; corte.frequency.value = 2600; corte.Q.value = 0.7;
    const ganho = ctx.createGain(); ganho.gain.value = 0.9;
    fonte.connect(corte); corte.connect(ganho); ganho.connect(ctx.destination);
  } catch { /* sem Web Audio: toca seco, ainda baixo e lento */ }
  try { await a.play(); } catch { /* som bloqueado */ }
}
/* ── As palavras da abertura ────────────────────────────────────────────────
   Uma palavra, um clipe. E assim que o som acompanha as letras nascendo: cada
   palavra e dita no instante em que as particulas dela chegam ao lugar. Frase
   inteira num clipe so NUNCA sincroniza — o Edge devolve o audio pronto, sem
   dizer onde cada palavra comeca, entao o maximo que da e casar o inicio.
   O sussurro continua sendo feito na reproducao: mais devagar (o que tambem
   baixa o tom), volume baixo e os agudos cortados. */
const VOZ_ABERTURA = "pt-BR-AntonioNeural";
export const FRASE_1 = ["isso", "é", "o", "futuro"];
export const FRASE_2 = ["escrito", "por", "Thiago", "Herrera"];
const ditas = new Map<string, string>();
let somCtx: AudioContext | null = null;

export async function prepararPalavras() {
  if (mudo() || ditas.size) return;
  await Promise.all([...FRASE_1, ...FRASE_2].map(async (p) => {
    const u = await sintetizar(p, VOZ_ABERTURA, 1);
    if (u) ditas.set(p, u);
  }));
}

export async function dizerPalavra(p: string) {
  if (mudo()) return;
  const url = ditas.get(p) ?? (await sintetizar(p, VOZ_ABERTURA, 1));
  if (!url) return;
  const a = new Audio(url);
  a.playbackRate = 0.92;
  a.volume = 0.7;
  try {
    somCtx = somCtx ?? new AudioContext();
    if (somCtx.state === "suspended") await somCtx.resume();
    const fonte = somCtx.createMediaElementSource(a);
    const corte = somCtx.createBiquadFilter();
    corte.type = "lowpass"; corte.frequency.value = 3200; corte.Q.value = 0.7;
    fonte.connect(corte); corte.connect(somCtx.destination);
  } catch { /* sem Web Audio: toca seco, ainda baixo e devagar */ }
  try { await a.play(); } catch { /* som bloqueado pelo navegador */ }
}
/* ── A frase da abertura, inteira e medida ─────────────────────────────────
   Palavra sintetizada sozinha NUNCA soa real: sai sem entonacao, cada uma
   comecando do zero, com silencio em volta. Voz natural exige a frase inteira
   num clipe so — e dai o problema vira sincronizar.
   A saida: depois de sintetizar, a gente MEDE a duracao do audio e reparte
   esse tempo entre as palavras, proporcional ao tamanho de cada uma. Nao e
   marcacao exata (o Edge nao diz onde cada palavra comeca), mas e a frase de
   verdade, no ritmo de verdade — e a leitura acompanha. */
const VOZ_FRASE = "pt-BR-FranciscaNeural";
const VEL_FRASE = 0.96;
const frases = new Map<string, HTMLAudioElement>();

/** Sintetiza e devolve quanto tempo ela vai durar na reproducao, em ms. */
export async function prepararFrase(chave: string, texto: string): Promise<number> {
  if (mudo()) return 0;
  const ja = frases.get(chave);
  if (ja) return ja.duration * 1000;
  const url = await sintetizar(texto, VOZ_FRASE, VEL_FRASE);
  if (!url) return 0;
  const a = new Audio(url);
  // velocidade pedida ao servidor (ver sintetizar).
  a.volume = 0.9;
  await new Promise<void>((ok) => {
    if (a.readyState >= 1) return ok();
    a.onloadedmetadata = () => ok();
    a.onerror = () => ok();
    setTimeout(ok, 4000); // audio que nao carrega nao pode travar a abertura
  });
  frases.set(chave, a);
  const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
  return d * 1000;
}

export async function tocarFrase(chave: string) {
  const a = frases.get(chave);
  if (!a || mudo()) return;
  try { a.currentTime = 0; await a.play(); } catch { /* som bloqueado */ }
}