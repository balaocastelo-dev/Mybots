# -*- coding: utf-8 -*-
"""
E-mail para os bots do MyBots: le e envia pelo Gmail (ou qualquer IMAP/SMTP).

Usa senha de app do Google (nao a senha da conta), lida de variaveis de ambiente
ou do .env do projeto. Nenhuma senha e impressa nunca.

Variaveis (no .env do mybots):
  MYBOTS_EMAIL_USER=voce@gmail.com
  MYBOTS_EMAIL_APP_PASSWORD=as 16 letras da senha de app
  MYBOTS_EMAIL_IMAP=imap.gmail.com      (opcional)
  MYBOTS_EMAIL_SMTP=smtp.gmail.com      (opcional)

Uso:
  python email-tool.py conferir
  python email-tool.py caixa    [--quantos 10] [--pasta INBOX] [--nao-lidos]
  python email-tool.py buscar   --termo "nota fiscal" [--quantos 10]
  python email-tool.py ler      --id 12345
  python email-tool.py enviar   --para a@b.com --assunto "..." --texto "..." [--copia c@d.com] [--anexo arq.pdf]
"""
import argparse, email, imaplib, json, os, re, smtplib, ssl, sys
from email.header import decode_header, make_header
from email.message import EmailMessage
from pathlib import Path


def saida(**kw):
    print(json.dumps(kw, ensure_ascii=False, default=str))
    sys.exit(0 if kw.get("ok") else 1)


def do_env():
    """Le o .env do projeto sem sobrescrever o que ja esta no ambiente."""
    for base in (Path(__file__).resolve().parent.parent, Path.cwd()):
        f = base / ".env"
        if not f.exists():
            continue
        for linha in f.read_text(encoding="utf-8", errors="ignore").lstrip("﻿").splitlines():
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            k, v = linha.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


COMO_CONFIGURAR = (
    "Falta a senha de app do Gmail. Como pegar, em 2 minutos: entre em "
    "myaccount.google.com/apppasswords (precisa ter a verificacao em duas etapas ligada), "
    "crie uma senha chamada MyBots, copie as 16 letras e coloque no .env do mybots assim: "
    "MYBOTS_EMAIL_USER=seu@gmail.com e MYBOTS_EMAIL_APP_PASSWORD=as16letras. "
    "Nao e a senha da sua conta, e uma senha separada que vale so para isto e pode ser revogada."
)


def conta():
    do_env()
    user = os.environ.get("MYBOTS_EMAIL_USER", "").strip()
    senha = os.environ.get("MYBOTS_EMAIL_APP_PASSWORD", "").replace(" ", "").strip()
    if not user or not senha:
        saida(ok=False, erro=COMO_CONFIGURAR, configurado=False)
    return user, senha, os.environ.get("MYBOTS_EMAIL_IMAP", "imap.gmail.com"), os.environ.get("MYBOTS_EMAIL_SMTP", "smtp.gmail.com")


def txt(v):
    try:
        return str(make_header(decode_header(v or "")))
    except Exception:
        return str(v or "")


def corpo_de(msg, limite=4000):
    if msg.is_multipart():
        for p in msg.walk():
            if p.get_content_type() == "text/plain" and "attachment" not in str(p.get("Content-Disposition") or ""):
                try:
                    return p.get_payload(decode=True).decode(p.get_content_charset() or "utf-8", "replace")[:limite]
                except Exception:
                    pass
        for p in msg.walk():
            if p.get_content_type() == "text/html":
                try:
                    h = p.get_payload(decode=True).decode(p.get_content_charset() or "utf-8", "replace")
                    return re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(script|style).*?</\1>", " ", h))[:limite]
                except Exception:
                    pass
        return ""
    try:
        return msg.get_payload(decode=True).decode(msg.get_content_charset() or "utf-8", "replace")[:limite]
    except Exception:
        return str(msg.get_payload())[:limite]


def abre_imap():
    user, senha, imap_host, _ = conta()
    try:
        m = imaplib.IMAP4_SSL(imap_host, 993)
        m.login(user, senha)
        return m, user
    except imaplib.IMAP4.error as e:
        saida(ok=False, erro=f"o Gmail recusou o login IMAP ({e}). Confira a senha de app e se o IMAP esta ligado "
                             f"em mail.google.com > Configuracoes > Encaminhamento e POP/IMAP.")
    except Exception as e:
        saida(ok=False, erro=f"nao consegui falar com o {imap_host}: {type(e).__name__}: {e}")


