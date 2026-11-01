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
const RAZAO_FONE: [number, number] = [9, 19.5];
const FOLGA = 8;
const EMPILHA_ABAIXO = 520;

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

export function TelasDoBot({ botId, nome, mostrarPareamento }: {
  botId: string;
  nome: string;
  mostrarPareamento: boolean;
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
      setCaixa({ w, h, empilhado: w < EMPILHA_ABAIXO });
    };
    ler();
    const ro = new ResizeObserver(ler);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const par = caixa.w > 0 && caixa.h > 0 ? medirPar(caixa.w, caixa.h, caixa.empilhado) : null;
  const androidPronto = status.tipo === "ok" && status.cadastrado && status.conectado && rotaAndroid === "pronta";
  const avisoAndroid = textoDoAndroid(status, rotaAndroid);

  return (
    <div className="telas-bot">
      <div className="telas-fit" ref={fitRef}>
        {par && (
          <div
            className={"telas-par" + (caixa.empilhado ? " empilhado" : "")}
            style={{ width: par.w, height: par.h }}
          >
            <div className="quadro quadro-pc">
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
            <div className="quadro quadro-android" aria-label={`Android de ${nome || botId}`}>
              {androidPronto
                ? <iframe src={androidUrl} title={`Android de ${nome || botId}`} allow="clipboard-read; clipboard-write" />
                : <div className="quadro-estado">{avisoAndroid}</div>}
            </div>
          </div>
        )}
      </div>

      <div className={"android-status" + (status.tipo === "ok" && status.conectado ? " on" : "")} aria-live="polite">
        <i className={"pc-luz" + (status.tipo === "ok" && status.conectado ? " on" : status.tipo === "ok" && status.cadastrado ? " frio" : "")} />
        <span>Android · {rotuloStatus(status)}</span>
      </div>

      {mostrarPareamento && <ParearAndroid botId={botId} />}

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

function ParearAndroid({ botId }: { botId: string }) {
  const [ip, setIp] = useState("");
  const [porta, setPorta] = useState("");
  const [codigo, setCodigo] = useState("");
  const [portaConexao, setPortaConexao] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [serial, setSerial] = useState("");
  const [erroAdotar, setErroAdotar] = useState("");
  const [okAdotar, setOkAdotar] = useState("");
  const [adotando, setAdotando] = useState(false);
  const [aparelhos, setAparelhos] = useState<{ serial: string }[]>([]);

  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      try {
        const r = await fetch(comChave(`/api/bots/${encodeURIComponent(botId)}/android/aparelhos`));
        if (!vivo || !r.ok) return;
        const d = await r.json() as { aparelhos?: { serial?: string }[] };
        setAparelhos((d.aparelhos ?? []).filter((a) => typeof a.serial === "string" && a.serial.includes(":")) as { serial: string }[]);
      } catch { /* a lista é atalho; o campo de serial continua */ }
    };
    void ler();
    return () => { vivo = false; };
  }, [botId]);

  const adotar = async (valor: string) => {
    const alvo = valor.trim();
    setErroAdotar("");
    setOkAdotar("");
    if (!/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(alvo)) {
      setErroAdotar("Informe o serial IP:porta, como 192.168.15.5:5555.");
      return;
    }
    setAdotando(true);
    try {
      const r = await fetch(comChave(`/api/bots/${encodeURIComponent(botId)}/android/adotar`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serial: alvo }),
      });
      const d = await r.json().catch(() => ({} as { ok?: boolean; erro?: string }));
      if (!r.ok || d.ok === false) {
        setErroAdotar(d.erro || "Não vinculei. O adb precisa mostrar esse serial como device.");
        return;
      }
      setOkAdotar(`Vinculado a este bot: ${alvo}`);
      setSerial("");
    } catch {
      setErroAdotar("O Hub não respondeu.");
    } finally {
      setAdotando(false);
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
    <>
    <form className="form android-parear" onSubmit={(e) => void enviar(e)}>
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
      {erro ? <p className="android-erro" role="alert">{erro}</p> : null}
      <button className="btn primary" type="submit" disabled={enviando}>{enviando ? "Pareando…" : "Parear"}</button>
    </form>
    <form className="form android-parear android-adotar" onSubmit={(e) => { e.preventDefault(); void adotar(serial); }}>
      <p className="android-dica">Se o aparelho já está em <code>adb devices</code>, vincule o serial sem código. Só entra quando o estado é device.</p>
      {aparelhos.length ? (
        <ul className="android-aparelhos">
          {aparelhos.map((a) => (
            <li key={a.serial}>
              <span>{a.serial}</span>
              <button className="btn" type="button" disabled={adotando} onClick={() => void adotar(a.serial)}>Usar este</button>
            </li>
          ))}
        </ul>
      ) : null}
      <label>Serial já conectado
        <input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="192.168.15.5:5555" autoComplete="off" spellCheck={false} />
      </label>
      {erroAdotar ? <p className="android-erro" role="alert">{erroAdotar}</p> : null}
      {okAdotar ? <p className="android-dica" role="status">{okAdotar}</p> : null}
      <button className="btn" type="submit" disabled={adotando}>{adotando ? "Vinculando…" : "Vincular este aparelho"}</button>
    </form>
    </>
  );
}
