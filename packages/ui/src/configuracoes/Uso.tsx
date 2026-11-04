import { USO_GRATIS } from "@mybots/shared";

export function AbaUso() {
  return (
    <div className="ajustes-aba" data-aba="uso">
      <section className="ajustes-grupo">
        <h3>Plano</h3>
        <p className="ajustes-uso">{USO_GRATIS}</p>
        <p className="ajustes-lead">Por enquanto a casa não cobra e não corta o uso. Quando houver franquia, o número aparece aqui no lugar desta frase.</p>
      </section>
    </div>
  );
}
