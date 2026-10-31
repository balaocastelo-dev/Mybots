import { UI_BASE } from "./api";
import { useEffect, useState } from "react";
import type { BotSummary } from "@mybots/shared";

// ---------------- a coluna da maquina ----------------

export type MaquinaInfo = {
  ram: { usadaGb: number; totalGb: number };
  vram: { usadaGb: number; totalGb: number; nome: string } | null;
  reserva: { ramGb: number; vramGb: number };
  saberes: { total: number; porTipo: Array<{ tipo: string; n: number }> };
};

/** Numeros lidos do Hub de verdade (RAM do sistema, VRAM pelo nvidia-smi).
 *  A marca e a reserva que o dono mandou guardar: 12 GB e 4 GB. */
export function Maquina({ bots, pendencias, voz }: { bots: BotSummary[]; pendencias: number; voz: { tts: boolean; ttsEngine: string; stt: boolean } }) {
  const [m, setM] = useState<MaquinaInfo | null>(null);
  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      try {
        const r = await fetch(`${UI_BASE}/api/maquina`);
        if (r.ok && vivo) setM(await r.json());
      } catch { /* hub caiu: a coluna simplesmente para de atualizar */ }
    };
    void ler();
    const t = setInterval(ler, 5000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  const online = bots.filter((b) => b.online).length;
  return (
    <aside className="maquina">
      <div>
        <h3>MÃ¡quina</h3>
        {m ? (
          <>
            <Medidor rotulo="MemÃ³ria" usada={m.ram.usadaGb} total={m.ram.totalGb} reserva={m.reserva.ramGb} />
            {m.vram
              ? <Medidor rotulo={"VÃ­deo Â· " + m.vram.nome.replace(/^NVIDIA GeForce /, "")} usada={m.vram.usadaGb} total={m.vram.totalGb} reserva={m.reserva.vramGb} />
              : <p className="maq-nota">Sem placa NVIDIA visÃ­vel aqui.</p>}
            <p className="maq-nota">
              A marca Ã© a reserva da casa: {m.reserva.ramGb} GB de memÃ³ria e {m.reserva.vramGb} GB de vÃ­deo
              sempre livres para o sistema.
            </p>
          </>
        ) : <p className="maq-nota">Lendo a mÃ¡quinaâ€¦</p>}
      </div>

      <div>
        <h3>Equipe</h3>
        <div className="lig"><span className="nome">Bots ligados</span><span className="n">{online} / {bots.length}</span></div>
        <div className="lig"><span className="nome">Esperando vocÃª</span><span className="n">{pendencias}</span></div>
        <div className="lig"><span className="nome">Voz</span><span className="n">{voz.tts ? voz.ttsEngine : "navegador"}</span></div>
      </div>

      <div>
        <h3>Base de conhecimento</h3>
        {m?.saberes?.porTipo?.length
          ? m.saberes.porTipo.slice(0, 7).map((t) => (
              <div className="lig" key={t.tipo}><span className="nome">{t.tipo}</span><span className="n">{t.n}</span></div>
            ))
          : <div className="vazio">Base vazia.</div>}
      </div>
    </aside>
  );
}

export function Medidor({ rotulo, usada, total, reserva }: { rotulo: string; usada: number; total: number; reserva: number }) {
  const cheio = total > 0 ? Math.min(100, (usada / total) * 100) : 0;
  const limite = total > 0 ? Math.max(0, Math.min(100, ((total - reserva) / total) * 100)) : 0;
  const folga = total - usada;
  const classe = folga < reserva ? "estourado" : folga < reserva * 1.5 ? "apertado" : "";
  return (
    <div className="med">
      <div className="med-topo">
        <span>{rotulo}</span>
        <span className="maq-num">{usada.toFixed(1)} / {total.toFixed(1)} GB</span>
      </div>
      <div className="tubo" title={`Reserva: ${reserva} GB livres`}>
        <i className={classe} style={{ width: cheio + "%" }} />
        <span className="reserva" style={{ left: limite + "%" }} />
      </div>
    </div>
  );
}

