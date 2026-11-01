import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

/**
 * As duas telas do bot, no painel da direita.
 *
 * O PC abre em /pc/<botId>/ e o Android (ws-scrcpy) em /android/<botId>/.
 * Cada quadro guarda a proporção da tela remota e ocupa exatamente essa
 * caixa: sem faixa em volta da imagem. No painel estreito os dois empilham;
 * no largo ficam lado a lado, na mesma altura.
 *
 * O clique na miniatura do PC não entra na tela — abre ela grande. Lá o
 * mouse e o teclado vão para o iframe. Fecha no X, no fundo ou no Esc.
 */

const RAZAO_PC: [number, number] = [16, 9];
/** Proporção do telefone: um pouco menos "fino" para caber legível no painel. */
const RAZAO_FONE: [number, number] = [9, 18.5];
const FOLGA = 8;
const EMPILHA_ABAIXO = 520;
/** Largura confortável do aparelho no painel Celular (px). */
const FONE_LARGURA_MIN = 300;
const FONE_LARGURA_MAX = 480;

type EstadoRota = "lendo" | "pronta" | "ausente";
type StatusAndroid =
  | { tipo: "lendo" }
  | { tipo: "sem-api" }
  | { tipo: "ok"; conectado: boolean; cadastrado: boolean };

function comChave(caminho: string) {
  const s = location.search;
  if (!s || s === "?") return caminho;
  return caminho + (caminho.includes("?") ? "&" + s.slice(1) : s);
}

function useRota(url: string): EstadoRota {
  const [estado, setEstado] = useState<EstadoRota>("lendo");
  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      const ac = new AbortController();
      const t = window.setTimeout(() => ac.abort(), 5000);
      try {
        const r = await fetch(url, { signal: ac.signal, headers: { accept: "text/html" } });
        await r.body?.cancel().catch(() => {});
        if (!vivo) return;
        setEstado(r.ok ? "pronta" : "ausente");
      } catch {
        if (vivo) setEstado("ausente");
      } finally {
        window.clearTimeout(t);
      }
    };
    void ler();
    const id = window.setInterval(() => void ler(), 8000);
    return () => { vivo = false; window.clearInterval(id); };
  }, [url]);
  return estado;
}

function useStatusAndroid(botId: string): StatusAndroid {
  const [status, setStatus] = useState<StatusAndroid>({ tipo: "lendo" });
  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      try {
        const r = await fetch(comChave(`/api/bots/${encodeURIComponent(botId)}/android/status`));
        if (!vivo) return;
        if (r.status === 404) { setStatus({ tipo: "sem-api" }); return; }
        if (!r.ok) { setStatus({ tipo: "sem-api" }); return; }
        const d = await r.json() as { conectado?: boolean; cadastrado?: boolean };
        setStatus({ tipo: "ok", conectado: !!d.conectado, cadastrado: !!d.cadastrado });
      } catch {
        if (vivo) setStatus({ tipo: "sem-api" });
      }
    };
    void ler();
    const id = window.setInterval(() => void ler(), 4000);
    return () => { vivo = false; window.clearInterval(id); };
  }, [botId]);
  return status;
}

function medirUma(largura: number, altura: number, razao: [number, number], lim?: { min?: number; max?: number; priorizarLargura?: boolean }) {
  const [rw, rh] = razao;
  // No modo celular priorizamos largura legível: não encolhemos abaixo do mínimo
  // só porque a altura do painel é baixa (o .telas-fit pode rolar).
  if (lim?.priorizarLargura) {
    let w = Math.floor(largura);
    if (lim.max) w = Math.min(w, lim.max);
    if (lim.min) w = Math.max(w, Math.min(lim.min, largura));
    w = Math.max(0, w);
    return { w, h: Math.max(0, Math.floor(w * rh / rw)) };
  }
  let w = Math.floor(Math.min(largura, altura > 0 ? altura * rw / rh : largura));
  if (lim?.max) w = Math.min(w, lim.max);
  if (lim?.min) w = Math.max(w, Math.min(lim.min, largura));
  w = Math.max(0, w);
  const h = Math.max(0, Math.floor(w * rh / rw));
  if (h > altura && altura > 0) {
    const h2 = altura;
    const w2 = Math.floor(h2 * rw / rh);
    return { w: Math.max(0, w2), h: h2 };
  }
  return { w, h };
}

