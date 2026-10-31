import { TelaDaEmpresa } from "./painelPc";

/**
 * O PC da empresa, na ficha.
 *
 * A mesma tela do painel ao lado do chat: noVNC/Selkies do container, passando
 * pelo Hub, só ver por padrão, com o selo de quem usou por último.
 */
export function PcDaEmpresa({ empresaId, nome, onFechar }: { empresaId: string; nome: string; onFechar: () => void }) {
  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal wide pc" onClick={(e) => e.stopPropagation()}>
        <div className="pc-topo">
          <div>
            <h3>PC da {nome}</h3>
            <p className="muted">
              Um Linux só desta empresa, compartilhado pelos bots dela. Você vê a tela ao vivo
              e pode assumir o controle para um login ou um captcha.
            </p>
          </div>
          <div className="pc-botoes">
            <button className="btn" type="button" onClick={onFechar}>Fechar</button>
          </div>
        </div>
        <TelaDaEmpresa empresaId={empresaId} nome={nome} />
      </div>
    </div>
  );
}
