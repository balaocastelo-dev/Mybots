import { useMemo, useState } from "react";
import type { BotSummary } from "@mybots/shared";
import { Avatar, colorFor } from "../avatar";
import { ehGerente } from "../lista";
import { quando } from "./normalizar";
import type { ConversaColab, MensagemColab, PacoteColab } from "./tipos";

type Nome = (id: string) => string;

export function QuemFala({
  pacote,
  bots,
  nome,
  onFechar,
}: {
  pacote: PacoteColab;
  bots: BotSummary[];
  nome: Nome;
  onFechar: () => void;
}) {
  const [modo, setModo] = useState<"grafo" | "linha">("grafo");
  const presentes = useMemo(() => {
    const ids = new Set<string>(bots.map((b) => b.id));
    for (const c of pacote.conversas) for (const id of c.bots) if (id !== "humano") ids.add(id);
    for (const b of bots) for (const id of b.manages ?? []) ids.add(id);
    return [...ids];
  }, [pacote, bots]);
  const [escolhida, setEscolhida] = useState<string>(() => pacote.conversas[0]?.id ?? "");
  const conversa = pacote.conversas.find((c) => c.id === escolhida) ?? pacote.conversas[0];
  const msgs = pacote.mensagens
    .filter((m) => m.conversaId === conversa?.id)
    .sort((a, b) => a.em - b.em);

  return (
    <section className="colab-quadro colab-fala" data-colab="grafo" aria-label="Quem fala com quem">
      <header className="colab-topo">
        <div>
          <button type="button" className="icon-btn" onClick={onFechar} title="Voltar" aria-label="Voltar">←</button>
          <b>Quem fala com quem</b>
          <small>Conversa entre os bots, só para ler</small>
        </div>
        <div className="colab-topo-acoes" role="tablist">
          <button type="button" className={"btn" + (modo === "grafo" ? " primary" : "")} onClick={() => setModo("grafo")} aria-pressed={modo === "grafo"}>Grafo</button>
          <button type="button" className={"btn" + (modo === "linha" ? " primary" : "")} onClick={() => setModo("linha")} aria-pressed={modo === "linha"}>Linha do tempo</button>
        </div>
      </header>
      {pacote.aviso && <p className="colab-aviso" role="status">{pacote.aviso}</p>}
      <div className="colab-fala-corpo">
        <div className="colab-fala-esq">
          {modo === "grafo" ? (
            <Grafo bots={bots} ids={presentes} conversas={pacote.conversas} escolhida={conversa?.id ?? ""} onEscolher={setEscolhida} nome={nome} />
          ) : (
            <LinhaDoTempo mensagens={pacote.mensagens} nome={nome} onEscolher={setEscolhida} />
          )}
          {!!pacote.salas.length && (
            <ul className="colab-salas">
              {pacote.salas.map((s) => (
                <li key={s.id}><b>{s.nome}</b><span>{s.aberta ? "aberta" : "fechada"} · {s.membros.map(nome).join(", ")}</span></li>
              ))}
            </ul>
          )}
        </div>
        <Historico conversa={conversa} mensagens={msgs} bots={bots} nome={nome} />
      </div>
    </section>
  );
}

function fileira(ids: string[], y: number, pos: Map<string, { x: number; y: number }>) {
  const n = ids.length;
  ids.forEach((id, i) => {
    const x = n <= 1 ? 50 : 16 + (i * 68) / (n - 1);
    pos.set(id, { x, y });
  });
}

