// Voz na interface.
//  - Fala (TTS): pelo Hub (/api/tts — Edge/Piper/OpenAI) ou, se o Hub não tiver, pela voz do navegador.
//  - Escuta (STT): pelo Hub (/api/stt — whisper) gravando com MediaRecorder + detector de silêncio,
//    ou pelo reconhecimento do navegador (Chrome/Edge). Nos dois casos, quando você para de falar a frase é enviada sozinha.

import { cleanForSpeech, ehRuido, pareceEco, toSpeech } from "@mybots/shared";

export type VoiceCaps = { stt: boolean; tts: boolean; ttsEngine: string; sttEngine: string };

const q = () => location.search; // mantém ?k=senha

// ---------------- MICROFONE ----------------
// Numa máquina com webcam, headset e placa de som, o navegador usa a "entrada padrão
// do sistema" — que quase nunca é o microfone em que a pessoa está falando. Daí o
// áudio chegar longe, baixo e cheio de sala, e a transcrição sair diferente do dito.
const CHAVE_MIC = "mybots.microfone";

export function microfoneEscolhido(): string {
  try { return localStorage.getItem(CHAVE_MIC) ?? ""; } catch { return ""; }
}
export function escolherMicrofone(deviceId: string): void {
  try { deviceId ? localStorage.setItem(CHAVE_MIC, deviceId) : localStorage.removeItem(CHAVE_MIC); } catch { /* navegador sem storage */ }
}
/** Lista as entradas de áudio. Os nomes só aparecem depois de o microfone ter sido liberado uma vez. */
export async function microfones(): Promise<{ id: string; nome: string }[]> {
  try {
    const todos = await navigator.mediaDevices.enumerateDevices();
    return todos.filter((d) => d.kind === "audioinput" && d.deviceId)
      .map((d, i) => ({ id: d.deviceId, nome: d.label || `Microfone ${i + 1}` }));
  } catch { return []; }
}

/**
 * O que se pede ao navegador na hora de abrir o microfone.
 *  - cancelamento de eco FICA: sem ele o alto-falante volta pelo microfone e o bot se ouve.
 *  - ganho automático e supressão de ruído SAEM: os dois deformam a onda (o ganho bombeia
 *    o chiado no silêncio, a supressão apaga consoante fraca) e o Whisper acerta mais no
 *    áudio cru do que no "tratado" pelo navegador.
 *  - um canal, 16 kHz: é o formato que o Whisper usa por dentro; mandar pronto evita
 *    uma reamostragem a mais pelo caminho.
 */
function restricoesDeAudio(): MediaStreamConstraints {
  const id = microfoneEscolhido();
  const a: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: 16000,
  };
  if (id) a.deviceId = { ideal: id };
  return { audio: a };
}

// ---------------- FALA ----------------

let current: HTMLAudioElement | null = null;
/** sobe a cada stopSpeaking/novo speak: pedaço de geração velha não toca */
let geracao = 0;
/** busca de áudio em andamento, para o "parar" cancelar também o que está vindo */
let emVoo: AbortController | null = null;
let speaking = false;
const speakListeners = new Set<(on: boolean) => void>();
export const onSpeaking = (l: (on: boolean) => void) => { speakListeners.add(l); return () => { speakListeners.delete(l); }; };
const setSpeaking = (on: boolean) => { speaking = on; for (const l of speakListeners) l(on); };
export const isSpeaking = () => speaking;

/**
 * Fala uma resposta do bot. Por padrão lê só o "lead" (1–2 frases) quando a mensagem é longa
 * ou estruturada (roteiro, bullets, tabela) e avisa que os detalhes estão no chat.
 * `full = true` lê o texto inteiro (limpo) — botão 🔊 na bolha.
 */
export async function speak(text: string, botId: string, caps: VoiceCaps, preferredVoice?: string, full = false): Promise<void> {
  stopSpeaking();
  const sp = toSpeech(text);
  const clean = full ? sp.full : sp.lead;
  if (!clean) return;
  if (caps.tts && (await falarPeloHub(clean.slice(0, 2500), botId))) return;
  await speakBrowser(clean.slice(0, 1500), botId, preferredVoice);
}

