import { useEffect, useMemo, useState } from "react";
import type { GravacaoCofre, ItemCofre, LinhaAuditoria, PermissaoCofre, TipoItemCofre } from "./segredos";
import { NOMES_EXEMPLO } from "./maquinas";
import { ChavesDaCasa } from "../tema";
import {
  apagarItem,
  criarItem,
  editarItem,
  gravarPermissoes,
  lerAuditoria,
  lerPermissoes,
  listarItens,
  statusCofre,
  type PacoteCofre,
} from "./cofre";

type Filtro = "tudo" | "login" | "cartao";

interface Rascunho {
  id: string | null;
  tipo: TipoItemCofre;
  titulo: string;
  usuario: string;
  url: string;
  senha: string;
  bandeira: string;
  nomeNoCartao: string;
  numero: string;
  validade: string;
  cvv: string;
  permissoes: PermissaoCofre[];
}

const VAZIO = (tipo: TipoItemCofre): Rascunho => ({
  id: null, tipo, titulo: "", usuario: "", url: "", senha: "",
  bandeira: "", nomeNoCartao: "", numero: "", validade: "", cvv: "", permissoes: [],
});

function limparSegredo(r: Rascunho): Rascunho {
  return { ...r, senha: "", numero: "", cvv: "" };
}

export function AbaCofre({ bots }: { bots: { id: string; name: string }[] }) {
  const [pacote, setPacote] = useState<PacoteCofre | null>(null);
  const [auditoria, setAuditoria] = useState<LinhaAuditoria[]>([]);
  const [pronto, setPronto] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("tudo");
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [apagando, setApagando] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  const recarregar = async () => {
    const [lista, st, aud] = await Promise.all([listarItens(), statusCofre(), lerAuditoria()]);
    setPacote(lista);
    setAuditoria(aud);
    setPronto(st.origem === "exemplo"
      ? "Cofre de exemplo neste navegador. Senha e número completo não ficam guardados."
      : st.pronto ? `Cofre do Hub · ${st.total} ${st.total === 1 ? "item" : "itens"}` : "O Hub não confirmou o cofre.");
    if (lista.erro) setErro(lista.erro);
  };

  useEffect(() => { void recarregar(); }, []);

  const nomes = useMemo(() => {
    const mapa = new Map(bots.map((b) => [b.id, b.name]));
    if (pacote?.origem === "exemplo") {
      for (const [id, nome] of Object.entries(NOMES_EXEMPLO)) if (!mapa.has(id)) mapa.set(id, `${nome} (exemplo)`);
    }
    return mapa;
  }, [bots, pacote?.origem]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (pacote?.itens ?? []).filter((item) => {
      if (filtro !== "tudo" && item.tipo !== filtro) return false;
      if (!q) return true;
      const texto = `${item.titulo} ${item.usuario} ${item.url} ${item.bandeira} ${item.nomeNoCartao} ${item.finalNumero}`.toLowerCase();
      return texto.includes(q);
    });
  }, [pacote, busca, filtro]);

  const abrirNovo = (tipo: TipoItemCofre) => {
    setErro("");
    setRascunho(VAZIO(tipo));
  };

  const abrirEdicao = async (item: ItemCofre) => {
    setErro("");
    setApagando(null);
    const perms = await lerPermissoes(item.id);
    setRascunho({
      id: item.id,
      tipo: item.tipo,
      titulo: item.titulo,
      usuario: item.usuario,
      url: item.url,
      senha: "",
      bandeira: item.bandeira,
      nomeNoCartao: item.nomeNoCartao,
      numero: "",
      validade: item.validade,
      cvv: "",
      permissoes: perms,
    });
  };

  const salvar = async () => {
    if (!rascunho) return;
    const titulo = rascunho.titulo.trim();
    if (!titulo) { setErro("Dê um nome ao item."); return; }
    const gravacao: GravacaoCofre = {
      tipo: rascunho.tipo,
      titulo,
      usuario: rascunho.usuario,
      url: rascunho.url,
      senha: rascunho.senha,
      bandeira: rascunho.bandeira,
      nomeNoCartao: rascunho.nomeNoCartao,
      numero: rascunho.numero,
      validade: rascunho.validade,
      cvv: rascunho.cvv,
    };
    const id = rascunho.id;
    const perms = rascunho.permissoes;
    setRascunho((r) => (r ? limparSegredo(r) : r));
    setErro("");
    let item: ItemCofre | null = null;
    try {
      item = id ? await editarItem(id, gravacao) : await criarItem(gravacao);
    } finally {
      gravacao.senha = "";
      gravacao.numero = "";
      gravacao.cvv = "";
    }
    if (!item) { setErro("Não deu para guardar. Nada secreto ficou na lista."); return; }
    if (perms.length) await gravarPermissoes(item.id, perms);
    setRascunho(null);
    await recarregar();
  };

  const apagar = async (id: string) => {
    setErro("");
    const ok = await apagarItem(id);
    if (!ok) { setErro("Não deu para apagar."); return; }
    setApagando(null);
    if (rascunho?.id === id) setRascunho(null);
    await recarregar();
  };

  const alternarBot = (botId: string) => {
    setRascunho((r) => {
      if (!r) return r;
      const tem = r.permissoes.some((p) => p.botId === botId);
      const permissoes = tem
        ? r.permissoes.map((p) => p.botId === botId ? { ...p, liberado: !p.liberado } : p)
        : [...r.permissoes, { botId, liberado: true }];
      return { ...r, permissoes };
    });
  };

  return (
    <div className="ajustes-aba" data-aba="cofre">
      <section className="ajustes-grupo">
        <h3>Chaves</h3>
        <p className="ajustes-lead">Provedores de IA. Depois de configurada, a chave não volta para esta tela: só a máscara e o teste.</p>
        <ChavesDaCasa />
      </section>
      <section className="ajustes-grupo">
        <h3>Cofre</h3>
        <p className="ajustes-lead">
          Logins e cartões. A resposta vem mascarada: a senha não aparece e o cartão mostra só os 4 finais.
          {pronto && ` ${pronto}`}
        </p>
        <div className="ajustes-cofre-barra">
          <input className="ajustes-busca" value={busca} placeholder="Buscar nome, usuário ou final" aria-label="Buscar no cofre" autoComplete="off" onChange={(e) => setBusca(e.target.value)} />
          <div className="ajustes-filtros" role="group" aria-label="Tipo">
            {([["tudo", "Tudo"], ["login", "Logins"], ["cartao", "Cartões"]] as const).map(([id, rotulo]) => (
              <button key={id} type="button" className={filtro === id ? "on" : ""} aria-pressed={filtro === id} onClick={() => setFiltro(id)}>{rotulo}</button>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => abrirNovo("login")}>Novo login</button>
          <button type="button" className="btn" onClick={() => abrirNovo("cartao")}>Novo cartão</button>
        </div>
        {erro && <p className="ajustes-erro" role="alert">{erro}</p>}
        {rascunho && (
          <form className="ajustes-form" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
            <h4>{rascunho.id ? "Editar" : "Adicionar"} {rascunho.tipo === "login" ? "login" : "cartão"}</h4>
            <label>Nome <input value={rascunho.titulo} maxLength={120} onChange={(e) => setRascunho({ ...rascunho, titulo: e.target.value })} required /></label>
            {rascunho.tipo === "login" ? (
              <>
                <label>Usuário <input value={rascunho.usuario} autoComplete="off" maxLength={160} onChange={(e) => setRascunho({ ...rascunho, usuario: e.target.value })} /></label>
                <label>Endereço <input value={rascunho.url} autoComplete="off" inputMode="url" placeholder="https://" maxLength={300} onChange={(e) => setRascunho({ ...rascunho, url: e.target.value })} /></label>
                <label>Senha <input type="password" value={rascunho.senha} autoComplete="new-password" spellCheck={false} placeholder={rascunho.id ? "Em branco mantém a atual" : "Não será mostrada de novo"} onChange={(e) => setRascunho({ ...rascunho, senha: e.target.value })} /></label>
              </>
            ) : (
              <>
                <label>Nome no cartão <input value={rascunho.nomeNoCartao} autoComplete="off" maxLength={80} onChange={(e) => setRascunho({ ...rascunho, nomeNoCartao: e.target.value })} /></label>
                <label>Bandeira <input value={rascunho.bandeira} autoComplete="off" maxLength={40} placeholder="Visa, Mastercard…" onChange={(e) => setRascunho({ ...rascunho, bandeira: e.target.value })} /></label>
                <label>Número <input type="password" value={rascunho.numero} autoComplete="off" inputMode="numeric" spellCheck={false} placeholder={rascunho.id ? "Em branco mantém os 4 finais" : "Só os 4 finais ficam na lista"} onChange={(e) => setRascunho({ ...rascunho, numero: e.target.value })} /></label>
                <label>Validade <input value={rascunho.validade} autoComplete="off" placeholder="MM/AA" maxLength={5} onChange={(e) => setRascunho({ ...rascunho, validade: e.target.value })} /></label>
                <label>CVV <input type="password" value={rascunho.cvv} autoComplete="off" inputMode="numeric" spellCheck={false} placeholder="Não fica guardado na lista" onChange={(e) => setRascunho({ ...rascunho, cvv: e.target.value })} /></label>
              </>
            )}
            <fieldset className="ajustes-perms">
              <legend>Quem pode usar</legend>
              {!nomes.size && <p className="ajustes-lead">Nenhum bot nesta casa ainda.</p>}
              {[...nomes.entries()].map(([id, nome]) => {
                const liberado = rascunho.permissoes.some((p) => p.botId === id && p.liberado);
                return (
                  <label key={id} className="ajustes-check">
                    <input type="checkbox" checked={liberado} onChange={() => alternarBot(id)} /> {nome}
                  </label>
                );
              })}
            </fieldset>
            <div className="ajustes-form-acoes">
              <button type="submit" className="btn">Guardar</button>
              <button type="button" className="btn" onClick={() => setRascunho(null)}>Cancelar</button>
            </div>
          </form>
        )}
        <ul className="ajustes-cofre">
          {visiveis.map((item) => (
            <li key={item.id}>
              <div>
                <b>{item.titulo}</b>
                <small>{item.tipo === "login" ? "Login" : "Cartão"}</small>
                {item.tipo === "login" ? (
                  <span>{item.usuario || "sem usuário"}{item.url ? ` · ${item.url}` : ""}{item.senhaMascarada ? ` · senha ${item.senhaMascarada}` : ""}</span>
                ) : (
                  <span>{item.bandeira}{item.finalNumero ? ` · final ${item.finalNumero}` : " · sem final"}{item.validade ? ` · ${item.validade}` : ""}{item.nomeNoCartao ? ` · ${item.nomeNoCartao}` : ""}</span>
                )}
              </div>
              <div className="ajustes-maq-acoes">
                <button type="button" className="btn" onClick={() => void abrirEdicao(item)}>Editar</button>
                {apagando === item.id ? (
                  <>
                    <button type="button" className="btn danger" onClick={() => void apagar(item.id)}>Apagar de vez</button>
                    <button type="button" className="btn" onClick={() => setApagando(null)}>Cancelar</button>
                  </>
                ) : (
                  <button type="button" className="btn" onClick={() => setApagando(item.id)}>Apagar</button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {pacote && !visiveis.length && <p className="ajustes-lead">Nada no cofre com esse filtro.</p>}
      </section>
      <section className="ajustes-grupo">
        <h3>Auditoria</h3>
        <p className="ajustes-lead">Quem criou, editou, apagou ou liberou. Sem senha e sem número.</p>
        <ul className="ajustes-audit">
          {auditoria.map((l) => (
            <li key={l.id}>
              <b>{rotuloAcao(l.acao)}</b> {l.titulo || "item"} <small>{l.quem} · {new Date(l.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</small>
            </li>
          ))}
          {!auditoria.length && <li className="ajustes-lead">Nenhum registro ainda.</li>}
        </ul>
      </section>
    </div>
  );
}

function rotuloAcao(acao: string): string {
  if (acao === "criou") return "Criou";
  if (acao === "editou") return "Editou";
  if (acao === "apagou") return "Apagou";
  if (acao === "permissao") return "Mudou permissão de";
  if (acao === "leu") return "Consultou";
  return "Registrou";
}
