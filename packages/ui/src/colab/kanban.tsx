import { useEffect, useState } from "react";
import type { BotSummary } from "@mybots/shared";
import { Avatar } from "../avatar";
import {
  colunaDe,
  podeCancelar,
  prazoAtrasado,
  quando,
  tarefasNaColuna,
} from "./normalizar";
import {
  COLUNAS,
  ROTULO_STATUS,
  type PacoteColab,
  type Tarefa,
} from "./tipos";

type Nome = (id: string) => string;

export function QuadroKanban({
  titulo,
  subtitulo,
  onFechar,
  tarefas,
  nome,
  mostrarResponsavel,
  fonte,
  aviso,
  onCancelar,
  onSimular,
  abertaInicial,
  filtro,
  botsFiltro,
  onFiltro,
  bots,
  onAbrirBot,
}: {
  titulo: string;
  subtitulo?: string;
  onFechar?: () => void;
  tarefas: Tarefa[];
  nome: Nome;
  mostrarResponsavel?: boolean;
  fonte?: PacoteColab["fonte"];
  aviso?: string;
  onCancelar: (id: string) => void;
  onSimular?: () => void;
  abertaInicial?: string | null;
  filtro?: string;
  botsFiltro?: Array<{ id: string; nome: string }>;
  onFiltro?: (id: string) => void;
  bots?: BotSummary[];
  onAbrirBot?: (id: string) => void;
}) {
  const [abertaId, setAbertaId] = useState<string | null>(abertaInicial ?? null);
  useEffect(() => { if (abertaInicial) setAbertaId(abertaInicial); }, [abertaInicial]);
  const aberta = tarefas.find((t) => t.id === abertaId) ?? null;

  return (
    <section className="colab-quadro" data-colab="kanban" aria-label={titulo}>
      <header className="colab-topo">
        <div>
          {onFechar && <button type="button" className="icon-btn" onClick={onFechar} title="Voltar" aria-label="Voltar">←</button>}
          <b>{titulo}</b>
          {subtitulo && <small>{subtitulo}</small>}
        </div>
        <div className="colab-topo-acoes">
          {botsFiltro && onFiltro && (
            <label className="colab-filtro">
              Bot
              <select data-colab="filtro-bot" value={filtro ?? ""} onChange={(e) => onFiltro(e.target.value)} aria-label="Filtrar tarefas por bot">
                <option value="">Todos os bots</option>
                {botsFiltro.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
            </label>
          )}
          {fonte === "exemplo" && onSimular && (
            <button type="button" className="btn" data-colab="simular" onClick={onSimular} title="Aplica um evento colab.tarefa de exemplo e move o cartão de coluna">
              Simular andamento
            </button>
          )}
        </div>
      </header>
      {aviso && <p className="colab-aviso" role="status">{aviso}</p>}
      <div className="kanban" role="list">
        {COLUNAS.map((col) => {
          const cards = tarefasNaColuna(tarefas, col.id);
          return (
            <div key={col.id} className={"kanban-col col-" + col.id} data-colab-coluna={col.id} role="group" aria-label={col.titulo}>
              <div className="kanban-col-tit">
                <span>{col.titulo}</span>
                <i>{cards.length}</i>
              </div>
              {cards.map((t) => (
                <article key={t.id} className={"kanban-card st-" + t.status + (abertaId === t.id ? " aberto" : "")} data-colab-card={t.id} data-colab-status={t.status}>
                  <button type="button" className="kanban-abre" onClick={() => setAbertaId(t.id)}>
                    <span className="kanban-rostos">
                      {rostos(bots, t.para, t.de, mostrarResponsavel).map((b) => <Avatar key={b.id} bot={b} size={28} />)}
                    </span>
                    <strong>{t.objetivo}</strong>
                    <span className="kanban-meta">pediu {nome(t.de)}</span>
                    {mostrarResponsavel && <span className="kanban-meta">com {nome(t.para)}</span>}
                    <span className={"kanban-meta" + (prazoAtrasado(t) ? " atrasado" : "")}>
                      {t.prazo ? `prazo ${quando(t.prazo)}` : "sem prazo"}
                    </span>
                    <span className="kanban-barra" title={t.progresso + "%"}>
                      <i style={{ width: t.progresso + "%" }} />
                    </span>
                    <span className="kanban-pct">{t.progresso}% · {ROTULO_STATUS[t.status]}</span>
                  </button>
                  {podeCancelar(t) && (
                    <button type="button" className="link kanban-cancelar" data-colab="cancelar" onClick={() => onCancelar(t.id)}>
                      Cancelar
                    </button>
                  )}
                </article>
              ))}
              {!cards.length && <p className="kanban-vazio">Nenhuma tarefa</p>}
            </div>
          );
        })}
      </div>
      {aberta && (
        <DetalheTarefa
          tarefa={aberta}
          nome={nome}
          onFechar={() => setAbertaId(null)}
          onCancelar={() => onCancelar(aberta.id)}
          onAbrirBot={onAbrirBot}
          bots={bots}
        />
      )}
    </section>
  );
}

function rostos(bots: BotSummary[] | undefined, para: string, de: string, ambos?: boolean): BotSummary[] {
  if (!bots?.length) return [];
  const quem = bots.filter((b) => b.id === para || (ambos && b.id === de && b.id !== para));
  return quem;
}

function DetalheTarefa({ tarefa, nome, onFechar, onCancelar, onAbrirBot, bots }: {
  tarefa: Tarefa; nome: Nome; onFechar: () => void; onCancelar: () => void;
  onAbrirBot?: (id: string) => void;
  bots?: BotSummary[];
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onFechar]);
  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal colab-detalhe" data-colab="detalhe" role="dialog" aria-modal="true" aria-label={tarefa.objetivo} onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <b>{tarefa.objetivo}</b>
          <button type="button" className="link" onClick={onFechar}>fechar</button>
        </div>
        <p className="kanban-rostos detalhe">
          {rostos(bots, tarefa.para, tarefa.de, true).map((b) => <Avatar key={b.id} bot={b} size={36} />)}
        </p>
        <p className={"colab-selo st-" + tarefa.status} data-colab-status={tarefa.status}>{ROTULO_STATUS[tarefa.status]} · coluna {nomeColuna(tarefa)}</p>
        <dl className="colab-ficha">
          <div><dt>Quem pediu</dt><dd>{nome(tarefa.de)}</dd></div>
          <div><dt>Quem faz</dt><dd>{nome(tarefa.para)}</dd></div>
          <div><dt>Prazo</dt><dd className={prazoAtrasado(tarefa) ? "atrasado" : ""}>{tarefa.prazo ? quando(tarefa.prazo) : "sem prazo"}</dd></div>
          <div><dt>Progresso</dt><dd>{tarefa.progresso}%</dd></div>
          {tarefa.formatoEntrega && <div><dt>Entrega</dt><dd>{tarefa.formatoEntrega}</dd></div>}
          {tarefa.profundidade != null && <div><dt>Profundidade</dt><dd>{tarefa.profundidade}</dd></div>}
        </dl>
        <div className="kanban-barra larga" title={tarefa.progresso + "%"}><i style={{ width: tarefa.progresso + "%" }} /></div>
        {tarefa.contexto && <p><b>Contexto. </b>{tarefa.contexto}</p>}
        {tarefa.criterioSucesso && <p><b>Pronto quando. </b>{tarefa.criterioSucesso}</p>}
        {tarefa.resultado?.resumo && <p><b>Resultado. </b>{tarefa.resultado.resumo}</p>}
        {tarefa.resultado?.motivo && tarefa.status !== "done" && <p><b>Motivo. </b>{tarefa.resultado.motivo}</p>}
        {!!tarefa.resultado?.arquivos?.length && <p><b>Arquivos. </b>{tarefa.resultado.arquivos.join(", ")}</p>}
        <h3>Histórico</h3>
        <ol className="colab-historico" data-colab="historico-tarefa">
          {tarefa.historico.map((passo, i) => (
            <li key={passo.em + "-" + i}>
              <time>{quando(passo.em)}</time>
              <span className={"colab-selo st-" + passo.status}>{ROTULO_STATUS[passo.status]}</span>
              <span>{passo.texto}</span>
            </li>
          ))}
        </ol>
        <div className="dialogo-botoes">
          {onAbrirBot && <button type="button" className="btn" onClick={() => { onAbrirBot(tarefa.para); onFechar(); }}>Abrir conversa de {nome(tarefa.para)}</button>}
          {podeCancelar(tarefa) && <button type="button" className="btn danger" data-colab="cancelar" onClick={onCancelar}>Cancelar tarefa</button>}
        </div>
      </div>
    </div>
  );
}

function nomeColuna(t: Tarefa): string {
  const id = colunaDe(t.status);
  return COLUNAS.find((c) => c.id === id)?.titulo ?? id;
}
