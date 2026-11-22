import type { CSSProperties } from "react";
import { ChevronLeft, Contact, Image as ImageIcon, KeyRound, MapPin, ScanFace, type LucideIcon } from "lucide-react";
import { SystemToast } from "@/components/mayday";
import { INTRO } from "../content";

/**
 * Intro, versión teléfono: el teléfono acepta permisos solo.
 * Alertas del sistema (estilo iOS en oscuro, grises sim-*, sin logos ni el azul de Apple) que
 * aparecen y se aprietan solas: contraseñas, contactos, fotos, Face ID. Detrás, la pantalla de
 * Privacidad va encendiendo cada permiso en ámbar (el atacante) en el momento del "toque".
 *   0,15–1,43 s  4 alertas, ~320 ms cada una (aparece → dedo fantasma → toque → se va)
 *   1,25 / 1,45 s bajan 2 notificaciones
 *   1,55–1,95 s  todo tiembla (transform, no luz)
 *   1,8–2,5 s    barrido de pixeles (pixel-md, en el canvas de IntroHack)
 * Todo es CSS (transform / opacity / color con delays): no hay estado ni re-render.
 */
export const MOBILE_TIMING = { sweepStart: 1800, sweepMs: 700 };

const FIRST_ALERT = 150;
const ALERT_EVERY = 320;
const ALERT_MS = 340;
const TAP_AT = 0.62; // fracción de la alerta en que el dedo "toca"

const ICONS: Record<string, LucideIcon> = {
  Contraseñas: KeyRound,
  Contactos: Contact,
  Fotos: ImageIcon,
  "Face ID y código": ScanFace,
  Ubicación: MapPin,
};

const alertAt = (i: number) => FIRST_ALERT + i * ALERT_EVERY;
const tapAt = (i: number) => Math.round(alertAt(i) + ALERT_MS * TAP_AT);

export function IntroMobile() {
  const rows = [
    ...INTRO.phoneAlerts.map((a, i) => ({ label: a.permission, onAt: tapAt(i) })),
    { label: INTRO.phoneUntouched, onAt: null },
  ];

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-sim-000"
      style={{ animation: "md-intro-shake .4s steps(6) 1550ms both" }}
    >
      {/* Barra de estado genérica */}
      <div className="flex items-center justify-between px-7 pt-4 text-[15px] font-semibold text-sim-ink tabular-nums">
        <span>03:12</span>
        <span className="flex items-center gap-1.5" aria-hidden="true">
          <span className="flex items-end gap-0.5">
            {[5, 7, 9, 11].map((h) => (
              <i key={h} className="w-[3px] rounded-sm bg-sim-ink" style={{ height: h }} />
            ))}
          </span>
          <span className="ml-1 h-[11px] w-6 rounded-sm border border-sim-ink-muted p-px">
            <i className="block h-full w-3/5 rounded-sm bg-sim-ink" />
          </span>
        </span>
      </div>

      {/* La app de fondo: Privacidad, con los permisos que se encienden solos */}
      <div className="px-4 pt-6">
        <span className="grid size-11 place-items-center rounded-full bg-sim-200 text-sim-ink">
          <ChevronLeft className="size-5" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <p className="mt-4 text-[34px] leading-[1.1] font-semibold tracking-[-0.02em] text-sim-ink">
          {INTRO.phoneScreen}
        </p>
        <div className="mt-5 overflow-hidden rounded-lg bg-sim-100">
          {rows.map((row) => {
            const Icon = ICONS[row.label] ?? KeyRound;
            return (
              <div
                key={row.label}
                className="flex items-center gap-3 border-b border-sim-line px-4 py-3 last:border-b-0"
              >
                <span className="grid size-8 place-items-center rounded-md bg-sim-300 text-sim-ink">
                  <Icon className="size-4" strokeWidth={1.5} aria-hidden="true" />
                </span>
                <span className="flex-1 text-[16px] text-sim-ink">{row.label}</span>
                <Toggle onAt={row.onAt} />
              </div>
            );
          })}
        </div>
        <p className="mt-3 px-1 text-[13px] leading-5 text-sim-ink-faint">
          Las apps que pidieron acceso aparecen aquí.
        </p>
      </div>

      {/* Fondo oscurecido mientras hay alertas */}
      <div
        className="absolute inset-0 bg-bg-000/50"
        style={{
          animation: `md-fade-in .15s ease-out ${FIRST_ALERT}ms both, md-intro-hide .2s ease-in ${
            alertAt(INTRO.phoneAlerts.length - 1) + ALERT_MS
          }ms forwards`,
        }}
      />

      {INTRO.phoneAlerts.map((a, i) => (
        <PermissionAlert key={a.permission} alert={a} at={alertAt(i)} />
      ))}

      <div className="absolute inset-x-3 top-12 flex flex-col gap-2">
        <SystemToast {...INTRO.toastLogin} attack style={{ width: "100%", animationDelay: "1250ms" }} />
        <SystemToast {...INTRO.toastPassword} attack style={{ width: "100%", animationDelay: "1450ms" }} />
      </div>
    </div>
  );
}

/** Interruptor tipo iOS. Se enciende en ámbar (lo encendió el atacante) en `onAt` ms. */
function Toggle({ onAt }: { onAt: number | null }) {
  const on = (name: string): CSSProperties | undefined =>
    onAt === null ? undefined : { animation: `${name} .15s ease-out ${onAt}ms forwards` };
  return (
    <span
      className="relative h-[30px] w-[50px] shrink-0 rounded-full bg-sim-300"
      style={on("md-ios-on")}
      aria-hidden="true"
    >
      <span
        className="absolute top-[2px] left-[2px] size-[26px] rounded-full bg-sim-ink shadow-toast"
        style={on("md-ios-knob")}
      />
    </span>
  );
}

/** Alerta del sistema que aparece, recibe un toque fantasma en "permitir" y se va. */
function PermissionAlert({ alert, at }: { alert: (typeof INTRO.phoneAlerts)[number]; at: number }) {
  const timing = `${ALERT_MS}ms linear ${at}ms both`;
  return (
    <div className="absolute inset-0 grid place-items-center px-10">
      <div
        className="w-full max-w-[300px] rounded-lg border border-sim-line bg-sim-200/90 p-5 shadow-toast backdrop-blur-xl"
        style={{ animation: `md-ios-alert ${timing}` }}
      >
        <p className="text-[17px] leading-[22px] font-semibold text-sim-ink">{alert.title}</p>
        <p className="mt-1.5 text-[15px] leading-5 text-sim-ink-muted">{alert.text}</p>
        <div className="mt-4 flex flex-col gap-2">
          <span
            className="relative rounded-full bg-sim-300 py-3 text-center text-[16px] font-semibold text-sim-ink"
            style={{ animation: `md-ios-press ${timing}` }}
          >
            {alert.allow}
            {/* El dedo del atacante: ámbar, como el cursor fantasma del computador. */}
            <span
              className="absolute top-1/2 left-1/2 -mt-5 -ml-5 size-10 rounded-full border-2 border-attack bg-attack-soft"
              style={{ animation: `md-ios-finger ${timing}` }}
            />
          </span>
          <span className="py-2 text-center text-[16px] text-sim-ink-muted">{alert.deny}</span>
        </div>
      </div>
    </div>
  );
}
