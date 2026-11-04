// Vídeo que o modelo não aceita vira quadros (ffmpeg) + áudio transcrito.
// O extrator é injetável para o teste não depender de um arquivo real.
import { execFile } from "node:child_process";
import { instantesDosQuadros } from "@mybots/shared";

export type ExtratorVideo = {
  duracao: (arquivo: string) => Promise<number>;
  quadro: (arquivo: string, segundo: number) => Promise<Buffer | null>;
  audio: (arquivo: string) => Promise<Buffer | null>;
  transcrever?: (audio: Buffer) => Promise<string>;
};

export type ResultadoVideo = {
  duracao: number;
  quadros: Array<{ segundo: number; jpeg: Buffer }>;
  transcricao: string;
  audioExtraido: boolean;
};

export async function pipelineDeVideo(
  arquivo: string,
  extrator: ExtratorVideo,
  opts: { maxQuadros?: number } = {},
): Promise<ResultadoVideo> {
  const duracao = Number(await extrator.duracao(arquivo)) || 0;
  const quadros: Array<{ segundo: number; jpeg: Buffer }> = [];
  for (const segundo of instantesDosQuadros(duracao, opts.maxQuadros ?? 8)) {
    const jpeg = await extrator.quadro(arquivo, segundo);
    if (jpeg?.length) quadros.push({ segundo, jpeg });
  }
  let transcricao = "";
  let audioExtraido = false;
  const audio = await extrator.audio(arquivo);
  if (audio?.length) {
    audioExtraido = true;
    if (extrator.transcrever) {
      transcricao = (await extrator.transcrever(audio)).trim();
    }
  }
  return { duracao, quadros, transcricao, audioExtraido };
}

function run(bin: string, args: string[], timeout = 120_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" }, (e, stdout, stderr) => {
      if (e) return reject(new Error(`${bin}: ${String(stderr ?? "").slice(-300) || e.message}`));
      resolve(stdout as unknown as Buffer);
    });
  });
}

export function extratorFfmpeg(ffmpeg = "ffmpeg", ffprobe = "ffprobe"): ExtratorVideo {
  return {
    async duracao(arquivo) {
      try {
        const out = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", arquivo], 20_000);
        return Number(out.toString().trim()) || 0;
      } catch {
        return 0;
      }
    },
    async quadro(arquivo, segundo) {
      try {
        return await run(ffmpeg, ["-v", "error", "-ss", segundo.toFixed(2), "-i", arquivo, "-frames:v", "1", "-vf", "scale=768:-2", "-q:v", "4", "-f", "image2", "-vcodec", "mjpeg", "pipe:1"], 30_000);
      } catch {
        return null;
      }
    },
    async audio(arquivo) {
      try {
        return await run(ffmpeg, ["-v", "error", "-i", arquivo, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", "-f", "mp3", "pipe:1"], 120_000);
      } catch {
        return null;
      }
    },
  };
}
