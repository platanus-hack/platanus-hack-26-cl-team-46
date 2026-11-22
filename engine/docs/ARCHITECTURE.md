# Motor de hacking — propuesta de arquitectura general

> Estado: **propuesta para revisión** (Sebastián + supervisor). Incorpora los
> requisitos A–I. Apuntes es **un plugin/target más**, no el centro. Nada acá se
> ejecuta hasta aprobar los contratos y las decisiones marcadas (§11).
>
> Lo ya construido (núcleo HTTP con scope guard + saneamiento, evasión, PRNG
> seeded, teardown, recon básico, 8 plugins de Apuntes, tests con fixture local)
> se **re-encaja** en esta estructura; no se tira.

## 1. Capas (H) — separación obligatoria

```
packages/engine
  core/         contratos tipados, RecordingClient (+scope+saneo), rng, tracker, schemas versionados
  discovery/    adapters que LEEN el repo y lo desplegado → RepoModel (A)
  plugins/      attack plugins con variantes (F); p.ej. plugins/apuntes, plugins/<stack>
  providers/    interfaz de agentes LLM para análisis/adaptación/generación (C)
  scheduler/    planner: DAG/lanes, mutex, rate budget, baseline (B)
  diagnosis/    correlación repo+runtime+tráfico+telemetría, veredictos, re-verify (I)
  ledger/       cost ledger por corrida (D)
  report/       guía del hackeo + escenarios + attack.plan
  cli/          entrypoint; cero defaults peligrosos
```

Reglas: APIs tipadas, **schemas versionados** (`schemaVersion`), tests unit+integración+e2e por capa, doc de extensión por capa. Cero defaults de target/credenciales.

## 2. Contrato de entrada (A)

```ts
interface EngagementSpec {
  schemaVersion: '1';
  repo: { path?: string; url?: string; commit: string; subdir?: string }; // OBLIGATORIO
  target: { url: string };            // app desplegada en contenedor controlado
  credentials?: Array<{ role: string; email?: string; secret?: string; note?: string }>; // opcional
  scope: { origins: string[] };       // hosts autorizados (scope guard)
  budget?: { maxUsd?: number; maxRequests?: number; onExceed?: 'abort'|'ask' }; // tope (D)
  authorization: { by: string; at: string };          // quién autoriza
}
```

El repo **es obligatorio**: sin `repo` la corrida **no procede** (decisión de Sebastián:
no hay modo black-box degradado). El discovery estático del repo es precondición
de la correlación hallazgo↔archivo/línea y de la activación de módulos.

## 3. Discovery adapters (A) — el repo se usa de verdad

Entrada: `EngagementSpec.repo`. Salida: `RepoModel` (normalizado, agnóstico de stack).

```ts
interface RepoModel {
  schemaVersion: '1';
  stack: { language: string; framework?: string; db?: string }[];
  routes: Array<{ method: string; path: string; handlerRef: FileRef; auth?: 'none'|'user'|'admin'|string; params: string[] }>;
  models: Array<{ name: string; fields: string[]; ref: FileRef }>;
  authModel: { scheme?: 'jwt'|'session'|'apikey'|string; secretsRefs: FileRef[]; notes?: string };
  manifests: { openapi?: object; dockerfiles: FileRef[]; compose?: FileRef; ci?: FileRef[]; env: FileRef[] };
  signals: Array<{ kind: 'secret'|'raw-sql'|'unescaped-render'|'missing-authz'|...; ref: FileRef; detail: string }>;
}
interface FileRef { file: string; line?: number; commit: string }
```

Adapters previstos (incrementales): `openapi` (si hay spec), `express-routes`, `flask-routes`, `generic-grep-signals` (regex/AST ligero por lenguaje), `manifests` (Docker/compose/CI/env). **SAST/AST real** = adapter `semgrep` (opcional, §10/G). Cada `signal` y cada `route` queda con `FileRef` para la **correlación hallazgo↔archivo/línea** (I).

## 4. Attack plugins con variantes (F)

