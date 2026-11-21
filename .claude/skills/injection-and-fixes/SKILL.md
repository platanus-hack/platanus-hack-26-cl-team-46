---
name: injection-and-fixes
description: "Invoke when hunting injection in source code (SQL/NoSQL, OS command, template/SSTI, XSS, LDAP, XML/XXE, deserialization, SSRF) AND when fixing it. For each class: the dangerous-sink catalog to grep, how to confirm attacker data reaches it unsanitized, and the correct fix (parameterized queries / safe APIs / context-aware encoding) with before→after code. Use with vuln-code-audit and finding-quality-gate."
---

# Injection Hunting & Remediation

Injection exists wherever **attacker-controlled data is concatenated into an interpreter's instruction** (SQL, a shell, HTML, a template, a query language, a serialized object, an outbound URL). Find it by tracing input to the sink (`vuln-code-audit`); fix it by **separating code from data** at the sink. The fix is almost never "escape the input" — it is "use the API that keeps data as data."

## How to hunt each class — sink catalog + the fix

### SQL / NoSQL injection
**Grep for sinks:** string-built queries — `execute(`, `query(`, `raw(`, `$queryRaw`, `cursor.execute(`, f-strings/`+`/`.format`/template literals inside SQL, `WHERE ... " + var`, Mongo `$where`, `{$gt:...}` from user JSON.
**Confirm:** the variable in the query string is attacker-controlled and not a bound parameter. A value passed as a *driver parameter* is safe; a value *interpolated into the string* is not — even if it is also escaped.
**Fix — parameterized queries / bound params (never string-build):**
```python
# VULNERABLE
db.execute("SELECT * FROM users WHERE email = '" + email + "'")
# FIXED — parameter placeholder, driver binds the value
db.execute("SELECT * FROM users WHERE email = %s", (email,))   # psycopg
cur.execute("SELECT * FROM users WHERE email = ?", (email,))   # sqlite
```
```ts
// VULNERABLE
db.query(`SELECT * FROM notes WHERE owner = '${userId}'`)
// FIXED
db.query('SELECT * FROM notes WHERE owner = $1', [userId])     // pg / parameterized
```
- ORMs: use query builders / parameter binding; `raw()` and `$queryRawUnsafe` re-open the hole — prefer `$queryRaw` tagged templates.
- Identifiers (table/column names) cannot be bound — **allowlist** them against a fixed set; never interpolate raw.
- NoSQL: reject user-supplied **operator objects**; cast to string/expected type before building the filter.

### OS command injection
**Sinks:** `exec(`, `system(`, `popen(`, `child_process.exec`, `os.system`, `subprocess` with `shell=True`, backticks, `Runtime.exec` with a string.
**Fix:** pass an **argument array to an API that does not spawn a shell**; never build a command string.
```python
# VULNERABLE
os.system("ping -c1 " + host)
# FIXED — no shell, args as a list
subprocess.run(["ping", "-c1", host], shell=False, check=True)
```
If a shell is unavoidable, allowlist the input against a strict pattern; escaping is a last resort and error-prone.

### Template injection (SSTI) & XSS
- **SSTI sinks:** user input rendered *as a template* (`render_template_string`, Jinja/Twig/Handlebars/EJS/Freemarker with concatenated user data). **Fix:** render static templates; pass user data as **context variables**, never into the template source.
- **XSS sinks:** `innerHTML`, `dangerouslySetInnerHTML`, `document.write`, `v-html`, unescaped template output, `|safe`/`raw` filters, reflected/stored response text. **Fix:** context-aware **output encoding** at the sink (HTML / attribute / JS / URL contexts differ); prefer framework auto-escaping and `textContent` over `innerHTML`; sanitize rich HTML with a vetted library (DOMPurify) — never a homemade regex. A CSP is defense-in-depth, not the fix.

### XML / XXE & deserialization
- **XXE sinks:** XML parsers with external entities enabled. **Fix:** disable DTDs/external entities (`resolve_entities=False`, `FEATURE_SECURE_PROCESSING`, `defusedxml`).
- **Insecure deserialization sinks:** `pickle.loads`, `yaml.load` (unsafe), `Marshal.load`, Java `readObject`, `unserialize`. **Fix:** never deserialize untrusted data into objects; use data-only formats (JSON) with schema validation; `yaml.safe_load`; signed/allowlisted types if objects are unavoidable.

### SSRF
**Sinks:** server-side HTTP/fetch where the **URL (scheme/host/port) is user-controlled** — webhooks, avatar/image importers, link previews, PDF/screenshot renderers, any "fetch this URL for me."
**Fix:** allowlist destination hosts/schemes; resolve the host and **block private/link-local/metadata ranges** (127/8, 10/8, 169.254.169.254, ::1, metadata endpoints) *after* DNS resolution; disable redirects or re-validate each hop; never let the response leak back verbatim.

## The remediation rule

> The fix separates **code from data** at the sink. Parameterized queries, argument arrays, context-aware encoders, safe parsers, and host allowlists all encode the same principle: the interpreter must receive the attacker's bytes as inert *data*, never as instructions. "Sanitize the input at the edge" is weaker and leaks — fix at the sink, and sweep the whole codebase for every sibling instance of the same pattern (`vuln-code-audit` Phase 5).

Prove the injection before and the safety after: the same PoC payload returns data/executes on the vulnerable version and is inert on the fixed one (`finding-quality-gate`, proof basis executed).

---
*Sink/fix catalog distilled from ARTEX `codeaudit` + `api-security` and PentAGI tool/exploit logic. Fix patterns follow OWASP parameterized-query / output-encoding guidance.*
