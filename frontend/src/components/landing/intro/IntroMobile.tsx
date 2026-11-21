"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SystemToast } from "@/components/mayday";
import { INTRO } from "../content";

/**
 * Intro, versión teléfono: se te abren pestañas del navegador solas.
 * Vista de pestañas genérica (sin logos ni marcas reales), grises sim-*.
 *   0,15–1,35 s  6 pestañas apiladas que aparecen una encima de otra; el contador sube 3 → 17
 *   0,6 / 1,1 s  bajan 2 notificaciones
 *   1,5–1,8 s    las pestañas se cierran deslizándose hacia los lados
 *   1,8–2,5 s    barrido de pixeles (pixel-md, en el canvas de IntroHack)
 */
export const MOBILE_TIMING = { sweepStart: 1800, sweepMs: 700 };

const TAB_EVERY = 200;
const TAB_START = 150;
const CLOSE_AT = 1500;

export function IntroMobile() {
  const [tabs, setTabs] = useState(INTRO.tabsFrom);
  useEffect(() => {
    const steps = INTRO.tabsTo - INTRO.tabsFrom;
    const every = (CLOSE_AT - TAB_START) / steps;
    let n = 0;
    let id = 0;
    const start = window.setTimeout(() => {
      id = window.setInterval(() => {
        n++;
        setTabs(INTRO.tabsFrom + n);
        if (n >= steps) window.clearInterval(id);
      }, every);
    }, TAB_START);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden bg-sim-000">
      <div className="absolute inset-x-0 top-16 text-center text-[15px] font-semibold text-sim-ink tabular-nums">
        {tabs} pestañas
      </div>

      {PAGES.map((page, i) => (
        <div
          key={page.url}
          className="absolute inset-x-4 h-[300px] overflow-hidden rounded-lg bg-sim-100 shadow-window"
          style={{
            top: 104 + i * 62,
            animation: `md-intro-rise .22s cubic-bezier(.2,.8,.2,1) ${TAB_START + i * TAB_EVERY}ms both, ${
              i % 2 ? "md-intro-out-right" : "md-intro-out-left"
            } .28s cubic-bezier(.4,0,1,1) ${CLOSE_AT + (PAGES.length - 1 - i) * 40}ms forwards`,
          }}
        >
          <div className="flex h-10 items-center gap-2 border-b border-sim-line px-3">
            <span className="md-tab__fav">{page.fav}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-sim-ink">{page.url}</span>
            <span className="text-[16px] leading-none text-sim-ink-muted" aria-hidden="true">
              ×
            </span>
          </div>
          <div className="h-[260px] overflow-hidden p-4 text-sim-ink">{page.body}</div>
        </div>
      ))}

      <div className="absolute inset-x-4 top-12 flex flex-col gap-2">
        <SystemToast {...INTRO.toastLogin} attack style={{ width: "100%", animationDelay: "600ms" }} />
        <SystemToast {...INTRO.toastPassword} attack style={{ width: "100%", animationDelay: "1100ms" }} />
      </div>
    </div>
  );
}

/** Páginas falsas de las pestañas: login, admin, export, una nota y logs. */
const PAGES: { url: string; fav: string; body: ReactNode }[] = [
  {
    url: "apuntes.dev/login",
    fav: "A",
    body: (
      <div className="flex flex-col gap-3 pt-4">
        <span className="text-[20px] font-semibold">Apuntes</span>
        <span className="rounded-md border border-sim-line px-3 py-2 text-[13px]">admin@apuntes.dev</span>
        <span className="rounded-md border border-sim-line px-3 py-2 text-[13px] tracking-[0.3em]">••••••••••</span>
        <span className="rounded-md bg-sim-ink py-2 text-center text-[13px] font-semibold text-sim-000">Entrar</span>
      </div>
    ),
  },
  {
    url: "apuntes.dev/admin",
    fav: "A",
    body: (
      <div className="flex flex-col gap-2">
        <span className="text-[15px] font-semibold">Usuarios</span>
        {INTRO.adminUsers.map((u) => (
          <div key={u.email} className="flex justify-between border-b border-sim-line py-1 text-[12px]">
            <span className="truncate">{u.email}</span>
            <span className="text-sim-ink-muted">{u.role}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    url: "apuntes.dev/api/users/export",
    fav: "{",
    body: (
      <pre className="font-mono text-[11px] leading-[17px] whitespace-pre-wrap text-sim-ink-muted">
        {`[{"id":1,"email":"catalina.rojas@example.com",
  "role":"admin","password_hash":"$2b$10$Qe…"},
 {"id":2,"email":"martin.soto@example.com",
  "role":"user","password_hash":"$2b$10$8Lz…"},
 {"id":3,"email":"fernanda.diaz@example.com",`}
      </pre>
    ),
  },
  {
    url: "apuntes.dev/notes/17",
    fav: "A",
    body: (
      <div className="flex flex-col gap-2">
        <span className="text-[15px] font-semibold">Datos para transferencias</span>
        <span className="text-[13px] leading-5 text-sim-ink-muted">Banco · cuenta corriente 00-123-45678-09 · RUT 12.345.678-5</span>
      </div>
    ),
  },
  {
    url: "apuntes.dev/api/admin/users",
    fav: "{",
    body: (
      <pre className="font-mono text-[11px] leading-[17px] whitespace-pre-wrap text-sim-ink-muted">
        {`HTTP/2 200
x-powered-by: Express
{"users":3812,"exported_by":"admin@apuntes.dev",
 "token_iat":"03:12:44"}`}
      </pre>
    ),
  },
  {
    url: "logs · apuntes · prod",
    fav: "L",
    body: (
      <div className="flex flex-col gap-1 font-mono text-[11px] leading-[17px]">
        {INTRO.logs.map((l) => (
          <span
            key={l.time}
            className={l.level === "ATTACK" ? "bg-attack-soft px-1 text-attack-strong" : "px-1 text-sim-ink-muted"}
          >
            {l.level} {l.message}
          </span>
        ))}
      </div>
    ),
  },
];
