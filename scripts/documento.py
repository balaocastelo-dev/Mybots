# -*- coding: utf-8 -*-
"""Faz PDF com o papel timbrado do Balao, usando o Chrome sem janela.

POR QUE ASSIM: os bots nao tinham ferramenta nenhuma de PDF. Pedido um
orcamento, o bot tentava wkhtmltopdf, pandoc e libreoffice — nenhum instalado
aqui — e ficava em laco gastando rodada ate desistir. O Chrome ja esta na
maquina e imprime HTML em PDF com fidelidade total.

TRES MODOS:
  --modelo nenhum     imprime o HTML cru que voce mandou
  --modelo balao      poe o seu HTML dentro do papel timbrado
  --modelo orcamento  monta a PROPOSTA COMERCIAL inteira a partir de um JSON,
                      no layout que o chefe aprovou (logo, CNPJ, numero da
                      proposta, bloco do cliente, item com foto e ficha,
                      TOTAL GERAL, condicoes comerciais e assinatura).

TRAVA DO QUE E DA CASA: o bloco COMPOSICAO DO PRECO (preco de custo, fonte da
pesquisa e margem) SO sai com --interno. Sem a flag ele nao e nem montado, mesmo
que os numeros venham no JSON. Isso e trava de codigo, nao recomendacao no
prompt: a versao que vai para o cliente nao tem como vazar o custo.

Uso:
  python documento.py --html corpo.html --saida x.pdf --modelo balao --titulo "Relatorio"
  python documento.py --dados proposta.json --saida orcamento.pdf --modelo orcamento
  python documento.py --dados - --saida orcamento.pdf --modelo orcamento --interno

Imprime uma linha de JSON.
"""
import argparse, base64, datetime, io, json, os, re, subprocess, sys, tempfile, time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
LOGO = RAIZ / "dados" / "marca" / "logo-balao.png"

CHROMES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

CASA = {
    "nome": "BALÃO DA INFORMÁTICA CASTELO",
    "cnpj": "34.397.947/0001-08",
    "endereco": "Av. Conta1, 789 — Cambuí — Campinas/SP — CEP 13015-101",
    "contato": "Tel.: (19) 3255-1661 · WhatsApp: (19) 98751-0267",
    "email": "balaoconta2@gmail.com · www.exemplo.com.br",
    "assina": "o chefe Gabriel Morales Herrera",
}

CONDICOES_PADRAO = [
    "Validade: {validade} dias corridos — até {ate}.",
    "Prazo de entrega: até 24 (vinte e quatro) horas úteis após a confirmação do pedido.",
    "Frete: CIF (incluso).",
    "Pagamento: {pagamento}",
    "Valores em Reais, com tributos do Simples Nacional inclusos na forma da legislação aplicável.",
    "Garantia: conforme política do fabricante.",
]
PAGAMENTO_PADRAO = "faturado em 30 (trinta) dias. Empresa optante pelo Simples Nacional (LC 123/2006)."