export function stopSpeaking() {
  viva?.cancelar();          // a fala da chamada (frase a frase) também morre aqui
  geracao++;                 // o que já foi pedido não toca mais
  emVoo?.abort();            // e o que está vindo do Hub nem chega
  emVoo = null;
  if (current) { current.pause(); current.src = ""; try { current.load(); } catch { /* já descartado */ } current = null; }
  // O Chrome IGNORA o cancel quando a fala está pausada: cancelar, soltar a pausa e cancelar
  // de novo é o que de fato cala. Sem isso, "parar" durante uma pausa não parava nada.
  if (typeof speechSynthesis !== "undefined") {
    try { speechSynthesis.cancel(); speechSynthesis.resume(); speechSynthesis.cancel(); } catch { /* navegador sem voz */ }
  }
  setSpeaking(false);
}

/**
 * Quebra a fala em pedaços. O primeiro é curto de propósito: é ele que decide quanto
 * tempo passa entre o bot terminar de escrever e o primeiro som sair. Os seguintes são
 * maiores (menos idas ao Hub) e chegam enquanto o anterior ainda está tocando.
 */
export function emPedacos(texto: string, primeiro = 90, depois = 320): string[] {
  const frases = (texto.replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]*/g) ?? [texto])
    .map((x) => x.trim())
    .filter(Boolean);
  if (!frases.length) return [];
  const out: string[] = [];
  let buf = frases[0];
  for (let i = 1; i < frases.length; i++) {
    const limite = out.length ? depois : primeiro;
    if ((buf + " " + frases[i]).length > limite) { out.push(buf); buf = frases[i]; }
    else buf += " " + frases[i];
  }
  out.push(buf);
  return out;
}

/** Toca um pedaço e espera acabar. Não mexe no estado "falando": quem cuida é o laço. */
/** Velocidade de fala da casa. O Hub ja entrega o audio acelerado no proprio SSML
 *  (voz acelerada sem ficar fina); aqui so compensamos quando o motor nao aceita
 *  velocidade, como o piper. Reaplicamos no loadedmetadata porque o algoritmo de
 *  carga do elemento de audio devolve o playbackRate para o default -- era por isso
 *  que o 1.4 escrito direto no construtor nao valia nada. */
export const VEL_ALVO = 1.4;
let velDoServidor = VEL_ALVO;
function aplicarVel(audio: HTMLAudioElement) {
  const r = Math.max(1, Math.min(4, VEL_ALVO / (velDoServidor || 1)));
  audio.defaultPlaybackRate = r;
  audio.playbackRate = r;
  audio.addEventListener("loadedmetadata", () => { audio.playbackRate = r; }, { once: true });
}

function tocar(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    aplicarVel(audio);
    current = audio;
    const fim = () => { URL.revokeObjectURL(url); if (current === audio) current = null; resolve(); };
    audio.onended = fim;
    audio.onerror = fim;
    audio.play().catch(fim);
  });
}

/**
 * Fala pelo Hub, pedaço a pedaço, buscando o próximo enquanto o atual toca.
 * Devolve false só quando nada saiu (aí quem chamou cai para a voz do navegador).
 */
