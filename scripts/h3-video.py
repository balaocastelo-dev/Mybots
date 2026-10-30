# -*- coding: utf-8 -*-
"""
Gera video com o MiniMax H3 local, no ComfyUI da RTX 4090.
Usado pela ferramenta gerar_video_h3 dos bots do MyBots.

Respeita a reserva da maquina: NUNCA comeca se a VRAM livre, descontando o que
o trabalho vai pedir, invadir os 4 GB reservados para o sistema.

Uso:
  python h3-video.py --prompt "texto" [--imagem foto.jpg] [--segundos 6]
                     [--largura 768] [--altura 1344] [--passos 4] [--seed N]
                     [--prefixo mybots_h3/reel] [--esperar 900]

Imprime JSON numa linha: {"ok":true,"arquivo":"...","segundos":6.0,"seed":N}
"""
import argparse, base64, json, os, re, shutil, subprocess, sys, time, urllib.error, urllib.request

PORTA = int(os.environ.get("H3_PORT", "8189"))
BASE = f"http://127.0.0.1:{PORTA}"
LAUNCHER = os.environ.get("H3_LAUNCHER", r"D:\IA\H3\start8189.ps1")
SAIDA = os.environ.get("H3_OUTPUT", r"D:\IA\H3\output")
RESERVA_VRAM_GB = float(os.environ.get("MYBOTS_RESERVE_VRAM_GB", "4"))
# o H3 em int8 ocupa aprox. isto na 4090; se nao couber, nao comeca
VRAM_DO_TRABALHO_GB = float(os.environ.get("H3_VRAM_GB", "14"))

MODELOS = {
    "unet": "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    "lora": "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors",
    "clip": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    "vae_video": "minimax_h3_video_vae_int8_convrot.safetensors",
    "vae_audio": "minimax_h3_audio_vae_fp32.safetensors",
}


def erro(msg, **extra):
    print(json.dumps({"ok": False, "erro": msg, **extra}, ensure_ascii=False))
    sys.exit(1)


def vram_livre_gb():
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None, None
    try:
        out = subprocess.run([exe, "--query-gpu=memory.free,memory.total", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=20).stdout.strip().splitlines()[0]
        livre, total = [float(x.strip()) / 1024 for x in out.split(",")]
        return round(livre, 1), round(total, 1)
    except Exception:
        return None, None


def no_ar():
    try:
        urllib.request.urlopen(f"{BASE}/system_stats", timeout=5).read()
        return True
    except Exception:
        return False


def sobe_comfy(espera=180):
    if no_ar():
        return True
    if not os.path.exists(LAUNCHER):
        erro(f"ComfyUI nao esta no ar na porta {PORTA} e o lancador nao existe: {LAUNCHER}")
    subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", LAUNCHER],
                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    fim = time.time() + espera
    while time.time() < fim:
        time.sleep(5)
        if no_ar():
            return True
    erro(f"ComfyUI nao subiu em {espera}s (veja D:\\IA\\H3\\comfy8189c.log)")


def manda_imagem(caminho):
    """Sobe a imagem de referencia para o ComfyUI e devolve o nome que ele usa."""
    if not os.path.exists(caminho):
        erro(f"imagem de referencia nao existe: {caminho}")
    nome = os.path.basename(caminho)
    limite = "----h3" + str(int(time.time()))
    with open(caminho, "rb") as f:
        dados = f.read()
    corpo = b""
    corpo += f"--{limite}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{nome}\"\r\n".encode()
    corpo += b"Content-Type: application/octet-stream\r\n\r\n" + dados + b"\r\n"
    corpo += f"--{limite}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n".encode()
    corpo += f"--{limite}--\r\n".encode()
    req = urllib.request.Request(f"{BASE}/upload/image", data=corpo,
                                 headers={"Content-Type": f"multipart/form-data; boundary={limite}"})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        erro(f"falha ao subir a imagem: HTTP {e.code} {e.read().decode()[:400]}")
    return r.get("name", nome)


def grafo(prompt, largura, altura, quadros, passos, seed, prefixo, imagem_nome):
    g = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": MODELOS["unet"], "weight_dtype": "default"}},
        "2": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["1", 0], "lora_name": MODELOS["lora"], "strength_model": 1.0}},
        "3": {"class_type": "CLIPLoader", "inputs": {"clip_name": MODELOS["clip"], "type": "minimax", "device": "default"}},
        "4": {"class_type": "VAELoader", "inputs": {"vae_name": MODELOS["vae_video"]}},
        "5": {"class_type": "VAELoader", "inputs": {"vae_name": MODELOS["vae_audio"]}},
        "6": {"class_type": "MiniMaxH3ImageToVideo", "inputs": {
            "clip": ["3", 0], "vae": ["4", 0], "prompt": prompt,
            "width": largura, "height": altura, "length": quadros}},
        "7": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "8": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
        "9": {"class_type": "BasicScheduler", "inputs": {"model": ["2", 0], "scheduler": "simple", "steps": passos, "denoise": 1.0}},
        "10": {"class_type": "BasicGuider", "inputs": {"model": ["2", 0], "conditioning": ["6", 0]}},
        "11": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["7", 0], "guider": ["10", 0], "sampler": ["8", 0], "sigmas": ["9", 0], "latent_image": ["6", 1]}},
        "12": {"class_type": "VAEDecode", "inputs": {"samples": ["11", 0], "vae": ["4", 0]}},
        "13": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["11", 0], "vae": ["5", 0]}},
        "14": {"class_type": "CreateVideo", "inputs": {"images": ["12", 0], "audio": ["13", 0], "fps": 24.0}},
        "15": {"class_type": "SaveVideo", "inputs": {"video": ["14", 0], "filename_prefix": prefixo, "format": "auto", "codec": "auto"}},
    }
    if imagem_nome:
        # referencia visual: a imagem entra no no do H3 como primeiro quadro
        g["16"] = {"class_type": "LoadImage", "inputs": {"image": imagem_nome}}
        g["6"]["inputs"]["start_image"] = ["16", 0]
    return g


