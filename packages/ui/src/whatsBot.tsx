import { useEffect, useState } from "react";
import { api } from "./api";

type Estado = "desligado" | "qr" | "conectando" | "conectado";

type Whats = { estado: Estado; qr?: string; numero?: string; erro?: string };
type Nasc = {
  passo?: string | null;
  gmail?: "pendente" | "aberto" | "ok";
  whatsapp?: "pendente" | "ok";
};

function rotulo(w: Whats): string {
  if (w.estado === "conectado") return w.numero ? `Conectado · ${w.numero}` : "Conectado";
  if (w.estado === "qr") return "Esperando o QR";
  if (w.estado === "conectando") return "Conectando…";
  return "Desligado";
}

/**
 * QR e estado do WhatsApp deste bot.
 * No Celular o cartão é a tela principal quando há QR.
 * Na tela do PC ele só aparece como reserva (QR ou login do Gmail).
 */
export function CartaoWhats({ botId, onde }: { botId: string; onde: "celular" | "pc" }) {
  const [wa, setWa] = useState<Whats>({ estado: "desligado" });
  const [nasc, setNasc] = useState<Nasc | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      try {
        const [a, b] = await Promise.all([
          api(`/bots/${encodeURIComponent(botId)}/whatsapp`),
          api(`/bots/${encodeURIComponent(botId)}/nascimento`),
        ]);
        if (!vivo) return;
        if (a.ok) setWa(await a.json());
        if (b.ok) setNasc(await b.json());
      } catch { /* o painel tenta de novo */ }
    };
    void ler();
    const id = window.setInterval(() => void ler(), 2500);
    return () => { vivo = false; window.clearInterval(id); };
  }, [botId]);

  const gmailPendente = !!nasc && nasc.gmail !== "ok" && nasc.passo != null;
  const mostrarQr = wa.estado === "qr" && !!wa.qr;
  if (onde === "pc" && !mostrarQr && !gmailPendente) return null;

  const agir = async (caminho: string, body?: unknown) => {
    setOcupado(true);
    try {
      await api(`/bots/${encodeURIComponent(botId)}${caminho}`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
    } finally {
      setOcupado(false);
    }
  };

  const cheio = onde === "celular" && mostrarQr;

  return (
    <div className={"whats-cartao" + (cheio ? " cheio" : "") + (onde === "pc" ? " reserva" : "")} aria-label={onde === "celular" ? "WhatsApp no Celular" : "WhatsApp na tela do PC"}>
      {onde === "pc" && mostrarQr && <b>QR do WhatsApp</b>}
      {onde === "celular" && <b>WhatsApp · {rotulo(wa)}</b>}
      {onde === "pc" && !mostrarQr && <b>WhatsApp · {rotulo(wa)}</b>}
      {gmailPendente && (
        <p>Gmail: entre na tela do PC. A senha fica com você — ela não vem para o chat.</p>
      )}
      {mostrarQr && <img src={wa.qr} alt="QR code do WhatsApp deste bot" />}
      {mostrarQr && <p>No telefone: WhatsApp → Aparelhos conectados → Conectar aparelho.</p>}
      {wa.erro && wa.estado !== "conectado" && <p className="whats-erro">{wa.erro}</p>}
      <div className="botoes">
        {gmailPendente && (
          <button className="btn" type="button" disabled={ocupado} onClick={() => void agir("/nascimento/gmail")}>Abrir login do Gmail</button>
        )}
        {wa.estado === "conectado" ? (
          <>
            <button className="btn" type="button" disabled={ocupado} onClick={() => void agir("/whatsapp/conectar", { forcar: true })}>Reconectar</button>
            <button className="btn" type="button" disabled={ocupado} onClick={() => void agir("/whatsapp/desligar")}>Desconectar</button>
          </>
        ) : (
          <button className="btn primary" type="button" disabled={ocupado} onClick={() => void agir("/whatsapp/conectar", wa.estado === "qr" ? { forcar: true } : {})}>
            {wa.estado === "qr" ? "Gerar QR de novo" : "Conectar"}
          </button>
        )}
        {wa.estado !== "desligado" && wa.estado !== "conectado" && (
          <button className="btn" type="button" disabled={ocupado} onClick={() => void agir("/whatsapp/desligar")}>Desconectar</button>
        )}
      </div>
    </div>
  );
}