```ts
interface AttackModule {
  id: string; schemaVersion: '1';
  meta: VulnMeta;                 // ATT&CK/ATLAS→D3FEND, caso real, fixes
  scheduling: SchedulingMeta;     // §5
  variants: AttackVariant[];      // ≥1
  appliesTo(repo: RepoModel | null, target): boolean; // activación por señales del repo
}
interface AttackVariant {
  id: string;                     // p.ej. sqli: passive | error-based | boolean-blind | union
  preconditions: string[];       // footholds/credenciales/otros módulos
  cost: CostHint;                 // requests/tiempo/compute esperado (D)
  risk: 'read-only'|'mutating'|'destructive';
  signalToNoise: 'low'|'med'|'high'; // alarm footprint relativo
  confidenceIfConfirmed: number;  // 0..1
  fallbackTo?: string;            // id de variante si esta falla/bloquea
  run(ctx): Promise<AttackResult>;
}
```

El planner elige variante por `precondición/costo/riesgo/ruido/confianza` y **documenta cuál usó y por qué**; si falla, cae al `fallbackTo`. Tests: ≥2 variantes por objetivo cuando sea razonable (p.ej. SQLi error-based y UNION).

## 5. Scheduler / planner (B)

```ts
interface SchedulingMeta {
  dependsOn: string[];            // requiere resultado/foothold de otro módulo
  mutex: string[];               // no correr junto a (contaminación/estado compartido)
  mutates: boolean;
  needsCleanBaseline: boolean;    // debe correr antes de ensuciar señales
  rateBudget: { maxRps: number }; // ritmo
  alarmFootprint: 'low'|'med'|'high';
  requires: string[];             // credenciales/capacidades
}
```

El planner construye un **DAG → lanes** de ejecución: **paralelo por defecto**, y **secuencia** cuando: un ataque contamina señales que otro necesita, dispara una alarma que invalida la medición de otro, comparten estado, uno necesita el foothold de otro, o uno necesita baseline limpio. Respeta el `rateBudget` global y por lane. El **reporte explica, por táctica, por qué fue paralela o secuencial** (traza del planner).

## 6. Providers / agentes (C)

```ts
interface AnalysisProvider {
  id: string;
  analyze(input: { repo: RepoModel; recon; telemetry }): Promise<ProposedAngle[]>;
  adapt(module: AttackModule, repo: RepoModel): Promise<GeneratedArtifact>;
}
interface GeneratedArtifact { kind: 'attack-module'|'plan'; code?: string; spec: object; provenance: Provenance }
```

**Gate de ejecución para TODO artefacto generado** (sin excepción, decisión de Sebastián): (1) valida contra schema; (2) scope guard estático (no URLs fuera de scope, no I/O arbitrario, allowlist de imports); (3) corre en **sandbox contra un fixture/dummy**, con sus tests. **Este gate automatizado basta para ejecutar en local y en Render.** (4) **Checkpoint de supervisión**: cada vez que se corren pruebas o se modifican módulos, se **reporta a Sebastián** (vía Claude) antes de avanzar — supervisión humana continua, no bloqueo por artefacto. **Prohibida la ejecución libre no delimitada.** Todo uso de provider se registra en el ledger (D) y la provenance (G).

## 7. Cost ledger (D)

```ts
interface CostEntry {
  phase: 'discovery'|'recon'|'planning'|'exploit'|'analysis'|'report';
  provider: string; resourceOrModelOrTool: string;
  usage: { tokensIn?: number; tokensOut?: number; requests?: number; computeMs?: number; wallMs?: number };
  currency: 'USD'; unitPrice: number; priceVersion: string;
  estimatedUsdBefore: number; actualUsdAfter?: number;
}
interface CostLedger { entries: CostEntry[]; byPhase: Record<string, number>; grandTotalUsd: number }
```

Se instrumenta por corrida. **Herramientas gratuitas/locales también figuran** con `unitPrice: 0` y su consumo (requests/compute/tiempo). Se emite **estimado antes** y **real después**, total por fase y total general. `budget.maxUsd` excedido → **abortar** por defecto (`onExceed: 'abort'`), o `'ask'`.

