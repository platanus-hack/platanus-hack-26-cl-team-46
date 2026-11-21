"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { GitHubRepo, GitHubUser } from "./github";
import { github } from "./github";

/**
 * La "conexión" con GitHub del onboarding. Dos caminos:
 * - oauth: entró con GitHub. El token vive en una cookie httpOnly del servidor de Next
 *   (ver src/app/api/auth); acá solo vemos el perfil público vía /api/auth/me.
 * - username: respaldo sin login (si el OAuth no está configurado). Escribió su usuario
 *   y lo guardamos en localStorage.
 */
export interface GitHubConnection {
  login: string;
  name: string | null;
  avatar_url: string;
  public_repos: number;
  via: "oauth" | "username";
}

export interface ConnectionState {
  /** undefined = todavía cargando. */
  connection: GitHubConnection | null | undefined;
  /** Si el login con GitHub está configurado en el servidor. undefined = cargando. */
  oauth: boolean | undefined;
}

const STORAGE_KEY = "mayday.github";
const EVENT = "mayday:github";
const emit = () => window.dispatchEvent(new Event(EVENT));

// --- Sesión OAuth (servidor) ---------------------------------------------------------------

type Me = { oauth: boolean; user: Omit<GitHubConnection, "via"> | null };
let me: Me | undefined;
let meRequest: Promise<void> | null = null;

function loadMe(force = false) {
  if (meRequest && !force) return meRequest;
  meRequest = fetch("/api/auth/me", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<Me>) : { oauth: false, user: null }))
    .catch(() => ({ oauth: false, user: null }))
    .then((m) => {
      me = m;
      emit();
    });
  return meRequest;
}

// --- Respaldo sin login (localStorage) -----------------------------------------------------

let cachedRaw: string | null = null;
let cachedLocal: GitHubConnection | null = null;
function localConnection(): GitHubConnection | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedLocal = raw ? { ...(JSON.parse(raw) as GitHubConnection), via: "username" } : null;
    } catch {
      cachedLocal = null;
    }
  }
  return cachedLocal;
}

// --- Hook ----------------------------------------------------------------------------------

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

// useSyncExternalStore exige snapshots estables: memo por (me, local).
let lastSnap: { me: Me | undefined; local: GitHubConnection | null; value: ConnectionState } | null = null;
function snapshot(): ConnectionState {
  const local = localConnection();
  if (lastSnap && lastSnap.me === me && lastSnap.local === local) return lastSnap.value;
  const value: ConnectionState = {
    oauth: me?.oauth,
    // La sesión OAuth manda; si no hay, el usuario escrito a mano.
    connection: me === undefined ? undefined : me.user ? { ...me.user, via: "oauth" } : local,
  };
  lastSnap = { me, local, value };
  return value;
}

const SERVER_SNAPSHOT: ConnectionState = { connection: undefined, oauth: undefined };

export function useGitHubConnection(): ConnectionState {
  useEffect(() => {
    void loadMe();
  }, []);
  return useSyncExternalStore(subscribe, snapshot, () => SERVER_SNAPSHOT);
}

/** Respaldo sin login: guarda el perfil público que escribió el usuario. */
export function saveUsernameConnection(user: GitHubUser) {
  const conn: GitHubConnection = {
    login: user.login,
    name: user.name,
    avatar_url: user.avatar_url,
    public_repos: user.public_repos,
    via: "username",
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
  emit();
}

/** Cierra la sesión de GitHub (cookie) y olvida el usuario guardado. */
export async function disconnectGitHub() {
  localStorage.removeItem(STORAGE_KEY);
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  await loadMe(true);
}

/** Repos públicos de la conexión: con login, por nuestro servidor (incluye orgs); sin login, la API pública. */
export async function listReposFor(conn: GitHubConnection): Promise<GitHubRepo[]> {
  if (conn.via === "username") return github.listRepos(conn.login);
  const res = await fetch("/api/github/repos", { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
  return body as GitHubRepo[];
}
