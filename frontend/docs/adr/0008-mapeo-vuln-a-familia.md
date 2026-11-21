# 0008. Cada `vuln_id` de Apuntes se mapea a una familia visual y a una superficie

- Estado: Propuesta
- Fecha: 2026-11-21
- Decide: Clemente (diseño + front)

## Contexto

`DESIGN.md` define tres familias visuales para el escritorio:

- **A · Entrada de texto:** texto que se escribe solo en un chat o un input (`md-injected`).
- **B · Infra y secretos:** un valor que se revela y queda con glow ámbar (`md-secret.is-leaked`).
- **C · Volumen y caída:** un medidor de carga que sube y parpadea (`md-meter`, `md-flicker`).

Esas familias se pensaron para vectores de apps con IA (prompt injection, keys filtradas, DoS). Las 8 debilidades de Apuntes (`docs/victim/ANSWER_KEY.md`) son de web clásica (auth, IDOR, SQLi, XSS, mass-assignment) y no calzan una a una. Además, `src/lib/types.ts` tiene un `AttackVector` cerrado (`prompt-injection`, `message`, `deploy`, `keychain-access`, `dos`) que no incluye ninguna.

## Decisión

1. **Las familias describen la superficie del efecto, no el tipo de vulnerabilidad:**
   - **A** = algo que el atacante *escribe*: un input, la omnibox, el cuerpo de un request o una nota.
   - **B** = algo que *queda expuesto*: un token, un hash, un secreto o un stack trace.
   - **C** = algo que pasa *muchas veces*: intentos por minuto o requests por segundo.

   No hace falta una cuarta familia.

2. **Mapeo:**

   | # | `vuln_id` | Familia | Dónde se ve (app simulada) | Evento de la app víctima que lo dispara | Evidencia ámbar |
   |---|---|---|---|---|---|
   | 1 | `weak-password-no-rate-limit` | **C** | Medidor "Intentos de login / min" en la pestaña del dashboard de Render (o arriba de los logs). Sube y parpadea | Ráfaga de `login_failed` a `martin.soto@…` y luego `login_success` desde `203.0.113.42` | La fila `login_success` desde la IP del atacante |
   | 2 | `jwt-not-invalidated-on-password-change` | **B** | Pestaña "Sesiones activas" de Apuntes: el token del atacante se revela (`eyJhbGciOi…`, `iat 03:12`) y sigue "activo" después del `password_changed 03:17` | `http_request` con `user_id: 2` y `token_iat` anterior al `password_changed` | El `iat` del token. En la pestaña de la repo, `src/middleware/auth.ts:25` (no compara `iat`) |
   | 3 | `idor` | **A** | La omnibox se escribe sola: `/notes/7` → `/notes/8` → `/notes/9`, y cada nota es de otro usuario | `http_request GET /api/notes/:id` en serie desde la misma cuenta | El nombre del dueño de la nota, que no es el usuario logueado |
   | 4 | `admin-endpoint-no-authz` | **B** | Se abre `users-export.json` en Chrome y la columna `password_hash` queda con glow | `admin_access` + `admin_export` con `role: user` | La columna `password_hash` |
   | 5 | `mass-assignment` | **A** | El cuerpo del `PATCH /api/users/me` se escribe solo, `{"role":"admin"}`, y el chip del perfil cambia de `user` a `admin` | `profile_updated` con `fields: ["role"]` | El chip `admin` |
   | 6 | `sql-injection` | **A** | El buscador de Apuntes se escribe solo: `' UNION SELECT email, password_hash FROM users--`. Los resultados muestran hashes | `server_error` con error SQL y luego `http_request /?q=…` con 200 | El texto inyectado en el input |
   | 7 | `verbose-errors` | **B** | La página de error de Apuntes revela `detail`, `hint` y `stack` (paso previo a la #6) | `server_error` con `code` y `stack` | Las líneas `detail` y `hint` |
   | 8 | `stored-xss` | **A**, luego **B** | A: el cuerpo de una nota se escribe solo con `<img src=x onerror=…>`. B: cuando la admin abre `/admin`, se revela su cookie `token` en un request saliente | `http_request POST /api/notes` + `admin_access` de la admin | El payload en la nota; después, la cookie |

3. **Cadena de la demo** ("Creí que lo había resuelto", `ANSWER_KEY.md` › Cadenas): `C (#1) → B (#2)`, con la acción del usuario en el medio. Usa dos de las tres familias; la A se ve en la landing y en otros escenarios.

4. Cada efecto respeta la regla de oro: **nunca va solo**. Siempre viene con una fila `ATTACK` en los logs y un cambio de texto en la app.

5. **Tipos:** se agrega en `src/lib/sim/vulns.ts` un `VULN_EFFECT: Record<VulnId, { family: AttackFamily; surface: Surface }>` con los 8 `vuln_id` de Apuntes. Para un `vuln_id` desconocido (otro repo, otro analizador), el efecto por defecto es solo la fila en los logs, sin efecto visual. `AttackVector` y `VECTOR_FAMILY` de `src/lib/types.ts` se mantienen para los escenarios de IA hasta que el analizador emita `vuln_id` para todo.

## Consecuencias

- Con tres componentes de efecto (`TypedText`, `SecretReveal` y `LoadMeter`) se cubren las 8 debilidades. Lo que cambia entre una y otra es la superficie y el texto.
- Se necesitan dos pestañas extra en el Chrome simulado, siempre simples: "Apuntes" (la app desplegada, con buscador, notas, perfil y sesiones) y "Render" (dashboard con el medidor). `DESIGN.md` › Browser lo permite.
- Si el analizador de otro repo emite `vuln_id` nuevos, alguien tiene que agregarlos a `VULN_EFFECT`. Mientras tanto se ven solo como filas de log.
