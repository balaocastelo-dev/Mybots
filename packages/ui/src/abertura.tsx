import { UI_BASE } from "./api";
// A abertura do MyBots: um enxame se junta em "isso é o futuro", se reorganiza em
// "escrito por" pequeno sobre "THIAGO HERRERA" grande, e então EXPLODE.
//
// QUANTAS PARTÍCULAS CABEM: em canvas 2D cada partícula é um desenho por quadro. Dez
// milhões não é lento — é travado. O teto prático a 60 quadros por segundo fica entre
// 40 e 60 mil; acima disso só reescrevendo em WebGL. Aqui são 50 mil, pequenas, o que
// dá o aspecto de areia densa — e o laço MEDE o próprio tempo de quadro e corta pela
// metade se a máquina engasgar, em vez de entregar uma abertura travando.
//
// COMO A EXPLOSÃO É DE VERDADE: impulso único de fora para dentro do centro, dado uma
// vez; depois só arrasto, gravidade e o caco encolhendo. O quadro deixa de ser apagado
// e recebe um véu translúcido, o que deixa rastro atrás de cada estilhaço.
import { useEffect, useRef, useState } from "react";
import { falar, calar, mudo, alternarMudo, preparar, boasVindas, definirIdioma, idiomaAtual, IDIOMAS, ESCOLHA_IDIOMA, prepararConvite, falarConvite, aoConvidar, prepararFrase, tocarFrase, type Idioma } from "./guia";
import { PreviaNavegador } from "./previa";

const api = (path: string, init?: RequestInit) =>
  fetch(`${UI_BASE}/api${path}${location.search}`, {
    credentials: "include",
    ...(init?.body === undefined ? { ...init } : { headers: { "content-type": "application/json" }, ...init }),
  });

const FUNDO = "#F4F4F1"; // claro, como a referencia: letra grafite sobre parede clara
// grafite na maioria, com faiscas vermelhas: a letra le como quase preta de longe
const CORES = ["#4A4A52", "#5C5C66", "#3A3A42", "#6E6E78", "#55555E", "#45454D", "#63636D", "#4F4F58", "#4A5A6E", "#4A6B5E"];
const QUANTAS = 150000; // o triplo: enche a letra em vez de pontilhar o contorno
/** quanto cada palavra espera a anterior, no compasso da voz */
const PASSO_A = 430, PASSO_B = 520;
const T_TROCA = 2600, T_EXPLODE = 6600, T_FIM = 7450;

type Par = { x: number; y: number; ax: number; ay: number; vx: number; vy: number; t: number; g: number; cor: string; lados: number; ang: number; giro: number; palavra: number };
type Linha = { tipo: "hero" | "nota" | "regra"; texto?: string };

/** Desenha as linhas num canvas invisível e devolve os pixels com tinta. */
/** Desenha as linhas num canvas invisivel, UMA PALAVRA POR VEZ, e devolve os pixels
 *  com tinta marcados com o indice da palavra. E esse indice que depois faz cada
 *  palavra nascer na sua vez, no ritmo da voz, em vez de a frase inteira aparecer.
 *
 *  POR QUE AMOSTRAR SO O RETANGULO DA PALAVRA: ler a tela inteira a cada palavra sao
 *  oito leituras de alguns megabytes e trava a abertura antes de ela comecar. Aqui
 *  le-se so a caixa daquela palavra, que e uma fracao disso. */
/** O desenho das duas telas.
 *  A ideia: nao e cartaz de parede, e capa. Uma linha FINA e muito espacada por cima,
 *  quase um sussurro visual, e embaixo a palavra em peso maximo ocupando a largura.
 *  O nome vem quebrado em duas linhas de proposito — "THIAGO" e "HERRERA" sozinhos
 *  ficam o dobro do tamanho que ficariam lado a lado. */