async function falarPeloHub(texto: string, botId: string): Promise<boolean> {
  const pedacos = emPedacos(texto);
  if (!pedacos.length) return true;
  const minha = ++geracao;
  const ac = new AbortController();
  emVoo = ac;
  const pedir = (p: string) =>
    fetch(`/api/tts${q()}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: p, botId }), signal: ac.signal })
      .then((r) => { if (!r.ok) return null; const v = Number(r.headers.get("x-fala-vel")); if (v > 0) velDoServidor = v; return r.blob(); })
      .catch(() => null);

  let proximo = pedir(pedacos[0]);
  let tocouAlgo = false;
  try {
    for (let i = 0; i < pedacos.length; i++) {
      const blob = await proximo;
      if (minha !== geracao) return true;                                  // mandaram parar
      if (i + 1 < pedacos.length) proximo = pedir(pedacos[i + 1]);         // busca enquanto este toca
      if (!blob) return tocouAlgo;                                         // Hub falhou no meio
      if (!tocouAlgo) setSpeaking(true);
      tocouAlgo = true;
      await tocar(blob);
      if (minha !== geracao) return true;
    }
  } finally {
    if (minha === geracao) { emVoo = null; if (tocouAlgo) setSpeaking(false); }
  }
  return tocouAlgo;
}

let voicesCache: SpeechSynthesisVoice[] = [];
function voices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === "undefined") return [];
  if (!voicesCache.length) voicesCache = speechSynthesis.getVoices();
  return voicesCache;
}
if (typeof speechSynthesis !== "undefined") speechSynthesis.onvoiceschanged = () => { voicesCache = speechSynthesis.getVoices(); };

function pickBrowserVoice(botId: string, preferred?: string): SpeechSynthesisVoice | undefined {
  const all = voices();
  if (!all.length) return undefined;
  if (preferred) { const v = all.find((v) => v.name.toLowerCase().includes(preferred.toLowerCase())); if (v) return v; }
  const pt = all.filter((v) => v.lang.toLowerCase().startsWith("pt"));
  const pool = pt.length ? pt : all;
  let h = 0; for (const c of botId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

function speakBrowser(text: string, botId: string, preferred?: string): Promise<void> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-BR";
    const v = pickBrowserVoice(botId, preferred);
    if (v) u.voice = v;
    u.rate = VEL_ALVO;
    u.onend = () => { setSpeaking(false); resolve(); };
    u.onerror = () => { setSpeaking(false); resolve(); };
    setSpeaking(true);
    speechSynthesis.speak(u);
  });
}

// ---------------- ESCUTA ----------------

export function speechSupported(caps?: VoiceCaps) {
  if (caps?.stt && typeof navigator !== "undefined" && navigator.mediaDevices) return true;
  return typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export type ListenHandlers = {
  onPartial: (text: string) => void;      // texto parcial (só no modo navegador)
  onFinal: (text: string) => void;        // frase pronta → enviar
  onEnd: () => void;                      // parou de escutar (por qualquer motivo)
  onLevel?: (level: number) => void;      // 0..1, para animar o microfone
};

const SILENCE_MS = 1300;   // quanto de silêncio depois da fala fecha a frase
const NO_SPEECH_MS = 9000; // sem fala nenhuma → desliga

/** Escuta uma frase e devolve uma função para parar. Fecha sozinha quando você para de falar. */
export function listenOnce(caps: VoiceCaps, h: ListenHandlers): () => void {
  if (caps.stt && typeof navigator.mediaDevices?.getUserMedia === "function") return listenWithRecorder(h);
  return listenWithBrowser(h);
}

function listenWithBrowser(h: ListenHandlers): () => void {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) { h.onEnd(); return () => {}; }
  const rec = new Ctor();
  rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = true;
  let finalText = "", interim = "", silence: any = null, stopped = false, gotSpeech = false;
  const noSpeech = setTimeout(() => { if (!gotSpeech) stop(); }, NO_SPEECH_MS);
  const finish = () => { clearTimeout(silence); clearTimeout(noSpeech); const t = (finalText + " " + interim).trim(); if (t) h.onFinal(t); };
  const stop = () => { if (stopped) return; stopped = true; try { rec.stop(); } catch {} };
  rec.onresult = (ev: any) => {
    gotSpeech = true;
    interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript + " "; else interim += r[0].transcript;
    }
    h.onPartial((finalText + interim).trim());
    clearTimeout(silence);
    silence = setTimeout(stop, SILENCE_MS);
  };
  rec.onerror = () => stop();
  rec.onend = () => { finish(); h.onEnd(); };
  try { rec.start(); } catch { h.onEnd(); }
  return stop;
}

function listenWithRecorder(h: ListenHandlers): () => void {
  let stopped = false;
  let stopFn = () => { stopped = true; };
  (async () => {
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia(restricoesDeAudio()); }
    catch { h.onEnd(); return; }
    if (stopped) { stream.getTracks().forEach((t) => t.stop()); h.onEnd(); return; }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let spoke = false, lastVoice = Date.now(), started = Date.now(), timer: any = null;
    const THRESH = 0.03;
    const tick = () => {
      if (stopped) return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      h.onLevel?.(Math.min(1, rms * 8));
      const now = Date.now();
      if (rms > THRESH) { spoke = true; lastVoice = now; }
      if (spoke && now - lastVoice > SILENCE_MS) return stopFn();
      if (!spoke && now - started > NO_SPEECH_MS) return stopFn();
      timer = setTimeout(tick, 60);
    };
    stopFn = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      try { rec.stop(); } catch {}
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      if (spoke && chunks.length) {
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        try {
          const res = await fetch(`/api/stt${q()}`, { method: "POST", headers: { "content-type": blob.type || "audio/webm" }, body: blob });
          if (res.ok) { const j = await res.json(); if (j.text?.trim()) h.onFinal(j.text.trim()); }
        } catch { /* ignora */ }
      }
      h.onEnd();
    };
    rec.start(250);
    tick();
  })();
  return () => stopFn();
}

// ===========================================================================
// CHAMADA DE VOZ — telefone de verdade
//
// Duas peças, e as duas rodam ao mesmo tempo (é isso que faz parecer telefone):
//   • criarFala()      — vai falando enquanto o bot ainda escreve, frase por frase.
//   • escutaContinua() — o microfone NUNCA fecha; quando o chefe fala, o bot cala.
// ===========================================================================


export type FalaViva = {
  /** frase pronta vinda do Hub (speech.delta) */
  alimentar(texto: string): void;
  /** a resposta acabou: fala o que sobrou e encerra */
  fim(): void;
  /** silêncio imediato e esquece o que não foi falado */
  cancelar(): void;
  /** cala na hora, guardando o lugar (o chefe começou a falar) */
  pausar(): void;
  /** volta de onde parou (era só um ruído) */
  retomar(): void;
  /** o que está sendo falado agora — serve de filtro de eco para o microfone */
  dito(): string;
};

/** a fala viva desta chamada; stopSpeaking() também mata ela */
let viva: FalaViva | null = null;

export function criarFala(botId: string, caps: VoiceCaps, preferredVoice?: string): FalaViva {
  type Item = { texto: string; promessa?: Promise<Blob | null> };
  const fila: Item[] = [];
  const ac = new AbortController();
  let rodando = false, morta = false, acabou = false, pausado = false;
  let ditoAgora = "";

  const pedir = (p: string) =>
    fetch(`/api/tts${q()}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: p, botId }), signal: ac.signal })
      .then((r) => { if (!r.ok) return null; const v = Number(r.headers.get("x-fala-vel")); if (v > 0) velDoServidor = v; return r.blob(); })
      .catch(() => null);

  /** mantém os dois próximos pedaços já sendo gerados enquanto o atual toca */
  const abastecer = () => { if (caps.tts) for (const it of fila.slice(0, 2)) if (!it.promessa) it.promessa = pedir(it.texto); };

  const tocarBlob = (blob: Blob) => new Promise<void>((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    aplicarVel(audio);
    current = audio;
    const fim = () => { URL.revokeObjectURL(url); if (current === audio) current = null; resolve(); };
    audio.onended = fim;
    audio.onerror = fim;
    if (!pausado) audio.play().catch(fim);
  });

  const laco = async () => {
    if (rodando || morta) return;
    rodando = true;
    setSpeaking(true);
    try {
      while (fila.length && !morta) {
        const it = fila.shift()!;
        ditoAgora = it.texto;
        abastecer();
        const blob = caps.tts ? await (it.promessa ?? pedir(it.texto)) : null;
        if (morta) return;
        if (blob) await tocarBlob(blob);
        else await speakBrowser(it.texto, botId, preferredVoice);   // Hub sem TTS: voz do navegador
        if (morta) return;
      }
    } finally {
      rodando = false;
      if (!morta && !fila.length) { ditoAgora = ""; setSpeaking(false); }
      if (acabou && !fila.length && viva === api) viva = null;
    }
  };

  const api: FalaViva = {
    alimentar(texto) {
      if (morta) return;
      const limpo = cleanForSpeech(texto);
      if (!limpo) return;
      fila.push({ texto: limpo });
      abastecer();
      void laco();
    },
    fim() { acabou = true; if (!rodando && !fila.length) { setSpeaking(false); if (viva === api) viva = null; } },
    cancelar() {
      morta = true;
      fila.length = 0;
      ditoAgora = "";
      ac.abort();
      if (current) { current.pause(); current = null; }
      if (typeof speechSynthesis !== "undefined") { speechSynthesis.cancel(); }
      setSpeaking(false);
      if (viva === api) viva = null;
    },
    pausar() {
      if (morta || pausado) return;
      pausado = true;
      current?.pause();
      if (typeof speechSynthesis !== "undefined" && speechSynthesis.speaking) speechSynthesis.pause();
    },
    retomar() {
      if (morta || !pausado) return;
      pausado = false;
      current?.play().catch(() => {});
      if (typeof speechSynthesis !== "undefined" && speechSynthesis.paused) speechSynthesis.resume();
    },
    dito: () => ditoAgora,
  };
  viva?.cancelar();
  viva = api;
  return api;
}

