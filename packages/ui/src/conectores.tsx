import { useEffect, useState } from "react";
import { api, UI_BASE } from "./api";

export type CategoriaConector =
  | "senhas"
  | "produtividade"
  | "comunicacao"
  | "design"
  | "codigo"
  | "marketing"
  | "financas";

export type ConectorPublico = {
  id: string;
  nome: string;
  categoria: CategoriaConector;
  descricao: string;
  gratis: true;
  auth: "oauth" | "chave" | "oauth_ou_chave";
  oauthConfigurado: boolean;
  faltandoOauth: string[];
  campos: Array<{ id: string; rotulo: string; segredo: boolean; obrigatorio: boolean }>;
  conectado: boolean;
  rotulo: string | null;
  atualizadoEm: number | null;
};

type Pacote = { cofreAtivo: boolean; aviso?: string; conectores: ConectorPublico[] };

const ABAS: Array<{ id: "todos" | CategoriaConector | "mais"; nome: string }> = [
  { id: "todos", nome: "Todos" },
  { id: "senhas", nome: "Gerenciadores de senha" },
  { id: "produtividade", nome: "Produtividade" },
  { id: "comunicacao", nome: "Comunicação" },
  { id: "design", nome: "Design" },
  { id: "codigo", nome: "Código" },
  { id: "mais", nome: "Mais" },
];

const MAIS: Array<{ id: "marketing" | "financas"; nome: string }> = [
  { id: "marketing", nome: "Marketing" },
  { id: "financas", nome: "Finanças" },
];

export function rotaModelosDeBots(): string {
  const base = UI_BASE || "";
  const caminho = `${base}/bots/importar-link`.replace(/\/{2,}/g, "/");
  return `${caminho}#/bots/importar-link`;
}

function podeChave(c: ConectorPublico): boolean {
  return c.auth === "chave" || c.auth === "oauth_ou_chave";
}

function podeOauth(c: ConectorPublico): boolean {
  return (c.auth === "oauth" || c.auth === "oauth_ou_chave") && c.oauthConfigurado;
}

