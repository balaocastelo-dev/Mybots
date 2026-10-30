// Uma janela só do painel por navegador ("líder"). As outras ficam paradas: não conectam no Hub nem falam.
// Usa BroadcastChannel (funciona em http sem HTTPS). Lógica pura para dar para testar no Node.

export const INSTANCE_CHANNEL = "mybots-instance";
export const HELLO_TIMEOUT_MS = 400;

type Msg =
  | { type: "hello"; id: string }
  | { type: "leader"; id: string; to?: string }
  | { type: "takeover"; id: string };

export type InstanceRole = "leader" | "duplicate";

export type InstanceHandle = {
  id: string;
  role: InstanceRole;
  /** virar líder à força (manda `takeover`; a antiga para) */
  takeover: () => void;
  /** chamado no líder antigo quando outra janela faz takeover */
  onReplaced: (cb: () => void) => void;
  close: () => void;
};

type ChannelLike = { postMessage: (m: unknown) => void; close: () => void; onmessage: ((ev: { data: unknown }) => void) | null };

const newChannel = (): ChannelLike | null => {
  const Ctor = (globalThis as any).BroadcastChannel;
  if (!Ctor) return null;
  const ch = new Ctor(INSTANCE_CHANNEL) as ChannelLike & { unref?: () => void };
  ch.unref?.(); // Node: não segura o processo
  return ch;
};

/**
 * Pergunta "tem alguém aí?" e espera HELLO_TIMEOUT_MS. Se um líder responder (ou outra janela
 * mais antiga estiver também perguntando), vira `duplicate`; senão assume como `leader`.
 */
export function claimInstance(timeoutMs = HELLO_TIMEOUT_MS): Promise<InstanceHandle> {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const ch = newChannel();
  let role: InstanceRole = "leader";
  let replacedCb: () => void = () => {};
  let closed = false;

  const handle: InstanceHandle = {
    id,
    get role() { return role; },
    set role(r: InstanceRole) { role = r; },
    takeover: () => {
      if (!ch || closed) return;
      ch.postMessage({ type: "takeover", id } satisfies Msg);
      role = "leader";
    },
    onReplaced: (cb) => { replacedCb = cb; },
    close: () => { closed = true; try { ch?.close(); } catch {} },
  } as InstanceHandle;

  if (!ch) return Promise.resolve(handle); // sem BroadcastChannel: age como líder

  return new Promise((resolve) => {
    let settled = false;
    const settle = (r: InstanceRole) => { if (settled) return; settled = true; role = r; resolve(handle); };
    ch.onmessage = (ev) => {
      const m = ev.data as Msg;
      if (!m || typeof m !== "object" || m.id === id) return;
      switch (m.type) {
        case "hello":
          // já sou líder → respondo. Ainda esperando → desempate: o id menor (mais antigo) fica.
          if (settled && role === "leader") ch.postMessage({ type: "leader", id, to: m.id } satisfies Msg);
          else if (!settled && m.id < id) settle("duplicate");
          break;
        case "leader":
          if (!settled && (!m.to || m.to === id)) settle("duplicate");
          break;
        case "takeover":
          if (role === "leader") { role = "duplicate"; settle("duplicate"); replacedCb(); }
          break;
      }
    };
    ch.postMessage({ type: "hello", id } satisfies Msg);
    setTimeout(() => settle("leader"), timeoutMs);
  });
}
