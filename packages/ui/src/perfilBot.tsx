import { useEffect, useRef, useState } from "react";
import type { BotSummary, Routine } from "@mybots/shared";
import {
  IDIOMAS_FALA, ROTINAS_VAZIAS, VELOCIDADE_PADRAO, VOZES_NEURAIS_PT,
  agruparBiblioteca, frequenciaDaRotina, type PerfilVoz,
} from "@mybots/shared";
import { api, UI_BASE } from "./api";
import { Avatar } from "./avatar";
import type { Tarefa } from "./colab/tipos";

export type AbaPerfil = "detalhes" | "biblioteca" | "computador";

type ItemBib = { id: string; nome: string; mime: string; quando: number; tipo: string; url: string };

const ABAS: Array<{ id: AbaPerfil; nome: string }> = [
  { id: "detalhes", nome: "Detalhes" },
  { id: "biblioteca", nome: "Biblioteca" },
  { id: "computador", nome: "Computador" },
];

function comSessao(caminho: string) {
  if (typeof location === "undefined") return caminho;
  const s = location.search;
  if (!s || s === "?") return caminho;
  return caminho + (caminho.includes("?") ? "&" + s.slice(1) : s);
}

function itensAgora(bot: BotSummary, tarefas: Tarefa[]) {
  const linhas = tarefas.map((t) => ({
    id: t.id,
    titulo: t.objetivo,
    feito: t.status === "done",
  }));
  if (bot.busy) linhas.unshift({ id: "agora", titulo: bot.status?.trim() || "Trabalhando agora", feito: false });
  const abertas = linhas.filter((l) => !l.feito);
  const feitas = linhas.filter((l) => l.feito);
  return [...abertas, ...feitas].slice(0, 12);
}

/**
 * Perfil do bot. O nome no topo do chat abre isto.
 * Três abas: o que ele faz, os arquivos dele, e o computador dele.
 */
