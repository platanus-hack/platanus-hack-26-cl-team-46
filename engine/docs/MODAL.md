# El motor en Modal

El motor de hacking corre en [Modal](https://modal.com). Cada corrida es **un
contenedor desechable** que se levanta, ataca el host autorizado, devuelve los
resultados y se apaga. No hay servidor encendido esperando: se paga solo el
tiempo que dura cada corrida.

Todo está en [`engine/modal_app.py`](../modal_app.py).

## Cómo está armado

```
backend ──POST /runs──▶ api (FastAPI, privada) ──spawn──▶ run_engagement (contenedor desechable)
        ◀── call_id ───                                     │ git clone del repo (opcional)
backend ──GET /runs/{id}──▶ api ──FunctionCall.get──────────┤ node src/cli/run.ts …
        ◀── running | done + resultado                      │ semgrep · discovery · ataques · LLM
                                                            └─▶ devuelve los artefactos en JSON
```

| Pieza | Qué es |
|---|---|
| `run_engagement` | Función que hace una corrida completa. Imagen con Node 24.14 y semgrep 1.90. Tope de 30 min, 1 CPU, 1 GiB, hasta 10 corridas a la vez. |
| `api` | API HTTP privada (FastAPI). Valida el pedido, lanza la corrida y devuelve su estado. Pide token de Modal en cada request. |
| `selftest` | Corre los tests del motor dentro de la imagen y una corrida completa contra el fixture local. No ataca nada externo. |
| `main` (local entrypoint) | Para lanzar una corrida a mano desde la terminal. |

### Por qué así y no con el Dockerfile

Lo que dice la documentación de Modal y obligó a este diseño:

1. **Modal ignora el `CMD` de un Dockerfile.** El proceso principal del
   contenedor es el runtime de Modal, así que `CMD ["node", "src/server.ts"]`
   nunca se ejecuta ([Using existing images](https://modal.com/docs/guide/existing-images)).
   Por eso la imagen se arma en `modal_app.py`, y `run_engagement` lanza Node con
   `subprocess`. El `Dockerfile` y `render.yaml` quedan solo para Render (el respaldo).
2. **Todo request HTTP a Modal se corta a los 150 s** (responde un 303 de
   redirección; [Request timeouts](https://modal.com/docs/guide/webhook-timeouts)).
   Una corrida puede tardar más, así que la API usa el patrón que recomienda Modal:
   `spawn` devuelve un `call_id` al tiro y otro endpoint se consulta hasta que termina.
3. **Las Web Functions son públicas por defecto.** La API usa
   `requires_proxy_auth=True`: sin los headers `Modal-Key` / `Modal-Secret`
   responde `401` ([Proxy Tokens](https://modal.com/docs/guide/webhook-proxy-auth)).
   Así nadie de afuera puede usar el motor para atacar otra cosa.
4. **semgrep va en su propio entorno de Python** (`/opt/semgrep`), con
   `setuptools<81`. Si no, choca con las dependencias de Modal, y con
   `setuptools` 81 o superior falla al arrancar (`No module named 'pkg_resources'`).
5. **semgrep necesita las métricas encendidas** para usar `--config auto` (la
   config que eligió el motor). Por eso no se apaga `SEMGREP_SEND_METRICS`.

## Puesta en marcha (una vez)

### 1. Instalar Modal y entrar a la cuenta

```bash
pip install modal        # cliente 1.2 o superior
modal setup              # abre el navegador para autenticarse
modal profile current    # confirma la cuenta (workspace) activa
```

Despliega en el workspace del equipo, no en uno personal. Si tienes varios:
`modal profile activate <workspace>`.

### 2. Crear el secret `hack26-engine`

Todas las variables del motor van en un solo secret de Modal, nunca en el repo:

```bash
modal secret create hack26-engine \
  ENGINE_ALLOWED_HOSTS='*.onrender.com' \
  ANTHROPIC_API_KEY=sk-ant-... \
  DEEPSEEK_API_KEY=... \
  GLM_API_KEY=... \
  GITHUB_TOKEN=ghp_...
```

| Variable | Obligatoria | Para qué |
|---|---|---|
| `ENGINE_ALLOWED_HOSTS` | **Sí** | Hosts que el motor puede atacar, separados por coma y con comodines (`*.onrender.com,victima.midominio.cl`). **Sin esta variable el motor rechaza todo.** |
| `ANTHROPIC_API_KEY` | No | Primer modelo de la cascada LLM (solo si el pedido trae `providers: true`). |
| `DEEPSEEK_API_KEY` / `GLM_API_KEY` | No | Respaldos de la cascada LLM. |
| `GITHUB_TOKEN` | Sí, con el backend | Para clonar el mirror del sandbox (la org de sandboxes suele ser privada) o repos privados. Usa el mismo token del backend o uno con lectura de contenido en esa org. Va como header de git, nunca en la URL. |
| `ENGINE_ALLOW_DESTRUCTIVE` | No | `1` permite el modo destructivo (DoS, SSRF, etc.). Por defecto está apagado. |

Para cambiar un valor después: `modal secret create hack26-engine ... --force`
(reemplaza el secret entero) o edítalo en el dashboard (Secrets). Para usar
otros nombres de secret: `ENGINE_MODAL_SECRETS=nombre1,nombre2 modal deploy …`.

### 3. Probar la imagen

```bash
cd engine && npm run modal:selftest
# = ENGINE_MODAL_SECRETS= modal run engine/modal_app.py::selftest   (desde la raíz)
```

Construye la imagen (unos 2 minutos la primera vez; después queda en caché),
corre los 33 tests y una corrida completa contra el fixture local. Debe terminar
con `✅ selftest OK` y `8/8 vulnerabilidades confirmadas`. No necesita el secret.

### 4. Desplegar

```bash
cd engine && npm run modal:deploy
# = modal deploy engine/modal_app.py   (desde la raíz)
```

Imprime la URL de la API, del tipo
`https://<workspace>--hack26-engine-api.modal.run` (puede incluir la región, p. ej.
`…-api.us-east.modal.run`). Cada `deploy` reemplaza la versión anterior.

Para desarrollo, `npm run modal:serve` levanta una copia temporal (URL con
sufijo `-dev`) que se recarga sola al guardar y se apaga con Ctrl-C.

### 5. Crear el token de acceso para el backend

En el dashboard de Modal: **Settings → Proxy Auth Tokens → New token**
(<https://modal.com/settings/proxy-auth-tokens>). Da un **Token ID** (`wk-…`) y un
**Token Secret** (`ws-…`). Van en las variables de entorno del backend:

```
ENGINE_URL=https://<workspace>--hack26-engine-api.modal.run
ENGINE_MODAL_KEY=wk-...
ENGINE_MODAL_SECRET=ws-...
```

## Contrato de la API

Todas las rutas piden **una** de estas dos formas de autenticación:

```
Modal-Key: wk-...
Modal-Secret: ws-...
```
```
Authorization: Bearer wk-....ws-...
```

### `POST /runs` — lanzar una corrida

```json
{
  "url": "https://sbx-xxxx.onrender.com",
  "plugin": "apuntes",
  "profile": "fast",
  "seed": "sim-123",
  "repo": "https://github.com/org/app-victima",
  "commit": "abc123",
  "weak_login": { "email": "martin.soto@example.com", "password": "qwerty123" },
  "semgrep": true,
  "providers": false,
  "budget_usd": 5,
  "read_only": false,
  "only": ["idor", "sql-injection"],
  "no_recon": false,
  "destructive": false
}
```

Solo `url` es obligatorio. `plugin`: `apuntes` | `tasks` | `destructive`.
`profile`: `noisy` | `normal` | `fast` | `stealth`. `semgrep` y `providers` solo
se aplican si viene `repo`. `repo` tiene que ser una URL `https`.

Respuestas:
- `202 { "call_id": "fc-…", "status_url": "/runs/fc-…" }`: la corrida partió.
- `400 { "detail": "host fuera de la lista autorizada: …" }`: pedido rechazado sin gastar contenedor.

### `GET /runs/{call_id}` — consultar

- `202 { "status": "running" }`: sigue corriendo. Consulta de nuevo cada 5–10 s.
- `200 { "status": "done", "result": { … } }`: terminó (ver abajo).
- `200 { "status": "failed", "error": "…" }`: la corrida se cayó (timeout, error de Python, pedido inválido).
- `404`: el `call_id` no existe. `410`: el resultado expiró (Modal guarda los resultados por un tiempo limitado; el backend debe guardarlos apenas lleguen).

`result`:

```json
{
  "ok": true,
  "exit_code": 0,
  "duration_s": 42.1,
  "log": "…salida del CLI (últimos 20 KB)…",
  "stderr": "",
  "artifacts": {
    "attack_plan":   { "…": "evento attack.plan con el contrato del backend" },
    "diagnoses":     [ "veredicto, confianza, causa raíz, remediación por vuln" ],
    "diagnosis":     { "summary": { "confirmed": 8, "total": 8 }, "…": "" },
    "scenarios":     [ "escenarios preconfigurados para el simulador" ],
    "guide_md":      "# Guía del hackeo …",
    "recon":         { }, "telemetry": [ ], "cost_ledger": { },
    "repo_model":    { }, "semgrep": [ ], "cicd": [ ], "llm_angles": [ ]
  }
}
```

Los últimos cinco (`repo_model`, `semgrep`, `cicd`, `llm_angles` y `recon`)
aparecen solo cuando aplican: si hay `repo`, si se pidió `providers` o si no se
saltó el recon.

### `DELETE /runs/{call_id}` — cancelar

`200 { "status": "cancelled" }`.

### `GET /health`

`200 { "ok": true, "allowed_hosts": ["*.onrender.com"] }`. Sirve para comprobar que
el token y el secret están bien.

### Ejemplo con curl

```bash
H=(-H "Modal-Key: $ENGINE_MODAL_KEY" -H "Modal-Secret: $ENGINE_MODAL_SECRET")
ID=$(curl -s "${H[@]}" -H 'content-type: application/json' \
  -d '{"url":"https://sbx-xxxx.onrender.com","seed":"demo"}' \
  "$ENGINE_URL/runs" | jq -r .call_id)
until [ "$(curl -s -o /tmp/run.json -w '%{http_code}' "${H[@]}" "$ENGINE_URL/runs/$ID")" = 200 ]; do sleep 5; done
jq '.result.artifacts.diagnosis.summary' /tmp/run.json
```

### Desde el backend (TypeScript)

```ts
const headers = {
  'Modal-Key': process.env.ENGINE_MODAL_KEY!,
  'Modal-Secret': process.env.ENGINE_MODAL_SECRET!,
  'content-type': 'application/json',
};

const { call_id } = await fetch(`${process.env.ENGINE_URL}/runs`, {
  method: 'POST', headers, body: JSON.stringify({ url: sandboxUrl, seed: simId }),
}).then((r) => r.json());

// Después, cada 5–10 s (o desde un job):
const res = await fetch(`${process.env.ENGINE_URL}/runs/${call_id}`, { headers });
if (res.status === 200) {
  const body = await res.json(); // { status: 'done', result } | { status: 'failed', error }
}
```

## Corrida a mano desde la terminal

```bash
modal run engine/modal_app.py --url https://sbx-xxxx.onrender.com \
  --weak-email martin.soto@example.com --weak-pass qwerty123 --seed demo-1 \
  --repo https://github.com/org/app-victima
```

Usa el secret `hack26-engine`, así que la URL tiene que estar en
`ENGINE_ALLOWED_HOSTS`. Imprime el log y guarda todo en
`engine/out/modal-<timestamp>/result.json`.

## Seguridad

- **Dos candados antes de atacar:** el token de Modal (nadie sin token llega a la
  API) y `ENGINE_ALLOWED_HOSTS` (aun con token, solo se atacan esos hosts). Dentro
  de la corrida sigue activo el scope guard del motor (no sale del host pedido ni
  sigue redirects a otro lado).
- **El modo destructivo está apagado** salvo que el secret tenga `ENGINE_ALLOW_DESTRUCTIVE=1`.
- **Las keys solo viven en el secret de Modal.** El token de GitHub se usa solo
  para clonar y no queda en los artefactos. El contenedor borra el repo clonado y
  la carpeta de salida al terminar.
- **Rotar el token:** crea uno nuevo en Proxy Auth Tokens, cámbialo en el backend
  y borra el viejo.

## Costos y límites

- Solo se cobra mientras corre una corrida: 1 CPU y 1 GiB por el tiempo que tarde,
  más los tokens de LLM si se pide `providers`. La API en reposo no cuesta.
- `max_containers=10`: hasta 10 corridas en paralelo; las demás esperan en cola.
  Se cambia en `run_engagement`.
- Tope por corrida: 30 minutos (`RUN_TIMEOUT_S`).

## Problemas conocidos

| Síntoma | Causa y arreglo |
|---|---|
| `401 missing credentials for proxy authorization` | Faltan los headers `Modal-Key`/`Modal-Secret` o el token es de otro workspace. |
| `400 ENGINE_ALLOWED_HOSTS no está configurado` | El secret `hack26-engine` no tiene esa variable. |
| `modal deploy` falla con `Secret 'hack26-engine' not found` | Falta el paso 2, o estás en otro workspace (`modal profile current`). |
| Una corrida se queda en `running` para siempre y los logs dicen `Function has N dependencies but container got M object ids` | La lista de secrets al desplegar no coincide con la del contenedor. `ENGINE_MODAL_SECRETS` viaja en la imagen para evitarlo; vuelve a desplegar con el mismo valor. |
| `semgrep falló: Cannot create auto config when metrics are off` | Alguien puso `SEMGREP_SEND_METRICS=off`. Quítalo, o cambia la config de semgrep en `providers/semgrep.ts`. |
| `git clone` falla con un repo privado | Falta `GITHUB_TOKEN` en el secret o no tiene acceso a ese repo. |

Para ver los logs de una corrida: dashboard de Modal → app `hack26-engine` →
`run_engagement`, o `modal app logs hack26-engine`.

## Cómo lo usa el backend

Con `ENGINE_URL`, `ENGINE_MODAL_KEY` y `ENGINE_MODAL_SECRET` en el backend, las
simulaciones nuevas usan el motor real (`hacker_mode: "external"` y
`engine_driven: true`; en ellas no se devuelve `hacker_token`). Una simulación
creada con `hacker: "external"` explícito sigue siendo para un hacker de afuera
y el motor no la toca. Lo maneja
`backend/src/simulations/engine/engine.hacker.ts`:

1. **Primera pasada.** Con `deploy.ready`, el backend llama a `POST /runs` con la
   URL del sandbox, el mirror desplegado (`deploy_repo_url`) en su commit
   (`sandbox_commit`) y un usuario del seed. Mientras corre, Modal
   manda cada línea del motor a `POST /sim/:id/engine/progress` (token de la
   simulación, rol `hacker`) y el frontend la muestra en vivo.
2. **Informe.** Al terminar, se publica `attack.plan` solo con lo confirmado (con
   archivo y línea) y la simulación queda `ready`. El developer elige los incidentes
   (`POST /simulations/:id/start { vulns }`); el plan queda solo con esos, en ese orden.
3. **Repetición.** En `control.start` y `control.next`, los pasos reales de una vuln
   (`artifacts.replay`) se publican como `attack.*`, uno cada
   `ENGINE_REPLAY_STEP_SECONDS` (±30 %). Respeta `control.pause` y `control.resume`.
4. **Verificación real.** En `control.verify`, el motor vuelve a atacar solo esa vuln
   (`only: [vuln_id]`). Si sigue explotable lo dice el tráfico real. Si el atacante
   sigue adentro se decide por el acceso que consiguió: un token robado sirve hasta
   que se rota `JWT_SECRET` **y** se despliega; un rol de admin, hasta que se revierte
   en la base; una fuga de datos no deja acceso. Si la vuln sigue explotable, el
   atacante puede volver a entrar aunque se haya rotado el secreto. Un veredicto
   `inconclusive` o un error del motor no cuentan como arreglado.
5. **Fallas.** Los 5xx/401 de Modal se reintentan en el siguiente sondeo (cada 5 s).
   Una corrida que no arrancó en 2 min (reinicio del backend) o que no termina en
   40 min se da por fallida.

## Pendiente

- El motor solo trae catálogos de ataques para la app víctima "Apuntes" y para
  "Tasks" (`ENGINE_PLUGIN`). Otro repo necesita su propio plugin.
- Las notificaciones (correos, alertas, tickets) las sigue escribiendo el generador
  a partir de los eventos `attack.*`; el motor no las produce.
