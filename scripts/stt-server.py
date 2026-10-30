"""
Whisper local para o MyBots — transcreve áudio na GPU do chefe, de graça.
Expõe /v1/audio/transcriptions no mesmo formato da OpenAI, que é o que o Hub espera.

Uso:  python scripts/stt-server.py                      (porta 8178, modelo large-v3)
      python scripts/stt-server.py --model medium       (menos VRAM, um pouco menos exato)
      python scripts/stt-server.py --port 9000 --device cpu

Modelos: tiny, base, small, medium, large-v3.
Numa RTX 4090 o "large-v3" é o certo: ocupa ~3 GB de VRAM, roda em tempo real e erra
MUITO menos em português do que o "small" — principalmente em nome próprio e palavra de loja.
Se não couber na placa, ele cai sozinho para medium e depois small.
"""
import argparse
import inspect
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=int(os.environ.get("MYBOTS_STT_PORT", 8178)))
parser.add_argument("--host", default="127.0.0.1")
parser.add_argument("--model", default=os.environ.get("MYBOTS_STT_MODEL", "large-v3"))
parser.add_argument("--device", default=os.environ.get("MYBOTS_STT_DEVICE", "auto"))
parser.add_argument("--language", default=os.environ.get("MYBOTS_STT_LANG", "pt"))
args = parser.parse_args()

try:
    from faster_whisper import WhisperModel
except ImportError:
    print("Falta o faster-whisper. Instale com:  pip install faster-whisper", flush=True)
    sys.exit(1)

try:
    from fastapi import FastAPI, File, Form, UploadFile
    from fastapi.responses import JSONResponse
    import uvicorn
except ImportError:
    print("Falta fastapi/uvicorn. Instale com:  pip install fastapi uvicorn python-multipart", flush=True)
    sys.exit(1)


# ---------------------------------------------------------------------------
# O vocabulário da casa.
#
# O Whisper decide entre palavras parecidas pelo que é comum no idioma. "Kevinho",
# "o ERP", "sua empresa" e "Conta1" não são comuns em lugar nenhum, então
# ele troca por outra coisa — é exatamente o "falo uma coisa e escreve outra".
# Dar a lista de antemão (initial_prompt/hotwords) resolve a maior parte disso.
# Para acrescentar termos sem mexer no código: MYBOTS_STT_VOCAB="palavra, outra palavra"
# ---------------------------------------------------------------------------
# O prompt é tratado pelo modelo como "o que foi dito antes", então vale mais uma frase
# natural com os nomes da casa do que uma lista enorme de marcas que ele já conhece.
# Só entram aqui as palavras que ele NÃO tem como adivinhar sozinho.
VOCABULARIO = (
    "Conversa no sua empresa, loja do Conta2, na Avenida Conta1, em Campinas. "
    "Falam o chefe, o Gerente Geral, o João Videomaker, o Kevinho, o Carlos e o Médico do Sistema. "
    "Assunto: MyBots, o ERP, estoque, orçamento, nota fiscal, garantia, assistência técnica, "
    "notebook, placa de vídeo, placa-mãe, SSD NVMe, pendrive, nobreak, roteador, "
    "Reels do Instagram, WhatsApp, CRM e o site exemplo.com.br."
)

# O Whisper só tem 448 posições de contexto, e metade é reservada para a transcrição.
# Prompt maior que isso não melhora nada: derruba a chamada inteira
# ("No position encodings are defined for positions >= 448"). ~700 caracteres é o teto seguro.
TETO_PROMPT = 700


def vocabulario(extra_do_pedido: str | None = None) -> str:
    extra = os.environ.get("MYBOTS_STT_VOCAB", "").strip()
    partes = [p for p in (extra_do_pedido or "", VOCABULARIO, extra) if p and p.strip()]
    dica = " ".join(x.strip() for x in partes)
    return dica[:TETO_PROMPT]


