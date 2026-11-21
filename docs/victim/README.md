# Repo víctima "Apuntes": guía para el equipo

App de notas personales **deliberadamente insegura** (en el espíritu de Juice Shop o DVWA) que usamos como blanco del simulador. Vive en `victim-app/` y más adelante se publica como repo propio. La lista de debilidades, dónde están y cómo se corrigen está en [`ANSWER_KEY.md`](./ANSWER_KEY.md). **No copies estas notas dentro de `victim-app/`.**

Stack: Node 22, Express 5, TypeScript, Postgres (`pg`), vistas EJS, JWT stateless (`jsonwebtoken`), `bcryptjs`.

## Correr local

### Con Docker (recomendado)

```bash
cd victim-app
docker compose up --build -d     # app en :3000, postgres en :5433
curl localhost:3000/health       # {"status":"ok"}
docker compose logs -f app       # eventos JSON por línea
```

- Para rotar el secreto (simula la acción "rotar JWT_SECRET"): `JWT_SECRET=otro docker compose up -d app`. Todos los tokens previos pasan a responder 401.
- Para resetear los datos: `SEED_RESET=true docker compose up -d app` y después `docker compose up -d app` (sin la variable) para no seguir borrando en cada reinicio.
- Para borrar todo, incluido el volumen: `docker compose down -v`.

En esta VM, Docker no venía instalado. Se instaló con `sudo dnf install -y docker`, el daemon se levantó con `sudo dockerd &` y el plugin de compose se descargó a `/usr/libexec/docker/cli-plugins/docker-compose`. Hay que usar `sudo docker ...`.

### Sin Docker

Necesitas un Postgres accesible:

```bash
cd victim-app
npm ci
export DATABASE_URL=postgres://apuntes:apuntes@localhost:5433/apuntes JWT_SECRET=dev PORT=3000
npm run dev     # compila con tsc y arranca dist/server.js
```

## Arranque y auto-inicialización

Al arrancar (`src/server.ts`), la app:

1. Escucha de inmediato en `PORT`. Mientras inicializa, `/health` responde **503** `{"status":"starting"}`.
2. Espera la DB (30 intentos × 2 s) y, si no la encuentra, sale con código 1 para que Render la reinicie.
3. Si `SEED_RESET=true`, hace `DROP` de las tablas.
4. Corre las migraciones (`src/db/migrate.ts`). Son idempotentes, usan la tabla `schema_migrations` y un advisory lock.
5. Carga el seed (`src/db/seed.ts`). Es idempotente: `ON CONFLICT (email) DO NOTHING`, y las notas solo se insertan si el usuario se acaba de crear. Por eso un reinicio **no** deshace los cambios del atacante ni del dev.
6. `/health` pasa a **200** `{"status":"ok"}` (además hace `SELECT 1` en cada llamada).

El SSL de Postgres se maneja así: la URL interna de Render (`dpg-xxx-a`) va sin SSL. Las URLs `*.render.com` o con `?sslmode=require` usan SSL con `rejectUnauthorized: false`.

## Variables de entorno