CSS = """
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10.5pt/1.45 "Segoe UI", Arial, Helvetica, sans-serif; color: #15171a; }
  .folha { padding: 0 0 26mm; position: relative; min-height: 297mm; }
  .barra-topo { height: 9mm; background: #E52521; border-radius: 0 0 14px 14px; }
  .miolo { padding: 7mm 13mm 0; }
  .cab { display: flex; gap: 14px; align-items: flex-start; }
  .cab img { width: 44mm; flex: none; }
  .cab h1 { margin: 0 0 2px; font-size: 13.5pt; letter-spacing: -0.01em; }
  .cab .linhas { color: #4a4f55; font-size: 8pt; line-height: 1.5; }
  .faixa { background: #E52521; color: #fff; text-align: center; font-weight: 700; font-size: 11pt;
           letter-spacing: 0.04em; padding: 7px 10px; border-radius: 5px; margin: 10px 0 11px; }
  .meta { display: flex; justify-content: space-between; gap: 10px; font-size: 9pt; margin-bottom: 11px; }
  .meta b { font-weight: 700; }
  .rotulo { color: #E52521; font-weight: 700; font-size: 8.5pt; letter-spacing: 0.06em; margin: 13px 0 5px; }
  .cliente { background: #f4f5f6; border-radius: 6px; padding: 9px 12px; }
  .cliente .nome { font-weight: 700; font-size: 11pt; }
  .cliente .sub { color: #4a4f55; font-size: 9pt; }
  .item { border: 1px solid #e3e5e7; border-radius: 8px; padding: 11px 13px; display: flex; gap: 14px; margin-bottom: 9px; }
  .item .foto { width: 46mm; flex: none; display: grid; place-items: center; }
  .item .foto img { max-width: 100%; max-height: 42mm; }
  .item .corpo { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .item h3 { margin: 0 0 5px; font-size: 10.5pt; }
  .item .ficha { color: #4a4f55; font-size: 9pt; line-height: 1.5; }
  .item .preco { margin-top: auto; padding-top: 10px; display: flex; align-items: flex-end; justify-content: space-between; }
  .item .qtd { font-size: 9.5pt; }
  .item .valor { text-align: right; }
  .item .valor b { color: #E52521; font-size: 15pt; display: block; line-height: 1.1; }
  .item .valor span { color: #80858b; font-size: 8pt; }
  .composicao { border: 1px solid #f0b6b4; background: #fdf4f4; border-radius: 8px; padding: 10px 13px; margin: 10px 0; }
  .composicao .titulo { color: #E52521; font-weight: 700; font-size: 8.5pt; letter-spacing: 0.06em; margin-bottom: 7px; }
  .composicao .l { display: flex; justify-content: space-between; font-size: 9.5pt; padding: 2px 0; }
  .composicao .l.fim { border-top: 1px solid #f0b6b4; margin-top: 5px; padding-top: 6px; font-weight: 700; color: #E52521; }
  .total { background: #E52521; color: #fff; border-radius: 6px; padding: 10px 14px; display: flex;
           justify-content: space-between; font-weight: 700; font-size: 12.5pt; margin: 11px 0 4px; }
  ul.cond { margin: 4px 0 0; padding-left: 16px; font-size: 9pt; line-height: 1.65; color: #2b2f33; }
  .assina { margin-top: 20px; border-top: 1px solid #e3e5e7; padding-top: 14px; font-size: 9.5pt; }
  .assina .risco { width: 72mm; border-bottom: 1px solid #15171a; margin: 26px 0 5px; }
  .assina .quem { font-weight: 700; }
  .assina .sub { color: #4a4f55; font-size: 8.5pt; }
  .rodape { position: fixed; bottom: 0; left: 0; right: 0; height: 9mm; background: #E52521; color: #fff;
            border-radius: 14px 14px 0 0; display: flex; align-items: center; justify-content: space-between;
            padding: 0 13mm; font-size: 7.5pt; }
  table { width: 100%; border-collapse: collapse; margin: 9px 0; font-size: 9.5pt; }
  th { background: #f4f5f6; text-align: left; padding: 7px 9px; border-bottom: 2px solid #e3e5e7; }
  td { padding: 7px 9px; border-bottom: 1px solid #ededee; vertical-align: top; }
  h2 { font-size: 11.5pt; margin: 15px 0 6px; }
  img { max-width: 100%; }
"""