export function PerfilDoBot({
  bot, routines, tarefas, onFechar, abaInicial = "detalhes", perfilInicial, arquivosIniciais, faseComputador,
}: {
  bot: BotSummary;
  routines: Routine[];
  tarefas: Tarefa[];
  onFechar: () => void;
  abaInicial?: AbaPerfil;
  perfilInicial?: PerfilVoz;
  arquivosIniciais?: ItemBib[];
  faseComputador?: "acordando" | "vivo" | "erro";
}) {
  const [aba, setAba] = useState<AbaPerfil>(abaInicial);
  const [perfil, setPerfil] = useState<PerfilVoz | null>(perfilInicial ?? null);
  const [avisoVoz, setAvisoVoz] = useState("");
  const [arquivos, setArquivos] = useState<ItemBib[] | null>(arquivosIniciais ?? null);
  const [fase, setFase] = useState<"acordando" | "vivo" | "erro">(faseComputador ?? "acordando");
  const [erroPc, setErroPc] = useState("");
  const [tela, setTela] = useState("");
  const [soAssistir, setSoAssistir] = useState(true);
  const [cheio, setCheio] = useState(false);
  const telaRef = useRef<HTMLDivElement | null>(null);
  const velTimer = useRef<number | null>(null);
  const fecharRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const t = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", t);
    fecharRef.current?.focus();
    return () => window.removeEventListener("keydown", t);
  }, [onFechar]);

  useEffect(() => {
    if (perfilInicial) return;
    let vivo = true;
    api(`/bots/${encodeURIComponent(bot.id)}/voz`).then(async (r) => {
      if (!vivo) return;
      if (!r.ok) {
        setPerfil({ voice: VOZES_NEURAIS_PT[0].id, rate: VELOCIDADE_PADRAO, lang: "auto" });
        return;
      }
      const d = await r.json();
      setPerfil({ voice: d.voice, rate: Number(d.rate) || VELOCIDADE_PADRAO, lang: d.lang || "auto" });
    }).catch(() => {
      if (vivo) setPerfil({ voice: VOZES_NEURAIS_PT[0].id, rate: VELOCIDADE_PADRAO, lang: "auto" });
    });
    return () => { vivo = false; };
  }, [bot.id, perfilInicial]);

  useEffect(() => {
    if (aba !== "biblioteca" || arquivosIniciais) return;
    let vivo = true;
    const p = new URLSearchParams();
    p.set("bot", bot.id);
    fetch(comSessao(`${UI_BASE}/api/arquivos?${p.toString()}`), { credentials: "include" })
      .then(async (r) => {
        if (!vivo) return;
        if (!r.ok) { setArquivos([]); return; }
        const d = await r.json();
        setArquivos(Array.isArray(d.itens) ? d.itens : []);
      })
      .catch(() => { if (vivo) setArquivos([]); });
    return () => { vivo = false; };
  }, [aba, bot.id, arquivosIniciais]);

  const acordar = () => {
    if (faseComputador) return;
    setFase("acordando");
    setErroPc("");
    api(`/bots/${encodeURIComponent(bot.id)}/computador`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErroPc(d.error || "Não consegui acordar o computador."); setFase("erro"); return; }
      if (d.tela) { setTela(String(d.tela)); setFase("vivo"); return; }
      setErroPc(d.erro || "O computador não acordou.");
      setFase("erro");
    }).catch(() => { setErroPc("Sem resposta do Hub."); setFase("erro"); });
  };

  useEffect(() => {
    if (aba === "computador") acordar();
  }, [aba, bot.id]);

  const salvar = async (parcial: Partial<PerfilVoz>) => {
    const base = perfil ?? { voice: VOZES_NEURAIS_PT[0].id, rate: VELOCIDADE_PADRAO, lang: "auto" };
    const otimista = { ...base, ...parcial };
    setPerfil(otimista);
    setAvisoVoz("");
    const r = await api(`/bots/${encodeURIComponent(bot.id)}/voz`, { method: "PATCH", body: JSON.stringify(parcial) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setAvisoVoz(d.error || "Não consegui salvar."); return; }
    setPerfil({ voice: d.voice, rate: Number(d.rate) || otimista.rate, lang: d.lang || otimista.lang });
    setAvisoVoz("Salvo");
  };

  const telaCheia = () => {
    const el = telaRef.current;
    if (!el) return;
    if (document.fullscreenElement) { void document.exitFullscreen(); setCheio(false); return; }
    void el.requestFullscreen?.().then(() => setCheio(true)).catch(() => setCheio(true));
  };

  const rotinas = routines.filter((r) => r.botId === bot.id);
  const agora = itensAgora(bot, tarefas);
  const grupos = agruparBiblioteca(arquivos ?? []);
  const vozAtual = perfil?.voice ?? "";
  const opcoes = [...VOZES_NEURAIS_PT];
  if (vozAtual.startsWith("clone:") && !opcoes.some((v) => v.id === vozAtual)) {
    opcoes.unshift({ id: vozAtual, nome: "Voz da casa", genero: "clonada" });
  }

  return (
    <div className="perfil-fundo" role="presentation" onClick={onFechar}>
      <div className="perfil-folha" role="dialog" aria-modal="true" aria-label={`Perfil de ${bot.name}`} onClick={(e) => e.stopPropagation()}>
        <header className="perfil-topo">
          <Avatar bot={bot} size={44} />
          <div>
            <b>{bot.name}</b>
            <small>{bot.role}</small>
          </div>
          <button ref={fecharRef} className="icon-btn perfil-fechar" type="button" aria-label="Fechar" onClick={onFechar}>×</button>
        </header>
        <div className="perfil-abas" role="tablist" aria-label="Perfil do bot">
          {ABAS.map((a) => (
            <button key={a.id} type="button" role="tab" id={`perfil-aba-${a.id}`} aria-selected={aba === a.id} aria-controls={`perfil-painel-${a.id}`} onClick={() => setAba(a.id)}>
              {a.nome}
            </button>
          ))}
        </div>
        <div className="perfil-corpo" role="tabpanel" id={`perfil-painel-${aba}`} aria-labelledby={`perfil-aba-${aba}`}>
          {aba === "detalhes" && (
            <>
              <section className="perfil-secao">
                <h3>Agora</h3>
                {agora.length === 0 && <p className="perfil-vazio">Nada em andamento agora.</p>}
                <ul className="perfil-checks">
                  {agora.map((l) => (
                    <li key={l.id}>
                      <label>
                        <input type="checkbox" checked={l.feito} readOnly tabIndex={-1} />
                        <span>{l.titulo}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="perfil-secao">
                <h3>Rotinas</h3>
                {rotinas.length === 0 && <p className="perfil-vazio">{ROTINAS_VAZIAS}</p>}
                <ul className="perfil-rotinas">
                  {rotinas.map((r) => (
                    <li key={r.id}>
                      <b>{r.name}</b>
                      <small>{frequenciaDaRotina(r.cron)}{r.enabled ? "" : " · pausada"}</small>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="perfil-secao">
                <h3>Chat de voz</h3>
                <div className="perfil-linha">
                  <span>Voz</span>
                  <select aria-label="Voz" value={vozAtual} disabled={!perfil} onChange={(e) => void salvar({ voice: e.target.value })}>
                    {!vozAtual && <option value="">…</option>}
                    {opcoes.map((v) => <option key={v.id} value={v.id}>{v.nome} · {v.genero}</option>)}
                  </select>
                </div>
                <div className="perfil-linha">
                  <span>Velocidade</span>
                  <label className="perfil-vel">
                    <input aria-label="Velocidade" type="range" min={0.5} max={2} step={0.1} value={perfil?.rate ?? VELOCIDADE_PADRAO} disabled={!perfil}
                      onChange={(e) => {
                        const rate = Number(e.target.value);
                        setPerfil((p) => p ? { ...p, rate } : p);
                        if (velTimer.current) window.clearTimeout(velTimer.current);
                        velTimer.current = window.setTimeout(() => void salvar({ rate }), 280);
                      }} />
                    <b>{(perfil?.rate ?? VELOCIDADE_PADRAO).toFixed(1)}x</b>
                  </label>
                </div>
                <div className="perfil-linha">
                  <span>Idioma</span>
                  <select aria-label="Idioma" value={perfil?.lang ?? "auto"} disabled={!perfil} onChange={(e) => void salvar({ lang: e.target.value })}>
                    {IDIOMAS_FALA.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                  </select>
                </div>
                {avisoVoz && <p className={"perfil-aviso" + (avisoVoz === "Salvo" ? " ok" : "")}>{avisoVoz}</p>}
              </section>
            </>
          )}
          {aba === "biblioteca" && (
            <section className="perfil-secao">
              {arquivos === null && <p className="perfil-vazio">Carregando…</p>}
              {arquivos?.length === 0 && <p className="perfil-vazio">Nada deste bot ainda.</p>}
              {grupos.map((g) => (
                <div key={g.id} className="perfil-grupo">
                  <h3>{g.titulo}</h3>
                  <div className="perfil-grade">
                    {g.itens.map((f) => (
                      <figure key={f.id} className="perfil-card">
                        {f.tipo === "imagem" || f.mime.startsWith("image/")
                          ? <a href={f.url} target="_blank" rel="noopener"><img src={f.url} alt={f.nome} /></a>
                          : f.tipo === "video" || f.mime.startsWith("video/")
                            ? <video src={f.url} controls preload="metadata" playsInline />
                            : <a className="perfil-doc" href={f.url} target="_blank" rel="noopener">{f.nome}</a>}
                        {(f.tipo === "imagem" || f.tipo === "video" || f.mime.startsWith("image/") || f.mime.startsWith("video/")) && <figcaption>{f.nome}</figcaption>}
                      </figure>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
          {aba === "computador" && (
            <section className="perfil-secao">
              <div className={"perfil-tela" + (cheio ? " cheio" : "")} ref={telaRef}>
                {fase === "acordando" && (
                  <div className="perfil-acordando">
                    <span className="gira-lento" aria-hidden />
                    <p>Acordando computador...</p>
                  </div>
                )}
                {fase === "erro" && (
                  <div className="perfil-acordando">
                    <p>{erroPc}</p>
                    <button className="btn" type="button" onClick={acordar}>Tentar de novo</button>
                  </div>
                )}
                {fase === "vivo" && tela && (
                  <iframe className={soAssistir ? "so-ver" : ""} src={comSessao(tela)} title={`Computador de ${bot.name}`} allow="clipboard-read; clipboard-write" />
                )}
                {fase === "vivo" && !tela && faseComputador === "vivo" && (
                  <div className="perfil-acordando"><p>Tela ao vivo</p></div>
                )}
                {soAssistir && fase === "vivo" && <div className="perfil-velo" aria-hidden />}
              </div>
              <div className="perfil-controles">
                <button type="button" className="btn" aria-pressed={soAssistir} onClick={() => setSoAssistir(true)}>Só assistir</button>
                <button type="button" className="btn" aria-pressed={!soAssistir} onClick={() => setSoAssistir(false)}>Assumir controle</button>
                <button type="button" className="btn" onClick={telaCheia}>Tela cheia</button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
