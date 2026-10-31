// Conversa por telefone: a ponte AudioSocket do Asterisk <-> ouvido, cabeça e voz do bot.
//
// O Asterisk abre um TCP aqui e despeja o áudio da linha em tempo real. A gente escuta,
// decide quando a pessoa parou de falar, transcreve, pensa, e devolve a voz pela mesma
// conexão. Formato da linha: PCM 16 bits, 8 kHz, mono — quadros de 20 ms (320 bytes).
//
// POR QUE GROQ E NÃO O WHISPER DA 4090: no telefone o orçamento inteiro é ~1 segundo
// entre a pessoa calar e o bot falar. O Whisper local ocupa a placa e some quando o PC
// é usado para outra coisa; o da Groq responde em frações de segundo e não disputa VRAM.
import net from "node:net";
import fs from "node:fs";
import { spawn } from "node:child_process";

const env = Object.fromEntries(fs.readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));

const PORTA = Number(process.env.URA_PORTA || 8090);
const HUB = "http://127.0.0.1:8790";
const QUADRO = 320;              // 20 ms de áudio
const SILENCIO_FIM = Number(process.env.URA_SILENCIO || 320);        // ms de silêncio que encerram a fala da pessoa (era 700: 280 ms de ar morto a cada turno)
const FALA_MIN = 300;            // ms mínimos para não disparar com tosse
const LIMIAR = 600;              // energia RMS que conta como voz
const LIMIAR_CORTE = 2200;       // para INTERROMPER o bot exige voz bem mais forte que o eco
const CORTE_QUADROS = 6;         // 120 ms seguidos: ruído isolado não cala o bot
const CARENCIA_CORTE = 1200;     // ms iniciais em que o bot não aceita ser interrompido

const PERSONA = `Você é o atendente de inteligência artificial do Balão da Informática, loja de informática em Campinas.
Está FALANDO AO TELEFONE: responda em português do Brasil, em UMA frase curta sempre que possível, no máximo duas, como gente conversando.
Nunca use listas, markdown, emoji ou qualquer coisa que não se fale em voz alta. Se não souber, diga que vai verificar.
Na primeira fala, identifique-se como atendimento por robô — a pessoa tem o direito de saber.
NUNCA INVENTE. Se não souber preço, prazo, estoque ou o motivo de algo, diga que não sabe e que vai verificar com uma pessoa.
Não explique o funcionamento interno do sistema nem chute causas técnicas: isso é conversa com cliente, e palpite vira promessa.`;

/** Energia média do quadro. Barato e suficiente para saber se tem voz. */
function energia(buf) {
  let soma = 0;
  for (let i = 0; i + 1 < buf.length; i += 2) { const v = buf.readInt16LE(i); soma += v * v; }
  return Math.sqrt(soma / (buf.length / 2));
}

/** Empacota um quadro no protocolo do AudioSocket: tipo, tamanho, carga. */
function quadro(tipo, carga = Buffer.alloc(0)) {
  const c = Buffer.alloc(3);
  c.writeUInt8(tipo, 0);
  c.writeUInt16BE(carga.length, 1);
  return Buffer.concat([c, carga]);
}

/** PCM cru -> WAV, só para a transcrição aceitar. */
function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24); h.writeUInt32LE(16000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function transcrever(pcm) {
  const fd = new FormData();
  fd.append("file", new Blob([wav(pcm)], { type: "audio/wav" }), "fala.wav");
  fd.append("model", "whisper-large-v3-turbo");
  fd.append("language", "pt");
  const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }, body: fd,
  });
  if (!r.ok) throw new Error(`transcrição ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return ((await r.json()).text || "").trim();
}

async function pensar(historico) {
  // GROQ, NÃO Z.AI. O glm-4.5-flash responde bem, mas sai do Brasil, atravessa o
  // Pacífico e volta — num chat isso não se nota, no telefone é meio segundo de
  // silêncio constrangedor. A Groq devolve em frações disso. Se ela falhar, cai
  // no Z.ai, porque conversa interrompida é pior que conversa lenta.
  const corpo = (model, max_tokens) => JSON.stringify({ model, max_tokens, temperature: 0.6,
    messages: [{ role: "system", content: PERSONA }, ...historico.slice(-8)] });
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: corpo(env.URA_MODELO || "qwen/qwen3.8-27b", 110), signal: AbortSignal.timeout(8000),
    });
    if (r.ok) return ((await r.json()).choices?.[0]?.message?.content || "").trim();
  } catch {}
  const r2 = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${env.ZAI_API_KEY}`, "Content-Type": "application/json" },
    body: corpo("glm-4.5-flash", 110),
  });
  if (!r2.ok) throw new Error(`modelo ${r2.status}`);
  return ((await r2.json()).choices?.[0]?.message?.content || "").trim();
}

