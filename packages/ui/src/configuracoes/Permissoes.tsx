import { useEffect, useState } from "react";
import { listarItens, lerPermissoes } from "./cofre";
import { linhaDoCofre, type LinhaPermissao } from "./permissoes";

type Estado = "granted" | "denied" | "prompt" | "indisponivel";

const ROTULO: Record<Estado, string> = {
  granted: "Liberado",
  denied: "Bloqueado neste navegador",
  prompt: "Ainda não pedido",
  indisponivel: "Este navegador não informa",
};

function estadoDe(v: string): Estado {
  if (v === "granted" || v === "denied" || v === "prompt") return v;
  return "indisponivel";
}

export function AbaPermissoes({ bots }: { bots: { id: string; name: string }[] }) {
  const [microfone, setMicrofone] = useState<Estado>("indisponivel");
  const [avisos, setAvisos] = useState<Estado>(() => (typeof Notification === "undefined" ? "indisponivel" : estadoDe(Notification.permission)));
  const [linhas, setLinhas] = useState<LinhaPermissao[] | null>(null);
  const [origem, setOrigem] = useState("");
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const perm = navigator.permissions;
        if (!perm?.query) return;
        const s = await perm.query({ name: "microphone" as PermissionName });
        if (!vivo) return;
        setMicrofone(estadoDe(s.state));
        s.onchange = () => setMicrofone(estadoDe(s.state));
      } catch { /* o navegador não conta o microfone */ }
    })();
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const pacote = await listarItens();
      if (!vivo) return;
      setOrigem(pacote.origem);
      const nomes = new Map(bots.map((b) => [b.id, b.name]));
      const saida: LinhaPermissao[] = [];
      for (const item of pacote.itens) {
        const perm = await lerPermissoes(item.id);
        if (!vivo) return;
        const quem = perm.filter((p) => p.liberado).map((p) => nomes.get(p.botId) ?? p.botId);
        saida.push(linhaDoCofre(item, quem));
      }
      setLinhas(saida);
    })().catch(() => { if (vivo) setErro("Não consegui ler as permissões do cofre."); });
    return () => { vivo = false; };
  }, [bots]);

  const pedirMicrofone = async () => {
    setErro("");
    try {
      const fluxo = await navigator.mediaDevices.getUserMedia({ audio: true });
      fluxo.getTracks().forEach((t) => t.stop());
      setMicrofone("granted");
    } catch {
      setMicrofone("denied");
      setErro("O navegador não liberou o microfone.");
    }
  };

  const pedirAvisos = async () => {
    if (typeof Notification === "undefined") return;
    try {
      setAvisos(estadoDe(await Notification.requestPermission()));
    } catch {
      setAvisos("denied");
    }
  };

  return (
    <div className="ajustes-aba" data-aba="permissoes">
      <section className="ajustes-grupo">
        <h3>Neste navegador</h3>
        <p className="ajustes-lead">O microfone serve para falar com o bot. Os avisos aparecem com a aba escondida.</p>
        <div className="ajustes-linha">
          <span><b>Microfone</b><small>{ROTULO[microfone]}</small></span>
          {microfone !== "granted" && microfone !== "indisponivel" && (
            <button type="button" className="btn" onClick={() => void pedirMicrofone()}>Pedir acesso</button>
          )}
        </div>
        <div className="ajustes-linha">
          <span><b>Avisos</b><small>{ROTULO[avisos]}</small></span>
          {avisos === "prompt" && (
            <button type="button" className="btn" onClick={() => void pedirAvisos()}>Pedir acesso</button>
          )}
        </div>
        {erro && <p className="ajustes-erro" role="alert">{erro}</p>}
      </section>
      <section className="ajustes-grupo">
        <h3>Cofre</h3>
        <p className="ajustes-lead">
          Quem pode usar cada item. A senha não aparece: só o nome e a máscara.
          {origem === "exemplo" ? " Lista de exemplo neste navegador." : ""}
        </p>
        <ul className="ajustes-cofre">
          {(linhas ?? []).map((l, i) => (
            <li key={i + l.nome}>
              <div>
                <b>{l.nome}</b>
                <span>{l.detalhe}</span>
                <small>Pode usar: {l.quem}</small>
              </div>
            </li>
          ))}
        </ul>
        {linhas && !linhas.length && <p className="ajustes-lead">Nenhum item no cofre.</p>}
        <p className="ajustes-lead">Para mudar quem usa um item, abra a aba Cofre.</p>
      </section>
    </div>
  );
}
