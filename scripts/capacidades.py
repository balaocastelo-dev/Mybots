# -*- coding: utf-8 -*-
"""Confere, de verdade, o que cada ferramenta do robo consegue fazer NESTE PC.

POR QUE EXISTE: o robo so sabia o nome das ferramentas. Quando uma delas
dependia de um programa que nao estava instalado, ele descobria tentando — e
ficava em laco (foi o que aconteceu com o PDF: tentou wkhtmltopdf, pandoc e
libreoffice, nenhum instalado, quatro minutos queimados). Aqui a conferencia e
feita UMA vez, de fora, e vira texto: "isto funciona, isto nao, e o motivo".

SEGREDO NUNCA SAI DAQUI: senha, chave e token sao reportados so como
"configurado: sim/nao". O valor nunca e impresso, nem em pedaco.

Uso:
  python capacidades.py            -> JSON de uma linha (contrato das ferramentas)
  python capacidades.py --texto    -> o catalogo em portugues, pronto pra base
"""
import argparse, json, os, shutil, socket, subprocess, sys, time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "dados"


def carregar_env():
    for nome in (".env", "packages/node/.env"):
        p = RAIZ / nome
        if not p.exists():
            continue
        for linha in p.read_text(encoding="utf-8", errors="replace").splitlines():
            if "=" in linha and not linha.strip().startswith("#"):
                k, _, v = linha.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def porta_viva(host, porta, timeout=0.6):
    try:
        with socket.create_connection((host, porta), timeout=timeout):
            return True
    except OSError:
        return False


def achar(*candidatos):
    for c in candidatos:
        if not c:
            continue
        if os.path.sep in str(c) or ":" in str(c):
            if Path(c).exists():
                return str(c)
        else:
            achado = shutil.which(str(c))
            if achado:
                return achado
    return None


def tem_env(*chaves):
    """So diz SE existe. O valor nunca e lido para fora."""
    return all(bool(os.environ.get(k, "").strip()) for k in chaves)


def json_de(arquivo):
    """Quantos registros o arquivo tem, sem saber o formato dele de antemao.

    A primeira versao chutava os nomes de campo ("itens", "produtos") e devolvia
    ZERO para a agenda — que guarda as listas em "whatsapp", "fixos" e
    "internacionais". Um zero errado aqui vira um robo dizendo ao chefe que a
    agenda esta vazia. Entao agora soma TODA lista que o arquivo tiver.
    """
    try:
        d = json.loads(Path(arquivo).read_text(encoding="utf-8"))
        if isinstance(d, list):
            n = len(d)
        elif isinstance(d, dict):
            n = sum(len(v) for v in d.values() if isinstance(v, list))
        else:
            n = 0
        idade_h = round((time.time() - Path(arquivo).stat().st_mtime) / 3600, 1)
        return n, idade_h
    except Exception:
        return None, None