# Frases que o Whisper inventa quando ouve silêncio, respiração ou ruído de loja.
# Não são transcrição: são o modelo preenchendo o vazio com o que viu em legenda de vídeo.
ALUCINACOES = [
    "legendas pela comunidade", "amara.org", "legendado por", "legendas por",
    "obrigado por assistir", "obrigada por assistir", "inscreva-se no canal",
    "até o próximo vídeo", "ate o proximo video", "tchau tchau",
    "subscribe", "thanks for watching",
]


def ehLixo(texto: str, no_speech: float, logprob: float) -> bool:
    """Descarta o que não é fala de verdade antes de devolver ao Hub."""
    t = (texto or "").strip()
    if len(t) < 2:
        return True
    baixo = t.lower()
    if any(a in baixo for a in ALUCINACOES):
        return True
    if not re.search(r"[a-zà-ú]{2,}", baixo):      # só pontuação, número solto, "..."
        return True
    # o modelo sabe quando chutou: probabilidade alta de "não tem fala" + confiança baixa
    if no_speech > 0.75 and logprob < -0.9:
        return True
    # uma palavra só repetida ("sim sim sim sim") é laço de alucinação
    palavras = re.findall(r"[a-zà-ú]+", baixo)
    if len(palavras) >= 6 and len(set(palavras)) <= 2:
        return True
    return False


def vramLivreGb() -> float:
    """Quanto a placa tem livre agora. 0 quando não dá para saber."""
    try:
        import torch
        if not torch.cuda.is_available():
            return 0.0
        livre, _total = torch.cuda.mem_get_info()
        return livre / (1024 ** 3)
    except Exception:
        return 0.0


def escolheDevice():
    if args.device != "auto":
        return args.device, ("float16" if args.device == "cuda" else "int8")
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


device, compute = escolheDevice()

# A reserva da casa: 4 GB de VRAM sempre livres para o sistema. O large-v3 pede ~3 GB;
# se não couber com folga, desce de modelo sozinho em vez de derrubar o que estiver rodando.
MENORES = {"large-v3": "medium", "large-v2": "medium", "large": "medium", "medium": "small"}
PRECISA_GB = {"large-v3": 3.2, "large-v2": 3.2, "large": 3.2, "medium": 1.8, "small": 1.0, "base": 0.6, "tiny": 0.4}
# O "small" é o chão: é o que a casa já rodava. Descer abaixo dele para "caber" seria
# trocar um problema de VRAM por um problema de transcrição — exatamente o que estamos consertando.
CHAO = "small"
RESERVA_GB = float(os.environ.get("MYBOTS_VRAM_RESERVA_GB", "4"))

modelo = args.model
if device == "cuda":
    livre = vramLivreGb()
    while livre and modelo in MENORES and livre - PRECISA_GB.get(modelo, 1.0) < RESERVA_GB:
        menor = MENORES[modelo]
        print(f"[stt] só {livre:.1f} GB livres na placa — '{modelo}' invadiria a reserva de {RESERVA_GB:.0f} GB; usando '{menor}'", flush=True)
        modelo = menor
    if modelo == CHAO and livre and livre - PRECISA_GB[CHAO] < RESERVA_GB:
        print(f"[stt] aviso: a placa está quase cheia ({livre:.1f} GB livres). Rodando no '{CHAO}' mesmo assim — é o mínimo para transcrever direito. Liberar VRAM (ComfyUI, llama-server, Ollama) deixa subir para large-v3.", flush=True)

model = None
while model is None:
    print(f"[stt] carregando modelo '{modelo}' em {device} ({compute})…", flush=True)
    t0 = time.time()
    try:
        model = WhisperModel(modelo, device=device, compute_type=compute)
    except Exception as e:
        if modelo in MENORES:
            print(f"[stt] '{modelo}' não carregou ({e}); tentando '{MENORES[modelo]}'", flush=True)
            modelo = MENORES[modelo]
            continue
        raise
print(f"[stt] pronto em {time.time() - t0:.1f}s — ouvindo em http://{args.host}:{args.port}", flush=True)

