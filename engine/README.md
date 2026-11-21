# @hack26/engine — Motor de hacking

Pasada de **diagnóstico real** contra una app controlada y autorizada. Valida qué
vulnerabilidades existen con **ataques reales** (no emulados), captura el paso a
paso de cada uno (telemetría), y produce:

- `GUIA-DEL-HACKEO.md` — el paso a paso enseñable, con mapeo MITRE ATT&CK/ATLAS →
  D3FEND, caso real y fixes correctos/equivocados. Material del simulador.
- `scenarios/<vuln>.json` — escenarios **preconfigurados, versionados y con seed**.
  El usuario del simulador elige cuál seguir y de ahí arranca el storytelling.
- `attack-plan.json` — el plan en el contrato de eventos del backend (`attack.plan`).
- `diagnosis.json` / `telemetry.json` — resultado crudo + toda la telemetría HTTP.

## Uso

```bash
# Requiere Node >= 22 (usa type-stripping nativo; sin build).
cd engine
node src/run.ts --url https://sbx-xxxx.onrender.com [opciones]
```

Opciones:

| Flag | Default | Qué hace |
|---|---|---|
| `--url` | `sbx-8e92f100…` | Target autorizado. **Solo se ataca este host.** |
| `--profile` | `fast` | `noisy` \| `normal` \| `fast` \| `stealth` (ver abajo). |
| `--only` | (todas) | CSV de `vuln_id` a correr, p. ej. `--only idor,sql-injection`. |
| `--weak-email` / `--weak-pass` | seed de Apuntes | Credencial débil para la demo de fuerza bruta. |
| `--commit` | — | Commit del target, para versionar el escenario. |
| `--out` | `engine/out` | Carpeta de salida. |

## Perfiles de emulación de adversario

El tráfico se parece al de un atacante real: identidades que rotan (IP vía
`X-Forwarded-For` + pool de User-Agents), jitter temporal y concurrencia. Da
**dificultad variable** para el simulador.

| Perfil | Concurrencia | Jitter | Identidad | Detectabilidad |
|---|---|---|---|---|
| `noisy` | 1 | 0 | fija | obvia (escenario fácil) |
| `normal` | 2 | 40–180ms | por ataque | media |
| `fast` | 6 | 0 | por ataque | media, agresivo |
| `stealth` | 2 | 250–1200ms | por request | se mezcla (escenario difícil) |

**Límite ético/de producto:** esto es emulación de adversario (timing, identidades,
ritmo). **No** hace anti-forense ni toca/borra logs del target — eso sería malicioso
y además destruiría la telemetría, que es el producto. Y **solo** ataca el `--url`.

## Arquitectura

```
run.ts ─▶ diagnose.ts ─▶ attacks/*.ts   (un módulo de ataque real por vuln)
            │               └─ usa http.ts (RecordingClient: graba cada request)
            │               └─ evasion.ts (perfiles, identidades, jitter, pool)
            ├─▶ catalog.ts   (conocimiento: ATT&CK/ATLAS, D3FEND, caso real, fixes)
            ├─▶ scenario.ts  (arma el pack de escenarios versionados)
            ├─▶ events.ts    (traduce al contrato attack.plan / attack.* del backend)
            └─▶ report.ts    (genera la guía del hackeo)
```

Cada ataque está diseñado para ser **lo menos invasivo posible**: usa cuentas
desechables (`rt-xxxx@redteam.local`) en vez de los usuarios seed, deja en
solo-lectura lo que puede (IDOR, SQLi, admin-export, verbose-errors) y limpia lo
que crea (borra la nota del XSS, revierte el rol escalado). Igual quedan las
cuentas desechables en `users`: antes de un demo, resetear con `SEED_RESET=true`
+ redeploy (ver `docs/victim/ANSWER_KEY.md`).

## Cobertura actual (app víctima "Apuntes")

8/8 vulnerabilidades del catálogo, confirmadas con tráfico real: fuerza bruta sin
rate limit, JWT que sobrevive al cambio de contraseña, IDOR, endpoint admin sin
authz, mass assignment, SQLi UNION-based, errores verbosos y stored XSS.

## Roadmap (fases con agentes / herramientas del estado del arte)

Pendiente de integrar (requiere bajar herramientas → correr contenidas y scopeadas):

- **Recon / "todos los ángulos":** enumeración de rutas, matriz de métodos y de
  estados de auth (anónimo vs user vs otro-user), reflexión de parámetros,
  cabeceras de seguridad y análisis del JWT. Módulo propio, sin dependencias.
- **Escáneres públicos (SOTA):** `nuclei` (plantillas) y `ffuf` (content discovery)
  vía Docker, apuntando solo al sandbox.
- **ARTEX (fork libre):** descubrimiento autónomo multi-agente, en Docker, caja
  negra contra el sandbox. No se le entrega el repo. Revisar su compose antes.
- **Agente analista (LLM):** lee recon + telemetría y propone ángulos nuevos
  (usa `ANTHROPIC_API_KEY`). Alimenta el `attack.plan`.
