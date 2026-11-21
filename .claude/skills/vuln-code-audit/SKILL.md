---
name: vuln-code-audit
description: "Invoke when auditing first-party source code for security vulnerabilities (a repo, service, plugin, or diff). White-box, attacker-first: inventory every user-controllable input, trace each forward to dangerous sinks, keep only findings that pass the gates, prove each with a PoC and a measured impact. Pair with finding-quality-gate (verification) and the class skills injection-and-fixes / access-control-audit / auth-secrets-audit."
---

# Vulnerability Code Audit (white-box source review)

Audit first-party production source the way an attacker reads it: enumerate every user-controllable input, trace each one **forward** to dangerous sinks, keep only findings that pass the three gates, and prove each with a PoC and a measured impact. Run `finding-quality-gate` on every candidate before it becomes a finding.

This is the source-code counterpart of live pentesting. Zero confirmed findings is a valid, honest outcome — never soften the gates to manufacture output.

## Scope rules (production code only)

Never report findings in, and never trace through: test code, build/packaging scripts, vendored or third-party code, generated code, documentation. If a flow passes through vendored code, note the dependency boundary and focus on the first-party caller.

**Exception:** security-relevant infrastructure config checked into the repo is in scope when it changes the app's security assumptions (reverse-proxy/nginx directives, `trust proxy`, header forwarding, TLS termination, CORS). A directive that promotes a normally trusted value to attacker-controllable is a deployed vulnerability, not an operational note.

## Phase 1 — Input inventory and partitioning

Enumerate **every** user-controllable input, each with its handler `file:line`:
HTTP routes + their params, headers, cookies, request bodies, REST/RPC methods, queue/event consumers, CLI args, config/env read at request time, file uploads, import/export endpoints, webhooks/callbacks, scheduled jobs with externally influenced inputs.

Partition a large codebase by module/subgraph and hunt each partition separately — but first build the **shared defense catalog**: middleware, auth wrappers, sanitizers, ORM base classes, framework validators. Each trace sees only its partition; verification (Phase 3) searches the *whole* codebase for these shared defenses.

Write the inventory to disk as the **completeness artifact**. Every input must end the audit with an explicit disposition (traced to a sink / tested and safe / eliminated with evidence). Candidates are hypotheses, not findings. Silent drops are audit failures.

## Phase 2 — Forward hunt, one vuln class at a time

For each input, trace **forward** (entry point → sink), one class at a time: injection, navigation/XSS, business-logic/authorization, file ops, deserialization, cryptography, SSRF. Per input:

1. Read the entry handler; list every use of the input variable (assignments, arguments, interpolation, concatenation).
2. Trace forward function-by-function until a sink, a sanitizer, or the codebase boundary.
   - **Never stop at an abstraction boundary.** A router, dispatcher, middleware chain, data fetcher, strategy selector, or callback is a *fork* into multiple traces — follow each to its conclusion.
   - **Audit all parameters at every outbound call site** (DB query, HTTP client, message publish), not just the traced input. A validated scoping parameter (tenant / user / account id) that is substituted, dropped, defaulted, or replaced by a wildcard (`~`, `*`, `-1`, `"all"`) between validation and the call is a candidate **authorization bypass (high)**.
   - **Exhaust all paths.** An input used in three places is three traces; a safe path never clears the others.
   - **Early-return guards protect only what they actually validate.** "not null" protects nothing against injection — verify the check matches the sink's context.
   - **Follow through stores.** Input written to DB/cache/queue continues wherever a reader consumes it (second-order injection).
   - **Follow through responses.** When input controls scheme/host/port of an outbound request, the response body is attacker-influenced; when input selects a resource, enumerate the response-mapper fields for sensitive data reaching the caller (CWE-200).
   - **Transitive caller search on every candidate sink:** grep callers of the sink, then callers of callers, to entry points or exhaustion.
3. **Read the actual sink source before confirming anything.** Search navigates; source read judges.

## Phase 3 — The three gates (a candidate must pass all)

1. **Reachable** in production. Route registration ≠ reachability; a dev-only guard in the handler's own source removes it.
2. **Attacker-controlled** data reaches the sink. A value only the server writes fails this — *unless all its write paths are attacker-influenced*.
3. **New capability** for the attacker: a privilege they lack, another user's data, code execution, or a state change beyond their rights.

A candidate failing any gate is a **hardening note, never a finding.** Prose ("by design", "sanitized downstream", "internal only") satisfies no gate — only read code does. A sanitizer whose scope does not match the sink context (an HTML encoder guarding a URL; URL-encoding guarding SQL) is itself a finding.

## Phase 4 — PoC and measured impact

Prefer executing the PoC against a real instance: deploy locally (compose, a lab instance, a local install for a plugin) and demonstrate the attacker's goal achieved end to end. **Executed beats static.**

When execution is genuinely impossible, a static-trace PoC must contain: the concrete attacker input at the entry, `file:line` at every propagation step, the literal dangerous value reaching the sink, and the concrete impact. Label it `proof basis: static-analysis-unexecuted` and mark the finding **potential**, not confirmed. Every finding carries a measured impact with its denominator (see `finding-quality-gate`).

## Phase 5 — Sweep and count cross-check

For each confirmed root cause, grep the whole codebase for the same pattern; every instance gets its own disposition (confirmed as its own finding, or eliminated with cited evidence). Before the final summary: every Phase-2 candidate appears exactly once as confirmed / eliminated / downgraded; every confirmed finding with a passing PoC becomes its own reported finding. Deliver a coverage statement even at zero findings: which classes were hunted, by which method, across which surfaces, with what result.

---
*Methodology distilled from the ARTEX `codeaudit` skill (itself adapted from Capital One VulnHunter, Apache-2.0, and bug-bounty-hunting-prompts, MIT) and PentAGI agent logic (MIT).*
