"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { GitHubRepo } from "./github";
import { API_URL, HttpError, request as http } from "./http";

/**
 * Sesión de GitHub del usuario. El login es del backend (GitHub App, backend/src/auth):
 * la sesión es una cookie httpOnly de api.mayday.rip y acá solo leemos GET /auth/me.
 */
export interface SessionUser {
  login: string;
  name: string | null;
  avatar_url: string;
  /** Ve los sandboxes de todos (ADMIN_GITHUB_LOGINS). */
  admin: boolean;
}

export interface SessionState {
  /** undefined = todavía cargando. */
  user: SessionUser | null | undefined;
  /** Login encendido en el backend. Apagado = API abierta (desarrollo). undefined = cargando. */
  enabled: boolean | undefined;
  /** Link de GitHub para compartir (más) repos con Mayday. */
  installUrl: string | null;
}

type Me = { enabled: boolean; user: SessionUser | null; install_url: string | null };

const EVENT = "mayday:session";
const LOGGED_OUT: Me = { enabled: true, user: null, install_url: null };
let me: Me | undefined;
let request: Promise<void> | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 1_000;

function load(force = false) {
  if (request && !force) return request;
  const current: Promise<void> = http<Me>("/auth/me", { cache: "no-store" })
    // Solo un 401 es "sin sesión". Un 5xx o un corte de red no dicen nada de la sesión.
    .catch((e: unknown) => {
      if (e instanceof HttpError && e.status === 401) return LOGGED_OUT;
      throw e;
    })
    .then((m) => {
      me = m;
      retryDelay = 1_000;
      window.dispatchEvent(new Event(EVENT));
    })
    .catch(() => {
      // El fallo no se guarda: la próxima llamada vuelve a preguntar, y mientras tanto se reintenta
      // con espera creciente (hasta 30 s) para que la página se recupere sola cuando vuelva el backend.
      if (request === current) request = null;
      if (!retry) {
        retry = setTimeout(() => {
          retry = null;
          void load();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      }
    });
  request = current;
  return request;
}

/**
 * Solo rutas internas: `next` viene de la URL y después se navega a él (el backend vuelve a validarlo).
 * Se resuelve con URL y se compara el origen: un regex no ve trucos como "/\t/evil.com" (el parser
 * de URL se come tabs y saltos de línea y queda "//evil.com").
 */
export function safeNext(next: string | null | undefined, fallback = "/start/repos"): string {
  if (!next || typeof window === "undefined") return fallback;
  try {
    const u = new URL(next, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search + u.hash : fallback;
  } catch {
    return fallback;
  }
}

const LOADING: SessionState = { user: undefined, enabled: undefined, installUrl: null };
let lastMe: Me | undefined;
let lastSnap: SessionState = LOADING;
function snapshot(): SessionState {
  if (me !== lastMe) {
    lastMe = me;
    lastSnap = me ? { user: me.user, enabled: me.enabled, installUrl: me.install_url } : LOADING;
  }
  return lastSnap;
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function useSession(): SessionState {
  useEffect(() => {
    void load();
  }, []);
  return useSyncExternalStore(subscribe, snapshot, () => LOADING);
}

/** URL del login con GitHub (la maneja el backend y vuelve a `next`). */
export function loginUrl(next = "/start/repos") {
  return `${API_URL}/auth/github/login?next=${encodeURIComponent(next)}`;
}

export async function logout() {
  await http("/auth/logout", { method: "POST" }).catch(() => {});
  await load(true);
}

/** Repos que el usuario compartió con la GitHub App (públicos y privados). */
export function listRepos(): Promise<GitHubRepo[]> {
  return http<GitHubRepo[]>("/auth/repos", { cache: "no-store" });
}