/**
 * Voz do Hub -> PCM 8 kHz, EM FLUXO.
 *
 * Antes isto esperava o mp3 inteiro, convertia inteiro e só então começava a tocar:
 * 1,4 s de silêncio antes da primeira sílaba. Agora o áudio do TTS entra no ffmpeg
 * enquanto ainda está chegando, e cada pedaço convertido já vai para a fila que a
 * linha consome. A pessoa ouve a primeira sílaba assim que ela existe.
 */
async function falarEmFluxo(texto, entregar) {
  const r = await fetch(`${HUB}/api/tts`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: texto, voice: env.URA_VOZ || "pt-BR-ThalitaMultilingualNeural", vel: Number(env.URA_VEL || 1.05) }),
  });
  if (!r.ok || !r.body) throw new Error(`tts ${r.status}`);
  const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0",
    "-ar", "8000", "-ac", "1", "-f", "s16le", "pipe:1"], { windowsHide: true });
  let resto = Buffer.alloc(0);
  p.stdout.on("data", (d) => {
    resto = Buffer.concat([resto, Buffer.from(d)]);
    while (resto.length >= QUADRO) { entregar(resto.subarray(0, QUADRO)); resto = resto.subarray(QUADRO); }
  });
  p.stdin.on("error", () => {});
  const fim = new Promise((ok) => p.on("close", () => {
    if (resto.length) entregar(Buffer.concat([resto, Buffer.alloc(QUADRO - resto.length)]));
    ok();
  }));
  for await (const pedaco of r.body) p.stdin.write(Buffer.from(pedaco));
  p.stdin.end();
  await fim;
}

