# Frontend (`@app/frontend`)

Next.js 16 (App Router) + Tailwind v4 + shadcn/ui (Base UI) + lucide-react.

## Correr

```bash
pnpm install          # desde la raíz del repo
pnpm dev:frontend     # http://localhost:3000
```

Scripts del monorepo (raíz): `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`.

## Dónde está cada cosa

| Ruta | Paso del flujo | Archivo |
| --- | --- | --- |
| `/` | 1. Landing | `src/app/page.tsx` |
| `/login` | 1. Login GitHub | `src/app/login/page.tsx` |
| `/connect-claude` | 2. Conectar Claude | `src/app/(app)/connect-claude/page.tsx` |
| `/projects` | 3. Elegir repo | `src/app/(app)/projects/page.tsx` |
| `/projects/[id]/analysis` | 4. Análisis (+ preguntas opcionales) | `src/app/(app)/projects/[projectId]/analysis/page.tsx` |
| `/projects/[id]/preview` | 5. Previsualización | `src/app/(app)/projects/[projectId]/preview/page.tsx` |
| `/projects/[id]/simulation` | 6–7. Simulacro (vacía, por implementar) | `src/app/(simulation)/projects/[projectId]/simulation/page.tsx` |
| `/projects/[id]/report` | 8. Feedback por dimensiones | `src/app/(app)/projects/[projectId]/report/page.tsx` |
| `/dev/components` | Playground de componentes | `src/app/dev/components/page.tsx` |

- `(app)` = páginas con header. `(simulation)` = layout inmersivo a pantalla completa.
- `src/components/ui/` — primitivas shadcn. Agregar más: `pnpm dlx shadcn@latest add <componente>` (desde `apps/frontend`).
- `src/components/simulation/families/` — las 3 familias visuales (A texto, B infra/secretos, C volumen). Placeholders listos para diseñar.
- `src/lib/types.ts` — modelo de dominio (vectores, familias, hallazgos, guión, rúbrica).
- `src/lib/mock-data.ts` — datos de ejemplo; también sirven de modo de respaldo offline para la demo.
- `src/lib/routes.ts` — helpers de rutas.

## Diseño

- Tokens de color en `src/app/globals.css` (`:root` y `.dark`). Además de los de shadcn hay tokens del simulacro: `attack`, `warning`, `safe`, `terminal` → clases `bg-attack`, `text-safe`, etc.
- Tema oscuro por defecto (`className="dark"` en `src/app/layout.tsx`).
- Fuentes: Geist Sans / Geist Mono (`font-sans`, `font-mono`).

## Ojo

Next 16 trae cambios rompedores; la doc de la versión instalada está en `node_modules/next/dist/docs/` (ver `AGENTS.md`).
`params` en páginas es una Promise: `const { projectId } = await params`.