def lista(m, criterio, quantos, pasta):
    st, _ = m.select(pasta, readonly=True)
    if st != "OK":
        saida(ok=False, erro=f"nao abri a pasta {pasta}")
    st, dados = m.search(None, criterio)
    if st != "OK":
        saida(ok=False, erro="a busca no Gmail falhou")
    ids = (dados[0] or b"").split()[-max(1, min(50, quantos)):]
    fora = []
    for i in reversed(ids):
        st, d = m.fetch(i, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] FLAGS)")
        if st != "OK" or not d or not isinstance(d[0], tuple):
            continue
        cab = email.message_from_bytes(d[0][1])
        flags = str(d[0][0])
        fora.append({
            "id": i.decode(),
            "de": txt(cab.get("From")),
            "assunto": txt(cab.get("Subject")),
            "data": txt(cab.get("Date")),
            "lido": "\\Seen" in flags,
        })
    return fora


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("acao")
    ap.add_argument("--quantos", type=int, default=10)
    ap.add_argument("--pasta", default="INBOX")
    ap.add_argument("--nao-lidos", action="store_true", dest="nao_lidos")
    ap.add_argument("--termo", default="")
    ap.add_argument("--id", default="")
    ap.add_argument("--para", default="")
    ap.add_argument("--copia", default="")
    ap.add_argument("--assunto", default="")
    ap.add_argument("--texto", default="")
    ap.add_argument("--anexo", default="")
    a = ap.parse_args()

    if a.acao == "conferir":
        do_env()
        tem = bool(os.environ.get("MYBOTS_EMAIL_USER") and os.environ.get("MYBOTS_EMAIL_APP_PASSWORD"))
        if not tem:
            saida(ok=False, configurado=False, erro=COMO_CONFIGURAR)
        m, user = abre_imap()
        st, _ = m.select("INBOX", readonly=True)
        st2, nl = m.search(None, "UNSEEN")
        n = len((nl[0] or b"").split()) if st2 == "OK" else None
        m.logout()
        saida(ok=True, configurado=True, conta=user, nao_lidos=n, aviso="login IMAP ok")

    if a.acao in ("caixa", "buscar"):
        m, user = abre_imap()
        if a.acao == "buscar":
            if not a.termo:
                m.logout(); saida(ok=False, erro="informe --termo")
            t = a.termo.replace('"', "")
            crit = f'(OR OR SUBJECT "{t}" FROM "{t}" BODY "{t}")'
        else:
            crit = "UNSEEN" if a.nao_lidos else "ALL"
        itens = lista(m, crit, a.quantos, a.pasta)
        m.logout()
        saida(ok=True, conta=user, pasta=a.pasta, quantos=len(itens), mensagens=itens,
              dica="use a acao ler com --id para ver o conteudo de uma")

    if a.acao == "ler":
        if not a.id:
            saida(ok=False, erro="informe --id (veja na acao caixa)")
        m, user = abre_imap()
        m.select(a.pasta, readonly=True)
        st, d = m.fetch(a.id.encode(), "(BODY.PEEK[])")
        if st != "OK" or not d or not isinstance(d[0], tuple):
            m.logout(); saida(ok=False, erro=f"nao achei a mensagem {a.id} em {a.pasta}")
        msg = email.message_from_bytes(d[0][1])
        anexos = [txt(p.get_filename()) for p in msg.walk() if p.get_filename()]
        m.logout()
        saida(ok=True, conta=user, id=a.id, de=txt(msg.get("From")), para=txt(msg.get("To")),
              assunto=txt(msg.get("Subject")), data=txt(msg.get("Date")),
              anexos=anexos, texto=corpo_de(msg))

    if a.acao == "enviar":
        if not a.para or not a.assunto or not a.texto:
            saida(ok=False, erro="informe --para, --assunto e --texto")
        user, senha, _, smtp_host = conta()
        msg = EmailMessage()
        msg["From"] = user
        msg["To"] = a.para
        if a.copia:
            msg["Cc"] = a.copia
        msg["Subject"] = a.assunto
        msg.set_content(a.texto)
        if a.anexo:
            p = Path(a.anexo)
            if not p.exists():
                saida(ok=False, erro=f"anexo nao existe: {a.anexo}")
            if p.stat().st_size > 20 * 1024 * 1024:
                saida(ok=False, erro="anexo maior que 20 MB; o Gmail recusa")
            msg.add_attachment(p.read_bytes(), maintype="application", subtype="octet-stream", filename=p.name)
        try:
            with smtplib.SMTP_SSL(smtp_host, 465, context=ssl.create_default_context(), timeout=60) as s:
                s.login(user, senha)
                s.send_message(msg)
        except smtplib.SMTPAuthenticationError:
            saida(ok=False, erro="o Gmail recusou a senha de app no envio. " + COMO_CONFIGURAR)
        except Exception as e:
            saida(ok=False, erro=f"falha ao enviar: {type(e).__name__}: {e}")
        saida(ok=True, enviado=True, de=user, para=a.para, copia=a.copia or None,
              assunto=a.assunto, anexo=(Path(a.anexo).name if a.anexo else None))

    saida(ok=False, erro=f"acao desconhecida: {a.acao}")


if __name__ == "__main__":
    main()