def espera_pronto(prompt_id, limite_s):
    fim = time.time() + limite_s
    ultimo = ""
    while time.time() < fim:
        time.sleep(4)
        try:
            h = json.load(urllib.request.urlopen(f"{BASE}/history/{prompt_id}", timeout=20))
        except Exception as e:
            ultimo = str(e)
            continue
        item = h.get(prompt_id)
        if not item:
            continue
        status = (item.get("status") or {})
        if status.get("status_str") == "error" or status.get("completed") is False and status.get("status_str") == "error":
            msgs = json.dumps(status.get("messages", []), ensure_ascii=False)[:800]
            erro(f"o ComfyUI falhou ao gerar: {msgs}")
        if status.get("completed"):
            return item
    erro(f"o video nao terminou em {limite_s}s (ainda pode estar rodando; veja {SAIDA})", detalhe=ultimo)


def acha_arquivo(item):
    for saidas in (item.get("outputs") or {}).values():
        for chave in ("videos", "gifs", "images", "files"):
            for f in saidas.get(chave, []) or []:
                nome, sub = f.get("filename"), f.get("subfolder") or ""
                if not nome:
                    continue
                p = os.path.join(SAIDA, sub, nome)
                if os.path.exists(p):
                    return p
    # plano B: o mais novo do prefixo
    recentes = []
    for raiz, _, arqs in os.walk(SAIDA):
        for a in arqs:
            if a.lower().endswith((".mp4", ".webm", ".mkv")):
                p = os.path.join(raiz, a)
                recentes.append((os.path.getmtime(p), p))
    if recentes:
        return sorted(recentes)[-1][1]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--imagem", default="")
    ap.add_argument("--segundos", type=float, default=6.0)
    ap.add_argument("--largura", type=int, default=768)
    ap.add_argument("--altura", type=int, default=1344)
    ap.add_argument("--passos", type=int, default=4)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--prefixo", default="mybots_h3/reel")
    ap.add_argument("--esperar", type=int, default=900)
    ap.add_argument("--so-conferir", action="store_true", help="só diz se dá para rodar agora")
    a = ap.parse_args()

    # --- trava da reserva da maquina (4 GB de video para o sistema) ---
    livre, total = vram_livre_gb()
    if livre is not None:
        sobra = round(livre - VRAM_DO_TRABALHO_GB, 1)
        if sobra < RESERVA_VRAM_GB:
            erro(
                f"nao da para gerar video agora: a 4090 tem {livre} GB livres de {total} GB. "
                f"O H3 pede ~{VRAM_DO_TRABALHO_GB} GB e a regra da casa reserva {RESERVA_VRAM_GB} GB "
                f"para o sistema — sobrariam {sobra} GB. Libere a placa (feche o VoiceStudio, "
                f"rode 'ollama stop' nos modelos locais) e peça de novo.",
                vram_livre_gb=livre, vram_total_gb=total, precisa_gb=VRAM_DO_TRABALHO_GB,
            )
    if a.so_conferir:
        print(json.dumps({"ok": True, "pode_rodar": True, "vram_livre_gb": livre, "vram_total_gb": total,
                          "comfy_no_ar": no_ar()}, ensure_ascii=False))
        return

    sobe_comfy()

    quadros = max(24, int(round(a.segundos * 24)))
    seed = a.seed or int.from_bytes(os.urandom(6), "big")
    imagem_nome = manda_imagem(a.imagem) if a.imagem else ""
    g = grafo(a.prompt, a.largura, a.altura, quadros, a.passos, seed, a.prefixo, imagem_nome)

    req = urllib.request.Request(f"{BASE}/prompt", data=json.dumps({"prompt": g}).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        erro(f"o ComfyUI recusou o trabalho: HTTP {e.code} {e.read().decode()[:1200]}")
    pid = r.get("prompt_id")
    if not pid:
        erro(f"resposta estranha do ComfyUI: {json.dumps(r)[:400]}")

    item = espera_pronto(pid, a.esperar)
    arquivo = acha_arquivo(item)
    if not arquivo:
        erro("o trabalho terminou mas nao achei o arquivo de video", prompt_id=pid, saida=SAIDA)

    print(json.dumps({"ok": True, "arquivo": arquivo, "segundos": round(quadros / 24, 1),
                      "largura": a.largura, "altura": a.altura, "passos": a.passos,
                      "seed": seed, "prompt_id": pid,
                      "tamanho_mb": round(os.path.getsize(arquivo) / 1048576, 1)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
