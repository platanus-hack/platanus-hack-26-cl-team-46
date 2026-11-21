---
name: access-control-audit
description: "Invoke when auditing authorization in source or live API: broken object-level (BOLA/IDOR), function-level (BFLA), and privilege escalation. The highest-value and most-missed bug class in business apps. Covers the code smells (missing ownership checks, the dropped scoping parameter), the two-identity proof requirement, and the fixes. Use with vuln-code-audit and finding-quality-gate."
---

# Access-Control Audit (BOLA / IDOR / BFLA / privilege escalation)

Broken access control is the bug class that *costs real money* in business apps — one customer reading another's data — and the one scanners miss, because it needs **semantics and a second identity**, not a payload. An access-control finding does not exist until a **second account or role has proven the boundary is real.**

## The core question for every handler

For every endpoint that reads or mutates a resource, ask: **"Does the code check that *this* authenticated principal is allowed to act on *this specific object*?"** Authentication (who you are) is not authorization (what you may touch). A valid session is not permission.

## Broken Object-Level Authorization (BOLA / IDOR)

The handler resolves an object from a user-supplied id (`/notes/:id`, `?orderId=`, a UUID in the body) but **filters only by the id, not by the owner**.

**Code smell:**
```python
# VULNERABLE — any logged-in user reads any note
note = db.query("SELECT * FROM notes WHERE id = %s", (note_id,))
# FIXED — ownership is part of the query, enforced server-side
note = db.query("SELECT * FROM notes WHERE id = %s AND owner_id = %s",
                (note_id, session.user_id))
```
Hunt in source: find every `findById` / `WHERE id =` / `get(pk)` and check the *same query or the line after* constrains it to the caller's tenant/owner. In live testing: enumerate numeric ids (`/user/1`→`/user/2`), substitute harvested UUIDs, swap username/email in path and body, and **two-session replay** — user A's session requesting user B's object; a 200 is the finding.

**UUIDs are not authorization.** "Unguessable id" is obscurity; if the object is returned without an ownership check, harvest the id from any other response and it falls.

## The dropped-scoping-parameter pattern (high)

A tenant/user/account id is **validated, then lost** before the data call: substituted, dropped, defaulted, or replaced by a wildcard (`~`, `*`, `-1`, `"all"`, empty) between the authz check and the query/outbound call. Audit **all parameters at every outbound call site**, not just the obvious input — this is where a correct-looking handler leaks across tenants.

## Broken Function-Level Authorization (BFLA)

A standard user reaches a privileged *function*. Hunt and test:
- standard user calling admin endpoints (`/admin/*`);
- **HTTP method swap** (GET→PUT/PATCH/DELETE) where the write path lacks the read path's guard;
- **version downgrade** (`/v2/admin`→`/v1/admin`) where the old route is unguarded;
- **batch/bulk** endpoints that skip the per-item authz the single endpoint has;
- a role check on the UI/route but **not on the controller** (client-side-only enforcement).

## Privilege escalation & mass assignment

- **Self role change:** can a low-privilege user set their own `role`/`enabledRoles`/`is_admin` via a profile/update endpoint? Look for `PATCH/PUT /users/me` (or `/account`) that binds the whole body to the model.
- **Mass assignment:** request body fields bound straight to the ORM model (`is_admin:true`, `balance:…`, `owner_id:…`) because the handler does `Model(**request.json)` / `.update(body)` with no field allowlist.
- **Fix:** explicit input allowlists (DTOs / serializers with a fixed field set); role/permission changes go through a dedicated, separately-authorized path — never the generic update.

## The two-identity proof (required)

A BOLA/BFLA/privesc claim is **not a finding** until proven with a second identity: a second account of the same role (for BOLA), or a lower-privilege account reaching a higher-privilege function (for BFLA/privesc). One record you are authorized to touch, or your own second account, is sufficient evidence — **do not exfiltrate real user data to prove it** (`finding-quality-gate`, testing bounds). In code review without live access, the proof is the traced `file:line` showing the missing/omitted ownership check with the concrete request that would reach it, marked `static-analysis-unexecuted`.

## Fix principles

- Enforce authorization **at the data layer / server**, scoped to the authenticated principal — ownership is part of the query, not a separate optional check.
- Centralize it (policy/guard/middleware) so every handler inherits it; a per-handler check is one forgotten handler from a breach.
- Deny by default; the UI hiding a button is not access control.

---
*Distilled from ARTEX `api-security` Phase 3 and `codeaudit` authorization logic, plus PentAGI authenticated-testing methodology. Maps to OWASP API Top-10 (BOLA/BFLA) and A01 Broken Access Control.*
