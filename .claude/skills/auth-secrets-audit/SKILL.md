---
name: auth-secrets-audit
description: "Invoke when auditing authentication, session, token, and secret handling in source or live API: JWT/OAuth flaws, session fixation, password/credential handling, and hardcoded or leaked secrets. Covers the concrete checks and the fixes. Use with vuln-code-audit and finding-quality-gate."
---

# Authentication, Token & Secret Audit

Authentication decides *who the principal is*; everything downstream trusts it. Flaws here are high severity because they forge identity or hand over persistent access. Audit the token's full lifecycle (issue → validate → refresh → revoke) and every place a secret could enter the repo or a response.

## JWT

Read the **verification** code, not the issuance code — bugs live in how tokens are *checked*.
- [ ] **`alg: none`** accepted — header rewritten, signature stripped, still trusted. (Fix: pin the expected algorithm; reject `none`.)
- [ ] **Algorithm confusion** — an RS256 public key accepted as an HS256 secret (attacker signs with the public key). (Fix: bind the key to one algorithm; never let the token's `alg` choose the verifier.)
- [ ] **Weak/guessable HMAC secret** — dictionary-crackable. (Fix: long random secret from the secret store, not source/config.)
- [ ] **Signature not actually verified** — decoded-but-not-verified (`decode` without `verify`, or verification result ignored).
- [ ] **Claims not enforced** — `exp`/`nbf` ignored (expired token still works), `sub`/`role`/`aud`/`iss` unchecked or trusted from the token for authorization.
- [ ] **`kid` injection** — path traversal / SQL in the key-id selects an attacker-chosen key.
- [ ] **Refresh token never rotated/invalidated** — the same refresh token is reusable indefinitely, so a stolen one grants persistent access even after the user re-authenticates. (Fix: one-time-use rotation; invalidate the prior token and detect reuse.)

## OAuth 2.0 / OIDC

- [ ] **`redirect_uri` manipulation** → authorization-code theft (allowlist exact URIs; no wildcards/suffix matches).
- [ ] **Missing `state`** → CSRF on the authorization flow.
- [ ] **Missing PKCE** on public clients.
- [ ] **Token leakage** via `Referer`, logs, or URL fragments.

## Sessions & login

- [ ] **Session fixation** — the session id is not rotated on privilege change/login.
- [ ] **Predictable / non-expiring** session tokens; missing `HttpOnly`/`Secure`/`SameSite` on the cookie.
- [ ] **Password storage** — plaintext or fast hash (MD5/SHA1/unsalted). Fix: a slow salted KDF (bcrypt/scrypt/argon2).
- [ ] **Login oracles** — different responses/timing for "user exists, wrong password" vs "no such user" (a low-severity item; report only when it chains — see `finding-quality-gate` priority discipline).
- [ ] **Credential-handling smells** — timing-unsafe comparison of secrets (`==` on tokens); use constant-time compare.

## Secrets in the repo and in responses

- [ ] **Hardcoded secrets** — API keys, DB passwords, private keys, signing secrets committed in source/config/CI. Grep: `api_key`, `secret`, `password`, `BEGIN PRIVATE KEY`, `AKIA` (AWS), high-entropy strings. Check git history, not just HEAD.
- [ ] **Client-exposed secrets** — a *server* secret shipped in a frontend bundle or returned by an API. (Note: a public client key — Sentry DSN, PostHog/analytics project key, Stripe *publishable* key — is **designed to be public**; do not report these as leaks. The gate is "does this grant a capability the client shouldn't have?")
- [ ] **Secrets in logs/errors** — tokens, connection strings, or stack traces with credentials in log output or error responses.
- [ ] **Over-exposed response fields** — the API returns more than the UI needs (PII, internal ids, role-change metadata). Diff the API response against what the page renders (CWE-200).

## Fixes

- Secrets live in the deployment's secret store (env/manager), never in the repo; rotate anything that was ever committed.
- Verify tokens against a pinned algorithm and a server-held key; enforce `exp` and the authorization claims server-side.
- Rotate session ids on login/privilege change; rotate refresh tokens on every use and detect reuse.
- Return the minimum fields a role needs (output DTOs), not the whole model.

Each confirmed item needs the request/response or the `file:line` that proves it, per `finding-quality-gate`.

---
*Distilled from ARTEX `api-security` Phase 2 and `codeaudit`, plus PentAGI web-pentest checklist. Maps to OWASP A02/A07 and API Top-10 (auth).*
