import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { claimInstance, type InstanceHandle } from "@mybots/shared";
import { App } from "./App";
import { stopEverything } from "./stop";
import { api, UI_BASE } from "./api";
import { LoginOnline } from "./loginOnline";
import "./styles.css";

type Gate = { phase: "checking" } | { phase: "leader" } | { phase: "duplicate" } | { phase: "replaced" };
type Auth = { phase: "loading" } | { phase: "login" } | { phase: "ok"; usuario?: string };

const icon = (nome: string) => `${UI_BASE}/${nome}`.replace(/\/{2,}/g, "/").replace(":/", "://");

/** Garante um painel so: a janela que nao e lider nao conecta no Hub nem fala. */
function Root() {
  const [auth, setAuth] = useState<Auth>({ phase: "loading" });
  const [gate, setGate] = useState<Gate>({ phase: "checking" });
  const [inst, setInst] = useState<InstanceHandle | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await api("/me");
        const j = await r.json().catch(() => ({} as any));
        if (!alive) return;
        if (j?.autenticado) setAuth({ phase: "ok", usuario: j.usuario });
        else setAuth({ phase: "login" });
      } catch {
        if (alive) setAuth({ phase: "login" });
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (auth.phase !== "ok") return;
    let alive = true;
    void claimInstance().then((h) => {
      if (!alive) { h.close(); return; }
      h.onReplaced(() => { stopEverything("outra janela assumiu", { soAqui: true }); setGate({ phase: "replaced" }); setTimeout(() => window.close(), 1500); });
      setInst(h);
      setGate({ phase: h.role });
    });
    return () => { alive = false; };
  }, [auth.phase]);

  if (auth.phase === "loading") return null;
  if (auth.phase === "login") return <LoginOnline onOk={(usuario) => setAuth({ phase: "ok", usuario })} />;

  if (gate.phase === "checking") return null;
  if (gate.phase === "leader") return <App />;
  if (gate.phase === "replaced") {
    return (
      <div className="gate">
        <img className="gate-logo" src={icon("icon.svg")} alt="" />
        <h1>Janela substituída</h1>
        <p>O MyBots passou a usar outra janela. Pode fechar esta.</p>
        <button className="primary" onClick={() => window.close()}>Fechar esta janela</button>
      </div>
    );
  }
  return (
    <div className="gate">
      <img className="gate-logo" src={icon("icon.svg")} alt="" />
      <h1>MyBots já está aberto em outra janela</h1>
      <p>Para não ter dois painéis falando ao mesmo tempo, só uma janela fica ativa.</p>
      <div className="gate-actions">
        <button className="primary" onClick={() => window.close()}>Fechar esta janela</button>
        <button onClick={() => { inst?.takeover(); setGate({ phase: "leader" }); }}>Usar aqui</button>
      </div>
      <small>Se a janela não fechar sozinha, feche pelo X.</small>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