// ---------------- ESCUTA CONTÍNUA (o microfone não fecha) ----------------

export type EscutaViva = { parar(): void; mudo(on: boolean): void };
export type EscutaHandlers = {
  /** frase fechada do chefe (já descartado eco e ruído) */
  onFinal: (texto: string) => void;
  /** ele começou a falar: cale o bot AGORA */
  onVoz?: () => void;
  /** o que parecia fala não era nada (eco, tosse): pode voltar a falar */
  onFalsoAlarme?: () => void;
  onLevel?: (x: number) => void;
  onEstado?: (ouvindo: boolean) => void;
  /** o bot está falando agora? (sobe a régua do microfone, para o alto-falante não se ouvir) */
  botFalando?: () => boolean;
  /** o que o bot está dizendo neste instante (filtro de eco) */
  ecoDoBot?: () => string;
};

const VOZ_BASE = 0.030;        // régua normal
const VOZ_COM_BOT_FALANDO = 0.075;  // régua alta: o alto-falante volta pelo microfone
const CONFIRMA_MS = 140;       // tempo acima da régua para valer como fala
const CONFIRMA_COM_BOT_MS = 300;
const FIM_DA_FRASE_MS = 1000;  // silêncio que fecha a frase; curto demais corta quem pensa no meio
const GIRO_MS = 3000;          // de quanto em quanto tempo o gravador recomeça, no silêncio
const QUIETO_PARA_GIRAR_MS = 700; // ...e só se não houver som nenhum há esse tempo (ver novoGravador)
const PRE_SOM = 0.5;           // fração da régua que já conta como "tem som" e trava o giro
const FALA_MINIMA_MS = 350;    // mais curto que isso é tosse, clique, porta batendo
const FATIA_MS = 200;          // de quanto em quanto tempo o gravador entrega um pedaço