function Grafo({ ids, conversas, escolhida, onEscolher, nome, bots }: {
  ids: string[];
  conversas: ConversaColab[];
  escolhida: string;
  onEscolher: (id: string) => void;
  nome: Nome;
  bots: BotSummary[];
}) {
  const pos = new Map<string, { x: number; y: number }>();
  const gerentes = ids.filter((id) => {
    const b = bots.find((x) => x.id === id);
    return !!b && ehGerente({ nome: b.name, role: b.role, gerente: b.gerente, manages: b.manages });
  });
  const resto = ids.filter((id) => !gerentes.includes(id));
  if (gerentes.length && resto.length) {
    fileira(gerentes, 26, pos);
    fileira(resto, 74, pos);
  } else {
    fileira(ids, 50, pos);
  }
  const comando = bots.flatMap((b) => (b.manages ?? []).filter((id) => pos.has(b.id) && pos.has(id)).map((id) => ({ de: b.id, para: id })));
  return (
    <div className="colab-grafo" data-colab="mapa">
      <svg viewBox="0 0 100 100" role="img" aria-label="Ligações entre os bots. Gerentes em cima.">
        {comando.map((c) => {
          const pa = pos.get(c.de)!;
          const pb = pos.get(c.para)!;
          return <line key={"m-" + c.de + "-" + c.para} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className="aresta-comanda" />;
        })}
        {conversas.map((c) => {
          const [a, b] = c.bots.filter((id) => pos.has(id));
          if (!a || !b) return null;
          const pa = pos.get(a)!;
          const pb = pos.get(b)!;
          const grosso = 0.7 + Math.min(c.quantas, 8) * 0.25;
          return (
            <line key={c.id} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
              className={c.id === escolhida ? "aresta-fala on" : "aresta-fala"}
              strokeWidth={grosso}
              onClick={() => onEscolher(c.id)}
            />
          );
        })}
      </svg>
      {ids.map((id) => {
        const p = pos.get(id)!;
        const bot = bots.find((b) => b.id === id);
        return (
          <button key={id} type="button" className="colab-no" style={{ left: p.x + "%", top: p.y + "%", borderColor: colorFor(id) }}
            onClick={() => {
              const conv = conversas.find((c) => c.bots.includes(id));
              if (conv) onEscolher(conv.id);
            }}>
            {bot ? <Avatar bot={bot} size={44} /> : <span className="colab-no-letra">{nome(id).slice(0, 1)}</span>}
            <span>{nome(id)}</span>
          </button>
        );
      })}
    </div>
  );
}

function LinhaDoTempo({ mensagens, nome, onEscolher }: {
  mensagens: MensagemColab[];
  nome: Nome;
  onEscolher: (id: string) => void;
}) {
  const ordem = [...mensagens].sort((a, b) => a.em - b.em);
  return (
    <ol className="colab-linha" data-colab="linha">
      {ordem.map((m) => (
        <li key={m.id}>
          <button type="button" onClick={() => onEscolher(m.conversaId)}>
            <time>{quando(m.em)}</time>
            <b>{nome(m.de)}{m.para ? ` → ${nome(m.para)}` : ""}</b>
            <span>{m.texto}</span>
          </button>
        </li>
      ))}
      {!ordem.length && <li className="kanban-vazio">Ainda não há mensagens entre os bots.</li>}
    </ol>
  );
}

function Historico({ conversa, mensagens, bots, nome }: {
  conversa?: ConversaColab;
  mensagens: MensagemColab[];
  bots: BotSummary[];
  nome: Nome;
}) {
  if (!conversa) return <div className="colab-hist" data-colab="historico"><p className="kanban-vazio">Nenhuma conversa entre bots ainda.</p></div>;
  const titulo = conversa.bots.map(nome).join(" e ");
  return (
    <div className="colab-hist" data-colab="historico">
      <header>
        <b>{titulo}</b>
        <small>{conversa.quantas || mensagens.length} mensagens · só leitura</small>
      </header>
      <ol>
        {mensagens.map((m) => {
          const bot = bots.find((b) => b.id === m.de);
          return (
            <li key={m.id} className={m.prioridade ? "prioridade" : ""}>
              <div className="colab-hist-quem">
                {bot && <Avatar bot={bot} size={28} />}
                <b>{m.nomeDe || nome(m.de)}</b>
                <time>{quando(m.em)}</time>
                {m.prioridade && <span className="colab-selo st-running">acordou</span>}
              </div>
              <p>{m.texto}</p>
            </li>
          );
        })}
        {!mensagens.length && <li className="kanban-vazio">A conversa existe, mas o texto ainda não chegou.</li>}
      </ol>
    </div>
  );
}
