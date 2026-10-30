// PARAR É PARAR. E PARAR É PARAR TUDO.
//
// Uma função só — `stopEverything()` — chamada pelo botão ⏹, pela tecla Esc, ao trocar de
// conversa, ao fechar a janela e quando outra janela assume. Nada de cada tela parar o seu
// pedaço: foi assim que o chefe clicou em parar e o bot continuou falando.
//
// A ordem importa: primeiro o que é instantâneo no navegador (a fala e o microfone),
// depois o que depende de rede (o Hub e as outras janelas). Nada de esperar servidor
// para calar.

import { INSTANCE_CHANNEL } from "@mybots/shared";
import { stopSpeaking } from "./voice";

type Parador = () => void;
const paradores = new Set<Parador>();

/**
 * Registra uma coisa que precisa parar (microfone, chamada, fila de envio…).
 * Devolve a função que desfaz o registro — use no cleanup do efeito.
 */
export function registrarParada(fn: Parador): () => void {
  paradores.add(fn);
  return () => { paradores.delete(fn); };
}

const ouvintes = new Set<(motivo: string) => void>();
/** Avisa a interface que tudo parou (para mostrar o aviso e soltar os botões). */
export function aoParar(fn: (motivo: string) => void): () => void {
  ouvintes.add(fn);
  return () => { ouvintes.delete(fn); };
}

let canal: BroadcastChannel | null = null;
function canalDasJanelas(): BroadcastChannel | null {
  if (canal) return canal;
  if (typeof BroadcastChannel === "undefined") return null;
  canal = new BroadcastChannel(INSTANCE_CHANNEL);
  canal.onmessage = (ev) => {
    const m = ev.data as { type?: string; reason?: string };
    if (m?.type === "stop") stopEverything(m.reason ?? "outra janela mandou parar", { soAqui: true });
  };
  return canal;
}

/** Liga o ouvido nas outras janelas sem precisar de ninguém chamar: basta importar este módulo. */
canalDasJanelas();

let ultimo = 0;

/**
 * Para TUDO: a fala, o microfone, o que o bot está gerando, os comandos em execução,
 * os cartões parados esperando clique e as outras janelas abertas.
 *
 * @param motivo    aparece na auditoria do Hub
 * @param soAqui    true quando o pedido VEIO de fora (outra janela ou o Hub): não devolve o eco
 */
export function stopEverything(motivo = "⏹ no painel", opcoes: { soAqui?: boolean } = {}): void {
  const agora = Date.now();
  // dois cliques no mesmo instante (botão + Esc) não viram dois pedidos ao Hub
  const repetido = agora - ultimo < 300;
  ultimo = agora;

  // 1 e 2 — NO NAVEGADOR, AGORA: a voz cala e o microfone fecha antes de qualquer rede.
  stopSpeaking();
  for (const fn of [...paradores]) { try { fn(); } catch { /* um que falha não segura os outros */ } }

  // 3 a 7 — o resto (Hub: fluxo, comandos, cartões, rotinas; e as outras janelas).
  if (!opcoes.soAqui && !repetido) {
    try { canalDasJanelas()?.postMessage({ type: "stop", reason: motivo }); } catch { /* sem canal, tudo bem */ }
    void fetch(`/api/stop${location.search}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: motivo }),
      keepalive: true,   // sobrevive ao fechamento da janela
    }).catch(() => { /* se o Hub não responder, aqui já está em silêncio */ });
  }

  for (const fn of [...ouvintes]) { try { fn(motivo); } catch { /* idem */ } }
}