/** Microfone aberto o tempo todo. Cada frase vira texto sozinha; a chamada nunca para de ouvir. */
export function escutaContinua(caps: VoiceCaps, h: EscutaHandlers): EscutaViva {
  if (caps.stt && typeof navigator.mediaDevices?.getUserMedia === "function") return escutaComGravador(caps, h);
  return escutaComNavegador(h);
}

function escutaComGravador(_caps: VoiceCaps, h: EscutaHandlers): EscutaViva {
  type Trecho = { rec: MediaRecorder; pedacos: Blob[] };
  let parado = false, mudo = false;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let atual: Trecho | null = null;
  let emFala = false, acimaDesde = 0, abaixoDesde = 0, falaDesde = 0;
  let ultimoGiro = Date.now(), ultimoSom = 0;
  let timer: any = null;
  let mime = "";

  /**
   * Troca o gravador, e opcionalmente faz algo com o que o anterior gravou.
   *
   * O defeito que isto conserta: antes todos os gravadores empurravam os pedaços para a
   * MESMA lista. O último pedaço de um gravador chega DEPOIS do stop() — ou seja, depois
   * de a lista ter sido trocada — e caía no começo do arquivo seguinte, antes do cabeçalho.
   * O arquivo nascia inválido: era o "Invalid data found when processing input" do stt.log,
   * e nos casos em que não quebrava de vez, o decodificador descartava o começo em silêncio
   * e o Whisper transcrevia uma frase sem a primeira palavra. Agora cada gravador tem a
   * lista dele, fechada no próprio closure.
   */
  const novoGravador = (aoFechar?: (t: Trecho) => void) => {
    if (!stream || parado) return;
    const velho = atual;
    const pedacos: Blob[] = [];
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = (e) => { if (e.data.size) pedacos.push(e.data); };
    rec.start(FATIA_MS);
    atual = { rec, pedacos };
    // o novo já está gravando antes de o velho parar: não há buraco entre os dois
    if (velho) {
      velho.rec.onstop = () => aoFechar?.(velho);   // o onstop vem depois do último pedaço
      try { velho.rec.stop(); } catch { aoFechar?.(velho); }
    }
  };

  const enviar = async (t: Trecho) => {
    if (parado || !t.pedacos.length) return;
    const blob = new Blob(t.pedacos, { type: t.rec.mimeType || "audio/webm" });
    if (blob.size < 2000) return h.onFalsoAlarme?.();   // nem meio segundo de som: não vale transcrever
    try {
      const res = await fetch(`/api/stt${q()}`, { method: "POST", headers: { "content-type": blob.type || "audio/webm" }, body: blob });
      const texto = res.ok ? String((await res.json()).text ?? "").trim() : "";
      if (!texto || ehRuido(texto) || pareceEco(texto, h.ecoDoBot?.() ?? "")) return h.onFalsoAlarme?.();
      h.onFinal(texto);
    } catch { h.onFalsoAlarme?.(); }
  };

  /** Fecha a frase: o gravador atual vira arquivo e um novo começa na mesma hora. */
  const fecharFrase = (curtaDemais = false) => {
    novoGravador(curtaDemais ? () => h.onFalsoAlarme?.() : (t) => void enviar(t));
  };

  (async () => {
    try { stream = await navigator.mediaDevices.getUserMedia(restricoesDeAudio()); }
    catch { h.onEstado?.(false); return; }
    if (parado) { stream.getTracks().forEach((t) => t.stop()); return; }
    mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    novoGravador();
    h.onEstado?.(true);

    const tick = () => {
      if (parado) return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = mudo ? 0 : Math.sqrt(sum / buf.length);
      h.onLevel?.(Math.min(1, rms * 8));
      const agora = Date.now();
      const botFala = h.botFalando?.() ?? false;
      const regua = botFala ? VOZ_COM_BOT_FALANDO : VOZ_BASE;
      const confirma = botFala ? CONFIRMA_COM_BOT_MS : CONFIRMA_MS;

      if (rms > regua * PRE_SOM) ultimoSom = agora;   // um sopro abaixo da régua já trava o giro

      if (rms > regua) {
        abaixoDesde = 0;
        if (!acimaDesde) acimaDesde = agora;
        if (!emFala && agora - acimaDesde >= confirma) { emFala = true; falaDesde = acimaDesde; h.onVoz?.(); }
      } else {
        acimaDesde = 0;
        if (!abaixoDesde) abaixoDesde = agora;
        if (emFala && agora - abaixoDesde >= FIM_DA_FRASE_MS) {
          emFala = false;
          ultimoGiro = agora;
          fecharFrase(abaixoDesde - falaDesde < FALA_MINIMA_MS);
        } else if (!emFala && agora - ultimoGiro >= GIRO_MS && agora - ultimoSom >= QUIETO_PARA_GIRAR_MS) {
          // O giro existe para o arquivo não crescer sem fim durante o silêncio — mas ele
          // DESCARTA o que foi gravado. Girar no comecinho da fala comia a primeira palavra
          // (a fala só é confirmada depois de CONFIRMA_MS acima da régua, e o giro podia cair
          // bem nesse meio). Por isso agora só gira quando não há som nenhum há um tempo.
          ultimoGiro = agora;
          novoGravador();
        }
      }
      timer = setTimeout(tick, 60);
    };
    tick();
  })();

  return {
    parar() {
      parado = true;
      clearTimeout(timer);
      if (atual) { atual.rec.onstop = null as any; try { atual.rec.stop(); } catch { /* já parado */ } }
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
      h.onEstado?.(false);
    },
    mudo(on) {
      mudo = on;
      stream?.getAudioTracks().forEach((t) => { t.enabled = !on; });
      if (on && emFala) { emFala = false; fecharFrase(); }
    },
  };
}

/** Sem whisper no Hub: reconhecimento do navegador, também sem fechar entre as frases. */
function escutaComNavegador(h: EscutaHandlers): EscutaViva {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) { h.onEstado?.(false); return { parar() {}, mudo() {} }; }
  let parado = false, mudo = false;
  const rec = new Ctor();
  rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = true;
  rec.onspeechstart = () => { if (!mudo) h.onVoz?.(); };
  rec.onresult = (ev: any) => {
    if (mudo) return;
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (!r.isFinal) continue;
      const texto = String(r[0].transcript ?? "").trim();
      if (!texto || ehRuido(texto) || pareceEco(texto, h.ecoDoBot?.() ?? "")) { h.onFalsoAlarme?.(); continue; }
      h.onFinal(texto);
    }
  };
  rec.onerror = () => { /* o onend recomeça */ };
  rec.onend = () => { if (!parado) { try { rec.start(); } catch { /* já rodando */ } } else h.onEstado?.(false); };
  try { rec.start(); h.onEstado?.(true); } catch { h.onEstado?.(false); }
  return {
    parar() { parado = true; try { rec.abort(); } catch { /* já parado */ } },
    mudo(on) { mudo = on; },
  };
}