const BLOCO_1: Linha[] = [
  { tipo: "nota", texto: "isso \u00E9 o" },
  { tipo: "hero", texto: "FUTURO" },
];
const BLOCO_2: Linha[] = [
  { tipo: "nota", texto: "desenvolvido por" },
  { tipo: "hero", texto: "THIAGO" },
  { tipo: "hero", texto: "HERRERA" },
];
const AUDIO_1 = "isso \u00E9 o futuro";
const AUDIO_2 = "desenvolvido por Thiago Herrera";
const UNID_1 = ["isso", "\u00E9", "o", "futuro"];
const UNID_2 = ["desenvolvido", "por", "Thiago", "Herrera"];

const PILHA = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';

/** Desenha o bloco num canvas invisivel e devolve os pixels com tinta, cada um
 *  marcado com o indice da sua unidade. E esse indice que faz cada parte nascer na
 *  sua vez, no ritmo da voz.
 *
 *  POR QUE AMOSTRAR SO A CAIXA DE CADA UNIDADE: ler a tela inteira a cada palavra sao
 *  varias leituras de megabytes e travam a abertura antes de ela comecar. */
function alvos(w: number, h: number, linhas: Linha[]): { x: number; y: number; palavra: number }[] {
  const off = document.createElement("canvas");
  off.width = w; off.height = h;
  const c = off.getContext("2d", { willReadFrequently: true });
  if (!c) return [];
  const bloco = Math.min(w * 0.74, 1180);
  const x0 = (w - bloco) / 2;
  c.textBaseline = "middle";
  const espacar = (v: string) => { try { (c as unknown as { letterSpacing: string }).letterSpacing = v; } catch { /* navegador antigo */ } };

  // mede cada linha: a hero ocupa a largura do bloco; a nota e pequena de proposito
  const tamNota = Math.max(17, Math.min(h * 0.046, bloco * 0.04));
  const corpos = linhas.map((l) => {
    if (l.tipo === "regra") return { l, s: 0, alt: Math.max(12, h * 0.022) };
    if (l.tipo === "nota") return { l, s: tamNota, alt: tamNota * 3.2 };
    espacar("-0.015em");
    c.font = `900 200px ${PILHA}`;
    const larg = c.measureText(l.texto ?? "").width || 1;
    const s = Math.min(h * 0.27, (200 * bloco) / larg);
    return { l, s, alt: s * 1.02 };
  });
  const total = corpos.reduce((a, b) => a + b.alt, 0);
  let cursor = h / 2 - total / 2;

  const pts: { x: number; y: number; palavra: number }[] = [];
  let unidade = 0;
  // o passo decide a densidade: a hero e grossa e 2 basta; a nota e fina e clara, e
  // com passo 2 saem tao poucos pontos que ela some. Para ela, 1 — custa pouco porque
  // a caixa dela e pequena.
  const amostra = (bx: number, by: number, bw: number, bh: number, idx: number, passo = 2) => {
    bx = Math.max(0, Math.floor(bx)); by = Math.max(0, Math.floor(by));
    bw = Math.min(w - bx, Math.ceil(bw)); bh = Math.min(h - by, Math.ceil(bh));
    if (bw < 2 || bh < 2) return;
    const d = c.getImageData(bx, by, bw, bh).data;
    for (let yy = 0; yy < bh; yy += passo) {
      for (let xx = 0; xx < bw; xx += passo) {
        if (d[(yy * bw + xx) * 4 + 3] > 110) pts.push({ x: bx + xx, y: by + yy, palavra: idx });
      }
    }
  };

  for (const { l, s, alt } of corpos) {
    const y = cursor + alt / 2;
    if (l.tipo === "regra") {
      // um fio fino no lugar da faixa: separa sem gritar
      c.clearRect(0, 0, w, h);
      c.fillStyle = "#fff";
      const lg = bloco * 0.3, alt2 = Math.max(3, Math.round(h * 0.004));
      c.fillRect(w / 2 - lg / 2, y - alt2 / 2, lg, alt2);
      amostra(w / 2 - lg / 2 - 2, y - alt2 - 2, lg + 4, alt2 + 6, unidade, 1);
    } else if (l.tipo === "nota") {
      // pequena, minuscula e MUITO espacada: e o contraste com a hero que faz a peca
      espacar("0.46em");
      c.font = `600 ${s}px ${PILHA}`;
      c.textAlign = "left";
      const palavras = (l.texto ?? "").split(" ");
      const larg = palavras.map((q) => c.measureText(q).width);
      const esp = c.measureText("\u00A0\u00A0").width;
      let totalL = larg.reduce((a, b) => a + b, 0) + esp * (palavras.length - 1);
      // linha espacada e longa estoura facil: encolhe a letra ate caber no bloco
      if (totalL > bloco * 0.98) {
        const s2 = s * ((bloco * 0.98) / totalL);
        c.font = `600 ${s2}px ${PILHA}`;
        for (let k = 0; k < palavras.length; k++) larg[k] = c.measureText(palavras[k]).width;
        totalL = larg.reduce((a, b) => a + b, 0) + c.measureText("\u00A0\u00A0").width * (palavras.length - 1);
      }
      let x = w / 2 - totalL / 2;
      for (let k = 0; k < palavras.length; k++) {
        c.clearRect(0, 0, w, h);
        c.fillStyle = "#fff";
        c.fillText(palavras[k], x, y);
        amostra(x - 3, y - s, larg[k] + 8, s * 2, unidade, 1);
        x += larg[k] + esp;
        unidade++;
      }
      espacar("0px");
    } else {
      espacar("-0.015em");
      c.font = `900 ${s}px ${PILHA}`;
      c.textAlign = "center";
      c.clearRect(0, 0, w, h);
      c.fillStyle = "#fff";
      c.fillText(l.texto ?? "", w / 2, y);
      amostra(x0 - 10, y - s * 0.72, bloco + 20, s * 1.46, unidade);
      unidade++;
      espacar("0px");
    }
    cursor += alt;
  }
  return pts;
}
export function Abertura({ onFim }: { onFim: () => void }) {
  const [saindo, setSaindo] = useState(false);
  const [pronto, setPronto] = useState(false);
  const tela = useRef<HTMLCanvasElement | null>(null);
  const fase = useRef<0 | 1 | 2>(0);
  const tempoA = useRef<number[]>([]);
  const tempoB = useRef<number[]>([]);
  // onFim e uma funcao NOVA a cada render do painel. Com ela nas dependencias o efeito
  // reiniciava a cada atualizacao e a locucao recomecava — por isso a frase saia varias
  // vezes. Guardada num ref, a abertura roda UMA vez so.
  const fim = useRef(onFim);
  fim.current = onFim;

  useEffect(() => {
    const cv = tela.current; if (!cv) return;
    const ctx = cv.getContext("2d", { alpha: false }); if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = Math.floor(window.innerWidth), h = Math.floor(window.innerHeight);
    let umA: ReturnType<typeof alvos> = [], umB: ReturnType<typeof alvos> = [];
    let bolas: Par[] = [];
    let trocou = false;

    // Mudar o tamanho da janela TEM de recentrar: o canvas e os alvos sao medidos pela
    // janela. Sem isto, a abertura montada numa janela menor continuava desenhada no
    // tamanho antigo e ficava encostada no canto, ocupando meia tela.
    const medirTela = () => {
      w = Math.floor(window.innerWidth); h = Math.floor(window.innerHeight);
      cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr);
      cv.style.width = w + "px"; cv.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      umA = alvos(w, h, BLOCO_1);
      umB = alvos(w, h, BLOCO_2);
      const atual = trocou ? umB : umA;
      if (atual.length) {
        for (let k = 0; k < bolas.length; k++) {
          const n = atual[k % atual.length];
          bolas[k].ax = n.x; bolas[k].ay = n.y; bolas[k].palavra = n.palavra;
        }
      }
      ctx.fillStyle = FUNDO; ctx.fillRect(0, 0, w, h);
    };
    medirTela();
    for (let i = 0; i < (umA.length ? QUANTAS : 0); i++) {
      const a = umA[i % umA.length];
      const ang = Math.random() * Math.PI * 2, raio = Math.max(w, h) * (0.7 + Math.random() * 0.8);
      bolas.push({
        x: w / 2 + Math.cos(ang) * raio, y: h / 2 + Math.sin(ang) * raio,
        ax: a.x, ay: a.y, vx: 0, vy: 0,
        t: 0.055 + Math.random() * 0.05, g: 0.6 + Math.random() * 1.1,
        cor: CORES[(Math.random() * CORES.length) | 0],
        lados: Math.random() < 0.03 ? 3 : 0,
        ang: Math.random() * 6.28, giro: (Math.random() - 0.5) * 0.14,
        palavra: a.palavra,
      });
    }

    medirTela(); // agora que as bolas existem, prende-as aos alvos recem-medidos
    let relogioMedir: number | null = null;
    const aoRedimensionar = () => {
      if (relogioMedir) clearTimeout(relogioMedir);
      relogioMedir = window.setTimeout(medirTela, 140);
    };
    window.addEventListener("resize", aoRedimensionar);

    let vivo = true, t0 = performance.now(), tFase = t0, estourou = false;
    let lentos = 0, cortes = 0;
    ctx.fillStyle = FUNDO; ctx.fillRect(0, 0, w, h);

    const quadro = (agora: number) => {
      if (!vivo) return;
      const ms = agora - t0; t0 = agora;
      const dt = Math.min(2.5, ms / 16.7);
      if (!estourou && cortes < 2) {
        lentos = ms > 24 ? lentos + 1 : 0;
        if (lentos > 30) { bolas = bolas.filter((_, k) => k % 2 === 0); cortes++; lentos = 0; }
      }

      if (fase.current === 1 && !trocou && umB.length) {
        trocou = true; tFase = agora;
        for (let k = 0; k < bolas.length; k++) {
          const b = bolas[k], n = umB[k % umB.length];
          b.ax = n.x; b.ay = n.y; b.palavra = n.palavra;
          b.vx += (Math.random() - 0.5) * 5; b.vy += (Math.random() - 0.5) * 5;
        }
      }
      if (fase.current === 2 && !estourou) {
        estourou = true;
        for (const b of bolas) {
          const dx = b.x - w / 2, dy = b.y - h / 2, d = Math.hypot(dx, dy) || 1;
          const forca = 14 + Math.random() * 38;
          b.vx = (dx / d) * forca + (Math.random() - 0.5) * 12;
          b.vy = (dy / d) * forca + (Math.random() - 0.5) * 12 - 6;
          b.giro *= 5;
        }
      }

      ctx.fillStyle = estourou ? "rgba(244,244,241,0.26)" : FUNDO;
      ctx.fillRect(0, 0, w, h);

      const compasso = trocou ? tempoB.current : tempoA.current;
      for (let i = 0; i < bolas.length; i++) {
        const b = bolas[i];
        const esp = compasso[b.palavra] ?? b.palavra * 430;
        if (estourou) { b.vx *= 0.988; b.vy = b.vy * 0.988 + 0.34 * dt; b.g *= 0.995; }
        else if (agora - tFase < esp) { b.vx *= 0.94; b.vy *= 0.94; }
        else { b.vx += (b.ax - b.x) * b.t * dt; b.vy += (b.ay - b.y) * b.t * dt; b.vx *= 0.8; b.vy *= 0.8; }
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x < -60 || b.x > w + 60 || b.y > h + 60) continue;
        ctx.fillStyle = b.cor;
        if (b.lados === 0) ctx.fillRect(b.x, b.y, b.g, b.g);
        else {
          b.ang += b.giro * dt;
          ctx.beginPath();
          for (let k = 0; k < 3; k++) {
            const a2 = b.ang + (k * 6.2832) / 3, r = b.g * 2;
            k ? ctx.lineTo(b.x + Math.cos(a2) * r, b.y + Math.sin(a2) * r) : ctx.moveTo(b.x + Math.cos(a2) * r, b.y + Math.sin(a2) * r);
          }
          ctx.closePath(); ctx.fill();
        }
      }
      requestAnimationFrame(quadro);
    };
    requestAnimationFrame(quadro);
    return () => { vivo = false; if (relogioMedir) clearTimeout(relogioMedir); window.removeEventListener("resize", aoRedimensionar); };
  }, []);

  useEffect(() => {
    let vivo = true;
    const relogios: number[] = [];
    const agenda = (fn: () => void, ms: number) => { relogios.push(window.setTimeout(fn, Math.max(0, ms))); };
    const explodir = () => { fase.current = 2; agenda(() => fim.current(), 850); };
    const pular = () => { relogios.forEach(clearTimeout); relogios.length = 0; setPronto(true); explodir(); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") pular(); };
    window.addEventListener("keydown", tecla);

    void (async () => {
      void prepararConvite();
      const [bruA, bruB] = await Promise.all([prepararFrase("f1", AUDIO_1), prepararFrase("f2", AUDIO_2)]);
      void prepararFrase("f3", "Clique para iniciar.");
      if (!vivo) return;
      const durA = bruA || 1900, durB = bruB || 2500;
      // reparte a duracao REAL do audio entre as partes, pelo tamanho de cada uma, e
      // antecipa 170 ms: a parte precisa estar legivel no instante em que e ouvida.
      const compasso = (unid: string[], dur: number, inicio: number) => {
        const peso = unid.map((q) => q.length + 1);
        const soma = peso.reduce((a, b) => a + b, 0);
        let acc = 0;
        return unid.map((_, i) => {
          const t = inicio + (acc / soma) * dur - 170;
          acc += peso[i];
          return Math.max(0, t);
        });
      };
      const inicioA = 320;
      tempoA.current = compasso(UNID_1, durA, inicioA);
      agenda(() => void tocarFrase("f1"), inicioA);
      const troca = inicioA + durA + 480;
      agenda(() => { fase.current = 1; }, troca);
      tempoB.current = compasso(UNID_2, durB, 160);
      agenda(() => void tocarFrase("f2"), troca + 160);
      agenda(() => { setPronto(true); void tocarFrase("f3"); }, troca + 160 + durB + 520);
    })();

    return () => { vivo = false; relogios.forEach(clearTimeout); window.removeEventListener("keydown", tecla); };
  }, []);

  return (
    <div className={"abertura" + (saindo ? " saindo" : "")} style={{ background: FUNDO }}
         onClick={() => { fase.current = 2; setTimeout(onFim, 850); }}>
      <canvas ref={tela} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <div className="abertura-pe" style={{ position: "absolute", left: 0, right: 0, bottom: "5.5vh", textAlign: "center", color: "#B00000", opacity: 0.9 }}>
        <div style={{ fontSize: "13px", letterSpacing: "0.32em", textTransform: "uppercase" }}>MyBots</div>
        <div style={{ fontSize: "11px", letterSpacing: "0.08em", textTransform: "none", color: "#8A3030", marginTop: 4, fontWeight: 500 }}>By Thiago Herrera</div>
      </div>
      {pronto && !saindo && (
        <div className="abertura-chamada" style={{ position: "absolute", left: 0, right: 0, bottom: "13vh", textAlign: "center", color: "#5F5F6B", fontSize: "13px", letterSpacing: "0.1em" }}>
          clique para iniciar
        </div>
      )}
    </div>
  );
}

