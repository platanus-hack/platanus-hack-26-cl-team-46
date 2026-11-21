# Answer key: repo víctima "Apuntes"

> **Confidencial para el equipo.** Este archivo NO debe quedar dentro de `victim-app/` (el analizador lee esa carpeta).
> Lo usa el motor para evaluar al analizador y armar el debrief.
> Las líneas corresponden al commit en que se escribió este archivo. Si alguien edita `victim-app/`, vuelve a revisarlas (`grep -n` con los fragmentos de la columna "Evidencia").

La app es un gestor de notas personales (Express 5 + TypeScript + Postgres + EJS). Tiene **8 debilidades plantadas**. Las rutas son relativas a `victim-app/`.

## Resumen

| # | `vuln_id` | Archivo:línea | Evidencia | Severidad | Dificultad (1-5) | Orden sugerido |
|---|---|---|---|---|---|---|
| 1 | `weak-password-no-rate-limit` | `src/routes/auth.ts:41` (API) y `src/routes/web.ts:19` (form); usuario débil en `src/db/seed.ts:27` | Login sin limitación de intentos; `martin.soto@example.com` usa `qwerty123`; el registro no exige política de contraseñas (`src/routes/auth.ts:30`) | high | 1 | 1 |
| 2 | `jwt-not-invalidated-on-password-change` | `src/routes/users.ts:30` (cambio de contraseña) + `src/middleware/auth.ts:25` (no compara `iat`) + `src/config.ts:14` (`30d`) | El cambio de contraseña no rota ni invalida tokens; JWT stateless de 30 días | high | 2 | 2 |
| 3 | `idor` | `src/routes/notes.ts:23` (API) y `src/routes/web.ts:67` (vista HTML) | `getNote(id)` sin filtrar por `user_id` (en cambio `PUT`/`DELETE` sí filtran) | high | 1 | 3 |
| 4 | `admin-endpoint-no-authz` | `src/routes/admin.ts:33` | `/api/admin/users/export` usa `requireAuth` pero le falta `requireAdmin`; además hace `SELECT *` e incluye `password_hash` | critical | 1 | 4 |
| 5 | `mass-assignment` | `src/models/users.ts:47` (lista incluye `role`) usado desde `src/routes/users.ts:20` (`PATCH /api/users/me`) y `POST /profile` | `updateUser(id, req.body)` acepta cualquier columna de `USER_COLUMNS`, incluida `role` | critical | 2 | 5 |
| 6 | `sql-injection` | `src/models/notes.ts:15` | Búsqueda `?q=` concatenada en `ILIKE '%${search}%'` (API `GET /api/notes?q=` y dashboard `/?q=`) | critical | 3 | 6 |
| 7 | `verbose-errors` | `src/middleware/errors.ts:31-44` | El error handler devuelve `message`, `code`, `detail`, `hint`, `position` y `stack` al cliente (JSON y HTML), **sin mirar `NODE_ENV`** | medium | 1 | 7 (habilita la #6) |
| 8 | `stored-xss` | `views/note.ejs:6` y `views/admin.ejs:24` | El cuerpo de la nota se renderiza con `<%- %>` (sin escapar). En `/admin` lo ve la admin | high | 3 | 8 |

**Agravantes (no son vulns del catálogo, pero sirven para el debrief):**

- La cookie `token` no es `httpOnly` (`src/routes/web.ts:12`, usada en `:25` y `:43`): un XSS puede leer la sesión. Combinada con #2, el token robado sigue sirviendo aunque la víctima cambie su contraseña.
- La respuesta del export incluye `password_hash` (bcrypt): permite crackeo offline de contraseñas débiles.
- `app.set('trust proxy', true)` (`src/app.ts`) toma la IP del primer valor de `X-Forwarded-For`; un atacante puede falsearla en los logs. Bloquear por IP no es una defensa confiable.
- Ids secuenciales (`SERIAL`) facilitan enumerar notas (#3). Usar UUID **no** arregla el IDOR, solo lo oculta.

**Falsos positivos esperables del analizador:** `JWT_SECRET: ${JWT_SECRET:-solo-para-desarrollo-local}` en `docker-compose.yml` y `JWT_SECRET=cambia-esto` en `.env.example` son solo para uso local. En Render el secreto lo genera el deployer y `src/config.ts` lanza error si falta (no hay fallback hardcodeado). Las contraseñas en texto plano de `src/db/seed.ts` son datos de seed. Si el analizador las marca como `hardcoded-secret`, es un hallazgo menor y no forma parte de los 8.

---

## Detalle por debilidad

### 1. `weak-password-no-rate-limit`

- **Dónde:** `src/routes/auth.ts:8-25` (`login()`), que usan `POST /api/auth/login` (`:41`) y `POST /login` (`src/routes/web.ts:19`). No hay rate limit, lockout, captcha ni backoff. El usuario seed `martin.soto@example.com` / `qwerty123` (`src/db/seed.ts:27`) está en cualquier wordlist común. El registro acepta cualquier contraseña no vacía.
- **Síntomas / logs:** una ráfaga de `{"event":"login_failed","email":"martin.soto@example.com","reason":"bad_password","ip":...}` desde la misma IP o user-agent, seguida de un `login_success` con esa IP. Si prueban emails al azar, aparece `reason:"unknown_user"`. Además hay muchas líneas `http_request` con `status:401` en `/api/auth/login`.
- **Narrativa sugerida:** "Martín te escribe: le llegó un aviso de inicio de sesión que no reconoce"; un pico de 401 en el dashboard.
- **Corrección correcta:** rate limit por cuenta **y** por IP en **ambas** rutas (`express-rate-limit` o un contador en DB/Redis), backoff o lockout temporal, política mínima de contraseñas (largo y lista de contraseñas filtradas) y forzar el reset de las cuentas con contraseñas débiles. Opcional: 2FA.
- **Arreglos equivocados comunes:**
  - Cambiarle solo la contraseña a Martín: el login sigue sin límite y el atacante pasa a la siguiente cuenta. Además su token ya emitido sigue vivo (ver #2).
  - Bloquear la IP del atacante: rota IPs, y con `trust proxy` puede falsear la IP en los logs.
  - Poner el límite solo en el formulario web y no en `/api/auth/login`, o al revés.
  - Captcha solo en el frontend.
- **Caso real:** iCloud / "Celebgate" (2014). El endpoint de Find My iPhone no limitaba intentos y se usó para fuerza bruta (herramienta iBrute). También aplica 23andMe (2023): credential stuffing contra cuentas sin 2FA que expuso datos de ~6,9 M de usuarios.

### 2. `jwt-not-invalidated-on-password-change`

- **Dónde:** `src/routes/users.ts:30`. `updatePassword()` cambia el hash y no hace nada más: no emite un token nuevo ni guarda `password_changed_at` o `token_version`. `src/middleware/auth.ts:25` valida solo la firma y la expiración del JWT, y después carga el usuario. Los tokens duran 30 días (`src/config.ts:14`, `src/lib/jwt.ts:14`). Las sesiones son stateless y no hay lista de revocación. **Reiniciar la app no invalida nada.**
- **Síntomas / logs:** después de `{"event":"password_changed","user_id":2,...}` siguen apareciendo `http_request` con `"user_id":2` desde la IP o user-agent del atacante, con un `token_iat` **anterior** al timestamp del `password_changed`. Esa es la señal clave para el narrador: "cambiaste la contraseña hace 5 minutos y la sesión del atacante sigue activa".
- **Corrección correcta (acción del simulador):**
  1. **Inmediata:** rotar `JWT_SECRET` (set env y redeploy desde el deployer). Invalida todas las sesiones de todos los usuarios. Está verificado: con un secreto nuevo, el token anterior recibe `401`.
  2. **De fondo:** agregar `password_changed_at` o `token_version` en `users`, incluirlo en el JWT y rechazar en `attachUser` los tokens con `iat` anterior. Además, emitir un token nuevo al cambiar la contraseña y bajar la duración (p. ej. 15 min de access token + refresh token revocable).
- **Arreglos equivocados comunes:**
  - **Cambiar la contraseña y darlo por resuelto** (el escenario principal del simulador).
  - Hacer "logout" o borrar la cookie en el navegador propio: solo afecta a ese navegador.
  - Reiniciar o redeployar la app sin cambiar `JWT_SECRET`: el token sigue siendo válido.
  - Bajar `JWT_EXPIRES_IN` sin rotar el secreto: los tokens ya emitidos conservan su `exp` de 30 días.
  - Borrar al usuario o cambiarle el email: el token apunta al `id` y no al email. Si se borra al usuario, el token deja de servir, pero se pierde la cuenta del cliente.
- **Caso real:** CircleCI (enero 2023). Un malware robó la cookie de sesión SSO de un ingeniero, que estaba respaldada con 2FA, y el atacante la usó para entrar sin necesitar la contraseña. CircleCI terminó pidiendo a todos sus clientes que rotaran sus secretos. También aplica Okta (octubre 2023): se robaron tokens de sesión desde archivos HAR de soporte y se usaron para secuestrar sesiones de clientes.

### 3. `idor`

- **Dónde:** `src/routes/notes.ts:23` (`GET /api/notes/:id`) y `src/routes/web.ts:67` (`GET /notes/:id`). Ambas llaman a `getNote(id)` (`src/models/notes.ts`), que hace `WHERE id = $1` sin `user_id`. En cambio `updateNote` y `deleteNote` sí filtran por dueño, una inconsistencia típica.
- **Síntomas / logs:** una secuencia de `http_request` a `/api/notes/1`, `/api/notes/2`, `/api/notes/3`... con el mismo `user_id`, casi todas `200`. Ese usuario lee notas que no son suyas. Datos sensibles expuestos: "Datos para transferencias" (Martín), "Viaje a Torres del Paine" con pasaporte (Diego), "Dirección nueva" (Fernanda), "Clientes noviembre" con el teléfono de un tercero (Javiera).
- **Narrativa sugerida:** "Fernanda te escribe: alguien le mandó un mensaje mencionando su dirección nueva, que solo tenía anotada en Apuntes."
- **Corrección correcta:** filtrar por dueño en la query (`WHERE id = $1 AND user_id = $2`) en **ambos** handlers, o centralizar en un `getNoteForUser(id, userId)` y devolver 404 si no es del usuario. Revisar los logs para saber qué notas se leyeron y a quién avisar.
- **Arreglos equivocados comunes:**
  - Cambiar los ids por UUID: es seguridad por oscuridad y el problema de autorización sigue ahí.
  - Arreglar solo la API y no la vista `/notes/:id`, o al revés.
  - Esconder el link en el frontend.
- **Caso real:** First American Financial (2019). Cambiando un número secuencial en la URL de un documento se podía acceder a unos 885 millones de registros con datos bancarios, números de seguro social, etc. También aplica Optus (2022): una API sin autenticación con ids incrementales expuso datos de ~10 M de clientes.

### 4. `admin-endpoint-no-authz`

- **Dónde:** `src/routes/admin.ts:33`. `adminRouter` aplica `requireAuth` a todo, y `/stats` y `/users` agregan `requireAdmin`, pero a `/users/export` **le falta**. Cualquier usuario logueado descarga todos los usuarios con `SELECT *` (`exportUsers()` en `src/models/users.ts`), incluidos `password_hash`, teléfono y email.
- **Síntomas / logs:** `{"event":"admin_access","path":"/api/admin/users/export","role":"user",...}` (el `role` no es `admin`) y luego `{"event":"admin_export","rows":N,...}`. El `http_request` asociado tiene un `bytes` alto. Es la señal de "egreso de datos".
- **Narrativa sugerida:** "Alerta: un usuario sin rol de admin descargó el respaldo completo de usuarios" o "un cliente llama: alguien tiene su teléfono y email".
- **Corrección correcta:** agregar `requireAdmin` a la ruta, o mejor `adminRouter.use(requireAdmin)` a nivel de router para que no se vuelva a olvidar. El export no debe incluir `password_hash`. Como respuesta al incidente: asumir que los hashes se filtraron, forzar el reset de contraseñas (sobre todo las débiles, crackeables offline), rotar `JWT_SECRET` y avisar a los usuarios afectados.
- **Arreglos equivocados comunes:**
  - Quitar el link "Descargar respaldo" de `views/admin.ejs`: el endpoint sigue expuesto.
  - Cambiar la URL a algo "secreto".
  - Bloquear al usuario que lo descargó: cualquier otra cuenta, o una recién registrada, puede hacer lo mismo.
  - Arreglar la autorización y no hacer nada con los datos ya filtrados.
- **Caso real:** USPS "Informed Visibility" (2018). Una API permitía a cualquier usuario logueado en usps.com consultar datos de cuenta de otros ~60 millones de usuarios. También aplica Peloton (2021): una API devolvía datos privados de cualquier usuario sin verificar autorización.

### 5. `mass-assignment`

- **Dónde:** `src/models/users.ts:47`. `USER_COLUMNS` incluye `role`, y `updateUser(id, data)` arma el `UPDATE` con cualquier key de `req.body` que esté en esa lista. Lo usan `PATCH /api/users/me` (`src/routes/users.ts:20`) y `POST /profile` (`src/routes/web.ts`). El formulario de perfil no muestra `role`, pero la API lo acepta.
- **Síntomas / logs:** `{"event":"profile_updated","user_id":N,"fields":["role", ...]}`. Después, ese usuario aparece en `admin_access` con `"role":"admin"` y entra a `/admin`. Como `attachUser` lee el rol desde la DB en cada request, la escalada es inmediata y no necesita un token nuevo.
- **Narrativa sugerida:** "Hay un admin nuevo en el panel que nadie creó."
- **Corrección correcta:** allowlist explícita de campos editables por el propio usuario (`name`, `phone`, `bio`; `email` idealmente con verificación) y cambios de rol solo por un flujo de admin con autorización. Como respuesta: revisar en los logs los `profile_updated` que tocaron `role`, revertir esos roles en la DB y auditar qué hicieron esas cuentas como admin.
- **Arreglos equivocados comunes:**
  - Quitar el campo del formulario o validarlo en el frontend: el atacante usa la API directo.
  - Revertir el rol de una sola cuenta y no arreglar el código: vuelve a subir de rol en segundos.
  - Usar una blocklist (`delete body.role`) en vez de una allowlist: el siguiente campo sensible que se agregue a la tabla queda expuesto.
- **Caso real:** GitHub (2012). Egor Homakov explotó el mass assignment de Rails para agregar su llave SSH a la organización `rails` y hacer commit en el repositorio oficial. A raíz de esto Rails cambió su default (strong parameters).

### 6. `sql-injection`

- **Dónde:** `src/models/notes.ts:15`. `listNotes(userId, search)` concatena `search` dentro de `ILIKE '%...%'`. Se alcanza desde `GET /api/notes?q=` (`src/routes/notes.ts`) y desde el buscador del dashboard (`GET /?q=`, `src/routes/web.ts`). La query devuelve 6 columnas (`id, user_id, title, body, created_at, updated_at`), así que se puede leer cualquier tabla, incluida `users`.
- **Síntomas / logs:** `http_request` con `path` que contiene comillas, `UNION`, `--`, `pg_sleep`, etc. (el path se loguea completo con su query string). También ráfagas de `server_error` con códigos de Postgres (`42601` syntax error, `42725`, `42804`...) y tiempos de respuesta (`duration_ms`) anómalos si usan técnicas a ciegas.
- **Narrativa sugerida:** "Alerta tipo Sentry: errores de sintaxis SQL que nunca habían aparecido", seguida de "egreso de datos en la base".
- **Corrección correcta:** query parametrizada: `... WHERE user_id = $1 AND (title ILIKE '%' || $2 || '%' OR body ILIKE '%' || $2 || '%')`, con `userId` también como parámetro. Como respuesta: asumir que la tabla `users` se leyó completa (hashes, emails, teléfonos), forzar el reset de contraseñas, rotar `JWT_SECRET` y avisar a los usuarios. Si la DB tiene credenciales compartidas, rotarlas también.
- **Arreglos equivocados comunes:**
  - Escapar comillas a mano (`replace("'", "''")`) o filtrar palabras como `UNION`/`SELECT` con regex: se puede evadir.
  - Ocultar los errores (arreglar #7) y creer que con eso se cerró la inyección: sigue siendo explotable a ciegas.
  - Arreglar solo la ruta de la API: el buscador del dashboard usa la misma función, así que en este caso sí se arregla en un solo lugar (punto a favor del dev si lo nota).
- **Caso real:** TalkTalk (2015). Una SQL injection en páginas legacy expuso datos de ~157.000 clientes y terminó en una multa de £400.000 de la ICO. También aplica MOVEit Transfer (2023, CVE-2023-34362): una SQLi explotada masivamente por Cl0p.

### 7. `verbose-errors`

- **Dónde:** `src/middleware/errors.ts:31-44`. Para cualquier error devuelve `error`, `code`, `detail`, `hint`, `position`, `where` y `stack` en JSON (`/api/*`) o en la página HTML de error. **No depende de `NODE_ENV`**: en Render corre con `NODE_ENV=production` y aun así expone todo.
- **Síntomas / logs:** cada abuso genera un `{"event":"server_error","level":"error","error":...,"code":...,"stack":...}`. Para el atacante, la respuesta revela que la base es Postgres, la posición del error en la query, rutas internas (`/app/node_modules/pg-pool/...`, `/app/dist/...`) y versiones.
- **Narrativa sugerida:** "Sentry: 37 errores nuevos en 2 minutos, todos `error: syntax error at or near ...`".
- **Corrección correcta:** responder un mensaje genérico (`{"error":"Error interno","request_id":"..."}`) y loguear el detalle solo del lado del servidor, correlacionado con el `request_id`.
- **Arreglos equivocados comunes:**
  - **Setear `NODE_ENV=production`**: no cambia nada porque el handler no lo mira, y en Render ya está así.
  - Borrar el log del servidor en vez de la respuesta: pierdes visibilidad y el atacante sigue viendo el stack.
  - Quitar solo `stack` y dejar `detail`, `hint` y `position`, que siguen sirviendo para armar la inyección.
- **Caso real (relacionado):** Patreon (2015). Un debugger de Werkzeug expuesto en un servidor público (modo debug en producción) permitió ejecutar código y filtrar ~2,3 M de cuentas. Aquí el impacto es menor (fuga de información y no RCE), pero la lección es la misma: el detalle de los errores no debe salir a producción.

### 8. `stored-xss`

- **Dónde:** `views/note.ejs:6` (`<%- note.body %>`) y `views/admin.ejs:24` (`<%- n.body %>`). El placeholder del formulario invita a usar "HTML simple", así que el dev lo dejó sin escapar a propósito. El panel `/admin` muestra las últimas 20 notas de **todos** los usuarios, así que una nota maliciosa se ejecuta en el navegador de la admin (Catalina). La cookie de sesión no es `httpOnly` (`src/routes/web.ts:12`).
- **Síntomas / logs:** `POST /notes` o `POST /api/notes` con un body que contiene HTML o JS. En el log solo se ve el `http_request` del POST, no el contenido. Después hay requests con el `user_id` de la admin (1) desde una IP o user-agent distinto al habitual: el token robado se reutiliza, y por #2 sigue vivo aunque Catalina cambie su contraseña.
- **Narrativa sugerida:** "Catalina (admin) dice que el panel 'se comportó raro'", y luego "acciones de admin desde una IP desconocida".
- **Corrección correcta:** escapar en ambas vistas (`<%= %>`) o, si se quiere permitir formato, sanitizar con allowlist (`sanitize-html`/DOMPurify) al renderizar. Además: cookie `httpOnly` y `secure`, una CSP que bloquee scripts inline, limpiar las notas maliciosas en la DB y **rotar `JWT_SECRET`**, porque hay que asumir que se robaron tokens.
- **Arreglos equivocados comunes:**
  - Arreglar solo `note.ejs` y olvidar `admin.ejs`, justamente donde está la víctima de más valor.
  - Usar una blocklist que borra `<script>`: se evade con atributos de eventos (`onerror`, etc.).
  - Borrar la nota maliciosa sin arreglar la vista ni rotar el secreto: el token robado de la admin sigue sirviendo.
  - Que la admin cambie su contraseña (ver #2).
- **Caso real:** Samy worm, MySpace (2005). Un XSS almacenado en el perfil se autopropagó a más de 1 millón de usuarios en ~20 horas. También aplica TweetDeck (2014): un tweet con XSS se retuiteaba solo al ser visto.

---

## Cadenas de ataque sugeridas (para el narrador)

Son solo referencia narrativa. Los exploits los diseña el equipo atacante.

1. **"Creí que lo había resuelto":** #1 fuerza bruta a Martín → lectura de sus notas → el dev cambia la contraseña de Martín → el atacante sigue entrando con el token viejo (#2) → solo rotar `JWT_SECRET` lo saca.
2. **"Fuga de datos":** cuenta cualquiera (registro libre) → #4 export completo, o #3 enumeración de notas → el dev oculta el link (equivocado) → el egreso continúa hasta agregar `requireAdmin`.
3. **"Admin fantasma":** #5 escalar `role` → acceso a `/admin` → el dev revierte el rol pero no el código → vuelve a escalar.
4. **"Sentry se llenó de errores":** #6 + #7 → dump de `users` → reset de contraseñas + parche de la query.
5. **"El panel de admin":** #8 nota con payload → la admin abre `/admin` → token robado → acciones como admin aunque cambie su contraseña (#2).

## Reset entre demos

Para dejar la base en su estado inicial, setea `SEED_RESET=true` y redeploya (o reinicia) una vez, y luego vuelve a dejarla en `false`. Si queda en `true`, cada reinicio o cambio de env borra los datos, incluido lo que hizo el atacante a mitad del demo.