**Qué cuesta realmente** (lo demás es $0 metered): solo las **llamadas LLM** de los providers (C) y, más adelante, el **hosting de dummies en Render** (E). Los ataques propios y los scanners locales (semgrep/nuclei/ffuf en Docker) son $0 (cómputo local), registrados con su consumo.

**Modelos y presupuesto (decisión de Sebastián)** — pricing por 1M tokens, cache read entre paréntesis:
| Rol | Modelo | $ in / out | Uso |
|---|---|---|---|
| Triage/clasificación (volumen) | `claude-haiku-5-5` | 0.10 / 0.50 | filtrar endpoints, etiquetar respuestas |
| Análisis + diagnóstico (workhorse) | `claude-sonnet-5-5` | 2 / 10 (0.10) | discovery analysis, síntesis de diagnóstico |
| Generación/adaptación de módulos + causa raíz difícil | `claude-opus-5-5` | 4 / 20 (0.20) | código generado (pasa por el gate) |

Estimado por corrida (≈200k in / 55k out, con prompt caching del RepoModel): **~$1–2/corrida** con tiering (Sonnet de base + Opus puntual + Haiku triage). **Default `budget.maxUsd = 5`**; tope global sugerido para el hackathon **$30–50**. El provider interface permite fijar modelo por fase.

## 8. Diagnóstico (I) — capacidad principal

```ts
interface Diagnosis {
  vulnId: string;
  verdict: 'confirmed'|'not-confirmed'|'inconclusive';
  confidence: number;            // 0..1
  falsePositiveChecks: string[];
  rootCause: { summary: string; ref?: FileRef };      // correlación repo
  attackChain: StorylineBeat[];
  impact: string;
  evidence: HttpExchange[];       // SANITIZADA
  remediation: { correct: string; wrongFixes: string[] };
  reverify?: { afterPatch: boolean; stillExploitable?: boolean; attackerActive?: boolean };
}
```

Correlaciona **repo + runtime + tráfico + telemetría**. Cada hallazgo trae veredicto + confianza + chequeos de falso positivo + causa raíz con `archivo/línea` + cadena + impacto + evidencia sanitizada + remediación + **re-verificación tras parche** (se enchufa con el loop de deploy/redeploy del backend por el contrato `hacker: "external"`).

## 9. Dummy apps para generalización (E)

- **≥2 stacks distintos** con vulnerabilidades **solapadas y no solapadas** (p.ej. las 8 de Apuntes + algunas nuevas), para probar que el discovery/planner generaliza.
- **Primero locales/contenedores (costo $0)**: Docker compose por dummy, derribo incluido.
- **Render: NO crear/desplegar hasta que Sebastián confirme créditos.** Antes entrego instrucciones + presupuesto esperado.
- Recomendación de stacks: (1) Node/Express + SQLite, (2) Python/Flask + SQLite (o Go). Decisión en §11.

## 10. Fuentes externas (G)

Solo repos/fuentes **verificadas**: proyectos oficiales; revisar licencia, actividad, **release/commit fijado**, dependencias, **imágenes por digest**, firmas/checksums cuando existan; **sin montar secretos ni el repo completo** si no hace falta. Registrar **provenance** + costo (D). **No descargar/ejecutar ARTEX ni scanners** (nuclei/ffuf/semgrep) hasta completar esta revisión y aprobarla. Candidatos a vetar primero: `semgrep` (SAST, discovery), `nuclei` (plantillas), `ffuf` (content discovery), ARTEX (autónomo).

## 11. Decisiones

**Resueltas (Sebastián):**
1. Repo **obligatorio**, sin modo black-box degradado (§2).
2. **Presupuesto**: default `maxUsd = 5`/corrida, `onExceed: abort`; tope hackathon $30–50. **Modelos por rol**: Haiku 5.5 (triage) / Sonnet 5.5 (análisis+diagnóstico) / Opus 5.5 (generación+causa raíz) (§7).
3. **Gate (C)**: automatizado (schema+scope+tests-en-sandbox) **basta para local y Render**; además **checkpoint de supervisión con Sebastián** en cada prueba/modificación (§6).
4. **Dummies (E)**: Express+SQLite y Flask+SQLite, con vulns solapadas y no solapadas.
5. **Fuentes (G)**: primero `semgrep` (SAST) + `nuclei`; **ARTEX sigue en alcance**.
6. **Lenguajes discovery/SAST**: JS/TS y Python primero.