function medirPar(largura: number, altura: number, empilhado: boolean) {
  const [pw, ph] = RAZAO_PC;
  const [fw, fh] = RAZAO_FONE;
  if (empilhado) {
    const k = ph / pw + fh / fw;
    const w = Math.max(0, Math.floor(Math.min(largura, (altura - FOLGA) / k)));
    return { w, h: Math.floor(w * k + FOLGA) };
  }
  const s = pw / ph + fw / fh;
  const h = Math.max(0, Math.floor(Math.min(altura, (largura - FOLGA) / s)));
  return { w: Math.floor(h * s + FOLGA), h };
}

function textoDaRotaPc(rota: EstadoRota) {
  if (rota === "lendo") return "Abrindo a tela do PC…";
  return "A tela do PC ainda não está disponível.";
}

function textoDoAndroid(status: StatusAndroid, rota: EstadoRota) {
  if (status.tipo === "lendo") return "Lendo o aparelho…";
  if (status.tipo === "sem-api") return "A tela do Android ainda não está disponível.";
  if (!status.cadastrado) return "Nenhum Android pareado com este bot.";
  if (!status.conectado) return "O aparelho está desconectado.";
  if (rota === "lendo") return "Abrindo a tela do Android…";
  if (rota !== "pronta") return "A tela do Android ainda não está disponível.";
  return "";
}

function rotuloStatus(status: StatusAndroid) {
  if (status.tipo === "lendo") return "Lendo o aparelho…";
  if (status.tipo === "sem-api") return "Ainda não disponível";
  if (!status.cadastrado) return "Sem aparelho";
  return status.conectado ? "Conectado" : "Desconectado";
}

export function TelasDoBot({ botId, nome, mostrarPareamento = false, modo = "ambos" }: {
  botId: string;
  nome: string;
  mostrarPareamento?: boolean;
  /** pc = só Meu PC; celular = só Android; ambos = legado empilhado */
  modo?: "pc" | "celular" | "ambos";
}) {
  const fitRef = useRef<HTMLDivElement | null>(null);
  const [caixa, setCaixa] = useState({ w: 0, h: 0, empilhado: false });
  const [ampliado, setAmpliado] = useState(false);
  const pcUrl = comChave(`/pc/${encodeURIComponent(botId)}/`);
  const androidUrl = comChave(`/android/${encodeURIComponent(botId)}/`);
  const rotaPc = useRota(pcUrl);
  const rotaAndroid = useRota(androidUrl);
  const status = useStatusAndroid(botId);

  useEffect(() => {
    const el = fitRef.current;
    if (!el) return;
    const ler = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setCaixa({ w, h, empilhado: modo !== "ambos" ? true : w < EMPILHA_ABAIXO });
    };
    ler();
    const ro = new ResizeObserver(ler);
    ro.observe(el);
    return () => ro.disconnect();
  }, [modo]);

  const par = (() => {
    if (!(caixa.w > 0 && caixa.h > 0)) return null;
    if (modo === "celular") return medirUma(caixa.w, caixa.h, RAZAO_FONE, { min: FONE_LARGURA_MIN, max: FONE_LARGURA_MAX, priorizarLargura: true });
    if (modo === "pc") return medirUma(caixa.w, caixa.h, RAZAO_PC);
    return medirPar(caixa.w, caixa.h, caixa.empilhado);
  })();
  const androidPronto = status.tipo === "ok" && status.cadastrado && status.conectado && rotaAndroid === "pronta";
  const avisoAndroid = textoDoAndroid(status, rotaAndroid);

  return (
    <div className={"telas-bot" + (modo === "celular" ? " modo-celular" : modo === "pc" ? " modo-pc" : "")}>
      <div className="telas-fit" ref={fitRef}>
        {par && (
          <div
            className={"telas-par" + (caixa.empilhado ? " empilhado" : "")}
            style={{ width: par.w, height: par.h }}
          >
            {modo !== "celular" && (
            <div className={"quadro quadro-pc" + (modo === "pc" ? " sozinho" : "")}>
              {rotaPc === "pronta" && !ampliado
                ? <iframe src={pcUrl} title={`Tela do PC de ${nome || botId}`} tabIndex={-1} />
                : <div className="quadro-estado">{ampliado && rotaPc === "pronta" ? "Aberto em tela grande" : textoDaRotaPc(rotaPc)}</div>}
              <button
                className="quadro-abre"
                type="button"
                title="Abrir a tela do PC"
                aria-label={`Abrir a tela do PC de ${nome || botId}`}
                onClick={() => setAmpliado(true)}
              />
            </div>
            )}
            {modo !== "pc" && (
            <div className={"quadro quadro-android" + (modo === "celular" ? " sozinho" : "")} aria-label={`Android de ${nome || botId}`}>
              {androidPronto
                ? <iframe src={androidUrl} title={`Android de ${nome || botId}`} allow="clipboard-read; clipboard-write" />
                : <div className="quadro-estado">{avisoAndroid}</div>}
            </div>
            )}
          </div>
        )}
      </div>

      {modo !== "pc" && <div className={"android-status" + (status.tipo === "ok" && status.conectado ? " on" : "")} aria-live="polite">
        <i className={"pc-luz" + (status.tipo === "ok" && status.conectado ? " on" : status.tipo === "ok" && status.cadastrado ? " frio" : "")} />
        <span>Android · {rotuloStatus(status)}</span>
      </div>}

      {mostrarPareamento && modo !== "pc" && <ParearAndroid botId={botId} />}

      {ampliado && (
        <PcAmpliado
          nome={nome || botId}
          url={pcUrl}
          pronta={rotaPc === "pronta"}
          onFechar={() => setAmpliado(false)}
        />
      )}
    </div>
  );
}

