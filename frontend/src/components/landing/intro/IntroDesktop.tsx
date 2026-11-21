import type { CSSProperties, ReactNode } from "react";
import { AttackTerminal, Browser, DeployLogs, SimWindow, SystemToast } from "@/components/mayday";
import { ATTACK_SCRIPT, INTRO } from "../content";

/**
 * Intro, versión computador (el DOM; los pixeles van en el canvas de IntroHack).
 *   0–0,3 s   cursor en negro (los pixeles que se corren los pinta el canvas)
 *   0,3–1,7 s se abren 8 ventanas de la capa simulada, rápido y escalonadas; un cursor fantasma
 *             ámbar va de una a otra
 *   1,7–2,1 s todo tiembla (transform, no luz) mientras entra el barrido de pixeles
 * Todo es CSS (transform / opacity con delays): no hay estado ni re-render durante la intro.
 */
export const DESKTOP_TIMING = { noiseEnd: 520, sweepStart: 1700, sweepMs: 800 };

/** Ventana que aparece en `at` ms, en una posición de la pantalla. */
function Pop({
  at,
  left,
  top,
  width,
  height,
  dim,
  children,
}: {
  at: number;
  left: string;
  top: string;
  width: string;
  height: string;
  /** Un solo bajón de opacidad durante el temblor (localizado, nunca pantalla completa). */
  dim?: boolean;
  children: (style: CSSProperties) => ReactNode;
}) {
  return (
    <div
      className="md-intro-pop absolute"
      style={{
        left,
        top,
        width,
        height,
        ...(dim
          ? { animation: `md-intro-pop .18s cubic-bezier(.2,.8,.2,1) ${at}ms both, md-intro-dim .3s ease 1780ms` }
          : { animationDelay: `${at}ms` }),
      }}
    >
      {children({ width: "100%", height: "100%" })}
    </div>
  );
}

export function IntroDesktop() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Cursor en la pantalla negra: se ve al abrir y se va cuando llegan los pixeles. */}
      <span
        className="absolute top-[42%] left-[46%] font-mono text-[32px] leading-none text-ink"
        style={{ animation: "md-intro-hide 1ms linear 200ms forwards" }}
      >
        ▌
      </span>

      {/* Las ventanas tiemblan juntas al final (1,7–2,1 s). */}
      <div className="absolute inset-0" style={{ animation: "md-intro-shake .4s steps(6) 1700ms both" }}>
        <Pop at={300} left="3%" top="7%" width="min(560px, 40vw)" height="min(340px, 38vh)">
          {(style) => (
            <SimWindow title="zsh — ffuf · apuntes.dev" style={style}>
              <AttackTerminal lines={ATTACK_SCRIPT} variant="sim" live={false} seconds={4} startAt={0.25} />
            </SimWindow>
          )}
        </Pop>

        <Pop at={480} left="27%" top="15%" width="min(620px, 44vw)" height="min(380px, 42vh)" dim>
          {(style) => (
            <Browser
              style={style}
              tabs={[
                { title: "Google", fav: "G" },
                { title: "apuntes-dev/apuntes", fav: "A", active: true },
              ]}
              url={
                <>
                  <span>github.com/</span>apuntes-dev/apuntes
                </>
              }
            >
              <div className="md-repo">
                <div className="md-repo__path">
                  apuntes-dev <span>/</span> apuntes <span>· main</span>
                </div>
                <div className="flex flex-col py-1">
                  {INTRO.repoFiles.map((f) => (
                    <span key={f} className="border-b border-sim-line px-4 py-1.5 font-mono text-[12px] text-sim-ink">
                      {f}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex flex-col gap-2 border-t border-sim-line px-4 py-3">
                  <span className="font-mono text-[12px] text-sim-ink-muted">
                    $ git clone apuntes-dev/apuntes · Receiving objects 1204
                  </span>
                  <span className="h-1 overflow-hidden rounded-sm bg-sim-300">
                    <span
                      className="block h-full origin-left bg-sim-ink-muted"
                      style={{ animation: "md-intro-progress 1s cubic-bezier(.2,.8,.2,1) 560ms both" }}
                    />
                  </span>
                </div>
              </div>
            </Browser>
          )}
        </Pop>

        <Pop at={660} left="57%" top="5%" width="min(460px, 36vw)" height="min(250px, 30vh)">
          {(style) => (
            <SimWindow title=".env — apuntes" style={style}>
              <div className="md-code">
                {INTRO.env.map((line, i) => (
                  <div key={line.key} className={`md-code__ln ${line.leaked ? "is-hit" : ""}`}>
                    <b>{i + 1}</b>
                    <span>
                      {line.key}=
                      {line.leaked ? (
                        <span
                          className="md-injected"
                          style={{ animation: "md-type .6s steps(18) 900ms both" }}
                        >
                          {line.value}
                        </span>
                      ) : (
                        <span className="text-sim-ink-muted">{line.value}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </SimWindow>
          )}
        </Pop>

        <Pop at={840} left="6%" top="49%" width="min(640px, 46vw)" height="min(300px, 36vh)">
          {(style) => <DeployLogs style={style} rows={INTRO.logs} enter={{ start: 900, every: 110 }} />}
        </Pop>

        <Pop at={1000} left="51%" top="38%" width="min(520px, 38vw)" height="min(300px, 34vh)">
          {(style) => (
            <SimWindow title="zsh — curl · token robado" style={style}>
              <AttackTerminal lines={ATTACK_SCRIPT} variant="sim" live={false} seconds={3.5} startAt={0.6} />
            </SimWindow>
          )}
        </Pop>

        <Pop at={1160} left="25%" top="55%" width="min(600px, 42vw)" height="min(340px, 38vh)">
          {(style) => (
            <Browser
              style={style}
              compromised
              tabs={[{ title: "Apuntes · Admin", fav: "A", active: true }]}
              url={
                <>
                  <span>apuntes.dev/</span>admin
                </>
              }
            >
              <div className="flex flex-col gap-2 p-4 text-sim-ink">
                <span className="text-[15px] font-semibold">Usuarios</span>
                {INTRO.adminUsers.map((u) => (
                  <div key={u.email} className="flex justify-between border-b border-sim-line py-1 text-[12px]">
                    <span>{u.email}</span>
                    <span className="text-sim-ink-muted">{u.role}</span>
                  </div>
                ))}
                <span className="md-injected self-start" style={{ animation: "md-type .5s steps(20) 1300ms both" }}>
                  Exportando 3.812 usuarios…
                </span>
              </div>
            </Browser>
          )}
        </Pop>

        <Pop at={1300} left="70%" top="60%" width="min(380px, 28vw)" height="min(240px, 28vh)">
          {(style) => (
            <SimWindow title="zsh — nmap" style={style}>
              <AttackTerminal lines={ATTACK_SCRIPT} variant="sim" live={false} seconds={5} startAt={0} />
            </SimWindow>
          )}
        </Pop>

        <div className="absolute top-14 right-4 md-intro-pop" style={{ animationDelay: "1420ms" }}>
          <SystemToast {...INTRO.toastLogin} attack />
        </div>

        {/* Cursor fantasma del atacante, de ventana en ventana. */}
        <svg
          viewBox="0 0 20 20"
          className="absolute top-0 left-0 size-6 fill-attack stroke-on-attack"
          strokeWidth={1.2}
          style={{ animation: "md-intro-ghost 1.4s cubic-bezier(.45,0,.2,1) 300ms both" }}
          aria-hidden="true"
        >
          <path d="M3 2 L3 16 L7 12 L10 18 L12.5 17 L9.6 11 L15 11 Z" />
        </svg>
      </div>
    </div>
  );
}
