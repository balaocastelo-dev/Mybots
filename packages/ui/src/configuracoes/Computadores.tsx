import { useEffect, useMemo, useState } from "react";
import type { EstadoMaquina, Maquina, TipoMaquina } from "./segredos";
import {
  EMPRESAS_EXEMPLO,
  NOMES_EXEMPLO,
  type PacoteMaquinas,
  aoMudarMaquinas,
  caminhoDoCelular,
  definirAcesso,
  desligarMaquina,
  ligarMaquina,
  listarMaquinas,
} from "./maquinas";
import { Interruptor } from "./Geral";
import { adotarCelular, lerStatusPareamento, parearCelular, type StatusPareamento } from "./pareamento";

const ROTULO: Record<EstadoMaquina, string> = {
  ligado: "Ligado",
  desligado: "Desligado",
  ligando: "Ligando",
  erro: "Erro",
  "sem-provedor": "Sem provedor",
};

const TIPO: Record<TipoMaquina, string> = { pc: "PC", android: "Celular" };

function haQuanto(ms: number | null): string {
  if (ms == null) return "nunca";
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return new Date(ms).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function AbaComputadores({
  bots, empresas,
}: {
  bots: { id: string; name: string }[];
  empresas: { id: string; nome: string }[];
}) {
  const [pacote, setPacote] = useState<PacoteMaquinas | null>(null);
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [falha, setFalha] = useState("");

  const recarregar = async () => {
    setPacote(await listarMaquinas());
  };

  useEffect(() => {
    void recarregar();
    return aoMudarMaquinas(() => { void recarregar(); });
  }, []);

  const nomeBot = (id: string) => bots.find((b) => b.id === id)?.name ?? NOMES_EXEMPLO[id] ?? id;
  const nomeEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nome ?? EMPRESAS_EXEMPLO[id] ?? (id || "sem empresa");

  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const itens = (pacote?.itens ?? []).filter((m) => {
      if (!q) return true;
      const texto = `${nomeBot(m.botId)} ${nomeEmpresa(m.empresaId)} ${TIPO[m.tipo]} ${ROTULO[m.estado]} ${m.estado}`.toLowerCase();
      return texto.includes(q);
    });
    const ordem: string[] = [];
    const mapa = new Map<string, Maquina[]>();
    for (const m of itens) {
      if (!mapa.has(m.botId)) { mapa.set(m.botId, []); ordem.push(m.botId); }
      mapa.get(m.botId)!.push(m);
    }
    return ordem.map((id) => ({ id, itens: mapa.get(id)! }));
  }, [pacote, busca, bots, empresas]);

  const aplicarPc = async (botId: string, trabalho: Promise<Maquina | null>) => {
    setOcupado(botId + ":pc");
    setFalha("");
    try {
      const item = await trabalho;
      if (!item) { setFalha("O Hub não confirmou a mudança."); return; }
      setPacote((p) => p ? { ...p, itens: p.itens.map((m) => (m.botId === item.botId && m.tipo === item.tipo ? item : m)) } : p);
    } finally {
      setOcupado(null);
    }
  };

  const mudarAcesso = async (botId: string, liberado: boolean) => {
    setOcupado(botId + ":acesso");
    setFalha("");
    try {
      const r = await definirAcesso(botId, liberado);
      if (!r) { setFalha("O Hub não confirmou o acesso."); return; }
      setPacote((p) => p ? { ...p, itens: p.itens.map((m) => (m.botId === r.botId ? { ...m, acessoLiberado: r.acessoLiberado } : m)) } : p);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="ajustes-aba" data-aba="computadores">
      <section className="ajustes-grupo">
        <h3>Computadores</h3>
        <p className="ajustes-lead">
          Cada bot tem um PC e um celular. Ligar e desligar o PC passa por <code>/api/maquinas</code>. O acesso vale para os dois.
          O celular só mostra o estado: a tela ao vivo abre em <code>/android/&lt;bot&gt;/</code> e o stream fica lá, não nesta aba.
          {pacote?.origem === "exemplo" && " O Hub desta versão ainda não responde /api/maquinas (isso está no PR #13). A lista é de exemplo e não liga máquina nenhuma."}
          {pacote?.origem === "hub" && " Lista vinda do Hub."}
        </p>
        <input className="ajustes-busca" value={busca} placeholder="Buscar bot, empresa ou estado" aria-label="Buscar computador" onChange={(e) => setBusca(e.target.value)} />
        {falha && <p className="ajustes-erro" role="alert">{falha}</p>}
        {!pacote && <p className="ajustes-lead">Lendo as máquinas…</p>}
        {pacote && !grupos.length && <p className="ajustes-lead">Nenhuma máquina com esse filtro.</p>}
        <ul className="ajustes-maquinas">
          {grupos.map((g) => (
            <li key={g.id}>
              <header>
                <span><b>{nomeBot(g.id)}</b> <small>{nomeEmpresa(g.itens[0].empresaId)}{pacote?.origem === "exemplo" ? " · exemplo" : ""}</small></span>
                <Interruptor
                  ligado={g.itens.every((m) => m.acessoLiberado)}
                  titulo="Acesso"
                  detalhe={g.itens.every((m) => m.acessoLiberado) ? "liberado" : "bloqueado"}
                  rotulo={`Acesso às telas de ${nomeBot(g.id)}`}
                  onChange={(v) => void mudarAcesso(g.id, v)}
                />
              </header>
              {g.itens.map((m) => {
                const chave = `${m.botId}:${m.tipo}`;
                return (
                  <div key={chave} className={"ajustes-maq estado-" + m.estado} data-estado={m.estado} data-tipo={m.tipo}>
                    <div className="ajustes-maq-nome">
                      <b>{TIPO[m.tipo]}</b>
                      <span className={"ajustes-pill estado-" + m.estado}>{ROTULO[m.estado]}</span>
                    </div>
                    <div className="ajustes-maq-meta">
                      <span>Porta {m.porta ?? "—"}</span>
                      <span>Uso {haQuanto(m.ultimoUso)}</span>
                      {m.tipo === "pc" && m.estado === "erro" && <span>Não respondeu. Tentar de novo pede para ligar o PC outra vez.</span>}
                      {m.tipo === "pc" && m.estado === "sem-provedor" && <span>Nenhum provedor registrado para este PC.</span>}
                      {m.tipo === "android" && m.estado === "erro" && <span>O celular não respondeu. O estado fica aqui; a imagem não.</span>}
                      {m.tipo === "android" && m.estado === "sem-provedor" && <span>Nenhum provedor registrado para este celular.</span>}
                      {m.tipo === "android" && m.estado !== "erro" && m.estado !== "sem-provedor" && <span>Só o estado. A imagem abre no link.</span>}
                    </div>
                    <div className="ajustes-maq-acoes">
                      {m.tipo === "pc" ? (
                        <AcaoPc m={m} travado={ocupado === chave} onLigar={() => void aplicarPc(m.botId, ligarMaquina(m.botId))} onDesligar={() => void aplicarPc(m.botId, desligarMaquina(m.botId))} />
                      ) : (
                        <LinkCelular botId={m.botId} />
                      )}
                    </div>
                  </div>
                );
              })}
            </li>
          ))}
        </ul>
        <Pareamento bots={grupos.map((g) => ({ id: g.id, nome: nomeBot(g.id) }))} />
      </section>
    </div>
  );
}

