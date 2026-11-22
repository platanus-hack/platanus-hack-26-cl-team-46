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
- **B — LLM** (`src/dual/llm.ts`): el provider propone ángulos desde el `RepoModel`
  + recon. Offline usa el `MockProvider` ($0); con `--providers` + keys, la cascada
  (Sonnet 4.5 → DeepSeek → GLM).
- **Comparación/completitud** (`src/dual/compare.ts`): matriz de cobertura por clase:
  - `both`: A lo confirmó **y** B lo propuso → alta confianza.
  - `generic-only`: A lo confirmó, B no → A más preciso / B incompleto.
  - `llm-only`: B lo propuso, A no lo cubre → lead a investigar (clase no genérica).

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

- A: IDOR, SQLi error-based, sin-rate-limit, missing-authz, open-redirect.
- B: vía provider (mock/cascada).
- Comparación/cobertura + CLI + test (`test/dual.test.ts`).
- Pendiente: más clases genéricas (mass-assignment, SSRF, XSS reflejado), y que
  B **genere módulos ejecutables** (pasan por el gate) además de proponer ángulos.