**Pendientes:**
7. **Render/créditos**: en camino; **se dejan pendientes** en la arquitectura (nada se crea/despliega en Render hasta confirmación). Quién despliega los dummies (servicio de Rai) a definir.
8. **Defaults de `rateBudget`/alarm footprint** (propuesta inicial, ajustable): `maxRps` global 5, por lane 2; "alarm" = ráfaga de 4xx/5xx > N en ventana corta, o endpoints de admin/export. Confirmar con Sebastián al implementar el scheduler.

## 12. Criterios de aceptación (por requisito)

- **A**: correr exige `EngagementSpec` con repo+target; sin repo ⇒ modo degradado marcado. Hay ≥1 adapter que produce `RepoModel` y ≥1 hallazgo dinámico correlacionado a `FileRef`.
- **B**: el planner emite un DAG/lanes; existe ≥1 caso que se secuencia por contaminación/alarma/estado/foothold/baseline; el reporte explica paralelo vs secuencial por táctica.
- **C**: todo artefacto generado pasa schema+scope+tests-en-sandbox+revisión antes de ejecutar; test que prueba que un artefacto que viola scope es **rechazado**.
- **D**: cada corrida emite `CostLedger` con estimado-antes y real-después, por fase y total, incluyendo tools locales a $0.
- **E**: ≥2 dummies locales en contenedor; el motor confirma vulns en ambos sin cambios de core; Render solo tras confirmación de créditos.
- **F**: ≥1 objetivo con ≥2 variantes; el planner elige y documenta; test que ejercita ≥2 variantes.
- **G**: cada fuente externa tiene registro de provenance (licencia, commit/digest, checks); nada se ejecuta sin review aprobado.
- **H**: capas separadas con APIs tipadas y schemas versionados; suites unit+integración+e2e; doc de extensión; cero defaults peligrosos.
- **I**: cada hallazgo trae veredicto+confianza+falsos positivos+causa raíz(FileRef)+cadena+impacto+evidencia sanitizada+remediación+re-verify.

## 13. Plan de desarrollo (hitos) — todo local hasta que haya créditos Render

Cada hito termina con **tests verdes** + **checkpoint de supervisión** reportado a Sebastián.

- **M0 — Reestructura a capas (H).** Mover Apuntes a `plugins/apuntes/`, extraer `core/`, schemas versionados. Sin cambios de comportamiento; la suite de tests actual debe seguir verde. *Independiente, local.* ← arranco por acá.
- **M1 — Cost ledger (D).** `ledger/` transversal; se instrumenta en todas las fases (al inicio solo HTTP/compute a $0). *Independiente, local.*
- **M2 — Discovery (A) sobre el repo.** `discovery/`: adapters `manifests`, `express-routes`, `flask-routes`, `openapi`, `generic-grep-signals` (JS/TS + Python). Salida `RepoModel`; correlación `FileRef` de ≥1 hallazgo dinámico. Primer repo real = `victim-app/` (local). *Independiente, local.*
- **M3 — Scheduler (B).** `scheduler/` con `SchedulingMeta`, DAG→lanes, rate budget; el reporte explica paralelo vs secuencial. Migra el `pool` actual. *Independiente, local.*
- **M4 — Variantes (F) + diagnosis (I).** ≥2 variantes por objetivo (p.ej. SQLi error-based/UNION); `Diagnosis` con veredicto+confianza+falsos positivos+causa raíz(FileRef)+re-verify. *Local.*
- **M5 — 2º dummy stack (E).** Flask+SQLite en contenedor local, vulns solapadas/no solapadas; el motor confirma sin tocar el core → prueba de generalización. *Local.*
- **M6 — Providers (C) con gate + fuentes externas (G).** Provider tiered (Haiku/Sonnet/Opus); gate de artefactos generados. Luego vetar e integrar `semgrep` → `nuclei` → ARTEX (cada uno tras review de provenance). *Local; ARTEX en Docker caja negra.*
- **M7 — Render (pendiente créditos).** Desplegar dummies en Render con presupuesto por adelantado. **No se inicia hasta confirmación de Sebastián.**

