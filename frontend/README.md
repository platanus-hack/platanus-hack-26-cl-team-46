# Frontend (`frontend`)

Next.js 16 (App Router, `cacheComponents` + `partialPrefetching`) + Tailwind v4 + shadcn/ui (style `base-nova`, Base UI) + lucide-react.

## Correr

```bash
pnpm install                       # desde la raíz del repo
pnpm dev:frontend                  # http://localhost:3000
pnpm --filter frontend lint
pnpm --filter frontend typecheck   # next typegen && tsc --noEmit
pnpm --filter frontend build
```

## Dónde está cada cosa

| Ruta | Paso del flujo | Archivo |
| --- | --- | --- |
| `/` | 1. Landing (con link a `/deploy`) | `src/app/page.tsx` |
| `/login` | 1. Login GitHub | `src/app/login/page.tsx` |
| `/connect-claude` | 2. Conectar Claude | `src/app/(app)/connect-claude/page.tsx` |
| `/projects` | 3. Elegir repo | `src/app/(app)/projects/page.tsx` |
| `/projects/[id]/analysis` | 4. Análisis (+ preguntas opcionales) | `src/app/(app)/projects/[projectId]/analysis/page.tsx` |
| `/projects/[id]/preview` | 5. Previsualización | `src/app/(app)/projects/[projectId]/preview/page.tsx` |
| `/projects/[id]/simulation` | 6–7. Simulacro (vacía, por implementar) | `src/app/(simulation)/projects/[projectId]/simulation/page.tsx` |
| `/projects/[id]/report` | 8. Feedback por dimensiones | `src/app/(app)/projects/[projectId]/report/page.tsx` |
| `/dev/components` | Playground de componentes | `src/app/dev/components/page.tsx` |
| `/deploy` | Consola de desarrollo del servicio de deploy | `src/app/deploy/page.tsx` |

- `(app)` = páginas con header. `(simulation)` = layout inmersivo a pantalla completa.
- `src/components/ui/` — primitivas shadcn. Agregar más: `pnpm dlx shadcn@latest add <componente>` (desde `frontend/`). Ojo: `shadcn init` rompe `src/lib/utils.ts` y agrega un paquete npm `cn`; no lo vuelvas a correr y no instales `cn`.
- `src/components/simulation/families/` — las 3 familias visuales (A texto, B infra/secretos, C volumen). Placeholders listos para diseñar.
- `src/lib/types.ts` — modelo de dominio (vectores, familias, hallazgos, guión, rúbrica).
- `src/lib/mock-data.ts` — datos de ejemplo; también sirven de modo de respaldo offline para la demo.
- `src/lib/routes.ts` — helpers de rutas (usar en vez de strings sueltos).
- `src/lib/api.ts` — cliente del backend (servicio de deploy).

## Diseño

- Tokens de color en `src/app/globals.css` (`:root` y `.dark`). Además de los de shadcn hay tokens del simulacro: `attack`, `warning`, `safe`, `terminal` → clases `bg-attack`, `text-safe`, etc.
- Tema oscuro por defecto (`className="dark"` en `src/app/layout.tsx`).
- Fuentes: Geist Sans / Geist Mono (`font-sans`, `font-mono`).

## Ojo

Next 16 trae cambios rompedores; la doc de la versión instalada está en `node_modules/next/dist/docs/` (ver `AGENTS.md`).

Con `cacheComponents`, `params` es dato de runtime: **no hagas `await params` en el cuerpo de la página** (rompe el build con "uncached or runtime data during prerendering"). Pasa la Promise hacia abajo y resuélvela dentro de `<Suspense>`. Ejemplo en `analysis/page.tsx`: `next={{ href: params.then(({ projectId }) => routes.preview(projectId)), ... }}`; `PagePlaceholder` resuelve el `href` dentro de un `<Suspense>`.
