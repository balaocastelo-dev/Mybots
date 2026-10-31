/** A página que o painel embute em /android/<botId>/. Tudo inline: nada é buscado fora. */

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

export function htmlDaTela(botId: string): string {
  const id = esc(botId);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Celular de ${id}</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #0e1412; color: #e7efe9; font: 14px/1.4 "Segoe UI", sans-serif; }
  body { display: flex; flex-direction: column; min-height: 100%; }
  header { padding: 10px 12px 6px; }
  header b { display: block; font-size: 15px; }
  header p { margin: 4px 0 0; color: #b7c7bc; font-size: 12px; }
  #aviso { margin: 8px 12px 0; padding: 8px 10px; border-radius: 8px; background: #1c2822; color: #d5e6da; min-height: 1.2em; }
  .palco { flex: 1; display: flex; align-items: center; justify-content: center; padding: 10px; min-height: 0; }
  .aparelho { background: #111; border: 10px solid #1a1a1a; border-radius: 28px; box-shadow: 0 0 0 2px #333; max-height: 100%; max-width: 100%; }
  canvas { display: block; width: min(100%, 360px); height: auto; background: #000; border-radius: 16px; touch-action: none; cursor: crosshair; }
  .comandos { display: flex; gap: 8px; padding: 8px 12px 12px; flex-wrap: wrap; }
  button, input { font: inherit; }
  button { background: #1e3a2f; color: #e7efe9; border: 1px solid #2f6a52; border-radius: 8px; padding: 8px 10px; cursor: pointer; }
  button:hover { background: #27543f; }
  input { flex: 1; min-width: 120px; background: #101816; color: inherit; border: 1px solid #2a4036; border-radius: 8px; padding: 8px; }
</style>
</head>
<body data-stream="android" data-bot="${id}">
<header>
  <b>Celular de ${id}</b>
  <p>Tela ao vivo pelo Hub. O Chrome do aparelho abre o WhatsApp Web em https://web.whatsapp.com. Quem lê o QR é você — daqui não entra na conta e não manda mensagem.</p>
</header>
<div id="aviso">Conectando na tela…</div>
<div class="palco"><div class="aparelho"><canvas id="tela" width="360" height="780"></canvas></div></div>
<div class="comandos">
  <button type="button" id="voltar">Voltar</button>
  <button type="button" id="inicio">Início</button>
  <button type="button" id="whats">Abrir WhatsApp Web</button>
  <input id="texto" placeholder="Digitar no aparelho" maxlength="300" />
  <button type="button" id="enviar">Enviar</button>
</div>
<script>
(function () {
  const aviso = document.getElementById("aviso");
  const canvas = document.getElementById("tela");
  const ctx = canvas.getContext("2d");
  let dec = null;
  let largura = 0, altura = 0, ts = 0;
  let configurado = false;
  const base = location.pathname.endsWith("/") ? location.pathname : location.pathname + "/";
  const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + base + "ws";
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  function dizer(t) { aviso.textContent = t; }
  function desenhar(frame) {
    const dw = frame.displayWidth || frame.codedWidth;
    const dh = frame.displayHeight || frame.codedHeight;
    if (canvas.width !== dw || canvas.height !== dh) { canvas.width = dw; canvas.height = dh; }
    ctx.drawImage(frame, 0, 0);
    frame.close();
  }
  function configurar(codec, b64) {
    const cru = Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); });
    if (typeof VideoDecoder === "undefined") { dizer("Este navegador não decodifica a tela. Abra no Chrome."); return; }
    if (dec) { try { dec.close(); } catch (e) {} }
    dec = new VideoDecoder({
      output: desenhar,
      error: function (e) { dizer("A imagem da tela parou: " + (e && e.message ? e.message : e)); }
    });
    dec.configure({ codec: codec, description: cru, optimizeForLatency: true });
    configurado = true;
    dizer("Ao vivo. Toque na tela para mexer no aparelho.");
  }
  ws.onopen = function () { dizer("Ligando o aparelho…"); };
  ws.onclose = function () { dizer("A tela caiu. Atualize o painel se o aparelho ainda estiver na rede."); };
  ws.onerror = function () { dizer("Não consegui abrir a tela pelo Hub."); };
  ws.onmessage = function (ev) {
    if (typeof ev.data === "string") {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.tipo === "aviso") dizer(m.texto);
      if (m.tipo === "meta") { largura = m.largura; altura = m.altura; if (m.nome) dizer(m.nome + " · " + m.largura + "×" + m.altura); }
      if (m.tipo === "config") configurar(m.codec, m.description);
      return;
    }
    if (!configurado || !dec || dec.state !== "configured") return;
    const buf = new Uint8Array(ev.data);
    if (buf.length < 2) return;
    const chave = buf[0] === 1;
    try {
      dec.decode(new EncodedVideoChunk({ type: chave ? "key" : "delta", timestamp: ts, data: buf.subarray(1) }));
      ts += 33000;
    } catch (e) { /* o próximo quadro chave recupera */ }
  };
  function pos(ev) {
    const r = canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width;
    const y = (ev.clientY - r.top) / r.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }
  function toque(acao, ev) {
    if (ws.readyState !== 1) return;
    const p = pos(ev);
    ws.send(JSON.stringify({ tipo: "toque", acao: acao, x: p.x, y: p.y }));
  }
  canvas.addEventListener("pointerdown", function (ev) { canvas.setPointerCapture(ev.pointerId); toque("down", ev); ev.preventDefault(); });
  canvas.addEventListener("pointermove", function (ev) { if (ev.buttons) toque("move", ev); });
  canvas.addEventListener("pointerup", function (ev) { toque("up", ev); });
  canvas.addEventListener("pointercancel", function (ev) { toque("up", ev); });
  canvas.addEventListener("wheel", function (ev) {
    if (ws.readyState !== 1) return;
    const p = pos(ev);
    ws.send(JSON.stringify({ tipo: "rolar", x: p.x, y: p.y, unidades: ev.deltaY > 0 ? -1 : 1 }));
    ev.preventDefault();
  }, { passive: false });
  function mandar(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  document.getElementById("voltar").onclick = function () { mandar({ tipo: "voltar" }); };
  document.getElementById("inicio").onclick = function () { mandar({ tipo: "inicio" }); };
  document.getElementById("whats").onclick = function () { mandar({ tipo: "whatsapp" }); dizer("Pedindo o Chrome para abrir o WhatsApp Web…"); };
  document.getElementById("enviar").onclick = function () {
    const t = document.getElementById("texto").value;
    if (t) mandar({ tipo: "texto", texto: t });
  };
})();
</script>
</body>
</html>`;
}
