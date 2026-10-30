import { useEffect, useState } from "react";

/**
 * O PC DA EMPRESA, NA TELA
 *
 * Um Linux em container, so dessa empresa, rodando nesta mesma maquina. A tela vem
 * por noVNC dentro de um iframe: o chefe ve o bot navegando, clicando e preenchendo,
 * ao vivo -- e pode pegar o mouse se quiser ajudar (fazer um login, resolver um
 * captcha) sem tirar o bot do caminho.
 */
type Maquina = {
  empresaId: string; container: string; portaTela: number; portaCdp: number;
  estado: "ligada" | "desligada" | "sem-docker" | "nao-criada";
  telaUrl?: string; erro?: string; imagem?: boolean;
};

export function PcDaEmpresa({ empresaId, nome, onFechar }: { empresaId: string; nome: string; onFechar: () => void }) {
  const [m, setM] = useState<Maquina | null>(null);
  const [indo, setIndo] = useState(false);

  const ler = async () => {
    try { const r = await fetch(`/api/empresas/${empresaId}/maquina`); if (r.ok) setM(await r.json()); } catch { /* o Hub volta */ }
  };
  useEffect(() => { void ler(); const t = setInterval(ler, 5000); return () => clearInterval(t); }, [empresaId]);

  const acao = async (qual: "ligar" | "desligar") => {
    setIndo(true);
    try {
      const r = await fetch(`/api/empresas/${empresaId}/maquina/${qual}`, { method: "POST" });
      if (r.ok) setM(await r.json());
    } finally { setIndo(false); void ler(); }
  };

  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal wide pc" onClick={(e) => e.stopPropagation()}>
        <div className="pc-topo">
          <div>
            <h3>PC da {nome}</h3>
            <p className="muted">
              Um Linux so desta empresa. O que o bot abre e faz login aqui continua valendo amanha,
              e voce pode pegar o mouse a qualquer momento.
            </p>
          </div>
          <div className="pc-botoes">
            {m?.estado === "ligada"
              ? <button className="btn" disabled={indo} onClick={() => void acao("desligar")}>Desligar</button>
              : <button className="btn primary" disabled={indo || m?.estado === "sem-docker"} onClick={() => void acao("ligar")}>
                  {indo ? "Ligando..." : m?.estado === "nao-criada" ? "Criar o PC" : "Ligar"}
                </button>}
            <button className="btn" onClick={onFechar}>Fechar</button>
          </div>
        </div>

        {m?.estado === "sem-docker" && (
          <div className="pc-aviso">
            O Docker nao esta no ar nesta maquina. O PC da empresa roda em container, entao
            abra o Docker Desktop e tente de novo.
          </div>
        )}
        {m?.erro && <div className="pc-aviso">{m.erro}</div>}

        <div className="pc-tela">
          {m?.estado === "ligada" && m.telaUrl
            ? <iframe src={m.telaUrl} title={`PC da ${nome}`} allow="clipboard-read; clipboard-write" />
            : <div className="pc-vazia">
                {indo ? "ligando o PC da empresa..."
                  : m?.estado === "nao-criada" ? "Esta empresa ainda nao tem PC. Crie e o bot ganha um Linux so dela."
                  : m?.estado === "desligada" ? "O PC esta desligado."
                  : "lendo o estado..."}
              </div>}
        </div>

        {m?.estado === "ligada" && (
          <p className="pc-pe muted">
            tela em 127.0.0.1:{m.portaTela} · navegador dos bots em 127.0.0.1:{m.portaCdp} · container {m.container}
          </p>
        )}
      </div>
    </div>
  );
}