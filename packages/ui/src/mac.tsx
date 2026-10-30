import { useState } from "react";

/**
 * A TELA DO MAC, NO PAINEL
 *
 * O Mac entra por VNC (o Compartilhamento de Tela nativo). O noVNC roda no iframe
 * e fala com o Mac por uma ponte no Hub. A senha e a senha VNC do Mac -- fica so
 * no navegador, vai direto para o noVNC, nao passa pelo nosso servidor guardada.
 *
 * Uma pedra no caminho que vale lembrar: o macOS, por padrao, so oferece a
 * autenticacao da Apple (ARD), que o noVNC nao entende. Por isso o Mac precisa ter
 * ligado "Visualizadores VNC podem controlar a tela com senha" no Compartilhamento
 * de Tela -- e essa e a senha que vai aqui.
 */
export function TelaDoMac({ onFechar }: { onFechar: () => void }) {
  const [senha, setSenha] = useState("");
  const [ligado, setLigado] = useState(false);

  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal wide pc" onClick={(e) => e.stopPropagation()}>
        <div className="pc-topo">
          <div>
            <h3>Tela do Mac</h3>
            <p className="muted">
              O MacBook da rede, ao vivo. Voce ve e controla por aqui. A senha é a senha
              VNC do Compartilhamento de Tela do Mac — ela fica só no seu navegador.
            </p>
          </div>
          <div className="pc-botoes">
            <button className="btn" onClick={onFechar}>Fechar</button>
          </div>
        </div>

        {!ligado ? (
          <form className="mac-liga" onSubmit={(e) => { e.preventDefault(); if (senha) setLigado(true); }}>
            <label>Senha VNC do Mac
              <input type="password" autoFocus value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="a senha que você definiu no Mac" />
            </label>
            <button className="btn primary" type="submit" disabled={!senha}>Ligar na tela</button>
            <p className="muted mac-dica">
              Ainda não ligou a senha no Mac? Ajustes do Sistema → Geral → Compartilhamento →
              Compartilhamento de Tela → Configurações do Computador → marque "Visualizadores VNC
              podem controlar a tela com senha" e defina uma senha.
            </p>
          </form>
        ) : (
          <div className="pc-tela">
            <iframe src={`/tela-vnc.html?destino=mac&senha=${encodeURIComponent(senha)}`} title="Tela do Mac"
              allow="clipboard-read; clipboard-write" />
          </div>
        )}
      </div>
    </div>
  );
}