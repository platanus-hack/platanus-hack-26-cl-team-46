import { Rise } from "./Rise";

/**
 * Se aprende haciendo, no viendo. A un lado *Viendo*, apagado (ink-faint); al otro *Haciendo*,
 * en cian, porque es tuyo. Misma pieza en `/` y en `/como-funciona`.
 */
const WATCHING = ["Tutoriales", "Cursos", "Sistemas que no son tuyos"];
const DOING = ["Tu propio repo", "Atacado, en una copia aislada", "Con feedback al terminar"];

export function LearnByDoing() {
  return (
    <div className="flex flex-col gap-10">
      <div className="grid overflow-hidden rounded-md border border-line md:grid-cols-2">
        <Rise className="flex flex-col gap-6 p-6 md:p-10">
          <span className="md-index uppercase">Viendo</span>
          <ul className="flex flex-col gap-3">
            {WATCHING.map((item) => (
              <li key={item} className="flex items-center gap-3 text-[20px] leading-7 text-ink-faint">
                <span aria-hidden="true" className="size-1.5 shrink-0 bg-ink-faint" />
                {item}
              </li>
            ))}
          </ul>
        </Rise>
        <Rise
          delay={120}
          className="flex flex-col gap-6 border-line bg-defense-soft p-6 max-md:border-t md:border-l md:p-10"
        >
          <span className="font-mono text-[11px] leading-4 font-medium tracking-[0.12em] text-defense uppercase">
            Haciendo
          </span>
          <ul className="flex flex-col gap-3">
            {DOING.map((item) => (
              <li key={item} className="flex items-center gap-3 text-[20px] leading-7 font-medium text-defense">
                <span aria-hidden="true" className="size-1.5 shrink-0 bg-defense" />
                {item}
              </li>
            ))}
          </ul>
        </Rise>
      </div>
      <Rise as="p" className="max-w-[40ch] text-[20px] leading-7 font-semibold tracking-[-0.01em] text-ink">
        Para el dev que es su propio equipo de seguridad.
      </Rise>
    </div>
  );
}
