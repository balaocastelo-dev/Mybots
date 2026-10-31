/** Time de amebas v2 para a tela vazia / boas-vindas (substitui a ameba vermelha sozinha). */
import { amebaV2Path } from "./amebasV2";

/** Nove amebas coloridas e distintas — meio maior, pontas menores, arco leve. */
const TIME: { n: string; z: number; y: number; s: number; delay: string; dur: string }[] = [
  { n: "015", z: 1, y: 18, s: 0.62, delay: "0.05s", dur: "2.6s" },
  { n: "031", z: 2, y: 10, s: 0.74, delay: "0.25s", dur: "2.9s" },
  { n: "042", z: 3, y: 4,  s: 0.86, delay: "0.45s", dur: "2.4s" },
  { n: "068", z: 4, y: 0,  s: 0.96, delay: "0.15s", dur: "2.7s" },
  { n: "091", z: 5, y: -4, s: 1.12, delay: "0.00s", dur: "2.5s" }, // centro, maior
  { n: "001", z: 4, y: 0,  s: 0.96, delay: "0.35s", dur: "2.8s" },
  { n: "084", z: 3, y: 4,  s: 0.86, delay: "0.55s", dur: "2.55s" },
  { n: "055", z: 2, y: 10, s: 0.74, delay: "0.20s", dur: "3.0s" },
  { n: "098", z: 1, y: 18, s: 0.62, delay: "0.40s", dur: "2.65s" },
];

export function TimeAmebas({ className = "" }: { className?: string }) {
  return (
    <div className={"time-amebas " + className} aria-hidden="true">
      <div className="time-amebas-fila">
        {TIME.map((m, i) => (
          <span
            key={m.n + "-" + i}
            className="time-ameba"
            style={{
              zIndex: m.z,
              ["--y" as any]: m.y + "px",
              ["--s" as any]: String(m.s),
              ["--delay" as any]: m.delay,
              ["--dur" as any]: m.dur,
              ["--blink-delay" as any]: (0.8 + i * 0.7).toFixed(1) + "s",
            }}
          >
            <img src={amebaV2Path(m.n)} alt="" draggable={false} />
          </span>
        ))}
      </div>
    </div>
  );
}

/** Título padrão da casa: MyBots + assinatura. */
export function TituloMyBots({ grande = false }: { grande?: boolean }) {
  return (
    <div className={"titulo-mybots" + (grande ? " grande" : "")}>
      <h2 className="titulo-mybots-nome">MyBots</h2>
      <p className="titulo-mybots-by">By Thiago Herrera</p>
    </div>
  );
}
