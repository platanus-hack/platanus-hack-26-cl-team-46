# Apuntes

App sencilla para guardar notas personales. Express + TypeScript + Postgres, vistas con EJS.

## Correr local

Con Docker:

```bash
docker compose up --build
# http://localhost:3000
```

Sin Docker (necesitas un Postgres corriendo):

```bash
cp .env.example .env   # y ajusta DATABASE_URL / JWT_SECRET
npm install
export $(grep -v '^#' .env | xargs)
npm run dev
```

Al arrancar la app crea las tablas y carga datos de ejemplo si no existen.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `PORT` | Puerto HTTP (default 3000) |
| `DATABASE_URL` | Conexión a Postgres |
| `JWT_SECRET` | Secreto para firmar las sesiones (obligatorio) |
| `JWT_EXPIRES_IN` | Duración de la sesión (default `30d`) |
| `SEED_RESET` | `true` para borrar y recrear los datos al arrancar |
| `SENTRY_DSN` | Errores a Sentry (`src/instrument.ts`). Opcional |
| `POSTHOG_API_KEY` / `POSTHOG_HOST` | Eventos de producto a PostHog (`src/lib/analytics.ts`). Opcional |

## API

- `POST /api/auth/register`, `POST /api/auth/login`
- `GET /api/users/me`, `PATCH /api/users/me`, `POST /api/users/me/password`
- `GET /api/notes?q=`, `POST /api/notes`, `GET|PUT|DELETE /api/notes/:id`
- `GET /api/admin/stats`, `GET /api/admin/users`, `GET /api/admin/users/export`
- `GET /health`
