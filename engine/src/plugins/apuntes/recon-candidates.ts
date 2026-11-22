/** Rutas candidatas para el recon, específicas de Apuntes (+ genéricas comunes). */
import type { CandidateRoute } from '../../core/types.ts';

export const APUNTES_CANDIDATES: CandidateRoute[] = [
  { path: '/' },
  { path: '/login' },
  { path: '/register' },
  { path: '/profile', sensitive: true },
  { path: '/admin', sensitive: true, adminOnly: true },
  { path: '/api' },
  { path: '/api/notes', sensitive: true },
  { path: '/api/notes/1', sensitive: true },
  { path: '/api/users/me', sensitive: true },
  { path: '/api/admin', sensitive: true, adminOnly: true },
  { path: '/api/admin/stats', sensitive: true, adminOnly: true },
  { path: '/api/admin/users', sensitive: true, adminOnly: true },
  { path: '/api/admin/users/export', sensitive: true, adminOnly: true },
  { path: '/notes/1', sensitive: true },
  { path: '/health' },
  { path: '/healthz' },
  { path: '/metrics', sensitive: true },
  { path: '/debug', sensitive: true },
  { path: '/robots.txt' },
  { path: '/.env', sensitive: true },
  { path: '/.git/config', sensitive: true },
  { path: '/api/docs' },
];
