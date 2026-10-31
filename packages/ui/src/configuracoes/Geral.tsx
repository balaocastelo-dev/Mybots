import { useEffect, useState } from "react";
import { IDIOMAS, VOZES_PADRAO, definirIdioma, definirVozPadrao, idiomaAtual, vozPadrao, type Idioma } from "../guia";
import { PreferenciaDaCasa, ResetDaCasa, Tamanho, gravarPularAbertura, gravarTema, lerTema, pularAbertura, type TemaNome } from "../tema";

const CHAVE_NOME = "mybots.conta.nome";

function lerNome(): string {
  try { return localStorage.getItem(CHAVE_NOME) ?? ""; } catch { return ""; }
}

export function AbaGeral({
  empresas, botsOnline, botsTotal,
  tts, setTts, handsFree, setHandsFree, avisos, setAvisos,
}: {
  empresas: number;
  botsOnline: number;
  botsTotal: number;
  tts: boolean;
  setTts: (v: boolean) => void;
  handsFree: boolean;
  setHandsFree: (v: boolean) => void;
  avisos: boolean;
  setAvisos: (v: boolean) => void;
}) {
  const [nome, setNome] = useState(lerNome);
  const [tema, setTema] = useState<TemaNome>(lerTema);
  const [idioma, setIdioma] = useState<Idioma>(idiomaAtual);
  const [voz, setVoz] = useState(vozPadrao);
  const [pularIntro, setPularIntro] = useState(pularAbertura);
  const [permissao, setPermissao] = useState<NotificationPermission | "indisponivel">(
    () => (typeof Notification === "undefined" ? "indisponivel" : Notification.permission),
  );

  useEffect(() => {
    const ouvir = (e: Event) => {
      const t = (e as CustomEvent<string>).detail;
      if (t === "claro" || t === "escuro") setTema(t);
    };
    window.addEventListener("mybots-tema", ouvir);
    return () => window.removeEventListener("mybots-tema", ouvir);
  }, []);

  const guardarNome = (valor: string) => {
    setNome(valor);
    try { localStorage.setItem(CHAVE_NOME, valor.slice(0, 80)); } catch { /* privado */ }
  };

  const escolherTema = (t: TemaNome) => {
    setTema(t);
    gravarTema(t);
  };

  const escolherIdioma = (l: Idioma) => {
    setIdioma(l);
    definirIdioma(l);
  };

  const mudarAvisos = async (ligar: boolean) => {
    if (ligar && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      try {
        const p = await Notification.requestPermission();
        setPermissao(p);
        if (p !== "granted") { setAvisos(false); return; }
      } catch {
        setPermissao("denied");
        setAvisos(false);
        return;
      }
    }
    setAvisos(ligar);
  };

  return (
    <div className="ajustes-aba" data-aba="geral">
      <section className="ajustes-grupo">
        <h3>Conta</h3>
        <p className="ajustes-lead">O nome que os avisos deste navegador usam. O login da casa ainda não entra nesta versão: fica só aqui.</p>
        <label className="ajustes-linha">
          <span>Seu nome</span>
          <input value={nome} maxLength={80} placeholder="Chefe" autoComplete="nickname" onChange={(e) => guardarNome(e.target.value)} />
        </label>
        <div className="ajustes-linha">
          <span>Nesta casa</span>
          <b>{empresas} {empresas === 1 ? "empresa" : "empresas"} · {botsOnline} de {botsTotal} bots online</b>
        </div>
      </section>

      <section className="ajustes-grupo">
        <h3>Tema</h3>
        <p className="ajustes-lead">O mesmo controle do topo da lista. Claro é o Balcão; escuro é a Bancada.</p>
        <div className="ajustes-temas" role="group" aria-label="Tema">
          <button type="button" className={tema === "claro" ? "on" : ""} aria-pressed={tema === "claro"} onClick={() => escolherTema("claro")}>
            <i className="ajustes-amostra claro" /> Balcão, claro
          </button>
          <button type="button" className={tema === "escuro" ? "on" : ""} aria-pressed={tema === "escuro"} onClick={() => escolherTema("escuro")}>
            <i className="ajustes-amostra escuro" /> Bancada, escuro
          </button>
        </div>
      </section>

      <section className="ajustes-grupo">
        <h3>Escala</h3>
        <p className="ajustes-lead">O mesmo zoom do topo da lista. A casa inteira cresce junto, de 80% a 150%.</p>
        <Tamanho />
        <Interruptor
          ligado={pularIntro}
          onChange={(v) => { setPularIntro(v); gravarPularAbertura(v); }}
          titulo="Pular abertura"
          detalhe="Na próxima vez o painel abre direto, sem as partículas."
        />
      </section>

      <section className="ajustes-grupo">
        <h3>Idioma</h3>
        <p className="ajustes-lead">A voz do guia e a língua da casa. Os menus do painel continuam em português.</p>
        <div className="ajustes-idiomas" role="group" aria-label="Idioma da casa">
          {IDIOMAS.map((i) => (
            <button key={i.id} type="button" className={idioma === i.id ? "on" : ""} aria-pressed={idioma === i.id} onClick={() => escolherIdioma(i.id)}>
              <span className="idioma-cod">{i.cod}</span> {i.nome}
            </button>
          ))}
        </div>
      </section>

      <section className="ajustes-grupo">
        <h3>Voz padrão</h3>
        <p className="ajustes-lead">A voz da casa. O guia e a leitura usam esta, no lugar de sortear a do navegador.</p>
        <label className="ajustes-linha">
          <span>Voz</span>
          <select aria-label="Voz padrão" value={voz} onChange={(e) => { setVoz(e.target.value); definirVozPadrao(e.target.value); }}>
            {VOZES_PADRAO.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
          </select>
        </label>
      </section>

      <section className="ajustes-grupo">
        <h3>Notificações</h3>
        <Interruptor ligado={tts} onChange={setTts} titulo="Ler as respostas em voz" detalhe="O bot fala o que escreveu." />
        <Interruptor ligado={handsFree} onChange={setHandsFree} titulo="Mãos livres" detalhe="Volta a escutar depois que o bot fala." />
        <Interruptor ligado={avisos} onChange={(v) => void mudarAvisos(v)} titulo="Avisos do navegador" detalhe={
          permissao === "denied" ? "O navegador bloqueou. Libere o site para os avisos voltarem." :
          permissao === "indisponivel" ? "Este navegador não mostra aviso do sistema." :
          "Mensagem com a aba escondida, e também aprovação, pergunta e aviso do bot."
        } />
      </section>

      <section className="ajustes-grupo">
        <h3>Quem atende primeiro</h3>
        <p className="ajustes-lead">Nuvem ou a IA local desta máquina. Vale para a casa inteira.</p>
        <PreferenciaDaCasa />
      </section>

      <section className="ajustes-grupo">
        <h3>Zona de perigo</h3>
        <ResetDaCasa />
      </section>
    </div>
  );
}

export function Interruptor({ ligado, onChange, titulo, detalhe, rotulo }: {
  ligado: boolean; onChange: (v: boolean) => void; titulo: string; detalhe?: string; rotulo?: string;
}) {
  return (
    <div className="ajustes-linha">
      <span>
        <b>{titulo}</b>
        {detalhe && <small>{detalhe}</small>}
      </span>
      <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo ?? titulo} className={"ajustes-switch" + (ligado ? " on" : "")} onClick={() => onChange(!ligado)}>
        <i />
      </button>
    </div>
  );
}
