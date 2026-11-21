# Security Review Skills

A skill pack for a **code-review / vulnerability-hunting agent**. Each skill is a self-contained `SKILL.md` (name + description frontmatter, then the methodology) in the Claude-skill / `morluto/rea` plugin convention — drop the folders into your agent's skills directory and it loads them by their `description` triggers.

These are **methodology, not tooling**: the detection *logic* distilled from two autonomous pentest systems — [ARTEX](https://github.com/BaaRai/ARTEX) and [PentAGI](https://github.com/vxcontrol/pentagi) — refactored for **white-box source review** of your own code. They tell an agent how to *think like an attacker reading source*, and — critically — how to *not cry wolf*.

## The skills

| Skill | When it fires | Core idea |
|---|---|---|
| **`vuln-code-audit`** | Auditing a repo/service/diff | Inventory every user-controllable input → trace each **forward** to dangerous sinks → three gates → PoC → sweep. The spine. |
| **`finding-quality-gate`** | Before recording **any** finding | Adversarial self-check (5 axes), 3-tier confidence lifecycle (detected→confirmed→exploited), measured impact with a denominator, proof basis. **The anti-false-positive discipline — load this one everywhere.** |
| **`injection-and-fixes`** | Hunting *and fixing* injection | Per-class sink catalog (SQL/cmd/template/XSS/XXE/deserialization/SSRF) + the correct fix with before→after code (parameterized queries, arg arrays, context encoding). |
| **`access-control-audit`** | Auditing authorization | BOLA/IDOR/BFLA/privesc — the highest-value, most-missed class. The dropped-scoping-parameter smell + the two-identity proof requirement. |
| **`auth-secrets-audit`** | Auditing auth/tokens/secrets | JWT/OAuth/session flaws, refresh-token rotation, hardcoded & client-exposed secrets (with the "public key ≠ leak" nuance). |

Typical flow: `vuln-code-audit` drives; it calls into `injection-and-fixes` / `access-control-audit` / `auth-secrets-audit` per class; **every** candidate passes `finding-quality-gate` before it's reported.

## Operating principles for your review agent

Beyond the skills, these cross-cutting behaviors (lifted from both systems' orchestration logic) make the agent effective:

- **Attack-surface-first, not payload-dump.** Map routes, roles, inputs, file handling, integrations, and trust boundaries *before* testing; then organize work *by attack surface* (auth, access control, injection, SSRF, file processing, business logic).
- **Claims are not proof.** Run an **independent evaluation pass** that re-judges each "found it" against evidence and separates *confirmed* from *unverified* — don't trust the hunting pass's own success claims.
- **Pivot on repeated failure.** Classify a stuck step as Technical / Environmental / Conceptual / External. After ~2-3 attempts of the same approach, switch strategy instead of retrying flags.
- **Memory-first, reusable guides.** Check prior findings before re-hunting; store a confirmed technique as an *anonymized* guide (`{target}`, `{param}`) so it generalizes to the next review.
- **Scope gate.** For any command/target an agent generates, match every host/path against an allowlist; treat non-matches as out-of-scope and stop-and-ask on ambiguity.

## Sources & licensing

- **ARTEX** (`skills/codeaudit`, `api-security`, `api-recon`, `patch-diff`, and the solo-pentest prompt catalog). The ARTEX *code* is AGPL-3.0 — **none of it is copied here**; this pack reproduces the *methodology/ideas* in original prose. ARTEX itself credits Capital One **VulnHunter** (Apache-2.0), **bug-bounty-hunting-prompts** (MIT), and **zhaoxuya520/reverse-skill** (MIT).
- **PentAGI** — **MIT**; its prompt prose is reusable with attribution. Contributed: the detected→confirmed→exploited confidence lifecycle, low-risk-validation-before-exploitation, the attack-surface-first + per-input vuln-class checklist, the failure-taxonomy re-planning loop, and the independent-reporter discipline.
- Fix patterns follow **OWASP** (parameterized queries, output encoding, access control, ASVS).

These are for reviewing **code you own or are authorized to test**.
