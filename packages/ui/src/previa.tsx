import { UI_BASE } from "./api";
import { useEffect, useState } from "react";

/**
 * A JANELINHA DE NAVEGADOR DO CADASTRO
 *
 * Digitar o endereco da empresa e so texto: a pessoa nao tem como saber se
 * acertou. Aqui o Hub abre a pagina de verdade (Chrome sem janela, tirando a
 * cortina de cadastro do Instagram) e devolve o print. Ver a propria loja
 * aparecer e a confirmacao de que o cadastro esta certo -- e ja mostra ao chefe
 * que os bots conseguem navegar.
 *
 * A busca espera a pessoa parar de digitar: um pedido por tecla abriria um
 * Chrome por letra.
 */
type Previa = { ok: boolean; url: string; titulo?: string; descricao?: string; imagem?: string; captura?: string; erro?: string };

export function PreviaNavegador({ valor, tipo }: { valor: string; tipo: "site" | "insta" }) {
  const [p, setP] = useState<Previa | null>(null);
  const [indo, setIndo] = useState(false);

  useEffect(() => {
    const t = (valor ?? "").trim();
    if (t.replace(/^@/, "").length < 4) { setP(null); setIndo(false); return; }
    setIndo(true);
    const parar = new AbortController();
    const quando = setTimeout(async () => {
      try {
        const q = tipo === "insta" ? `insta=${encodeURIComponent(t)}` : `url=${encodeURIComponent(t)}`;
        const r = await fetch(`${UI_BASE}/api/previa?${q}`, { signal: parar.signal });
        setP(r.ok ? await r.json() : { ok: false, url: t, erro: "nao consegui abrir" });
      } catch { /* trocou o texto; o proximo pedido manda */ }
      finally { setIndo(false); }
    }, 900);
    return () => { clearTimeout(quando); parar.abort(); };
  }, [valor, tipo]);

  const t = (valor ?? "").trim();
  if (t.replace(/^@/, "").length < 4) return null;
  const endereco = p?.url ?? (tipo === "insta" ? `instagram.com/${t.replace(/^@/, "")}` : t);
  const foto = p?.captura ?? p?.imagem;

  return (
    <div className={"janelinha" + (indo ? " indo" : "")}>
      <div className="janelinha-barra">
        <i /><i /><i />
        <span className="janelinha-url">{endereco.replace(/^https?:\/\//, "")}</span>
        {indo ? <span className="janelinha-girando" aria-hidden="true" /> : null}
      </div>
      <div className="janelinha-tela">
        {foto
          ? <img src={foto} alt="" />
          : <div className="janelinha-vazia">{indo ? "abrindo a pagina..." : (p?.erro ?? "nao consegui abrir esse endereco")}</div>}
      </div>
      {p?.titulo ? (
        <div className="janelinha-pe">
          <b>{p.titulo}</b>
          {p.descricao ? <small>{p.descricao}</small> : null}
        </div>
      ) : null}
    </div>
  );
}
