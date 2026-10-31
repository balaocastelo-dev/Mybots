import { useEffect, useRef, useState } from "react";
import type { HubToUi } from "@mybots/shared";
import { carregarColab, pedirCancelamento, pedirTarefa } from "./api";
import { aplicarEvento, fundirTarefa, marcarCancelada, simularAndamento } from "./normalizar";
import type { PacoteColab } from "./tipos";

type Ouvir = (l: (m: HubToUi) => void) => () => void;

export function useColab(onEvent: Ouvir, exemplo: boolean) {
  const [pacote, setPacote] = useState<PacoteColab | null>(null);

  useEffect(() => {
    let vivo = true;
    void carregarColab(exemplo).then((p) => { if (vivo) setPacote(p); });
    return () => { vivo = false; };
  }, [exemplo]);

  const ouvir = useRef(onEvent);
  ouvir.current = onEvent;
  useEffect(() => ouvir.current((m) => {
    const bruto = m as { type?: string; tipo?: string };
    const tipo = bruto.type === "colab" && bruto.tipo ? bruto.tipo : (bruto.type ?? "");
    if (!tipo.startsWith("colab.")) return;
    setPacote((p) => (p && p.fonte === "api" ? aplicarEvento(p, m) : p));
  }), []);

  useEffect(() => {
    if (!pacote || pacote.fonte !== "api") return;
    const t = window.setInterval(() => {
      void carregarColab(false).then((novo) => {
        if (novo.fonte === "api") setPacote((atual) => atual && atual.fonte === "api" ? { ...novo, ajudando: atual.ajudando } : novo);
      });
    }, 8000);
    return () => window.clearInterval(t);
  }, [pacote?.fonte]);

  const cancelar = async (id: string) => {
    setPacote((p) => (p && p.fonte === "exemplo" ? marcarCancelada(p, id) : p));
    const atual = pacote;
    if (!atual || atual.fonte === "exemplo") return;
    setPacote((p) => (p ? marcarCancelada(p, id) : p));
    const corpo = await pedirCancelamento(id);
    if (!corpo) {
      void carregarColab(false).then(setPacote);
      return;
    }
    const fresca = await pedirTarefa(id);
    setPacote((p) => {
      if (!p) return p;
      const tarefa = fresca ?? fundirTarefa(p.tarefas.find((t) => t.id === id), corpo);
      if (!tarefa) return p;
      return { ...p, tarefas: p.tarefas.map((t) => (t.id === id ? tarefa : t)) };
    });
  };

  const simular = () => setPacote((p) => (p && p.fonte === "exemplo" ? simularAndamento(p) : p));

  return { pacote, cancelar, simular };
}