def reais(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return str(v)
    return "R$ " + f"{n:,.2f}".replace(",", "~").replace(".", ",").replace("~", ".")


def escapar(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def embutir(caminho):
    """Imagem vira data: URI. PDF self-contained nao depende de caminho nem de rede."""
    if not caminho:
        return ""
    if str(caminho).startswith(("data:", "http://", "https://")):
        return str(caminho)
    p = Path(caminho)
    if not p.is_absolute():
        p = RAIZ / caminho
    if not p.exists():
        return ""
    tipo = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "webp": "image/webp", "gif": "image/gif", "svg": "image/svg+xml"}.get(p.suffix.lower().lstrip("."), "image/png")
    return f"data:{tipo};base64," + base64.b64encode(p.read_bytes()).decode("ascii")


def cabecalho():
    logo = embutir(LOGO)
    marca = f'<img src="{logo}" alt="sua empresa">' if logo else '<h1 style="color:#E52521;margin:0">sua empresa</h1>'
    return f"""<div class="cab">
  {marca}
  <div>
    <h1>{CASA['nome']}</h1>
    <div class="linhas">CNPJ: {CASA['cnpj']}<br>{CASA['endereco']}<br>{CASA['contato']}<br>{CASA['email']}</div>
  </div>
</div>"""


def rodape(titulo):
    return f'<div class="rodape"><span>sua empresa Conta2 · www.exemplo.com.br</span><span>{escapar(titulo)}</span></div>'


def pagina(conteudo, titulo):
    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>{escapar(titulo)}</title>
<style>{CSS}</style></head><body><div class="folha">
<div class="barra-topo"></div>
<div class="miolo">{cabecalho()}{conteudo}</div>
{rodape(titulo)}
</div></body></html>"""


def numero_da_proposta(d):
    if d.get("numero"):
        return str(d["numero"])
    base = (d.get("itens") or [{}])[0].get("titulo", "proposta")
    apelido = re.sub(r"[^A-Za-z0-9]+", "", base).upper()[:10] or "PROP"
    hoje = datetime.date.today()
    return f"BI-{hoje.year}-{apelido}-{hoje.strftime('%m%d')}"


def montar_orcamento(d, com_interno):
    hoje = datetime.date.today()
    dias = int(d.get("validade_dias") or 10)
    ate = hoje + datetime.timedelta(days=dias)
    data_txt = d.get("data") or hoje.strftime("%d/%m/%Y")
    cli = d.get("cliente") or {}
    itens = d.get("itens") or []

    partes = [f'<div class="faixa">{escapar(d.get("faixa") or "PROPOSTA COMERCIAL / ORÇAMENTO")}</div>']
    partes.append(
        f'<div class="meta"><span><b>Proposta nº:</b> {escapar(numero_da_proposta(d))}</span>'
        f'<span><b>Data:</b> {escapar(data_txt)}</span>'
        f'<span><b>Validade:</b> {dias} dias (até {ate.strftime("%d/%m/%Y")})</span></div>'
    )

    sub = " · ".join(x for x in [cli.get("email"), cli.get("telefone"), cli.get("cnpj")] if x)
    partes.append('<div class="rotulo">CLIENTE</div><div class="cliente">'
                  f'<div class="nome">{escapar(cli.get("nome") or "—")}</div>'
                  + (f'<div class="sub">{escapar(sub)}</div>' if sub else "") + "</div>")

    partes.append(f'<div class="rotulo">{"ITENS" if len(itens) > 1 else "ITEM"}</div>')
    total = 0.0
    for it in itens:
        qtd = int(it.get("quantidade") or 1)
        preco = float(it.get("preco") or 0)
        total += preco * qtd
        foto = embutir(it.get("imagem"))
        bloco_foto = f'<div class="foto"><img src="{foto}" alt=""></div>' if foto else ""
        partes.append(f"""<div class="item">{bloco_foto}
  <div class="corpo">
    <h3>{escapar(it.get("titulo") or "Item")}</h3>
    <div class="ficha">{escapar(it.get("descricao") or "")}</div>
    <div class="preco">
      <span class="qtd">Quantidade: {qtd:02d}</span>
      <span class="valor"><b>{reais(preco * qtd)}</b><span>preço unitário / total</span></span>
    </div>
  </div>
</div>""")

    # SO com --interno. Sem a flag o bloco nem e montado — a versao do cliente
    # nao tem como vazar custo nem margem.
    comp = d.get("composicao") or {}
    if com_interno and comp:
        custo = float(comp.get("custo") or 0)
        fonte = comp.get("fonte") or "pesquisa"
        margem_v = total - custo
        pct = comp.get("margem_pct")
        pct_txt = f" ({pct}%)" if pct is not None else (f" ({round(margem_v / custo * 100)}%)" if custo else "")
        partes.append(f"""<div class="composicao">
  <div class="titulo">COMPOSIÇÃO DO PREÇO</div>
  <div class="l"><span>Preço pesquisado (custo / {escapar(fonte)}):</span><span>{reais(custo)}</span></div>
  <div class="l"><span>Margem aplicada{pct_txt}:</span><span>{reais(margem_v)}</span></div>
  <div class="l fim"><span>TOTAL (venda):</span><span>{reais(total)}</span></div>
</div>""")

    partes.append(f'<div class="total"><span>TOTAL GERAL</span><span>{reais(total)}</span></div>')

    pagamento = d.get("pagamento") or PAGAMENTO_PADRAO
    cond = d.get("condicoes") or CONDICOES_PADRAO
    linhas = [escapar(c.format(validade=f"{dias} ({dias_por_extenso(dias)})", ate=ate.strftime("%d/%m/%Y"), pagamento=pagamento))
              if "{" in c else escapar(c) for c in cond]
    partes.append('<div class="rotulo">CONDIÇÕES COMERCIAIS</div><ul class="cond">'
                  + "".join(f"<li>{l}</li>" for l in linhas) + "</ul>")

    partes.append(f"""<div class="assina">Atenciosamente,
  <div class="risco"></div>
  <div class="quem">{CASA['assina']}</div>
  <div class="sub">sua empresa Conta2<br>{CASA['contato']}</div>
</div>""")
    return "".join(partes)


EXTENSO = {1: "um", 2: "dois", 3: "três", 5: "cinco", 7: "sete", 10: "dez", 15: "quinze", 20: "vinte", 30: "trinta", 60: "sessenta", 90: "noventa"}
def dias_por_extenso(n):
    return EXTENSO.get(n, str(n))


def achar_chrome():
    for c in CHROMES:
        if os.path.exists(c):
            return c
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", help="arquivo .html de entrada, ou '-' para ler da entrada padrao")
    ap.add_argument("--dados", help="JSON da proposta (arquivo ou '-'), para --modelo orcamento")
    ap.add_argument("--saida", required=True)
    ap.add_argument("--modelo", choices=["nenhum", "balao", "orcamento"], default="balao")
    ap.add_argument("--titulo", default="Documento")
    ap.add_argument("--interno", action="store_true",
                    help="inclui o bloco COMPOSICAO DO PRECO (custo e margem). NAO use na via do cliente.")
    a = ap.parse_args()

    chrome = achar_chrome()
    if not chrome:
        print(json.dumps({"ok": False, "erro": "não achei o Chrome nem o Edge para imprimir o PDF"}, ensure_ascii=False))
        return 1

    if a.modelo == "orcamento":
        if not a.dados:
            print(json.dumps({"ok": False, "erro": "--modelo orcamento precisa de --dados com o JSON da proposta"}, ensure_ascii=False))
            return 1
        bruto = sys.stdin.read() if a.dados == "-" else io.open(a.dados, encoding="utf-8").read()
        try:
            d = json.loads(bruto)
        except Exception as e:
            print(json.dumps({"ok": False, "erro": f"o JSON da proposta não está válido: {e}"}, ensure_ascii=False))
            return 1
        titulo = a.titulo if a.titulo != "Documento" else (d.get("titulo") or "Orçamento")
        corpo = pagina(montar_orcamento(d, a.interno), titulo)
    else:
        if not a.html:
            print(json.dumps({"ok": False, "erro": "informe --html (ou use --modelo orcamento com --dados)"}, ensure_ascii=False))
            return 1
        texto = sys.stdin.read() if a.html == "-" else io.open(a.html, encoding="utf-8").read()
        titulo = a.titulo
        corpo = pagina(texto, titulo) if a.modelo == "balao" else texto

    tmp = tempfile.mkdtemp(prefix="pdf-")
    fonte = os.path.join(tmp, "doc.html")
    io.open(fonte, "w", encoding="utf-8").write(corpo)

    saida = os.path.abspath(a.saida)
    os.makedirs(os.path.dirname(saida) or ".", exist_ok=True)
    cmd = [chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
           "--print-to-pdf=" + saida, "--virtual-time-budget=9000",
           "--user-data-dir=" + os.path.join(tmp, "perfil"), fonte]
    r = subprocess.run(cmd, capture_output=True, timeout=180)
    time.sleep(0.4)

    if not os.path.exists(saida) or os.path.getsize(saida) < 800:
        erro = (r.stderr or b"").decode("utf-8", "replace")[-400:]
        print(json.dumps({"ok": False, "erro": "o Chrome não gerou o PDF", "detalhe": erro}, ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, "arquivo": saida, "kb": round(os.path.getsize(saida) / 1024, 1),
                      "modelo": a.modelo,
                      "custo_e_margem_no_pdf": bool(a.interno and a.modelo == "orcamento")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
