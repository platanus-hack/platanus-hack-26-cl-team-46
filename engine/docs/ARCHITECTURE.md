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
  repo: { path?: string; url?: string; commit: string; subdir?: string }; // acceso real al código
  target: { url: string };            // app desplegada en contenedor controlado
  credentials?: Array<{ role: string; email?: string; secret?: string; note?: string }>; // opcional
  scope: { origins: string[] };       // hosts autorizados (scope guard)
  budget?: { maxUsd?: number; maxRequests?: number }; // tope de la corrida (D)
  authorization: { by: string; at: string };          // quién autoriza
}
```

El repo **participa siempre**: si falta `repo`, la corrida es modo "black-box degradado" y se marca como tal (menor confianza, sin correlación archivo/línea).

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

**Gate de ejecución para TODO artefacto generado** (sin excepción): (1) valida contra schema; (2) pasa por scope guard estático (no URLs fuera de scope, no I/O arbitrario); (3) corre en **sandbox contra un fixture/dummy**, con sus tests; (4) **revisión** (humana o gate automatizado configurable) antes de tocar el target. **Prohibida la ejecución libre no delimitada.** Todo uso de provider se registra en el ledger (D) y la provenance (G).

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

Se instrumenta por corrida. **Herramientas gratuitas/locales también figuran** con `unitPrice: 0` y su consumo (requests/compute/tiempo). Se emite **estimado antes** y **real después**, total por fase y total general. Un `budget.maxUsd` excedido aborta o pide confirmación (decisión §11).

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

## 11. Decisiones que requieren a Sebastián

1. **Presupuesto por corrida**: `budget.maxUsd` default y comportamiento al excederlo (abortar vs pedir confirmación). Modelo LLM a usar (p.ej. `claude-opus-4-8`) y tope de tokens.
2. **Autonomía de módulos generados (C)**: ¿gate con revisión humana obligatoria, o gate automatizado (schema+scope+tests en sandbox) suficiente para ejecutar contra dummies locales? ¿Y contra Render?
3. **Dummy stacks (E)**: confirmar los 2 (sugeridos: Express+SQLite y Flask+SQLite) y el set de vulns solapadas/no solapadas.
4. **Fuentes externas a vetar primero (G)**: ¿`semgrep` + `nuclei` como primeros? ARTEX ¿se mantiene en el alcance o se pospone?
5. **Lenguajes de discovery/SAST prioritarios** (sugerido: JS/TS y Python primero).
6. **Render/créditos (E)**: confirmar cuándo hay créditos y quién despliega los dummies (servicio de Rai).
7. **Rate budget / alarm footprint**: definir defaults de `maxRps` y qué cuenta como "alarma" para la lógica de secuenciación.

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

## 13. Secuencia de implementación propuesta (sin tocar Render)

1. Re-encajar lo existente en las capas §1 (mover Apuntes a `plugins/apuntes`, extraer `core/`), con schemas versionados. (independiente)
2. `ledger/` (D) — transversal, self-contained. (independiente)
3. `scheduler/` (B) con `SchedulingMeta` y DAG; migrar el `pool` actual a lanes. (independiente)
4. `discovery/` (A): adapter `manifests` + `express-routes` + `generic-grep-signals`; correlación FileRef. (usa victim-app/ como primer repo real, local)
5. 2º dummy local (E) + variantes (F) + diagnosis (I) ampliado.
6. Providers (C) con gate, y recién después fuentes externas (G): semgrep/nuclei/ARTEX tras review.
```