/** A primeira empresa: a unica coisa que a casa pede quando esta vazia. */export function PrimeiraEmpresa({ onPronto, onPular }: { onPronto: (id: string) => void; onPular: () => void }) {
  const [nome, setNome] = useState("");
  const [site, setSite] = useState("");
  const [insta, setInsta] = useState("");
  const [idioma, setIdioma] = useState<string>(idiomaAtual());
  const [regras, setRegras] = useState("");
  const [resumo, setResumo] = useState("");
  const [avisos, setAvisos] = useState<string[]>([]);
  const [analisando, setAnalisando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [err, setErr] = useState("");

  const analisar = async () => {
    setAnalisando(true); setErr("");
    const r = await api("/empresas/sugerir", { method: "POST", body: JSON.stringify({ nome, site, instagram: insta }) });
    setAnalisando(false);
    if (!r.ok) { setErr((await r.json()).error ?? "não consegui ler o site"); return; }
    const f = await r.json();
    if (f.nome && !nome.trim()) setNome(f.nome);
    setResumo(f.resumo ?? ""); setRegras(f.regras ?? ""); setAvisos(f.avisos ?? []);
  };
  const criar = async () => {
    if (!nome.trim()) return;
    setCriando(true); setErr("");
    const r = await api("/empresas", { method: "POST", body: JSON.stringify({ nome, regras, idioma, site, instagram: insta, resumo }) });
    setCriando(false);
    if (!r.ok) { setErr((await r.json()).error ?? "erro ao criar"); return; }
    const e = await r.json();
    onPronto(e.id);
  };

  return (
    <div className="primeira">
      <div className="primeira-folha">
        <p className="primeira-olho">A casa está vazia</p>
        <h1>Vamos cadastrar a sua primeira empresa</h1>
        <p className="primeira-sub">
          Cada empresa tem os seus bots, as suas regras, a sua memória e o seu próprio WhatsApp.
          O conhecimento da casa é um só: toda empresa lê a mesma base.
        </p>

        <div className="primeira-campos">
          <label>Nome da empresa
            <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="sua empresa" />
          </label>
          <div className="primeira-dois">
            <label>Site
              <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="exemplo.com.br" />
            </label>
            <label>Instagram
              <input value={insta} onChange={(e) => setInsta(e.target.value)} placeholder="@suaempresa" />
            </label>
          </div>
          <div className="primeira-dois previas">
            <PreviaNavegador valor={site} tipo="site" />
            <PreviaNavegador valor={insta} tipo="insta" />
          </div>
          <label>Idioma da empresa <small className="muted">(os bots dela falam nele; respondem no idioma de quem escrever)</small>
            <select value={idioma} onChange={(e) => setIdioma(e.target.value)}>
              <option value="pt">Português (Brasil)</option>
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </label>
          <button className="btn" disabled={analisando || (!site.trim() && !insta.trim())} onClick={() => void analisar()}>
            {analisando ? "Lendo o site…" : "Ler o site e sugerir as regras"}
          </button>
        </div>

        {(resumo || regras) && (
          <div className="primeira-sugestao">
            <b>Sugestão da análise</b> <small>leia e corrija — é sugestão, não verdade</small>
            {resumo && <p>{resumo}</p>}
            <textarea rows={9} value={regras} onChange={(e) => setRegras(e.target.value)}
              placeholder="As regras que todo bot desta empresa vai seguir." />
            {avisos.map((a, i) => <small key={i}>⚠ {a}</small>)}
          </div>
        )}

        {err && <div className="err">{err}</div>}

        <div className="primeira-acoes">
          <button className="btn primary" disabled={!nome.trim() || criando} onClick={() => void criar()}>
            {criando ? "Criando…" : "Criar empresa"}
          </button>
          <button className="link" onClick={onPular}>agora não</button>
        </div>
        <p className="primeira-pe">
          Ao criar: o WhatsApp dela sobe e mostra o QR para escanear, e o Gerente Geral da empresa nasce,
          se apresenta e propõe os primeiros bots.
        </p>
      </div>
    </div>
  );
}

/** A primeira tela depois da explosão: em que língua esta casa vai falar.
 *  Vem ANTES do cadastro porque tudo que vier depois — a voz do guia e o idioma da
 *  empresa — já nasce na escolha dela, em vez de nascer em português e ser trocado. */
/** Reduz a tela a cacos e os explode — a MESMA fisica do nome na abertura:
 *  impulso unico de fora para dentro do centro, depois so arrasto, gravidade e o caco
 *  encolhendo; o quadro deixa de ser apagado e recebe um veu, o que deixa rastro.
 *
 *  COMO A TELA VIRA ALVO: o navegador nao deixa fotografar a propria pagina, entao em
 *  vez de rasterizar a folha a gente le o RETANGULO de cada peca dela (titulo, texto,
 *  cada botao) e enche esses retangulos de particulas. O estilhaco segue o desenho real
 *  da tela, nao uma mancha generica — e custa quase nada. */
function cacosDa(folha: HTMLElement): Caco[] {
  const r = folha.getBoundingClientRect();
  const pecas = Array.from(folha.querySelectorAll<HTMLElement>("h1,p,button"));
  const zonas = pecas.map((el) => ({
    r: el.getBoundingClientRect(),
    cor: el.classList.contains("escolhido") ? "#FFFFFF"
      : el.classList.contains("primeira-olho") ? "#E10600"
      : el.tagName === "BUTTON" ? "#C9C4CF" : "#ECECEF",
  }));
  const fundo = ["#2E2E38", "#3A3A46", "#242430"];
  const cacos: Caco[] = [];
  const passo = 3;
  for (let y = r.top; y < r.bottom; y += passo) {
    for (let x = r.left; x < r.right; x += passo) {
      let cor = fundo[(Math.random() * fundo.length) | 0];
      for (const z of zonas) {
        if (x >= z.r.left && x <= z.r.right && y >= z.r.top && y <= z.r.bottom) { cor = z.cor; break; }
      }
      cacos.push({ x, y, vx: 0, vy: 0, g: 1 + Math.random() * 1.6, cor });
    }
  }
  return cacos;
}

type Caco = { x: number; y: number; vx: number; vy: number; g: number; cor: string };

function Estilhaco({ cacos, centro, onFim }: { cacos: Caco[]; centro: { x: number; y: number }; onFim: () => void }) {
  const tela = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = tela.current; if (!cv) return;
    const ctx = cv.getContext("2d", { alpha: true }); if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr);
    cv.style.width = w + "px"; cv.style.height = h + "px";
    ctx.scale(dpr, dpr);

    // o impulso: dado UMA vez, de fora para dentro do centro da folha
    for (const c of cacos) {
      const dx = c.x - centro.x, dy = c.y - centro.y, d = Math.hypot(dx, dy) || 1;
      const forca = 12 + Math.random() * 34;
      c.vx = (dx / d) * forca + (Math.random() - 0.5) * 11;
      c.vy = (dy / d) * forca + (Math.random() - 0.5) * 11 - 7;
    }
    let vivo = true, t0 = performance.now();
    const quadro = (agora: number) => {
      if (!vivo) return;
      const dt = Math.min(2.5, (agora - t0) / 16.7); t0 = agora;
      ctx.fillStyle = "rgba(10,10,11,0.26)";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < cacos.length; i++) {
        const c = cacos[i];
        c.vx *= 0.988; c.vy = c.vy * 0.988 + 0.34 * dt; c.g *= 0.995;
        c.x += c.vx * dt; c.y += c.vy * dt;
        if (c.x < -40 || c.x > w + 40 || c.y > h + 40) continue;
        ctx.fillStyle = c.cor;
        ctx.fillRect(c.x, c.y, c.g, c.g);
      }
      requestAnimationFrame(quadro);
    };
    requestAnimationFrame(quadro);
    const fim = setTimeout(onFim, 760);
    return () => { vivo = false; clearTimeout(fim); };
  }, []);
  return <canvas ref={tela} style={{ position: "fixed", inset: 0, zIndex: 3600, pointerEvents: "none" }} />;
}

