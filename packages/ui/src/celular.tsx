import { UI_BASE } from "./api";
import { useEffect, useRef, useState } from "react";

/**
 * O CELULAR DA EMPRESA, NA TELA
 *
 * A tela do aparelho vem como foto, uma atras da outra. Pedimos o proximo quadro so
 * depois que o anterior chegou: pedir por relogio empilharia pedidos quando o
 * aparelho demorasse, e a tela ficaria cada vez mais atrasada.
 *
 * O clique vai em PROPORCAO (0 a 1), nunca em pixel: o painel nao precisa saber se
 * o aparelho e 1440x3200 ou 720x1600, e continua certo quando o chefe redimensiona
 * a janela.
 */
type Aparelho = { serial: string; modelo: string; estado: string; viaWifi: boolean; largura?: number; altura?: number };

export function CelularDaEmpresa({ onFechar }: { onFechar: () => void }) {
  const [lista, setLista] = useState<Aparelho[]>([]);
  const [temAdb, setTemAdb] = useState(true);
  const [qual, setQual] = useState<string>("");
  const [quadro, setQuadro] = useState<string>("");
  const [vivo, setVivo] = useState(false);
  const [texto, setTexto] = useState("");
  const [ip, setIp] = useState("");
  const [aviso, setAviso] = useState("");
  const img = useRef<HTMLImageElement | null>(null);
  const parar = useRef(false);
  const arrasto = useRef<{ x: number; y: number; t: number } | null>(null);

  const lerLista = async () => {
    try {
      const r = await fetch(`${UI_BASE}/api/celulares`);
      if (!r.ok) return;
      const d = await r.json();
      setTemAdb(!!d.adb);
      setLista(d.lista ?? []);
      if (!qual && d.lista?.length) setQual(d.lista.find((a: Aparelho) => a.estado === "device")?.serial ?? "");
    } catch { /* o Hub volta */ }
  };
  useEffect(() => { void lerLista(); const t = setInterval(lerLista, 8000); return () => clearInterval(t); }, []);

  // o laco da tela: um quadro de cada vez
  useEffect(() => {
    parar.current = false;
    if (!qual) { setQuadro(""); setVivo(false); return; }
    let urlAnterior = "";
    const laco = async () => {
      while (!parar.current) {
        try {
          const r = await fetch(`${UI_BASE}/api/celulares/${encodeURIComponent(qual)}/tela?t=${Date.now()}`);
          if (r.ok) {
            const b = await r.blob();
            const u = URL.createObjectURL(b);
            setQuadro(u); setVivo(true);
            if (urlAnterior) URL.revokeObjectURL(urlAnterior);
            urlAnterior = u;
          } else { setVivo(false); await espera(1500); }
        } catch { setVivo(false); await espera(1500); }
        await espera(120);
      }
      if (urlAnterior) URL.revokeObjectURL(urlAnterior);
    };
    void laco();
    return () => { parar.current = true; };
  }, [qual]);

  const ondeClicou = (e: React.MouseEvent) => {
    const el = img.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const mandar = (rota: string, corpo: unknown) =>
    fetch(`${UI_BASE}/api/celulares/${encodeURIComponent(qual)}/${rota}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo),
    }).catch(() => null);

  const aparelho = lista.find((a) => a.serial === qual);

  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal wide cel" onClick={(e) => e.stopPropagation()}>
        <div className="pc-topo">
          <div>
            <h3>Celular da empresa</h3>
            <p className="muted">
              O aparelho de verdade, por ADB. E nele que moram o WhatsApp e as contas da empresa —
              por isso ele, e nao um emulador. Voce pode tocar na tela aqui mesmo.
            </p>
          </div>
          <div className="pc-botoes">
            <select value={qual} onChange={(e) => setQual(e.target.value)}>
              <option value="">escolha o aparelho</option>
              {lista.map((a) => (
                <option key={a.serial} value={a.serial} disabled={a.estado !== "device"}>
                  {a.modelo}{a.viaWifi ? " (wifi)" : " (cabo)"}{a.estado !== "device" ? ` — ${a.estado}` : ""}
                </option>
              ))}
            </select>
            <button className="btn" onClick={onFechar}>Fechar</button>
          </div>
        </div>

        {!temAdb && <div className="pc-aviso">O adb nao foi encontrado nesta maquina. Sem ele nao da para ver nem tocar no aparelho.</div>}
        {aviso && <div className="pc-aviso">{aviso}</div>}

        <div className="cel-corpo">
          <div className="cel-moldura">
            {quadro
              ? <img ref={img} src={quadro} alt="tela do celular" draggable={false}
                  onMouseDown={(e) => { const p = ondeClicou(e); if (p) arrasto.current = { ...p, t: Date.now() }; }}
                  onMouseUp={(e) => {
                    const fim = ondeClicou(e); const ini = arrasto.current; arrasto.current = null;
                    if (!fim || !ini) return;
                    const dist = Math.hypot(fim.x - ini.x, fim.y - ini.y);
                    if (dist > 0.04) void mandar("deslizar", { x1: ini.x, y1: ini.y, x2: fim.x, y2: fim.y, ms: Math.max(120, Date.now() - ini.t) });
                    else void mandar("tocar", { x: fim.x, y: fim.y });
                  }} />
              : <div className="cel-vazia">{qual ? "pedindo a tela do aparelho..." : "escolha um aparelho acima"}</div>}
          </div>

          <div className="cel-lado">
            <div className="cel-teclas">
              <button className="btn" disabled={!qual} onClick={() => void mandar("tecla", { tecla: "voltar" })}>◀ Voltar</button>
              <button className="btn" disabled={!qual} onClick={() => void mandar("tecla", { tecla: "inicio" })}>⌂ Início</button>
              <button className="btn" disabled={!qual} onClick={() => void mandar("tecla", { tecla: "recentes" })}>▢ Recentes</button>
              <button className="btn" disabled={!qual} onClick={() => void mandar("acordar", {})}>☀ Acordar</button>
            </div>

            <label className="cel-campo">Escrever no aparelho
              <div className="cel-linha">
                <input value={texto} onChange={(e) => setTexto(e.target.value)}
                  placeholder="o que digitar"
                  onKeyDown={(e) => { if (e.key === "Enter" && texto.trim()) { void mandar("digitar", { texto }).then(() => setTexto("")); } }} />
                <button className="btn" disabled={!qual || !texto.trim()} onClick={() => void mandar("digitar", { texto }).then(() => setTexto(""))}>Digitar</button>
                <button className="btn" disabled={!qual} onClick={() => void mandar("tecla", { tecla: "enter" })}>⏎</button>
              </div>
            </label>

            <label className="cel-campo">Ligar outro aparelho pelo WiFi
              <div className="cel-linha">
                <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.0.10:5555" />
                <button className="btn" disabled={!ip.trim()} onClick={async () => {
                  const r = await fetch(`${UI_BASE}/api/celulares/conectar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ip }) });
                  const d = r.ok ? await r.json() : { ok: false, msg: "falhou" };
                  setAviso(d.ok ? "" : d.msg || "nao consegui conectar");
                  void lerLista();
                }}>Conectar</button>
              </div>
            </label>

            <p className="cel-nota muted">
              {aparelho
                ? `${aparelho.modelo} · ${aparelho.largura ?? "?"}×${aparelho.altura ?? "?"} · ${vivo ? "ao vivo" : "parado"}`
                : "nenhum aparelho escolhido"}
              <br />Arraste sobre a tela para rolar. O toque vai em proporção, então funciona em qualquer resolução.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
