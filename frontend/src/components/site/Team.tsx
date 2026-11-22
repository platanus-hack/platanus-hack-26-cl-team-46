import { PixelPlane } from "./PixelPlane";
import { Rise } from "./Rise";

interface Member {
  name: string;
  github: string;
  team: string;
  /** Qué avión de PixelPlane lleva de avatar (uno distinto por persona). */
  plane: number;
}

/** El equipo según CONTEXT.md (§3). */
const TEAM: Member[] = [
  {
    name: "Raimundo Mena",
    github: "rmena1",
    team: "Despliegue",
    plane: 0,
  },
  {
    name: "Daniel Toribio",
    github: "Hellonston",
    team: "Motor de hacking",
    plane: 2,
  },
  {
    name: "Sebastián Mira",
    github: "SeaMira",
    team: "Motor de hacking",
    plane: 1,
  },
  {
    name: "Clemente Bobillier",
    github: "ClementeBobillier07",
    team: "Producto",
    plane: 3,
  },
  {
    name: "Benjamín Lillo",
    github: "benjaminlillo",
    team: "Producto",
    plane: 4,
  },
];

export function Team() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {TEAM.map((m, i) => (
        <Rise
          as="li"
          key={m.github}
          delay={i * 80}
          className="flex flex-col gap-4 rounded-md border border-line bg-bg-100 p-5"
        >
          <Avatar member={m} />
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] leading-4 tracking-[0.12em] text-defense uppercase">{m.team}</span>
            <h3 className="text-[18px] leading-6 font-semibold tracking-[-0.01em] text-ink">{m.name}</h3>
            <a
              href={`https://github.com/${m.github}`}
              target="_blank"
              rel="noopener noreferrer"
              className="self-start rounded-sm font-mono text-[13px] leading-5 text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
            >
              @{m.github} ↗
            </a>
          </div>
        </Rise>
      ))}
    </ul>
  );
}

function Avatar({ member }: { member: Member }) {
  return (
    <div className="size-20 overflow-hidden rounded-md border border-line-strong bg-bg-200">
      <PixelPlane variant={member.plane} className="size-full" />
    </div>
  );
}
