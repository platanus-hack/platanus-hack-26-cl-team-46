import { StatusChip } from "@/components/mayday";
import { formatTime, HudLabel, TabHeading } from "./shared";
import type { ResultAiMoment, SimulationResult } from "./types";

/**
 * Uso de IA: cómo trabajaste con tu agente de código, que en Mayday es la única forma de
 * actuar. Lo medido (mensajes, primer pedido, latencia, cambios reales) sale del timeline;
 * las sugerencias seguidas y los pedidos clave los lee el agente de reportes.
 */

const OUTCOME: Record<ResultAiMoment["outcome"], { label: string; tone: "defense" | "neutral" | "attack" }> = {
  seguida: { label: "La seguiste", tone: "defense" },
  parcial: { label: "A medias", tone: "neutral" },
  ignorada: { label: "La ignoraste", tone: "attack" },
  sin_respuesta: { label: "Sin propuesta", tone: "neutral" },
};

function reading({ prompts, followed }: SimulationResult["aiUsage"]) {
  if (!prompts)
    return "No le pediste nada a tu agente. En Mayday es tu única forma de actuar: sin pedirle cambios, el atacante sigue donde está.";
  const ratio = followed / prompts;
  if (ratio >= 0.7)
    return "Le hiciste caso a tu agente casi siempre. Bien si sus propuestas apuntaban a la causa: revisa en el Replay si alguna no sacó al atacante.";
  if (ratio >= 0.3)
    return "Seguiste algunas propuestas de tu agente y descartaste otras. Lo importante es que cada descarte tenga una razón.";
  return "Seguiste pocas propuestas de tu agente. Puede ser criterio propio o desconfianza: compáralo con el resultado de cada momento.";
}

export function ResultAiUsage({ result, index }: { result: SimulationResult; index: string }) {
  const ai = result.aiUsage;
  const pct = ai.prompts ? Math.round((ai.followed / ai.prompts) * 100) : 0;
  const changes = ai.changes;
  const moments = ai.moments ?? [];

  const stats = [
    { label: "Pedidos", value: String(ai.prompts) },
    { label: "Seguidas", value: `${ai.followed}/${ai.prompts}` },
    ...(ai.firstPrompt !== undefined
      ? [{ label: "Primer pedido", value: ai.firstPrompt === null ? "—" : `T+${formatTime(ai.firstPrompt)}` }]
      : []),
    ...(ai.avgReply !== undefined
      ? [{ label: "Respuesta media", value: ai.avgReply === null ? "—" : `${ai.avgReply} s` }]
      : []),
  ];

  const applied = changes
    ? [
        { label: "Commits", value: changes.commits },
        { label: "Variables", value: changes.env },
        { label: "Datos", value: changes.db },
        { label: "Reinicios", value: changes.restarts },
        { label: "Deploys", value: changes.deploys },
      ]
    : [];

  return (
    <div className="flex flex-col gap-10">
      <TabHeading index={index} title="Uso de IA">
        <StatusChip tone={ai.prompts && pct >= 50 ? "defense" : "neutral"}>{pct}% seguidas</StatusChip>
      </TabHeading>

      <p className="max-w-[68ch] text-[18px] leading-7 text-ink">{reading(ai)}</p>

      <section className="flex flex-col gap-6">
        <dl className="flex flex-wrap gap-x-10 gap-y-6">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-1">
              <dt className="md-hud__label">{s.label}</dt>
              <dd className="md-mono text-[28px] leading-none font-medium text-ink">{s.value}</dd>
            </div>
          ))}
        </dl>
        {ai.prompts > 0 && (
          <div className="flex max-w-[640px] flex-col gap-2">
            <div
              className="h-2 bg-bg-300"
              role="meter"
              aria-label="Sugerencias seguidas"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div className="h-full bg-defense" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[13px] text-ink-faint">
              {ai.followed} de {ai.prompts} pedidos terminaron en algo que el agente te propuso.
            </span>
          </div>
        )}
      </section>

      {changes && (
        <section className="flex flex-col gap-4 border-t border-line pt-8">
          <HudLabel>Cambios aplicados</HudLabel>
          <p className="max-w-[68ch] text-[15px] leading-[22px] text-ink-muted">
            Lo que tu agente cambió de verdad en la app desplegada.
            {changes.failed > 0 &&
              ` ${changes.failed} ${changes.failed === 1 ? "deploy falló" : "deploys fallaron"} y quedó la versión anterior.`}
          </p>
          <dl className="grid max-w-[720px] grid-cols-2 gap-px border border-line bg-line sm:grid-cols-5">
            {applied.map((c) => (
              <div key={c.label} className="flex flex-col gap-2 bg-bg-000 px-4 py-4">
                <dt className="md-hud__label">{c.label}</dt>
                <dd className={`md-mono text-[24px] leading-none font-medium ${c.value ? "text-ink" : "text-ink-faint"}`}>
                  {c.value}
                </dd>
              </div>
            ))}
          </dl>
          {ai.manual > 0 && (
            <span className="text-[13px] text-ink-faint">Además usaste {ai.manual} acciones rápidas.</span>
          )}
        </section>
      )}

      {moments.length > 0 && (
        <section className="flex flex-col gap-4 border-t border-line pt-8">
          <HudLabel>Pedidos clave</HudLabel>
          <ol className="flex flex-col divide-y divide-line border-y border-line">
            {moments.map((m) => (
              <li key={m.seq} className="grid grid-cols-1 gap-2 py-4 md:grid-cols-[96px_1fr_auto] md:items-start md:gap-4">
                <span className="md-mono text-[15px] leading-6 text-ink-muted">T+{formatTime(m.t)}</span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-[15px] leading-6 font-medium text-ink">{m.prompt}</span>
                  <span className="text-[14px] leading-[21px] text-ink-muted">{m.note}</span>
                </div>
                <StatusChip tone={OUTCOME[m.outcome].tone}>{OUTCOME[m.outcome].label}</StatusChip>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