function PcAmpliado({ nome, url, pronta, onFechar }: {
  nome: string;
  url: string;
  pronta: boolean;
  onFechar: () => void;
}) {
  const iframe = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onFechar();
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onFechar]);

  useEffect(() => {
    const el = iframe.current;
    if (!el) return;
    const focar = () => {
      try {
        const doc = el.contentDocument;
        const alvo = (doc?.querySelector("canvas, video, input, textarea") ?? doc?.body) as HTMLElement | null;
        (alvo ?? el).focus();
      } catch {
        el.focus();
      }
    };
    el.addEventListener("load", focar);
    focar();
    return () => el.removeEventListener("load", focar);
  }, [pronta]);

  const razao = `${RAZAO_PC[0]} / ${RAZAO_PC[1]}`;

  return (
    <div className="pc-ampliado-fundo" role="presentation" onClick={onFechar}>
      <div
        className="pc-ampliado"
        role="dialog"
        aria-modal="true"
        aria-label={`Tela do PC de ${nome}`}
        style={{ "--razao-pc": razao } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="pc-ampliado-x" type="button" aria-label="Fechar a tela do PC" title="Fechar" onClick={onFechar}>×</button>
        {pronta
          ? <iframe ref={iframe} src={url} title={`Tela do PC de ${nome}`} allow="clipboard-read; clipboard-write; fullscreen" tabIndex={0} />
          : <div className="quadro-estado">{textoDaRotaPc("ausente")}</div>}
      </div>
    </div>
  );
}

type CelularListado = { serial: string; modelo?: string; estado?: string };

