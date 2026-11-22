---
name: finding-quality-gate
description: "Invoke before recording ANY security finding, in code review or live testing. The discipline that separates a real vulnerability from noise: an adversarial self-check along five axes, an end-to-end PoC, a measured impact with a denominator, an explicit proof basis, and priority discipline. A code-review agent that applies this stops crying wolf."
---

# Finding Quality Gate (the anti-false-positive discipline)

A candidate stays a **hypothesis** until you have actively tried to *disprove* it. This skill is the gate every finding passes before it is reported. It is the single most valuable transfer from autonomous pentest agents: it is why their findings are trusted. Apply it in code review and in live testing alike.

> Falsification is as valuable as confirmation. Whenever you think "found it / succeeded", **switch into a skeptic first** and re-trigger via a *different* path or independent check — do not restate the original evidence. If the self-check fails, record it honestly as unconfirmed; don't force the claim.

## Adversarial gate — argue the opposite along five axes

Before recording, make the case *against* your own finding:

1. **Reachability** — can a real attacker actually get there? (Route registration is not reachability; a dev-only/feature-flagged guard can remove it.)
2. **Preconditions** — does exploitation need an unrealistic starting position (already-admin, local access, a leaked secret you assumed)?
3. **Downstream controls** — does anything between the trigger and the goal block the impact (a prepared statement later, an output encoder, an authz check at the sink)?
4. **Scope** — is the affected asset inside the authorized scope / first-party production code?
5. **Simpler explanation** — is there a benign reason for the observation (a 500 that is validation, not injection; a reflected value that is already encoded)?

**Eliminations need evidence at the same bar as confirmations:** cite the specific request, response, `file:line`, or control that kills the candidate. "Probably validated downstream", "looks by design", "internal only" eliminate **nothing**.

## Watch for self-deception patterns

- Treating a **version/CVE match** as a vulnerability. A dependency being "known-vulnerable" is a hypothesis until the vulnerable path is reachable with attacker input — prove the call, don't cite the changelog.
- Treating **"the parameter looks injectable"** as exploited. A reflected quote or an error is a signal, not a finding.
- **Circular evidence** — using an assumption equivalent to the conclusion as its own proof.

## Proof standard — the PoC must achieve the goal end to end

Demonstrate the **attacker's goal actually achieved**: unauthorized data actually returned, the injected command actually executing *with output*, another user's resource actually read or modified. Not merely that a vulnerable pattern exists or a vulnerable code path runs. **When the mechanism fires but a downstream control blocks the goal, it is a hardening note, not a finding.**

State the **proof basis** on every finding:
- `executed-live` — triggered against the real target.
- `executed-lab` — triggered against a local/lab instance.
- `static-analysis-unexecuted` — traced in source but never fired → the finding is **potential/suspect**, never confirmed.

An executed proof outranks a static conclusion.

## The three-tier confidence lifecycle

Never let a tool's output *be* the finding. Every candidate moves through three explicit states, and only the last is reportable as confirmed:

1. **DETECTED** — a scanner/grep/pattern hit, or "this looks injectable." *Unverified. Not a finding.*
2. **CONFIRMED** — validated with a controlled, low-risk check that the mechanism really fires (below).
3. **EXPLOITED** — the attacker's goal actually achieved end to end, with evidence.

A raw scanner result or a `grep` match sits at DETECTED until you move it up with your own evidence. Report the level honestly; a DETECTED-only item is "suspect", never "confirmed".

## Low-risk validation *before* deep exploitation

Confirm the hypothesis with the smallest safe probe before escalating:
- **Unique markers** — inject a random token (`XSS_TEST_8F3A`) and check *where and how* it reflects (HTML / attribute / JS / CSS context) before building a real payload.
- **Timing checks** — a benign `sleep`/delay to confirm blind command/SQL injection without extracting anything.
- **Out-of-band (OOB)** — a callback host (Interactsh-style) for blind SSRF/XXE where there is no in-band response.
- **Controlled boolean** — `AND 1=1` vs `AND 1=2` response diff for blind SQLi.

These confirm the mechanism (DETECTED→CONFIRMED) cheaply and safely; only then spend effort on EXPLOITED.

## Measured impact — a number with its denominator

Every finding carries the attacker outcome **as a number with its denominator**, plus what the defense blocked:

- ✅ "3 of 20 payload variants returned other-tenant rows; 17 rejected."
- ✅ "commands executed: 2, output returned: yes."
- ❌ "the attacker can dump the table." *(a claim, not a measurement)*

If no number is obtainable, keep the section and state what was attempted and why it is not measurable.

## Testing bounds (non-destructive ≠ read-only)

State-changing requests are in bounds when they are the finding's *mechanism*. Prove the mechanism on **your own** objects/accounts first; then confirm cross-entity reach on **at most three** non-owned objects with the smallest request that demonstrates the boundary. Prefer reversible values, restore originals where possible, and **record every touched object ID** in the evidence. Never DROP/DELETE/mass-UPDATE to "prove" a bug.

## Priority discipline (don't inflate)

Low-impact oracles (user/account enumeration, account-existence, response-timing deltas) and low-yield misconfigs (permissive CORS, missing security headers) are **not standalone findings** — record them only when they *directly chain* into account takeover, auth bypass, or mass data exposure. Do not merge distinct candidates: different entry points, parameters, or privilege levels are separate findings even inside one narrative chain.

## De-duplication

Same root cause + same endpoint + same parameter = extend the existing finding's evidence, not a new report. A genuinely distinct entry point, parameter, or privilege level remains its own finding. When confidence is not high, attach `counterevidence` (what you tested that did not work) and `confidence_rationale` (why it still holds).

---
*Distilled from the ARTEX solo-pentest "adversarial gate" and "finding quality gates" prompt catalog (AGPL project; methodology reproduced, not code) and PentAGI's reflector/verification logic (MIT).*