# Só passamos adiante o que esta versão do faster-whisper entende: assim a mesma
# instalação funciona antes e depois de um "pip install -U".
ACEITA = set(inspect.signature(model.transcribe).parameters)

FFMPEG = shutil.which("ffmpeg")


def paraWav(origem: str) -> str | None:
    """
    Converte para WAV 16 kHz mono. Serve para dois casos:
      • o navegador manda um webm cortado no meio, que o decodificador recusa inteiro
        (era o 'Invalid data found when processing input' no log);
      • garante a taxa que o Whisper quer, sem ele ter que adivinhar.
    """
    if not FFMPEG:
        return None
    destino = origem + ".wav"
    r = subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-err_detect", "ignore_err",
         "-fflags", "+discardcorrupt", "-i", origem, "-vn", "-ac", "1", "-ar", "16000",
         "-f", "wav", "-y", destino],
        capture_output=True,
    )
    if r.returncode == 0 and os.path.exists(destino) and os.path.getsize(destino) > 2000:
        return destino
    if os.path.exists(destino):
        try:
            os.unlink(destino)
        except OSError:
            pass
    return None


app = FastAPI(title="MyBots STT")


@app.get("/health")
def health():
    return {"ok": True, "model": modelo, "device": device, "pedido": args.model}


@app.post("/v1/audio/transcriptions")
@app.post("/audio/transcriptions")
async def transcrever(
    file: UploadFile = File(...),
    model_name: str = Form("whisper-1", alias="model"),
    language: str = Form(None),
    prompt: str = Form(None),
):
    dados = await file.read()
    if not dados:
        return JSONResponse({"error": "arquivo vazio"}, status_code=400)
    sufixo = os.path.splitext(file.filename or "audio.ogg")[1] or ".ogg"
    caminho = None
    convertido = None
    try:
        with tempfile.NamedTemporaryFile(suffix=sufixo, delete=False) as f:
            f.write(dados)
            caminho = f.name

        convertido = paraWav(caminho)                      # pode falhar: aí vai o original mesmo
        entrada = convertido or caminho

        dica = vocabulario(prompt)

        opcoes = dict(
            language=(language or args.language or None),
            initial_prompt=dica,
            beam_size=5,
            # Cada frase chega solta; deixar o modelo se condicionar no que transcreveu
            # antes é o que produz o laço de repetição e o "arrasto" de assunto.
            condition_on_previous_text=False,
            # Se a primeira passada sair com confiança baixa, tenta de novo mais solto
            # em vez de entregar o chute.
            temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
            compression_ratio_threshold=2.4,
            log_prob_threshold=-1.0,
            no_speech_threshold=0.6,
            # Corta silêncio, mas com folga nas pontas: sem isso ele come a primeira
            # e a última sílaba, que é metade do "escreveu outra coisa".
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=400, speech_pad_ms=400),
        )
        opcoes = {k: v for k, v in opcoes.items() if k in ACEITA}

        t = time.time()
        segmentos, info = model.transcribe(entrada, **opcoes)
        segmentos = list(segmentos)
        texto = "".join(s.text for s in segmentos).strip()

        no_speech = max((getattr(s, "no_speech_prob", 0.0) or 0.0) for s in segmentos) if segmentos else 1.0
        logprob = min((getattr(s, "avg_logprob", 0.0) or 0.0) for s in segmentos) if segmentos else -5.0

        if ehLixo(texto, no_speech, logprob):
            print(f"[stt] {len(dados)/1024:.0f} KB · descartado (sem fala: {no_speech:.2f}, confiança {logprob:.2f}) · \"{texto[:40]}\"", flush=True)
            return {"text": ""}

        print(f"[stt] {len(dados)/1024:.0f} KB · {info.duration:.1f}s de áudio · {time.time()-t:.1f}s · conf {logprob:.2f} · \"{texto[:60]}\"", flush=True)
        return {"text": texto}
    except Exception as e:
        print(f"[stt] erro: {e}", flush=True)
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        for p in (caminho, convertido):
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass


if __name__ == "__main__":
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