function ParearAndroid({ botId }: { botId: string }) {
  const [ip, setIp] = useState("");
  const [porta, setPorta] = useState("");
  const [codigo, setCodigo] = useState("");
  const [portaConexao, setPortaConexao] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [lista, setLista] = useState<CelularListado[]>([]);
  const [usando, setUsando] = useState("");

  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      try {
        const r = await fetch(comChave("/api/celulares"));
        if (!vivo || !r.ok) return;
        const d = await r.json() as { lista?: CelularListado[] };
        setLista((d.lista ?? []).filter((c) => (c.estado ?? "device") === "device"));
      } catch { /* hub offline */ }
    };
    void ler();
    const id = window.setInterval(() => void ler(), 5000);
    return () => { vivo = false; window.clearInterval(id); };
  }, []);

  const usar = async (serial: string) => {
    setErro("");
    setUsando(serial);
    try {
      const r = await fetch(comChave(`/api/bots/${encodeURIComponent(botId)}/android/usar`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serial }),
      });
      const d = await r.json().catch(() => ({} as { ok?: boolean; erro?: string }));
      if (!r.ok || d.ok === false) {
        setErro(d.erro || "Não consegui vincular este aparelho ao bot.");
        return;
      }
    } catch {
      setErro("O Hub não respondeu.");
    } finally {
      setUsando("");
    }
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro("");
    let host = ip.trim();
    let portaPareamento = porta.trim();
    const cortar = host.match(/^(.+):(\d+)$/);
    if (cortar && !portaPareamento) {
      host = cortar[1];
      portaPareamento = cortar[2];
    }
    const nPorta = Number(portaPareamento);
    if (!host || !Number.isFinite(nPorta) || nPorta <= 0) {
      setErro("Informe o IP e a porta de pareamento.");
      return;
    }
    if (!codigo.trim()) {
      setErro("Informe o código de pareamento.");
      return;
    }
    const corpo: { ip: string; porta: number; codigo: string; portaConexao?: number } = {
      ip: host,
      porta: nPorta,
      codigo: codigo.trim(),
    };
    if (portaConexao.trim()) {
      const n = Number(portaConexao);
      if (!Number.isFinite(n) || n <= 0) {
        setErro("A porta de conexão precisa ser um número.");
        return;
      }
      corpo.portaConexao = n;
    }
    setEnviando(true);
    try {
      const r = await fetch(comChave(`/api/bots/${encodeURIComponent(botId)}/android/pair`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const d = await r.json().catch(() => ({} as { ok?: boolean; erro?: string }));
      if (!r.ok || d.ok === false) {
        setErro(d.erro || (r.status === 404 ? "O pareamento ainda não está disponível." : "Não consegui parear o aparelho."));
        return;
      }
      setCodigo("");
    } catch {
      setErro("O Hub não respondeu.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="android-parear-bloco">
      {lista.length > 0 && (
        <div className="android-ja-conectados">
          <p className="android-dica">Aparelhos já no adb — um clique vincula a este bot:</p>
          <ul className="android-lista-adb">
            {lista.map((c) => (
              <li key={c.serial}>
                <div className="android-lista-info">
                  <b>{c.modelo || "Android"}</b>
                  <span className="android-lista-serial">{c.serial}</span>
                </div>
                <button
                  className="btn primary"
                  type="button"
                  disabled={usando === c.serial}
                  onClick={() => void usar(c.serial)}
                >{usando === c.serial ? "Vinculando…" : "Usar neste bot"}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form className="form android-parear" onSubmit={(e) => void enviar(e)}>
        <p className="android-dica">Ou pareie um aparelho novo (Android 11+):</p>
        <div className="row">
          <label>IP
            <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.0.10" autoComplete="off" />
          </label>
          <label>Porta de pareamento
            <input value={porta} onChange={(e) => setPorta(e.target.value)} inputMode="numeric" placeholder="37123" autoComplete="off" />
          </label>
        </div>
        <div className="row">
          <label>Código
            <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="código de 6 dígitos" autoComplete="off" />
          </label>
          <label>Porta de conexão
            <input value={portaConexao} onChange={(e) => setPortaConexao(e.target.value)} inputMode="numeric" placeholder="opcional" autoComplete="off" />
          </label>
        </div>
        <p className="android-dica">No Android 11 ou mais novo a porta de pareamento é diferente da porta de conexão. A de conexão é opcional.</p>
        {erro && <p className="android-erro" role="alert">{erro}</p>}
        <button className="btn primary" type="submit" disabled={enviando}>{enviando ? "Pareando…" : "Parear"}</button>
      </form>
    </div>
  );
}