def nvidia():
    exe = achar("nvidia-smi", r"C:\Windows\System32\nvidia-smi.exe")
    if not exe:
        return None
    try:
        r = subprocess.run([exe, "--query-gpu=name,memory.total,memory.used",
                            "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=12)
        nome, total, usada = [x.strip() for x in r.stdout.strip().splitlines()[0].split(",")]
        return {"placa": nome, "vram_total_gb": round(int(total) / 1024, 1),
                "vram_livre_gb": round((int(total) - int(usada)) / 1024, 1)}
    except Exception:
        return None


def conferir():
    carregar_env()
    c = []

    def add(ferramenta, ok, detalhe, conserto=""):
        c.append({"ferramenta": ferramenta, "funciona": bool(ok), "detalhe": detalhe,
                  **({"conserto": conserto} if conserto and not ok else {})})

    # --- sempre disponiveis (o proprio processo do robo) ---
    for f in ("run_command", "read_file", "write_file", "list_dir", "fetch_url",
              "ask_user", "request_approval", "set_status", "notify_user", "send_file", "screenshot"):
        add(f, True, "nativo do robo, nao depende de nada instalado")

    # --- dependem so do Hub ---
    hub_porta = int(os.environ.get("MYBOTS_HUB_PORT", "8790"))
    hub = porta_viva("127.0.0.1", hub_porta)
    for f in ("search_knowledge", "learn_knowledge", "remember", "recall", "list_bots",
              "ask_bot", "send_to_bot", "schedule", "list_routines", "cancel_routine",
              # o Gerente Geral monta a equipe e alimenta a base da empresa por aqui.
              # Sem estarem nesta lista, ele lia as proprias capacidades e concluia
              # que nao podia criar bot -- mesmo tendo a ferramenta na mao.
              "criar_bot", "anotar_empresa"):
        add(f, hub, f"Hub na porta {hub_porta}: {'no ar' if hub else 'fora do ar'}",
            f"subir o Hub (npm run hub) na porta {hub_porta}")

    # --- os motores: sem chave, nenhum bot pensa ---
    # Esta lista existe para o Gerente Geral guiar o chefe ate as chaves no primeiro
    # contato, em vez de mandar ele se virar. Portal, o que a cota gratis da, e onde
    # pegar. O valor da chave nunca e lido: so se existe ou nao.
    PORTAIS = (
        ("Z.ai (GLM)",        "ZAI_API_KEY",        "https://z.ai/manage-apikey/apikey-list",      "cota gratis diaria; e o padrao da casa"),
        ("Google Gemini",     "GEMINI_API_KEY",     "https://aistudio.google.com/apikey",          "cota gratis diaria generosa"),
        ("Groq",              "GROQ_API_KEY",       "https://console.groq.com/keys",               "muito rapido; cota por minuto apertada"),
        ("Cerebras",          "CEREBRAS_API_KEY",   "https://cloud.cerebras.ai",                   "cota gratis diaria"),
        ("OpenRouter",        "OPENROUTER_API_KEY", "https://openrouter.ai/keys",                  "varios modelos gratis num lugar so"),
        ("Mistral",           "MISTRAL_API_KEY",    "https://console.mistral.ai/api-keys",         "camada gratis"),
        ("Nous Research",     "NOUS_API_KEY",       "https://portal.nousresearch.com",             "pago por credito"),
        ("Anthropic (Claude)","ANTHROPIC_API_KEY",  "https://console.anthropic.com/settings/keys", "pago, o mais caro e o melhor"),
    )
    com_chave = [nome for nome, env, _u, _n in PORTAIS if tem_env(env)]
    for nome, env, url, nota in PORTAIS:
        add(f"motor: {nome}", tem_env(env), f"{nota} - pegar em {url}",
            f"abrir {url} com o chefe, ele faz o login, voce cria a chave e ela vai no painel "
            f"(Configuracoes -> Motor) ou em {env} no .env do Hub")
    add("tem motor para pensar", bool(com_chave),
        ("chaves prontas: " + ", ".join(com_chave)) if com_chave
        else "NENHUMA chave de modelo configurada - nenhum bot consegue pensar; isto vem antes de tudo",
        "pegar ao menos uma chave gratis com o chefe (Z.ai ou Gemini sao as mais faceis)")

    # --- PDF / documento ---
    chrome = achar(r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                   r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                   r"C:\Program Files\Microsoft\Edge\Application\msedge.exe", "chrome", "msedge")
    script_pdf = (RAIZ / "scripts" / "documento.py").exists()
    add("gerar_pdf", bool(chrome and script_pdf),
        f"motor: {Path(chrome).name if chrome else 'nenhum'} · papel timbrado do Balao pronto"
        if chrome and script_pdf else "falta o Chrome/Edge ou o scripts/documento.py",
        "instalar o Google Chrome")

    # --- audio ---
    ff = achar(str(Path(r"C:\Users\user\ffmpeg") / "bin" / "ffmpeg.exe"), "ffmpeg")
    stt = porta_viva("127.0.0.1", 8178)
    add("audio", bool(ff),
        f"ffmpeg: {'ok' if ff else 'nao achei'} · transcrever (Whisper local 8178): "
        f"{'no ar' if stt else 'fora do ar — as outras acoes funcionam igual'}",
        "instalar o ffmpeg em C:\\Users\\user\\ffmpeg")

    # --- navegador ---
    nav = (RAIZ / "scripts" / "navegador.cjs").exists()
    node = achar("node")
    add("navegador", bool(nav and node),
        f"script: {'ok' if nav else 'faltando'} · node: {'ok' if node else 'faltando'}",
        "conferir scripts/navegador.cjs e o Node")

    # --- dados da casa ---
    n_ag, idade_ag = json_de(DADOS / "agenda.json")
    add("agenda", n_ag is not None,
        f"{n_ag} contatos, arquivo de {idade_ag}h atras" if n_ag is not None else "dados/agenda.json nao existe",
        "rodar scripts/organizar-agenda.py a partir do contacts.vcf")

    n_cat, idade_cat = json_de(DADOS / "catalogo-balao.json")
    add("catalogo_empresa", True,
        f"{n_cat} produtos em cache ({idade_cat}h); passou de 6h ele busca no site sozinho"
        if n_cat is not None else "sem cache local; busca direto no exemplo.com.br")

    # --- canais externos (so diz SE a credencial existe) ---
    wa = tem_env("MYBOTS_WHATS_VENDEDOR", "MYBOTS_WHATS_SENHA")
    add("whatsapp", wa,
        f"servidor {os.environ.get('MYBOTS_WHATS_URL', 'https://SEU_SERVIDOR')} · "
        f"login do vendedor configurado: {'sim' if wa else 'nao'} · enviar sempre pede o OK do chefe",
        "preencher MYBOTS_WHATS_VENDEDOR e MYBOTS_WHATS_SENHA no .env")

    em = tem_env("MYBOTS_EMAIL_USER", "MYBOTS_EMAIL_APP_PASSWORD")
    add("email", em,
        f"Gmail configurado: {'sim' if em else 'nao'} · enviar sempre pede o OK do chefe",
        "preencher MYBOTS_EMAIL_USER e MYBOTS_EMAIL_APP_PASSWORD no .env")

    fab = Path(os.environ.get("BALAO_FABRICA", r"C:\Users\user\balao-content-factory"))
    add("redes_sociais", fab.exists(),
        f"contas em {fab.name}: {'ok' if fab.exists() else 'pasta nao existe'} · "
        "por padrao ENSAIA; publicar de verdade pede o OK do chefe",
        "conferir a pasta balao-content-factory")

    # --- cameras ---
    simplay = achar(r"C:\Program Files\SIM Play\SIM Play.exe",
                    r"C:\Program Files (x86)\SIM Play\SIM Play.exe")
    add("cameras", (RAIZ / "scripts" / "cameras.ps1").exists(),
        f"SIM Play instalado: {'sim' if simplay else 'nao achei no caminho padrao'} · "
        "traz a janela pra frente, so com o chefe pedindo")

    # --- placa de video ---
    gpu = nvidia()
    comfy = porta_viva("127.0.0.1", 8188)
    add("system_resources", gpu is not None,
        f"{gpu['placa']}, {gpu['vram_livre_gb']} GB de VRAM livre de {gpu['vram_total_gb']}" if gpu
        else "nvidia-smi nao respondeu", "conferir o driver da NVIDIA")
    add("generate_image", True,
        f"ComfyUI local (8188): {'no ar' if comfy else 'fora do ar — cai nos provedores pagos, dentro da cota'}")
    add("generate_video", True,
        f"ComfyUI local (8188): {'no ar' if comfy else 'fora do ar — cai nos provedores pagos, dentro da cota'}")
    add("gerar_video_h3", bool(comfy and gpu and (RAIZ / "scripts" / "h3-video.py").exists()),
        f"ComfyUI: {'no ar' if comfy else 'fora do ar'} · "
        f"VRAM livre: {gpu['vram_livre_gb'] if gpu else '?'} GB (precisa de folga) · so com a palavra H3",
        "subir o ComfyUI e liberar a placa")

    return c


TOM = """COMO FALAR DISSO COM O CHEFE
- Se a ferramenta esta marcada funciona=false, NAO tente mesmo assim: diga o que falta
  e o conserto, numa linha. Tentar e queimar rodada a toa — ja aconteceu.
- Nunca procure programa por tentativa e erro. Esta tudo conferido aqui.
- Senha, chave e token nao aparecem nesta lista de proposito. Nunca peca nem repita o valor."""


def texto(c):
    bons = [x for x in c if x["funciona"]]
    maus = [x for x in c if not x["funciona"]]
    L = ["O QUE EU CONSIGO FAZER NESTE PC (conferido de verdade, nao e lista de nomes)", ""]
    L.append(f"FUNCIONANDO AGORA ({len(bons)}):")
    L += [f"- {x['ferramenta']}: {x['detalhe']}" for x in bons]
    if maus:
        L += ["", f"NAO FUNCIONA AGORA ({len(maus)}) — nem tente, ja esta conferido:"]
        L += [f"- {x['ferramenta']}: {x['detalhe']}. Conserto: {x.get('conserto', 'falar com o chefe')}" for x in maus]
    L += ["", TOM]
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--texto", action="store_true", help="imprime o catalogo em portugues")
    a = ap.parse_args()
    try:
        c = conferir()
    except Exception as e:
        print(json.dumps({"ok": False, "erro": f"a conferencia quebrou: {e}"}, ensure_ascii=False))
        return 1
    if a.texto:
        print(texto(c))
        return 0
    print(json.dumps({"ok": True, "conferido_em": time.strftime("%Y-%m-%d %H:%M"),
                      "funcionando": [x["ferramenta"] for x in c if x["funciona"]],
                      "fora": [{"ferramenta": x["ferramenta"], "detalhe": x["detalhe"],
                                "conserto": x.get("conserto", "")} for x in c if not x["funciona"]],
                      "catalogo": c}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
