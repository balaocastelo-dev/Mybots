import { USO_GRATIS, type FichaCasa } from "@mybots/shared";
import { AVISO_WINDOWS } from "../perfil";

export function AbaAtualizacoes({ casa, noApp }: { casa: FichaCasa; noApp: boolean }) {
  const externo = (href: string) => href.startsWith("http");
  return (
    <div className="ajustes-aba" data-aba="atualizacoes">
      <section className="ajustes-grupo">
        <h3>Esta versão</h3>
        <p className="ajustes-lead">Painel {casa.versao || "0.1.0"}. Não há atualização automática: o celular troca o APK por cima e o Windows espera o instalador.</p>
        <div className="ajustes-linha">
          <span><b>Uso</b><small>{USO_GRATIS}</small></span>
        </div>
      </section>
      <section className="ajustes-grupo">
        <h3>Celular</h3>
        <p className="ajustes-lead">O arquivo é o MyBots.apk. Instalar por cima mantém a conta.</p>
        <a className="btn" href={casa.apk} download="MyBots.apk" {...(externo(casa.apk) ? { target: "_blank", rel: "noreferrer" } : {})}>Baixar para celular</a>
      </section>
      {!noApp && (
        <section className="ajustes-grupo">
          <h3>Windows</h3>
          {casa.windows ? (
            <>
              <p className="ajustes-lead">Instalador publicado para este navegador.</p>
              <a className="btn" href={casa.windows} {...(externo(casa.windows) ? { target: "_blank", rel: "noreferrer" } : {})}>Baixar para Windows</a>
            </>
          ) : (
            <p className="ajustes-lead">{AVISO_WINDOWS} Quando a URL estiver definida no Hub, o botão aparece aqui e no menu da conta.</p>
          )}
        </section>
      )}
      {noApp && (
        <section className="ajustes-grupo">
          <h3>Windows</h3>
          <p className="ajustes-lead">Você já está no aplicativo. O instalador de Windows só aparece no navegador.</p>
        </section>
      )}
    </div>
  );
}
