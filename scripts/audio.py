# -*- coding: utf-8 -*-
"""
Audio para os bots do MyBots, com ffmpeg (que ja esta instalado neste PC).

Faz o que o o chefe faria no Audacity, mas por linha de comando e em segundos:
cortar, normalizar, limpar ruido, converter, juntar, tirar silencio, extrair
audio de video e transcrever (pelo Whisper local da 4090).

Uso (sempre imprime uma linha de JSON):
  python audio.py info        --entrada a.mp3
  python audio.py cortar      --entrada a.mp3 --saida b.mp3 --de 00:00:10 [--ate 00:01:30 | --duracao 20]
  python audio.py normalizar  --entrada a.mp3 --saida b.mp3 [--alvo -16]
  python audio.py limpar      --entrada a.mp3 --saida b.mp3 [--forca 20]
  python audio.py sem-silencio --entrada a.mp3 --saida b.mp3
  python audio.py volume      --entrada a.mp3 --saida b.mp3 --db 3
  python audio.py converter   --entrada a.wav --saida b.mp3
  python audio.py juntar      --saida b.mp3 --partes "a.mp3,b.mp3,c.mp3"
  python audio.py do-video    --entrada v.mp4 --saida a.mp3
  python audio.py transcrever --entrada a.mp3
"""
import argparse, json, os, re, shutil, subprocess, sys, urllib.request
from pathlib import Path

STT = os.environ.get("MYBOTS_STT_URL", "http://127.0.0.1:8178/v1").rstrip("/")


def saida(**kw):
    print(json.dumps(kw, ensure_ascii=False, default=str))
    sys.exit(0 if kw.get("ok") else 1)


def exe(nome):
    p = shutil.which(nome)
    if p:
        return p
    # o ffmpeg do o chefe nao esta no PATH de todo processo
    for base in (r"C:\Users\user\ffmpeg", os.environ.get("FFMPEG_DIR", "")):
        if not base:
            continue
        for raiz, _, arqs in os.walk(base):
            if f"{nome}.exe" in arqs:
                return os.path.join(raiz, f"{nome}.exe")
    return None


FFMPEG, FFPROBE = exe("ffmpeg"), exe("ffprobe")


def roda(args, timeout=900):
    if not FFMPEG:
        saida(ok=False, erro="nao achei o ffmpeg neste PC")
    r = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args],
                       capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        saida(ok=False, erro=f"ffmpeg falhou: {(r.stderr or '').strip()[-500:]}")
    return r


def confere(p, rotulo="entrada"):
    if not p:
        saida(ok=False, erro=f"informe --{rotulo}")
    a = Path(p)
    if not a.exists():
        saida(ok=False, erro=f"arquivo nao existe: {p}")
    return str(a.resolve())


def prepara_saida(p):
    if not p:
        saida(ok=False, erro="informe --saida")
    a = Path(p).resolve()
    a.parent.mkdir(parents=True, exist_ok=True)
    return str(a)


def sonda(caminho):
    if not FFPROBE:
        return {}
    r = subprocess.run([FFPROBE, "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", caminho],
                       capture_output=True, text=True, timeout=120, encoding="utf-8", errors="replace")
    try:
        return json.loads(r.stdout or "{}")
    except Exception:
        return {}


def resumo(caminho):
    d = sonda(caminho)
    fmt = d.get("format", {})
    som = next((s for s in d.get("streams", []) if s.get("codec_type") == "audio"), {})
    seg = float(fmt.get("duration") or 0)
    return {
        "arquivo": caminho,
        "segundos": round(seg, 2),
        "duracao": f"{int(seg // 60)}:{int(seg % 60):02d}",
        "formato": fmt.get("format_name"),
        "codec": som.get("codec_name"),
        "canais": som.get("channels"),
        "taxa_hz": int(som["sample_rate"]) if som.get("sample_rate") else None,
        "mb": round(int(fmt.get("size") or 0) / 1048576, 2),
    }