| Variable | Obligatoria | Default | Nota |
|---|---|---|---|
| `PORT` | no | `3000` | Render la inyecta |
| `DATABASE_URL` | sí en Render | `postgres://apuntes:apuntes@localhost:5433/apuntes` | La inyecta el deployer (`needs_postgres`) |
| `JWT_SECRET` | **sí** | — | Si falta, la app no arranca. Rotarla invalida todas las sesiones |
| `NODE_ENV` | no | `development` | No cambia el comportamiento de los errores (ver answer key #7) |
| `JWT_EXPIRES_IN` | no | `30d` | Formato de `jsonwebtoken` |
| `SEED_RESET` | no | `false` | `true` = borrar y re-sembrar en cada arranque |

## Credenciales seed (datos ficticios)

| id | Email | Contraseña | Rol | Nota |
|---|---|---|---|---|
| 1 | `catalina.rojas@example.com` | `Apuntes-Admin-2026!` | admin | Dueña de la app; ve `/admin` |
| 2 | `martin.soto@example.com` | `qwerty123` | user | **Contraseña débil** (blanco de fuerza bruta). Tiene notas con datos bancarios ficticios y la clave del wifi |
| 3 | `javiera.munoz@example.com` | `Jm!8vQ2#rTz9` | user | Notas de clientes con teléfono de un tercero |
| 4 | `diego.fuentes@example.com` | `Df-2026-montaña-azul` | user | Nota con pasaporte y reserva ficticios |
| 5 | `fernanda.castillo@example.com` | `FerCast#2026*notas` | user | Nota con dirección ficticia |

Los ids son estables solo con una base nueva (o con `SEED_RESET`). El registro es libre (`POST /api/auth/register` o `/register`), así que el atacante puede crearse su propia cuenta.

## Superficie de la app

**Web (cookie `token`):** `/login`, `/register`, `/` (mis notas + buscador `?q=`), `/notes/:id`, `/profile` (perfil + cambio de contraseña), `/admin` (solo admin).

**API (`Authorization: Bearer <jwt>` o cookie `token`):**

| Método | Ruta | Auth |
|---|---|---|
| POST | `/api/auth/register` `{email,password,name}` → `{token,user}` | — |
| POST | `/api/auth/login` `{email,password}` → `{token,user}` | — |
| GET | `/api/users/me` | user |
| PATCH | `/api/users/me` `{name,phone,bio,...}` | user |
| POST | `/api/users/me/password` `{current_password,new_password}` | user |
| GET | `/api/notes?q=` | user |
| POST | `/api/notes` `{title,body}` | user |
| GET / PUT / DELETE | `/api/notes/:id` | user |
| GET | `/api/admin/stats`, `/api/admin/users` | admin |
| GET | `/api/admin/users/export` | ver answer key |
| GET | `/health` | — |

## Eventos en stdout (para el narrador)

Cada línea es un JSON con `ts`, `level` (`info|warn|error`) y `event`, más campos propios. Se leen con la API de logs de Render.

| `event` | level | Campos | Cuándo |
|---|---|---|---|
| `http_request` | info | `method, path` (con query string), `status, duration_ms, bytes, ip, user_agent, user_id, token_iat` | Cada request excepto `/health` |
| `login_failed` | warn | `email, reason` (`bad_password`\|`unknown_user`), `ip, user_agent` | Login fallido (API o web) |
| `login_success` | info | `user_id, email, ip, user_agent` | Login OK |
| `user_registered` | info | `user_id, email, ip` | Registro |
| `password_changed` | info | `user_id, email, ip, user_agent` | Cambio de contraseña |
| `profile_updated` | info | `user_id, email, fields[], ip` | Cambio de perfil (`fields` incluye `role` si hubo escalada) |
| `admin_access` | warn | `method, path, user_id, email, role, ip` | Cualquier acceso a `/api/admin/*` o `/admin` (se loguea aunque luego responda 403) |
| `admin_export` | warn | `user_id, rows, ip` | Descarga del export de usuarios |
| `server_error` | error | `method, path, user_id, ip, error, code, stack` | Cualquier 5xx (aquí caen los errores SQL) |
| `server_started` / `migration_applied` / `seed_done` / `app_ready` / `db_waiting` / `db_reset` / `startup_failed` / `shutdown` | — | — | Ciclo de vida |

`token_iat` en `http_request` permite detectar que se sigue usando un token emitido **antes** de un `password_changed`, que es la señal de que el atacante sigue adentro.

`ip` viene de `X-Forwarded-For` (`trust proxy` activado), así que en Render es la IP del cliente, pero se puede falsear.

## Contrato `victim-app/.sandbox/manifest.json`

Lo lee el deployer para saber cómo desplegar el repo:

```json
{
  "port_env": "PORT",
  "healthcheck_path": "/health",
  "runtime": "docker",
  "needs_postgres": true,
  "env": {
    "JWT_SECRET": { "generate": true },
    "NODE_ENV": { "value": "production" }
  },
  "seed_users": [
    { "email": "catalina.rojas@example.com", "password": "Apuntes-Admin-2026!", "role": "admin" },
    { "email": "martin.soto@example.com", "password": "qwerty123", "role": "user" }
  ]
}
```

| Campo | Significado |
|---|---|
| `port_env` | Nombre de la env var donde la app espera el puerto (Render setea `PORT`) |
| `healthcheck_path` | Ruta para el health check de Render. Responde 200 solo cuando migraciones y seed terminaron |
| `runtime` | `docker`: Render construye con el `Dockerfile` de la raíz del repo |
| `needs_postgres` | Si es `true`, el deployer crea una Postgres e inyecta `DATABASE_URL` (usar la **internal** URL) |
| `env.<VAR>.generate` | El deployer genera un valor aleatorio (p. ej. 32+ bytes en hex) |
| `env.<VAR>.value` | Valor literal |
| `seed_users` | Credenciales que crea el seed. El deployer las pasa al motor en `credentials.seed_users`. Hay que mantenerlas en sync con `src/db/seed.ts` (el manifest real trae los 5 usuarios) |

## Notas para Render free tier

- El servicio web free se duerme tras ~15 min sin tráfico y el cold start toma ~1 min. Conviene hacerle ping a `/health` antes del demo.
- La Postgres free expira a los 30 días. No importa para el hackathon.
- No hay `preDeployCommand` ni shell, por eso todo se inicializa en el arranque.
- La imagen es `node:22-alpine` multi-stage, corre como usuario `node` y el build tarda ~1 min.
