# Camino dual A+B (generalización a cualquier repo)

El motor explota muy bien la app víctima "Apuntes", pero sus módulos conocen sus
endpoints exactos. Para que sirva con **un repo arbitrario**, corremos dos
caminos **en paralelo** que se comparan y se completan.

```
RepoModel (discovery)  ┬─▶ A · sondas genéricas  ──┐
+ recon                │   (deterministas, reales)  ├─▶ compare ─▶ cobertura
                       └─▶ B · ángulos del LLM   ──┘   (acuerdo + completitud)
```

- **A — genérico** (`src/dual/generic.ts`): sondas **app-agnósticas** derivadas del
  `RepoModel` (rutas + señales), confirmadas con **tráfico real**. Generalizan:
  - IDOR: rutas con param de id bajo auth → una identidad que ve varios dueños.
  - SQLi (error-based): params de query + comilla → error SQL reflejado.
  - Sin rate limit: ráfaga de logins sin 429.
  - Missing authz: ruta `/admin` alcanzable por un usuario de baja privilegia.
  - Open redirect: param de redirección → URL externa.
- **B — LLM** (`src/dual/llm.ts`, `generate.ts`, `probe-spec.ts`): el provider
  **propone ángulos** y, además, **genera probes ejecutables**. Para no ejecutar
  código arbitrario (peligroso), B no escribe JS: emite un **`ProbeSpec`
  declarativo** (método/ruta/payload/condición de éxito) que corre **código
  confiable**. Cada ProbeSpec pasa por el **gate** (schema + scope: nada apunta
  fuera del host autorizado) **antes** de ejecutarse; lo rechazado no corre.
  Offline usa el `MockProvider` ($0); con `--providers` + keys, la cascada
  (Sonnet 4.5 → DeepSeek → GLM).
- **Comparación/completitud** (`src/dual/compare.ts`): matriz de cobertura por clase,
  con tres señales: A confirmó (tráfico real), B propuso (ángulo), B confirmó (probe
  generado+ejecutado).
  - `both`: A y B coinciden → alta/máxima confianza (máxima si ambos **confirman**).
  - `generic-only`: A lo confirmó, B no → A más preciso / B incompleto.
  - `llm-only`: solo B lo aporta (propuesto o confirmado) → completitud / lead.

Así A aporta **confirmación real** y B aporta **amplitud/novedad**; juntos dan un
diagnóstico más completo que cualquiera por separado, y se validan mutuamente.

## Uso

```bash
node src/cli/dual.ts --url <app> --repo <ruta-al-repo> \
  [--weak-email .. --weak-pass ..] [--providers] [--seed s]
```

Escribe `out/<ts>/dual.json` (hallazgos de A, ángulos de B y la cobertura) e
imprime la matriz. El camino A **no** depende del plugin de Apuntes: deriva todo
del `RepoModel`, así que corre contra cualquier app desplegada + su repo.

## Estado

- **A (genérico):** IDOR, SQLi error-based, sin-rate-limit, missing-authz,
  open-redirect, **mass-assignment, SSRF, reflected-XSS** — todas derivadas del
  `RepoModel`, confirmadas con tráfico real (probadas contra Apuntes y contra una
  2ª app distinta).
- **B (LLM):** propone ángulos **y genera ProbeSpecs ejecutables gateados** (mock
  offline / cascada real).
- Comparación/cobertura (A-real / B-prop / B-gen) + CLI + tests (`test/dual.test.ts`).
- Pendiente: condición de éxito de open-redirect en el ProbeSpec, más plantillas
  de generación, y que la generación real pase por `provider.adapt` (structured output).
