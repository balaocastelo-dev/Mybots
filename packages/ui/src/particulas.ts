/**
 * Desintegração do avatar.
 *
 * Quando um bot é excluído, a ameba dele não some de uma vez: vira algumas
 * centenas de partículas que se espalham e caem. O desenho não é inventado —
 * as partículas saem dos pixels do próprio SVG daquele bot, então cada uma tem
 * a cor exata do lugar de onde veio.
 *
 * O trabalho pesado (serializar o SVG e ler os pixels) é feito num canvas fora
 * da tela. O que o usuário vê é um canvas só, fixo por cima de tudo, que some
 * sozinho quando a última partícula apaga.
 */

type Particula = {
  x: number; y: number; vx: number; vy: number;
  cor: string; lado: number; giro: number; dGiro: number; vida: number;
};

const DURACAO = 1250;        // ms até a última partícula apagar
const ALVO_DE_PARTICULAS = 520;
const GRAVIDADE = 0.00055;   // px por ms²

/** Pega o SVG (ou a foto) do avatar e devolve uma imagem já carregada. */
async function imagemDoAvatar(el: HTMLElement, w: number, h: number): Promise<HTMLImageElement | null> {
  const svg = el.querySelector("svg");
  if (svg) {
    const copia = svg.cloneNode(true) as SVGElement;
    copia.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    copia.setAttribute("width", String(w));
    copia.setAttribute("height", String(h));
    const texto = new XMLSerializer().serializeToString(copia);
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(texto);
    return carregar(url);
  }
  const img = el.querySelector("img");
  if (img?.src) { try { return await carregar(img.src); } catch { return null; } }
  return null;
}

function carregar(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, falhou) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => falhou(new Error("não carregou"));
    i.src = src;
  });
}

/** Lê os pixels do avatar e devolve uma partícula para cada ponto com cor. */
function particulasDe(img: HTMLImageElement, rect: DOMRect): Particula[] {
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const fora = document.createElement("canvas");
  fora.width = w; fora.height = h;
  const ctx = fora.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);
  let dados: ImageData;
  try { dados = ctx.getImageData(0, 0, w, h); } catch { return []; }

  // O passo da grade sai da área que a ameba REALMENTE ocupa, não do quadrado
  // em volta dela: senão, uma forma que preenche metade do quadro rende metade
  // das partículas pedidas. Conta primeiro os pixels com cor, depois decide.
  let opacos = 0;
  for (let i = 3; i < dados.data.length; i += 4) if (dados.data[i] >= 40) opacos++;
  if (!opacos) return [];
  const passo = Math.max(2, Math.round(Math.sqrt(opacos / ALVO_DE_PARTICULAS)));
  const cx = w / 2, cy = h / 2;
  const ps: Particula[] = [];
  for (let y = 0; y < h; y += passo) {
    for (let x = 0; x < w; x += passo) {
      const i = (y * w + x) * 4;
      const a = dados.data[i + 3];
      if (a < 40) continue;                       // fora do corpo da ameba
      const dx = x - cx, dy = y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const forca = 0.055 + Math.random() * 0.085;
      ps.push({
        x: rect.left + x, y: rect.top + y,
        vx: (dx / dist) * forca * (0.5 + Math.random()) + (Math.random() - 0.5) * 0.05,
        vy: (dy / dist) * forca * (0.5 + Math.random()) - 0.07 - Math.random() * 0.06,
        cor: `rgba(${dados.data[i]},${dados.data[i + 1]},${dados.data[i + 2]},${a / 255})`,
        lado: passo * (0.75 + Math.random() * 0.5),
        giro: Math.random() * Math.PI,
        dGiro: (Math.random() - 0.5) * 0.012,
        vida: 0.62 + Math.random() * 0.38,        // quem vive menos apaga antes
      });
    }
  }
  return ps;
}

function telaDeParticulas(): CanvasRenderingContext2D | null {
  const c = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = Math.floor(window.innerWidth * dpr);
  c.height = Math.floor(window.innerHeight * dpr);
  c.className = "tela-particulas";
  document.body.appendChild(c);
  const ctx = c.getContext("2d");
  if (!ctx) { c.remove(); return null; }
  ctx.scale(dpr, dpr);
  return ctx;
}

/**
 * Desintegra todos os avatares visíveis de um bot.
 * Devolve quando a animação acaba; quem chama não precisa esperar.
 */
export async function desintegrarAvatar(botId: string): Promise<void> {
  const seletor = `[data-ameba="${(window.CSS?.escape ?? ((s: string) => s))(botId)}"]`;
  const alvos = Array.from(document.querySelectorAll<HTMLElement>(seletor))
    .filter((el) => el.getBoundingClientRect().width > 4);
  if (!alvos.length) return;

  const suave = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (suave) {
    for (const el of alvos) { el.style.transition = "opacity .35s ease"; el.style.opacity = "0"; }
    return;
  }

  // 1. capturado AGORA, de forma síncrona: depois disso o React pode remover o bot
  const capturas = alvos.map((el) => ({ el, rect: el.getBoundingClientRect() }));
  const imagens = await Promise.all(
    capturas.map(({ el, rect }) => imagemDoAvatar(el, Math.round(rect.width), Math.round(rect.height)).catch(() => null)),
  );

  let ps: Particula[] = [];
  capturas.forEach(({ el, rect }, i) => {
    const img = imagens[i];
    if (!img) return;
    ps = ps.concat(particulasDe(img, rect));
    el.style.visibility = "hidden";   // o corpo some no instante em que vira pó
  });
  if (!ps.length) return;

  const ctx = telaDeParticulas();
  if (!ctx) return;
  const canvas = ctx.canvas;

  await new Promise<void>((pronto) => {
    const inicio = performance.now();
    const quadro = (agora: number) => {
      const t = agora - inicio;
      const passado = t / DURACAO;
      if (passado >= 1) { canvas.remove(); pronto(); return; }
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const p of ps) {
        const vivo = 1 - passado / p.vida;
        if (vivo <= 0) continue;
        const x = p.x + p.vx * t;
        const y = p.y + p.vy * t + GRAVIDADE * t * t;
        ctx.save();
        ctx.globalAlpha = Math.max(0, vivo);
        ctx.translate(x, y);
        ctx.rotate(p.giro + p.dGiro * t);
        ctx.fillStyle = p.cor;
        const l = p.lado * (0.35 + 0.65 * vivo);
        ctx.fillRect(-l / 2, -l / 2, l, l);
        ctx.restore();
      }
      requestAnimationFrame(quadro);
    };
    requestAnimationFrame(quadro);
  });
}
