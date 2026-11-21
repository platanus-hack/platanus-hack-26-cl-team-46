"use client";

import { useEffect, useSyncExternalStore } from "react";
import { API_URL } from "./api";
import type { GitHubRepo } from "./github";

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
let me: Me | undefined;
let request: Promise<void> | null = null;

function load(force = false) {
  if (request && !force) return request;
  request = fetch(`${API_URL}/auth/me`, { credentials: "include", cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
    .catch(() => null)
    // Si el backend no responde, lo tratamos como "sin sesión" (con login encendido).
    .then((m) => {
      me = m ?? { enabled: true, user: null, install_url: null };
      window.dispatchEvent(new Event(EVENT));
    });
  return request;
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
  await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
  await load(true);
}

/** Repos que el usuario compartió con la GitHub App (públicos y privados). */
export async function listRepos(): Promise<GitHubRepo[]> {
  const res = await fetch(`${API_URL}/auth/repos`, { credentials: "include", cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
  return body as GitHubRepo[];
}
