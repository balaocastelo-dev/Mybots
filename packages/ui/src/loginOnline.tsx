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
      onOk(String(j.usuario || usuario), { role: j.role, uid: j.uid });
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
        
      {google && (
        <a className="login-google" href={`${UI_BASE}/api/auth/google`} style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          width: "100%", padding: "12px 16px", marginBottom: 14, borderRadius: 12,
          background: "#fff", color: "#1f1f1f", textDecoration: "none", fontWeight: 600,
          border: "1px solid rgba(0,0,0,.12)", boxShadow: "0 1px 2px rgba(0,0,0,.06)",
        }}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.1 4 9.2 8.5 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.3 35.9 26.8 37 24 37c-5.3 0-9.7-3.3-11.3-8H6.2v5.1C9.1 39.4 16 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.6 5.6-6.9 6.9l.1.1 6.3 5.2C36.8 41.9 44 36 44 24c0-1.3-.1-2.5-.4-3.5z"/></svg>
          Entrar com Google
        </a>
      )}
      {google && senhaOk && <div style={{ textAlign: "center", opacity: .6, margin: "0 0 12px", fontSize: 13 }}>ou com e-mail e senha</div>}
      {senhaOk && (
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
      )}
        <p className="login-online-base muted">{UI_BASE || "/"}</p>
      </div>
    </div>
  );
}
