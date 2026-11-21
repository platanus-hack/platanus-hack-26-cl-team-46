/**
 * Rutas del flujo MVP en un solo lugar. Usar siempre estos helpers en vez de
 * strings sueltos para que renombrar una ruta sea un cambio de una línea.
 */
export const routes = {
  home: "/",
  login: "/login",
  connectClaude: "/connect-claude",
  projects: "/projects",
  analysis: (projectId: string) => `/projects/${projectId}/analysis`,
  preview: (projectId: string) => `/projects/${projectId}/preview`,
  simulation: (projectId: string) => `/projects/${projectId}/simulation`,
  report: (projectId: string) => `/projects/${projectId}/report`,
  devComponents: "/dev/components",
} as const;