/** A primeira tela depois da explosão: em que língua esta casa vai falar.
 *  Vem ANTES do cadastro porque tudo que vier depois — a voz do guia e o idioma da
 *  empresa — já nasce na escolha dela, em vez de nascer em português e ser trocado. */
/** O fundo da escolha de idioma: uma malha de pontos que se ligam quando chegam perto.
 *  E o mesmo vocabulario das particulas da abertura, mas em marcha lenta — a tela aqui
 *  e de LEITURA, e fundo que se mexe demais rouba a atencao de quem precisa escolher.
 *  Por isso poucos pontos, linhas fracas e velocidade baixa. */
function FundoTecnologico() {
  const tela = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = tela.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0;
    const medir = () => {
      w = window.innerWidth; h = window.innerHeight;
      cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr);
      cv.style.width = w + "px"; cv.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    medir();
    const quantos = Math.min(90, Math.round((w * h) / 22000));
    const pts = Array.from({ length: quantos }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28,
      r: Math.random() < 0.18 ? 2.2 : 1.4,
    }));
    const LIG = 150;
    let vivo = true;
    const quadro = () => {
      if (!vivo) return;
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
          const d = Math.hypot(dx, dy);
          if (d > LIG) continue;
          ctx.strokeStyle = `rgba(225,6,0,${(1 - d / LIG) * 0.34})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
        }
      }
      for (const p of pts) {
        ctx.fillStyle = p.r > 2 ? "rgba(225,6,0,0.95)" : "rgba(200,200,212,0.55)";
        ctx.fillRect(p.x, p.y, p.r, p.r);
      }
      requestAnimationFrame(quadro);
    };
    requestAnimationFrame(quadro);
    window.addEventListener("resize", medir);
    return () => { vivo = false; window.removeEventListener("resize", medir); };
  }, []);
  return <canvas ref={tela} style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }} />;
}
export function EscolhaIdioma({ onEscolher }: { onEscolher: (l: Idioma) => void }) {
  const [falandoAgora, setFalandoAgora] = useState<Idioma | null>(null);
  const [escolhida, setEscolhida] = useState<Idioma | null>(null);
  const [estilhaco, setEstilhaco] = useState<{ cacos: Caco[]; centro: { x: number; y: number } } | null>(null);
  const folha = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    aoConvidar(setFalandoAgora);
    void falarConvite();
    return () => aoConvidar(null);
  }, []);
  const escolher = (l: Idioma) => {
    if (escolhida) return;
    definirIdioma(l); calar(); setEscolhida(l);
    // o botao acende em vermelho por um instante, e SO ENTAO a tela vira cacos:
    // explodir no mesmo quadro do clique rouba a confirmacao visual da escolha.
    setTimeout(() => {
      const el = folha.current;
      if (!el) { void falar(boasVindas(), "passo-empresa"); onEscolher(l); return; }
      const r = el.getBoundingClientRect();
      setEstilhaco({ cacos: cacosDa(el), centro: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
      setTimeout(() => void falar(boasVindas(), "passo-empresa"), 220);
    }, 230);
  };
  return (
    <div className="primeira centro">
      <FundoTecnologico />
      <div ref={folha} className="primeira-folha" style={{ textAlign: "center", visibility: estilhaco ? "hidden" : "visible" }}>
        <p className="primeira-olho">MyBots</p>
        <p className="titulo-mybots-by" style={{ marginTop: -6, marginBottom: 8 }}>By Thiago Herrera</p>
        <h1>Escolha o seu idioma</h1>
        <p className="primeira-sub">Choose your language · Elige tu idioma · Choisissez votre langue</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12, marginTop: 22, maxWidth: 400, marginLeft: "auto", marginRight: "auto" }}>
          {IDIOMAS.map((i) => (
            <button key={i.id} type="button"
              className={"btn idioma" + (falandoAgora === i.id ? " brilha" : "") + (escolhida === i.id ? " escolhido" : "")}
                onClick={() => escolher(i.id)}>
              {/* o emoji de bandeira nao existe no Windows: vira duas letras soltas.
                  Um selo com o codigo do pais le melhor e combina com o resto. */}
              <span className="idioma-cod">{i.cod}</span>
              <span className="idioma-nome">{i.nome}</span>
            </button>
          ))}
        </div>
      </div>
      {estilhaco && <Estilhaco cacos={estilhaco.cacos} centro={estilhaco.centro} onFim={() => onEscolher(escolhida ?? "pt")} />}
    </div>
  );
}

