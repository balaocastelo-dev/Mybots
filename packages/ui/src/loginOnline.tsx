import { FormEvent, useState } from "react";
import { api, UI_BASE } from "./api";
import { TimeAmebas, TituloMyBots } from "./timeAmebas";

type Props = { onOk: (usuario: string) => void };

export function LoginOnline({ onOk }: Props) {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErro("");
    try {
      const r = await api("/login", {
        method: "POST",
        body: JSON.stringify({ usuario: usuario.trim(), senha }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) {
        setErro(String(j?.error || "nao foi possivel entrar"));
        setBusy(false);
        return;
      }
      onOk(String(j.usuario || usuario));
    } catch {
      setErro("falha de rede; tente de novo");
      setBusy(false);
    }
  }

  return (
    <div className="login-online">
      <style>{`
        .login-online-card{overflow:visible!important;padding-top:12px!important}
        .login-online .time-amebas{overflow:visible!important;margin:-8px auto 0!important;padding:6px 0 12px!important}
        .login-online .time-amebas-fila{overflow:visible!important;min-height:clamp(110px,28vw,160px)!important;padding-bottom:10px!important}
        .login-online .time-ameba{animation-name:time-hop-login!important}
        @keyframes time-hop-login{
          0%,100%{transform:translateY(calc(var(--y,0px)*0.15 - 12px)) scale(var(--s,1))}
          40%{transform:translateY(calc(var(--y,0px)*0.15 - 18px)) scale(var(--s,1))}
          55%{transform:translateY(calc(var(--y,0px)*0.15 - 12px)) scale(var(--s,1))}
        }
        @media (max-width:430px){
          .login-online-card{padding:10px 14px 18px!important}
          .login-online .time-amebas{margin:-10px auto 0!important;padding:4px 0 10px!important}
          .login-online .time-amebas-fila{min-height:124px!important;padding-bottom:12px!important}
        }
      `}</style>
      <div className="login-online-card">
        <TimeAmebas />
        <TituloMyBots />
        <p className="login-online-sub">Acesso restrito — entre com seu e-mail e senha.</p>
        <form onSubmit={enviar} className="login-online-form">
          <label>
            E-mail
            <input
              type="email"
              autoComplete="username"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          {erro ? <p className="login-online-erro" role="alert">{erro}</p> : null}
          <button type="submit" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
        </form>
        <p className="login-online-base muted">{UI_BASE || "/"}</p>
      </div>
    </div>
  );
}