El plugin Apuntes + el fixture local siguen siendo la red de seguridad de regresión en cada hito.
```

## 14. Modo agresivo / destructivo (M8)

En un **contenedor desechable y autorizado** sí se justifica generar daño real (es
la gracia de levantarlo). Decisión de Sebastián: el sandbox de Render compartido
que entregó **es objeto de destrucción** (él lo rota/redeploya). Operativamente,
una corrida destructiva deja el sandbox inservible hasta un redeploy — coordinar.

Eje nuevo, independiente del sigilo: `--destructive` (default OFF) + candados:
1. Autorización explícita en el `EngagementSpec` (`authorization`, `container.disposable`).
2. Scope guard: solo el host autorizado.
3. Presupuesto (DoS/LLM consumen).

Taxonomía `risk: 'destructive'` (ya existe en las variantes). Módulos por categoría:

- **DoS** — agotamiento **acotado** (tope de duración/concurrencia): flood, consulta
  pesada sin paginación, ReDoS. Mide cuándo cae (latencia/errores) y si hay límite.
- **Secrets / llavero** — **SSRF** → metadata del cloud / `localhost`, lectura de
  env/`.env`, detección de `JWT_SECRET` y **movimiento lateral** con el secreto.
- **Deploy / CICD** — análisis del pipeline del repo (workflow con permisos de más,
  secrets en CI, inyección de workflow) + narrativa del artefacto envenenado en el
  mirror del sandbox. No toca registries de terceros.
- **Prompt injection** — se **auto-activa solo si** el discovery detecta componente
  LLM (deps anthropic/openai): inyección directa/indirecta, exfiltración vía
  tool-calls. Mapeo MITRE **ATLAS**.
- **Phishing** — **simulado**: encadena open-redirect + genera el artefacto y lo
  "entrega" a una **persona ficticia** del sim. Nunca a personas reales.

Límites que no se cruzan ni en destructivo: nada fuera del contenedor autorizado;
phishing jamás contra personas reales; sin anti-forense que borre logs (rompería
la telemetría = la lección).

## 15. Cascada de providers LLM (reliability + costo)

Para el análisis/planificación con LLM, cascada con failover automático ante
**error, refusal (guard anti-ataque) o presupuesto agotado**:

1. **Claude Sonnet 4.5** (`claude-sonnet-4-5`) — primario.
2. **DeepSeek** (API key) — fallback.
3. **GLM** (API key) — fallback.

El primero disponible/que responde gana. Cada intento se registra en el cost
ledger (proveedor, modelo, tokens, costo). La interfaz `AnalysisProvider` ya
abstrae esto; se agrega un `CascadeProvider` que envuelve a los tres.

## 16. Despliegue del motor (otro contenedor)

El motor corre **fuera** de la app diagnosticada, en su propio contenedor.
Prioridad **Modal → Render** porque el motor usa herramientas (semgrep y, a
futuro, nuclei/ARTEX) que deben estar **en la imagen**: ni Modal ni Render dan
Docker-in-Docker, así que las herramientas se hornean y el adapter las corre
como binario (`providers/semgrep.ts` detecta binario-o-docker).

- **Modal** (primario): construye el contenedor de forma declarativa desde el
  mismo `engine/Dockerfile`; ideal para hornear herramientas y cómputo on-demand.
  Keys como secret de Modal. `modal deploy engine/modal_app.py`.
- **Render** (fallback): servicio Docker con la misma imagen, para cuando no haya
  acceso a Modal. Keys en el dashboard. `engine/render.yaml`.

Imagen única `engine/Dockerfile`: Node 22 + **semgrep horneado** (aprobado);
nuclei/ARTEX NO se hornean hasta aprobarse (ver §10/provenance). El motor no
necesita estado persistente (escribe a `out/` o devuelve el resultado en `/run`).
