import { ButtonLink, StatusChip } from "@/components/mayday";
import { formatTime, HudLabel, TabHeading } from "./shared";
import type { SimulationResult } from "./types";

/**
 * Uso de Hinty (antes Clicky): solo en modo instructor. Qué le preguntaste al profesor
 * durante el incidente, cuántas marcas te hizo en pantalla, qué pasos de sus guías
 * seguiste y cuánto rato estuvo el incidente en pausa por él.
 */
export function ResultHinty({ result, index }: { result: SimulationResult; index: string }) {
  const h = result.clickyUsage;

  if (!h) {
    return (
      <div className="flex flex-col gap-8">
        <TabHeading index={index} title="Uso de Hinty" />
        <p className="max-w-[60ch] text-[17px] leading-7 text-ink-muted">
          No le preguntaste nada a Hinty durante el incidente.
        </p>
      </div>
    );
  }

  const stats = [
    { label: "Preguntas", value: String(h.questions) },
    { label: "Pasos guiados", value: String(h.hintsFollowed) },
    { label: "Marcas", value: String(h.highlights) },
    ...(h.pausedSeconds !== undefined ? [{ label: "En pausa", value: formatTime(h.pausedSeconds) }] : []),
    ...(h.sessions !== undefined ? [{ label: "Veces abierto", value: String(h.sessions) }] : []),
  ];
  const moments = h.moments ?? [];

  return (
    <div className="flex flex-col gap-10">
      <TabHeading index={index} title="Uso de Hinty">
        <StatusChip>Modo instructor</StatusChip>
      </TabHeading>

      {h.note && <p className="max-w-[68ch] text-[18px] leading-7 text-ink">{h.note}</p>}

      <dl className="flex flex-wrap gap-x-10 gap-y-6">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-1">
            <dt className="md-hud__label">{s.label}</dt>
            <dd className="md-mono text-[28px] leading-none font-medium text-ink">{s.value}</dd>
          </div>
        ))}
      </dl>

      {moments.length > 0 && (
        <section className="flex flex-col gap-4 border-t border-line pt-8">
          <HudLabel>Lo que le preguntaste</HudLabel>
          <ol className="flex flex-col divide-y divide-line border-y border-line">
            {moments.map((m, i) => (
              <li
                key={`${m.t}-${i}`}
                className="grid grid-cols-1 gap-2 py-4 md:grid-cols-[96px_1fr_auto] md:items-start md:gap-4"
              >
                <span className="md-mono text-[15px] leading-6 text-ink-muted">T+{formatTime(m.t)}</span>
                <span className="text-[15px] leading-6 text-ink">{m.question}</span>
                {m.guided && <StatusChip tone="defense">Te guió</StatusChip>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="flex flex-col items-start gap-4 border-t border-line pt-8">
        <p className="max-w-[64ch] text-[15px] leading-[22px] text-ink-muted">
          Con Hinty el rango es de aprendizaje. Repite el simulacro sin abrirlo para medir tu rango real en modo examen.
        </p>
        <ButtonLink href="/start">Repite en modo examen</ButtonLink>
      </section>
    </div>
  );
}