net.createServer((sock) => {
  let buf = Buffer.alloc(0);
  let fala = [];            // quadros com voz
  let msSilencio = 0, msFala = 0;
  let ocupado = false;      // pensando ou falando
  let cortar = false;       // a pessoa interrompeu
  let falandoDesde = 0;     // quando o bot começou a falar
  let vozSeguida = 0;       // quadros seguidos de voz forte durante a fala dele
  const historico = [];
  console.log("[ura] chamada conectada");

  // SILÊNCIO ATIVO. Enquanto o bot pensa ou sintetiza, a linha não pode ficar sem
  // receber nada: o Asterisk trata canal mudo como canal morto e desliga — foi isso
  // que derrubou a chamada assim que ele atendia, porque gerar a saudação leva ~3 s.
  // Mandar silêncio de verdade (quadros zerados) mantém a linha viva e não se ouve.
  const MUDO = Buffer.alloc(QUADRO);
  const fila = [];          // quadros de voz esperando a vez
  // UM RELÓGIO SÓ para tudo que sai: se há voz na fila, manda voz; se não há, manda
  // silêncio. Some o buraco entre frases, some o engasgo, e a linha nunca fica muda.
  const batida = setInterval(() => {
    if (sock.destroyed) return;
    sock.write(quadro(0x10, fila.length ? fila.shift() : MUDO));
  }, 20);
  sock.on("close", () => clearInterval(batida));

  /** Devolve a voz em quadros de 20 ms, parando na hora se a pessoa falar por cima. */
  async function dizer(texto) {
    cortar = false;
    falandoDesde = Date.now();
    vozSeguida = 0;
    const tPedido = Date.now();
    let primeira = 0;
    await falarEmFluxo(texto, (q) => {
      if (cortar) return;
      if (!primeira) { primeira = Date.now() - tPedido; console.log(`[ura] primeira sílaba em ${primeira}ms`); }
      fila.push(q);
    });
    while (fila.length && !cortar && !sock.destroyed) await new Promise((r) => setTimeout(r, 20));
    if (cortar) fila.length = 0;
  }

  async function turno(pcm) {
    ocupado = true;
    const t0 = Date.now();
    try {
      const dito = await transcrever(pcm);
      const tOuvir = Date.now();
      if (!dito) { ocupado = false; return; }
      historico.push({ role: "user", content: dito });
      const resposta = await pensar(historico);
      const tPensar = Date.now();
      historico.push({ role: "assistant", content: resposta });
      console.log("[pessoa]", dito, "| [bot]", resposta, `| ouvir=${tOuvir - t0}ms pensar=${tPensar - tOuvir}ms`);
      await dizer(resposta);
    } catch (e) {
      console.error("[ura] erro no turno:", e.message);
      try { await dizer("Desculpe, tive um problema aqui. Pode repetir?"); } catch {}
    }
    ocupado = false;
  }

  sock.on("data", async (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 3) {
      const tipo = buf.readUInt8(0), tam = buf.readUInt16BE(1);
      if (buf.length < 3 + tam) break;
      const carga = buf.subarray(3, 3 + tam);
      buf = buf.subarray(3 + tam);
      if (tipo === 0x00) { sock.end(); return; }
      if (tipo !== 0x10) continue;

      const temVoz = energia(carga) > LIMIAR;
      if (ocupado) {
        // ELE ESTAVA SE CORTANDO SOZINHO. Na linha telefônica parte da voz do próprio
        // bot volta como eco, passava do limiar e era lida como "a pessoa falou" — ele
        // começava a falar e travava na hora. Para interromper agora exige três coisas
        // juntas: voz bem mais forte que o eco, 120 ms seguidos dela, e não estar nos
        // primeiros instantes da fala. Ruído e eco não passam; você falando, passa.
        // INTERRUPÇÃO DESLIGADA POR PADRÃO. Nesta linha o eco do próprio bot volta
        // mais forte que o limite, e o resultado foi ele se cortando a cada frase —
        // chamada de pé e nenhum som. Distinguir eco de voz humana de verdade exige
        // cancelamento de eco (comparar o que saiu com o que voltou), não um limiar.
        // Até isso existir, falar inteiro vale mais que poder interromper.
        // Para testar de novo: URA_INTERROMPER=1 no .env.
        if (env.URA_INTERROMPER === "1" && energia(carga) > LIMIAR_CORTE && Date.now() - falandoDesde > CARENCIA_CORTE) {
          if (++vozSeguida >= CORTE_QUADROS) { cortar = true; console.log("[ura] interrompido pela pessoa"); }
        } else vozSeguida = 0;
        continue;
      }
      if (temVoz) {
        fala.push(carga); msFala += 20; msSilencio = 0;
        // Um turno de 10 s apareceu no log: ruído de fundo segurava o "ainda falando"
        // para sempre. Passou de 7 s, fecha e manda — melhor cortar do que travar.
        if (msFala >= 7000) { const pcm = Buffer.concat(fala); fala = []; msFala = 0; msSilencio = 0; void turno(pcm); }
      }
      else if (fala.length) {
        msSilencio += 20;
        fala.push(carga);
        if (msSilencio >= SILENCIO_FIM) {
          const pcm = msFala >= FALA_MIN ? Buffer.concat(fala) : null;
          fala = []; msFala = 0; msSilencio = 0;
          if (pcm) void turno(pcm);
        }
      }
    }
  });

  sock.on("error", (e) => console.error("[ura] socket:", e.message));
  sock.on("close", () => console.log("[ura] chamada encerrada"));

  // A casa fala primeiro: quem atende um telefone espera ouvir alguém.
  ocupado = true;
  dizer("Oi! Aqui é o atendimento por inteligência artificial do Balão da Informática. Pode falar, eu estou ouvindo.")
    .catch((e) => console.error("[ura] saudação:", e.message))
    .finally(() => { ocupado = false; });
}).listen(PORTA, "0.0.0.0", () => console.log(`[ura] AudioSocket ouvindo na porta ${PORTA}`));
