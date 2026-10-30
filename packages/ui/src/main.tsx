import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { claimInstance, type InstanceHandle } from "@mybots/shared";
import { App } from "./App";
import { stopEverything } from "./stop";
import "./styles.css";

type Gate = { phase: "checking" } | { phase: "leader" } | { phase: "duplicate" } | { phase: "replaced" };

/** Garante um painel só: a janela que não é líder não conecta no Hub nem fala. */
function Root() {
  const [gate, setGate] = useState<Gate>({ phase: "checking" });
  const [inst, setInst] = useState<InstanceHandle | null>(null);

  useEffect(() => {
    let alive = true;
    void claimInstance().then((h) => {
      if (!alive) { h.close(); return; }
      h.onReplaced(() => { stopEverything("outra janela assumiu", { soAqui: true }); setGate({ phase: "replaced" }); setTimeout(() => window.close(), 1500); });
      setInst(h);
      setGate({ phase: h.role });
    });
    return () => { alive = false; };
  }, []);

  if (gate.phase === "checking") return null;
  if (gate.phase === "leader") return <App />;
  if (gate.phase === "replaced") {
    return (
      <div className="gate">
        <img className="gate-logo" src="/icon.svg" alt="" />
        <h1>Janela substituída</h1>
        <p>O MyBots passou a usar outra janela. Pode fechar esta.</p>
        <button className="primary" onClick={() => window.close()}>Fechar esta janela</button>
      </div>
    );
  }
  return (
    <div className="gate">
      <img className="gate-logo" src="/icon.svg" alt="" />
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