export function ModalConectores({ onFechar }: { onFechar: () => void }) {
  const [pacote, setPacote] = useState<Pacote | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<(typeof ABAS)[number]["id"]>("todos");
  const [mais, setMais] = useState<(typeof MAIS)[number]["id"]>("marketing");
  const [form, setForm] = useState<ConectorPublico | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState("");
  const [enviando, setEnviando] = useState(false);

  const carregar = async () => {
    setErro("");
    try {
      const r = await api("/conectores");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(typeof j.error === "string" ? j.error : "não consegui carregar os aplicativos");
        return;
      }
      setPacote(j as Pacote);
    } catch {
      setErro("não consegui carregar os aplicativos");
    }
  };

  useEffect(() => { void carregar(); }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  const categoria: CategoriaConector | null = aba === "todos" ? null : aba === "mais" ? mais : aba;
  const lista = (pacote?.conectores ?? []).filter((c) => !categoria || c.categoria === categoria);

  const abrirForm = (c: ConectorPublico) => {
    setForm(c);
    setCampos({});
    setAviso("");
  };

  const conectar = (c: ConectorPublico) => {
    if (c.conectado) return;
    const loja = c.campos.some((f) => f.id === "loja");
    if (podeOauth(c) && !loja) {
      location.assign(`${UI_BASE}/api/conectores/${encodeURIComponent(c.id)}/oauth/iniciar`);
      return;
    }
    abrirForm(c);
  };

  const enviarForm = async () => {
    if (!form) return;
    setAviso("");
    if (podeOauth(form) && !campos.chave) {
      const loja = campos.loja ? `?loja=${encodeURIComponent(campos.loja)}` : "";
      location.assign(`${UI_BASE}/api/conectores/${encodeURIComponent(form.id)}/oauth/iniciar${loja}`);
      return;
    }
    setEnviando(true);
    try {
      const r = await api(`/conectores/${encodeURIComponent(form.id)}/chave`, {
        method: "POST",
        body: JSON.stringify({ campos }),
      });
      const j = await r.json().catch(() => ({}));
      setCampos({});
      if (!r.ok) {
        setAviso(typeof j.error === "string" ? j.error : "não consegui conectar");
        return;
      }
      setForm(null);
      await carregar();
    } catch {
      setCampos({});
      setAviso("não consegui conectar");
    } finally {
      setEnviando(false);
    }
  };

  const desconectar = async (c: ConectorPublico) => {
    if (!window.confirm(`Desconectar ${c.nome} desta conta? Os bots deixam de usar este aplicativo.`)) return;
    const r = await api(`/conectores/${encodeURIComponent(c.id)}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErro(typeof j.error === "string" ? j.error : "não consegui desconectar");
      return;
    }
    await carregar();
  };

  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal modal-conectores" role="dialog" aria-modal="true" aria-labelledby="conectores-titulo" data-conectores="aberto" onClick={(e) => e.stopPropagation()}>
        <header className="conectores-topo">
          <div>
            <b id="conectores-titulo">Conectar aplicativos</b>
            <p>A conexão vale para todos os bots desta conta.</p>
          </div>
          <a className="btn" href={rotaModelosDeBots()}>Modelos de Bots</a>
          <button className="link" type="button" onClick={onFechar}>fechar</button>
        </header>
        <div className="conectores-abas" role="tablist" aria-label="Categorias">
          {ABAS.map((a) => (
            <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} className={aba === a.id ? "on" : ""} data-aba={a.id} onClick={() => setAba(a.id)}>{a.nome}</button>
          ))}
        </div>
        {aba === "mais" && (
          <div className="conectores-abas sub" role="tablist" aria-label="Mais">
            {MAIS.map((a) => (
              <button key={a.id} type="button" role="tab" aria-selected={mais === a.id} className={mais === a.id ? "on" : ""} data-aba={a.id} onClick={() => setMais(a.id)}>{a.nome}</button>
            ))}
          </div>
        )}
        <div className="conectores-lista">
          {pacote && !pacote.cofreAtivo && <p className="conectores-aviso">{pacote.aviso || "O cofre está desligado. Dá para ver a lista, mas ainda não dá para guardar a conexão."}</p>}
          {erro && <p className="conectores-aviso">{erro}</p>}
          {!pacote && !erro && <p className="ajustes-lead">Carregando…</p>}
          {pacote && !lista.length && <p className="ajustes-lead">Nenhum aplicativo nesta aba.</p>}
          {lista.map((c) => (
            <article key={c.id} className="conector" data-conector={c.id}>
              <div>
                <b>{c.nome}</b>
                <span className="conector-gratis">Grátis</span>
                {c.conectado && <span className="conector-ok">Conectado{c.rotulo ? ` · ${c.rotulo}` : ""}</span>}
                <p>{c.descricao}</p>
              </div>
              {c.conectado ? (
                <button className="btn" type="button" onClick={() => void desconectar(c)}>Desconectar</button>
              ) : (
                <button className="btn primary" type="button" onClick={() => conectar(c)}>Conectar</button>
              )}
            </article>
          ))}
        </div>
        {form && (
          <form className="conectores-form" onSubmit={(e) => { e.preventDefault(); void enviarForm(); }}>
            <b>Conectar {form.nome}</b>
            {!form.oauthConfigurado && form.faltandoOauth.length > 0 && (
              <p className="conectores-aviso">OAuth ainda não está no servidor. Defina no .env do Hub: {form.faltandoOauth.join(", ")}. O valor não aparece aqui.</p>
            )}
            {form.campos.filter((f) => !f.segredo || podeChave(form)).map((f) => (
              <label key={f.id}>
                {f.rotulo}
                <input
                  type={f.segredo ? "password" : "text"}
                  autoComplete="off"
                  value={campos[f.id] ?? ""}
                  onChange={(e) => setCampos({ ...campos, [f.id]: e.target.value })}
                />
              </label>
            ))}
            {podeOauth(form) && podeChave(form) && <p className="ajustes-lead">Sem chave, o botão usa o OAuth. Com chave, guarda no cofre.</p>}
            {aviso && <p className="conectores-aviso">{aviso}</p>}
            <div className="conectores-form-acoes">
              <button className="btn" type="button" onClick={() => { setForm(null); setCampos({}); }}>Cancelar</button>
              <button className="btn primary" type="submit" disabled={enviando || (!podeOauth(form) && !podeChave(form))}>{enviando ? "Conectando…" : "Conectar"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