def transcreve(caminho):
    url = STT + ("/audio/transcriptions" if not STT.endswith("/audio/transcriptions") else "")
    limite = "----mybots"
    with open(caminho, "rb") as f:
        dados = f.read()
    corpo = b""
    for campo, valor in (("model", "whisper-1"), ("language", "pt"), ("response_format", "json")):
        corpo += f"--{limite}\r\nContent-Disposition: form-data; name=\"{campo}\"\r\n\r\n{valor}\r\n".encode()
    corpo += f"--{limite}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{Path(caminho).name}\"\r\n".encode()
    corpo += b"Content-Type: application/octet-stream\r\n\r\n" + dados + b"\r\n"
    corpo += f"--{limite}--\r\n".encode()
    req = urllib.request.Request(url, data=corpo, headers={"Content-Type": f"multipart/form-data; boundary={limite}"})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.loads(r.read().decode("utf-8")).get("text", "").strip()
    except Exception as e:
        saida(ok=False, erro=f"o servidor de transcricao nao respondeu ({STT}): {type(e).__name__}: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("acao")
    ap.add_argument("--entrada", default="")
    ap.add_argument("--saida", default="")
    ap.add_argument("--de", default="")
    ap.add_argument("--ate", default="")
    ap.add_argument("--duracao", default="")
    ap.add_argument("--alvo", default="-16")
    ap.add_argument("--forca", default="20")
    ap.add_argument("--db", default="0")
    ap.add_argument("--partes", default="")
    a = ap.parse_args()

    if not FFMPEG:
        saida(ok=False, erro="nao achei o ffmpeg neste PC")

    if a.acao == "info":
        ent = confere(a.entrada)
        d = resumo(ent)
        if not d["segundos"]:
            saida(ok=False, erro="nao consegui ler esse arquivo como audio/video")
        saida(ok=True, **d)

    if a.acao == "transcrever":
        ent = confere(a.entrada)
        texto = transcreve(ent)
        saida(ok=True, arquivo=ent, caracteres=len(texto), texto=texto)

    if a.acao == "juntar":
        if not a.partes:
            saida(ok=False, erro="informe --partes com os arquivos separados por virgula")
        itens = [confere(p.strip(), "partes") for p in a.partes.split(",") if p.strip()]
        if len(itens) < 2:
            saida(ok=False, erro="informe pelo menos 2 arquivos em --partes")
        sai = prepara_saida(a.saida)
        lista = Path(sai).with_suffix(".lista.txt")
        lista.write_text("".join(f"file '{p}'\n" for p in itens), encoding="utf-8")
        try:
            # recodifica para nao depender de formatos iguais
            roda(["-f", "concat", "-safe", "0", "-i", str(lista), "-c:a", "libmp3lame" if sai.lower().endswith(".mp3") else "aac", "-b:a", "192k", sai])
        finally:
            lista.unlink(missing_ok=True)
        saida(ok=True, juntou=len(itens), **resumo(sai))

    ent = confere(a.entrada)
    sai = prepara_saida(a.saida)
    antes = resumo(ent)

    if a.acao == "cortar":
        if not a.de and not a.ate and not a.duracao:
            saida(ok=False, erro="informe --de e/ou --ate (ou --duracao)")
        args = ["-i", ent]
        if a.de:
            args = ["-ss", a.de, "-i", ent]
        if a.ate:
            args += ["-to", a.ate]
        elif a.duracao:
            args += ["-t", str(a.duracao)]
        roda([*args, "-c:a", "libmp3lame" if sai.lower().endswith(".mp3") else "copy", sai])
        saida(ok=True, acao="cortar", antes=antes["duracao"], **resumo(sai))

    if a.acao == "normalizar":
        # loudnorm em dois passes seria melhor, mas um passe ja resolve para fala
        roda(["-i", ent, "-af", f"loudnorm=I={a.alvo}:TP=-1.5:LRA=11", "-ar", "44100", sai])
        saida(ok=True, acao="normalizar", alvo_lufs=a.alvo, **resumo(sai),
              nota="volume padronizado; bom para juntar gravacoes de fontes diferentes")

    if a.acao == "limpar":
        # tira chiado/ruido de fundo e corta frequencias que so carregam ruido
        roda(["-i", ent, "-af", f"highpass=f=80,afftdn=nr={a.forca}:nf=-25,lowpass=f=12000,loudnorm=I=-16:TP=-1.5", sai])
        saida(ok=True, acao="limpar", forca=a.forca, **resumo(sai),
              nota="ruido de fundo reduzido e volume normalizado")

    if a.acao == "sem-silencio":
        roda(["-i", ent, "-af",
              "silenceremove=start_periods=1:start_duration=0.1:start_threshold=-45dB:"
              "stop_periods=-1:stop_duration=0.7:stop_threshold=-45dB", sai])
        d = resumo(sai)
        saida(ok=True, acao="sem-silencio", antes=antes["duracao"], **d,
              cortou_segundos=round(antes["segundos"] - d["segundos"], 2))

    if a.acao == "volume":
        try:
            db = float(a.db)
        except ValueError:
            saida(ok=False, erro="--db precisa ser um numero (ex.: 3 ou -4)")
        roda(["-i", ent, "-af", f"volume={db}dB", sai])
        saida(ok=True, acao="volume", db=db, **resumo(sai))

    if a.acao == "converter":
        roda(["-i", ent, "-vn", "-b:a", "192k", sai])
        saida(ok=True, acao="converter", de=antes["codec"], **resumo(sai))

    if a.acao == "do-video":
        roda(["-i", ent, "-vn", "-b:a", "192k", sai])
        saida(ok=True, acao="do-video", video=antes["duracao"], **resumo(sai))

    saida(ok=False, erro=f"acao desconhecida: {a.acao}")


if __name__ == "__main__":
    main()