function Pareamento({ bots }: { bots: { id: string; nome: string }[] }) {
  const [botId, setBotId] = useState(bots[0]?.id ?? "");
  const [ip, setIp] = useState("");
  const [porta, setPorta] = useState("");
  const [codigo, setCodigo] = useState("");
  const [portaConexao, setPortaConexao] = useState("");
  const [status, setStatus] = useState<StatusPareamento | null>(null);
  const [recado, setRecado] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [serial, setSerial] = useState("");
  const [adotando, setAdotando] = useState(false);
  const [recadoAdotar, setRecadoAdotar] = useState("");

  useEffect(() => {
    if (!botId) return;
    let vivo = true;
    void lerStatusPareamento(botId).then((s) => { if (vivo) setStatus(s); });
    return () => { vivo = false; };
  }, [botId]);

  useEffect(() => {
    if (botId || !bots[0]) return;
    setBotId(bots[0].id);
  }, [bots, botId]);

  const enviar = async () => {
    setRecado("");
    const pedido = {
      ip,
      porta: Number(porta),
      codigo,
      portaConexao: portaConexao.trim() ? Number(portaConexao) : null,
    };
    setEnviando(true);
    try {
      const r = await parearCelular(botId, pedido);
      setCodigo("");
      if (!r.ok) { setRecado(r.erro ?? "Não pareou."); return; }
      setRecado(r.origem === "exemplo" ? "Anotado só nesta tela. O código não ficou guardado." : "Pareado. O código não fica guardado.");
      setStatus(await lerStatusPareamento(botId));
    } finally {
      setCodigo("");
      setEnviando(false);
    }
  };

  const vincular = async () => {
    setRecadoAdotar("");
    setAdotando(true);
    try {
      const r = await adotarCelular(botId, serial);
      if (!r.ok) { setRecadoAdotar(r.erro ?? "Não vinculei."); return; }
      setSerial("");
      setRecadoAdotar("Vinculado a este bot. O código de pareamento não entrou nisso.");
      setStatus(await lerStatusPareamento(botId));
    } finally {
      setAdotando(false);
    }
  };

  return (
    <>
    <form className="ajustes-form" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
      <h4>Parear celular</h4>
      <p className="ajustes-lead">Mesma rede Wi-Fi. Depuração sem fio no aparelho. A imagem não abre aqui: o link “Abrir tela” é que leva para <code>/android/&lt;bot&gt;/</code>.</p>
      <label>Bot
        <select aria-label="Bot para parear" value={botId} onChange={(e) => setBotId(e.target.value)}>
          {bots.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
        </select>
      </label>
      <label>IP <input value={ip} inputMode="decimal" autoComplete="off" placeholder="192.168.15.20" onChange={(e) => setIp(e.target.value)} /></label>
      <label>Porta de pareamento <input value={porta} inputMode="numeric" autoComplete="off" placeholder="37123" onChange={(e) => setPorta(e.target.value)} /></label>
      <label>Código <input type="password" value={codigo} inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={6} placeholder="6 dígitos" onChange={(e) => setCodigo(e.target.value)} /></label>
      <label>Porta de conexão <input value={portaConexao} inputMode="numeric" autoComplete="off" placeholder="opcional" onChange={(e) => setPortaConexao(e.target.value)} /></label>
      {status && <p className="ajustes-lead">{status.cadastrado ? "Cadastrado" : "Ainda não pareado"} · {status.conectado ? "conectado" : "sem conexão"}{status.origem === "exemplo" ? " · exemplo" : ""}</p>}
      {recado && <p className="ajustes-lead" role="status">{recado}</p>}
      <div className="ajustes-form-acoes">
        <button type="submit" className="btn" disabled={!botId || enviando}>{enviando ? "Pareando…" : "Parear"}</button>
      </div>
    </form>
    <form className="ajustes-form" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void vincular(); }}>
      <h4>Aparelho já conectado</h4>
      <p className="ajustes-lead">Sem código. O serial precisa estar em <code>adb devices</code> como device, por exemplo <code>192.168.15.5:5555</code>.</p>
      <label>Serial <input value={serial} autoComplete="off" spellCheck={false} placeholder="192.168.15.5:5555" onChange={(e) => setSerial(e.target.value)} /></label>
      {recadoAdotar ? <p className="ajustes-lead" role="status">{recadoAdotar}</p> : null}
      <div className="ajustes-form-acoes">
        <button type="submit" className="btn" disabled={!botId || adotando}>{adotando ? "Vinculando…" : "Vincular este aparelho"}</button>
      </div>
    </form>
    </>
  );
}

function AcaoPc({ m, travado, onLigar, onDesligar }: { m: Maquina; travado: boolean; onLigar: () => void; onDesligar: () => void }) {
  if (m.estado === "sem-provedor") return <span className="ajustes-nota">Sem botão de energia</span>;
  if (m.estado === "ligando") return <button type="button" className="btn" disabled>Ligando…</button>;
  if (m.estado === "ligado") return <button type="button" className="btn" disabled={travado} onClick={onDesligar}>Desligar</button>;
  if (m.estado === "erro") return <button type="button" className="btn" disabled={travado} onClick={onLigar}>Tentar de novo</button>;
  return <button type="button" className="btn" disabled={travado} onClick={onLigar}>Ligar</button>;
}

/** Link para a página que o PR do Android já serve. Não abre o WebSocket daqui. */
function LinkCelular({ botId }: { botId: string }) {
  const caminho = caminhoDoCelular(botId);
  if (!caminho) return <span className="ajustes-nota">Sem link de tela</span>;
  const href = caminho + (typeof location !== "undefined" ? location.search : "");
  return <a className="btn" href={href} target="_blank" rel="noreferrer">Abrir tela</a>;
}
