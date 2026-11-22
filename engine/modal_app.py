"""Motor de hacking en Modal (https://modal.com).

Cada corrida del motor es UNA llamada a la función `run_engagement`, en su
propio contenedor desechable (Node 24 + semgrep). El backend la dispara por
HTTP (API privada con Proxy Auth de Modal) y consulta el resultado después,
porque Modal corta cualquier request HTTP a los 150 s y una corrida puede
tardar más.

    POST   /runs              { url, plugin?, ... }  → 202 { call_id }
    GET    /runs/{call_id}    → 202 { status: "running" } | 200 { status: "done", result }
    DELETE /runs/{call_id}    → cancela la corrida
    GET    /health

Comandos (desde la raíz del repo; detalle en engine/docs/MODAL.md):

    ENGINE_MODAL_SECRETS= modal run engine/modal_app.py::selftest   # tests en el contenedor
    modal run engine/modal_app.py --url https://sbx-xxxx.onrender.com  # una corrida a mano
    modal serve engine/modal_app.py                                   # API temporal (dev)
    modal deploy engine/modal_app.py                                  # API permanente
"""

from __future__ import annotations

import base64
import fnmatch
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import time
from urllib.parse import urlparse

import modal

APP_NAME = "hack26-engine"
ENGINE_DIR = pathlib.Path(__file__).resolve().parent
REMOTE_ENGINE = "/engine"
NODE_VERSION = "24.14.0"  # la misma con la que pasan los tests (TS sin compilar)
SEMGREP_VERSION = "1.90.0"  # la aprobada en providers/provenance.ts
RUN_TIMEOUT_S = 30 * 60

# Secrets de Modal que se inyectan como variables de entorno. Por defecto
# "hack26-engine" (ver docs/MODAL.md). Para correr el selftest sin crearlo:
#   ENGINE_MODAL_SECRETS= modal run engine/modal_app.py::selftest
# El valor viaja en la imagen (ENGINE_MODAL_SECRETS) para que el contenedor
# resuelva la MISMA lista que la máquina que despliega; si no, Modal falla al
# arrancar ("Function has 2 dependencies but container got 1 object ids").
SECRETS_ENV = os.environ.get("ENGINE_MODAL_SECRETS", "hack26-engine")
SECRET_NAMES = [s.strip() for s in SECRETS_ENV.split(",") if s.strip()]
secrets = [modal.Secret.from_name(name) for name in SECRET_NAMES]

# Imagen del motor: se construye con el builder de Modal (no usa el Dockerfile,
# que queda para Render). Modal no ejecuta el CMD de un Dockerfile, así que el
# proceso Node lo lanza run_engagement con subprocess.
engine_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "curl", "ca-certificates", "xz-utils")
    .run_commands(
        f"curl -fsSL https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-linux-x64.tar.xz"
        " | tar -xJ -C /usr/local --strip-components=1",
        # semgrep en su propio venv para que sus dependencias no choquen con las de Modal.
        f"python -m venv /opt/semgrep && /opt/semgrep/bin/pip install --no-cache-dir semgrep=={SEMGREP_VERSION} 'setuptools<81'",
        "ln -s /opt/semgrep/bin/semgrep /opt/semgrep/bin/pysemgrep /usr/local/bin/",
        "node --version && semgrep --version",
    )
    # Sin SEMGREP_SEND_METRICS=off: `semgrep --config auto` (la config que usa el
    # motor) se niega a correr con las métricas apagadas.
    .env({"NODE_NO_WARNINGS": "1", "ENGINE_MODAL_SECRETS": SECRETS_ENV})
    # El código va al final: cambiarlo no reconstruye las capas de arriba.
    .add_local_file(ENGINE_DIR / "package.json", f"{REMOTE_ENGINE}/package.json")
    .add_local_dir(ENGINE_DIR / "src", f"{REMOTE_ENGINE}/src")
    .add_local_dir(ENGINE_DIR / "test", f"{REMOTE_ENGINE}/test")
)

api_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("fastapi[standard]==0.115.12")
    .env({"ENGINE_MODAL_SECRETS": SECRETS_ENV})
)

app = modal.App(APP_NAME)

# Caché de discovery por (repo, commit). El RepoModel que produce discoverRepo es
# DETERMINISTA para un commit inmutable, así que se calcula una vez y se reutiliza
# en corridas repetidas del mismo commit (primera pasada + cada verify), en vez de
# re-descubrirlo en cada contenedor desechable. Persistente entre contenedores.
discovery_cache = modal.Dict.from_name("hack26-engine-discovery", create_if_missing=True)


def _discovery_cache_key(spec: dict) -> str | None:
    """Clave `f"{repo}@{commit}"` SOLO si el commit es un sha inmutable.

    Si no hay repo/commit, o el commit es volátil (una rama como `main`, o
    `working-tree`), devuelve None: el RepoModel podría cambiar entre corridas,
    así que se cae al camino normal (re-descubrir, sin cachear)."""
    repo = spec.get("repo")
    commit = spec.get("commit")
    if not repo or not commit:
        return None
    commit = str(commit)
    # Un sha de git es hex de 7..40 chars; ramas/tags/working-tree no cachean.
    if not re.fullmatch(r"[0-9a-fA-F]{7,40}", commit):
        return None
    return f"{repo}@{commit}"


# ───────────────────────── validación del pedido ─────────────────────────

PLUGINS = {"auto", "generic", "apuntes", "tasks", "destructive"}
PROFILES = {"noisy", "normal", "fast", "stealth"}


class SpecError(ValueError):
    pass


def _allowed_hosts() -> list[str]:
    raw = os.environ.get("ENGINE_ALLOWED_HOSTS", "")
    return [h.strip().lower() for h in raw.split(",") if h.strip()]


def validate_spec(spec: dict) -> dict:
    """Valida el pedido ANTES de gastar un contenedor. Lanza SpecError.

    Solo se ataca un host de ENGINE_ALLOWED_HOSTS (acepta comodines, p. ej.
    *.onrender.com). Sin esa variable no se ataca nada.
    """
    if not isinstance(spec, dict):
        raise SpecError("el cuerpo debe ser un objeto JSON")
    url = spec.get("url")
    if not isinstance(url, str) or not url:
        raise SpecError("falta url")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise SpecError(f"url inválida: {url}")

    allowed = _allowed_hosts()
    if not allowed:
        raise SpecError("ENGINE_ALLOWED_HOSTS no está configurado: el motor no ataca ningún host")
    host = parsed.hostname.lower()
    if not any(fnmatch.fnmatchcase(host, pattern) for pattern in allowed):
        raise SpecError(f"host fuera de la lista autorizada: {host}")

    plugin = spec.get("plugin", "auto")
    if plugin not in PLUGINS:
        raise SpecError(f"plugin desconocido: {plugin} (usa {', '.join(sorted(PLUGINS))})")
    profile = spec.get("profile", "fast")
    if profile not in PROFILES:
        raise SpecError(f"perfil desconocido: {profile}")
    if spec.get("destructive") and os.environ.get("ENGINE_ALLOW_DESTRUCTIVE") != "1":
        # El agresivo es el modo por defecto del producto; el daño real solo se
        # habilita con el flag de ops. Sin él, degradamos a no-destructivo en vez
        # de abortar la corrida: la simulación corre igual, solo sin DoS/SSRF.
        # Es el único sentido de degradación (nunca sube la agresividad), así que
        # es seguro para disponibilidad sin tocar el scope guard de hosts.
        print("[engine] destructive solicitado sin ENGINE_ALLOW_DESTRUCTIVE=1: se degrada a no-destructivo")
        spec["destructive"] = False

    repo = spec.get("repo")
    if repo is not None:
        r = urlparse(str(repo))
        if r.scheme != "https" or not r.hostname:
            raise SpecError("repo debe ser una URL https de git (p. ej. https://github.com/org/repo)")
    # RepoModel ya calculado (--repo-model): reusa el discovery de una corrida previa
    # y salta el escaneo estático. Útil para re-verificar una vuln sin re-descubrir.
    repo_model = spec.get("repo_model")
    if repo_model is not None and not isinstance(repo_model, dict):
        raise SpecError("repo_model debe ser un objeto (RepoModel serializado)")
    progress = spec.get("progress")
    if progress is not None:
        pu = urlparse(str((progress or {}).get("url", "")))
        if pu.scheme not in ("http", "https") or not pu.hostname or not (progress or {}).get("token"):
            raise SpecError("progress debe ser { url: http(s)://…, token }")
    weak = spec.get("weak_login")
    if weak is not None and not (isinstance(weak, dict) and weak.get("email") and weak.get("password")):
        raise SpecError("weak_login debe ser { email, password }")
    return spec


def _cli_args(spec: dict, out_dir: str, repo_dir: str | None, repo_model_path: str | None = None) -> list[str]:
    args = ["node", "src/cli/run.ts", "--url", spec["url"], "--out", out_dir]
    args += ["--plugin", spec.get("plugin", "auto"), "--profile", spec.get("profile", "fast")]
    if spec.get("seed"):
        args += ["--seed", str(spec["seed"])]
    if spec.get("budget_usd") is not None:
        args += ["--budget", str(float(spec["budget_usd"]))]
    if spec.get("only"):
        only = spec["only"]
        args += ["--only", ",".join(only) if isinstance(only, list) else str(only)]
    if spec.get("commit"):
        args += ["--commit", str(spec["commit"])]
    if spec.get("weak_login"):
        args += ["--weak-email", spec["weak_login"]["email"], "--weak-pass", spec["weak_login"]["password"]]
    for key, flag in (("read_only", "--read-only"), ("destructive", "--destructive"), ("no_recon", "--no-recon")):
        if spec.get(key):
            args.append(flag)
    # RepoModel precomputado: salta el discovery estático (y, si no se clonó el
    # repo, también el clon). Vive aparte de --repo para poder combinarse con él.
    if repo_model_path:
        args += ["--repo-model", repo_model_path]
    if repo_dir:
        args += ["--repo", repo_dir]
        if spec.get("semgrep", True):
            args.append("--semgrep")
        if spec.get("providers"):
            args.append("--providers")
    return args


def _clone(repo: str, commit: str | None, dest: str) -> None:
    """Clona el repo. El token va en un header por variables de entorno de git,
    nunca en la URL ni en argv: así no aparece en mensajes de error ni en `ps`."""
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    token = os.environ.get("GITHUB_TOKEN")
    if token and urlparse(repo).hostname == "github.com":
        basic = base64.b64encode(f"x-access-token:{token}".encode()).decode()
        env.update(
            GIT_CONFIG_COUNT="1",
            GIT_CONFIG_KEY_0="http.https://github.com/.extraheader",
            GIT_CONFIG_VALUE_0=f"AUTHORIZATION: basic {basic}",
        )

    def git(*args: str, timeout: int = 300) -> None:
        p = subprocess.run(["git", *args], env=env, capture_output=True, text=True, timeout=timeout)
        if p.returncode != 0:
            err = (p.stderr or p.stdout).strip().splitlines()[-1:] or ["sin salida"]
            if token:
                err = [e.replace(token, "***") for e in err]
            raise RuntimeError(f"git {args[0] if args[0] != '-C' else args[2]} falló: {err[0]}")

    git("clone", "--depth", "1", "--quiet", repo, dest)
    if commit:
        git("-C", dest, "fetch", "--depth", "1", "--quiet", "origin", commit)
        git("-C", dest, "checkout", "--quiet", commit, timeout=60)


def _read_artifacts(out_root: str) -> dict:
    runs = [p for p in pathlib.Path(out_root).iterdir() if p.is_dir() and p.name != "latest"]
    if not runs:
        return {}
    run_dir = max(runs, key=lambda p: p.stat().st_mtime)
    artifacts: dict = {"scenarios": []}
    for f in sorted(run_dir.glob("*.json")):
        artifacts[f.stem.replace("-", "_")] = json.loads(f.read_text())
    guide = run_dir / "GUIA-DEL-HACKEO.md"
    if guide.exists():
        artifacts["guide_md"] = guide.read_text()
    for f in sorted((run_dir / "scenarios").glob("*.json")):
        artifacts["scenarios"].append(json.loads(f.read_text()))
    return artifacts


class _ProgressReporter:
    """Manda la salida del CLI, línea a línea, a la URL del backend (progress.url)
    con su token. Así la pantalla de "primera pasada" se ve en vivo. Si falla,
    la corrida sigue: el progreso es solo para mirar."""

    def __init__(self, progress: dict | None):
        self.url = (progress or {}).get("url")
        self.token = (progress or {}).get("token")
        self.buf: list[str] = []
        self.last = 0.0

    def add(self, line: str) -> None:
        if not self.url or not line.strip():
            return
        self.buf.append(line[:500])
        self.flush()

    def flush(self, force: bool = False) -> None:
        if not self.url or not self.buf or (not force and time.time() - self.last < 1.0):
            return
        import urllib.request

        body = json.dumps({"lines": self.buf}).encode()
        req = urllib.request.Request(self.url, data=body, method="POST")
        req.add_header("content-type", "application/json")
        req.add_header("authorization", f"Bearer {self.token}")
        req.add_header("x-sim-role", "hacker")
        try:
            urllib.request.urlopen(req, timeout=5).read()
        except Exception as e:  # noqa: BLE001 — el progreso nunca tumba la corrida
            print(f"progreso no enviado: {e}", flush=True)
        self.buf = []
        self.last = time.time()


# ───────────────────────── funciones de Modal ─────────────────────────


@app.function(
    image=engine_image,
    secrets=secrets,
    timeout=RUN_TIMEOUT_S,
    cpu=1.0,
    memory=1024,
    max_containers=10,
)
def run_engagement(spec: dict) -> dict:
    """Una corrida completa del motor en un contenedor desechable."""
    return _execute(spec)


def _execute(spec: dict, repo_dir: str | None = None) -> dict:
    validate_spec(spec)
    started = time.time()
    work = tempfile.mkdtemp(prefix="engagement-")
    try:
        if spec.get("repo") and not repo_dir:
            repo_dir = os.path.join(work, "repo")
            _clone(str(spec["repo"]), spec.get("commit"), repo_dir)
        out_dir = os.path.join(work, "out")

        # RepoModel servido al CLI (--repo-model) para que salte el discovery estático.
        # Precedencia: (1) el que trae el spec explícitamente —p. ej. un verify reusa
        # el de la primera pasada—; (2) la caché de discovery por (repo, commit).
        repo_model_path = None
        served_from_cache = False
        cache_key = _discovery_cache_key(spec) if repo_dir else None
        if spec.get("repo_model"):
            repo_model_path = os.path.join(work, "repo-model.json")
            with open(repo_model_path, "w") as f:
                json.dump(spec["repo_model"], f)
        elif cache_key is not None:
            cached_model = None
            try:
                cached_model = discovery_cache.get(cache_key)
            except Exception as e:  # noqa: BLE001 — el caché nunca tumba la corrida
                print(f"caché de discovery no leído: {e}", flush=True)
            if cached_model:
                repo_model_path = os.path.join(work, "repo-model.json")
                pathlib.Path(repo_model_path).write_text(json.dumps(cached_model))
                served_from_cache = True

        args = _cli_args(spec, out_dir, repo_dir, repo_model_path)

        reporter = _ProgressReporter(spec.get("progress"))
        if repo_dir:
            reporter.add("▶ repo clonado")
        elif repo_model_path:
            reporter.add("▶ RepoModel reusado: sin re-descubrir")
        else:
            reporter.add("▶ sin repo: solo ataque")
        if served_from_cache:
            reporter.add(f"▶ discovery servido de caché ({cache_key})")
        proc = subprocess.Popen(
            args,
            cwd=REMOTE_ENGINE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # una sola tubería: sin riesgo de bloqueo por stderr lleno
            text=True,
            bufsize=1,
        )
        lines: list[str] = []
        deadline = started + RUN_TIMEOUT_S - 60
        for line in proc.stdout:  # type: ignore[union-attr]
            lines.append(line)
            reporter.add(line.rstrip("\n"))
            if time.time() > deadline:
                proc.kill()
                break
        code = proc.wait()
        reporter.flush(force=True)
        log = "".join(lines)
        artifacts = _read_artifacts(out_dir) if os.path.isdir(out_dir) else {}

        # Tras la primera corrida de este commit, guarda el RepoModel para que las
        # siguientes (verify) no re-descubran. Idempotente: si ya estaba, no toca.
        if cache_key is not None and repo_model_path is None and code == 0:
            model = artifacts.get("repo_model")
            if model:
                try:
                    discovery_cache[cache_key] = model
                except Exception as e:  # noqa: BLE001 — el caché nunca tumba la corrida
                    print(f"caché de discovery no escrito: {e}", flush=True)

        return {
            "ok": code == 0,
            "exit_code": code,
            "duration_s": round(time.time() - started, 1),
            "log": log[-20000:],
            "stderr": "" if code == 0 else log[-5000:],
            "artifacts": artifacts,
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


@app.function(image=engine_image, timeout=600)
def selftest() -> None:
    """Tests del motor DENTRO de la imagen + una corrida de punta a punta contra
    el fixture local (127.0.0.1). No ataca nada externo; semgrep sí baja reglas."""
    for cmd in (["node", "--version"], ["semgrep", "--version"], ["npm", "test"]):
        print("$", " ".join(cmd), flush=True)
        subprocess.run(cmd, cwd=REMOTE_ENGINE, check=True)

    print("$ corrida de punta a punta contra el fixture", flush=True)
    fixture = subprocess.Popen(["node", "test/serve-fixture.ts"], cwd=REMOTE_ENGINE, stdout=subprocess.PIPE, text=True)
    try:
        url = fixture.stdout.readline().strip()
        os.environ["ENGINE_ALLOWED_HOSTS"] = "127.0.0.1"
        spec = {
            "url": url,
            "plugin": "apuntes",
            "seed": "selftest",
            "weak_login": {"email": "martin.soto@example.com", "password": "qwerty123"},
        }
        result = _execute(spec, repo_dir=f"{REMOTE_ENGINE}/test/fixtures/repo-node")
        print(result["log"][-3000:], flush=True)
        arts = result["artifacts"]
        summary = arts.get("diagnosis", {}).get("summary", {})
        print(
            f"artefactos: {sorted(arts)} · confirmadas {summary.get('confirmed')}/{summary.get('total')}"
            f" · semgrep {len(arts.get('semgrep', []))} hallazgo(s)",
            flush=True,
        )
        assert result["ok"], result["stderr"]
        assert summary.get("confirmed") == summary.get("total") == 8, summary
        assert "semgrep" in arts and "attack_plan" in arts and "replay" in arts and arts["scenarios"], "faltan artefactos"
        try:
            validate_spec({"url": "https://example.com"})
            raise AssertionError("la lista de hosts autorizados no bloqueó example.com")
        except SpecError:
            pass
    finally:
        fixture.kill()

    print("$ plugin genérico: app desconocida (NestJS) sin plugin propio", flush=True)
    fixture = subprocess.Popen(["node", "test/serve-fixture.ts", "generic"], cwd=REMOTE_ENGINE, stdout=subprocess.PIPE, text=True)
    try:
        url = fixture.stdout.readline().strip()
        spec = {"url": url, "seed": "selftest-generic", "weak_login": {"email": "ana", "password": "qwerty123"}}
        result = _execute(spec, repo_dir=f"{REMOTE_ENGINE}/test/fixtures/repo-nest")
        print(result["log"][-2500:], flush=True)
        summary = result["artifacts"].get("diagnosis", {}).get("summary", {})
        assert result["ok"], result["stderr"]
        assert "plugin: generic (auto)" in result["log"], "auto no eligió el plugin genérico"
        assert summary.get("confirmed") == summary.get("total") == 11, summary
        print("✅ selftest OK", flush=True)
    finally:
        fixture.kill()


@app.function(image=api_image, secrets=secrets)
@modal.concurrent(max_inputs=50)
@modal.asgi_app(requires_proxy_auth=True)
def api():
    """API privada: cada request necesita los headers Modal-Key / Modal-Secret."""
    from fastapi import Body, FastAPI, HTTPException
    from fastapi.responses import JSONResponse

    web = FastAPI(title="hack26-engine", version="1")

    @web.get("/health")
    def health():
        return {"ok": True, "allowed_hosts": _allowed_hosts()}

    @web.post("/runs", status_code=202)
    def create_run(spec: dict = Body(...)):
        try:
            validate_spec(spec)
        except SpecError as e:
            raise HTTPException(status_code=400, detail=str(e))
        call = run_engagement.spawn(spec)
        return {"call_id": call.object_id, "status_url": f"/runs/{call.object_id}"}

    @web.get("/runs/{call_id}")
    def get_run(call_id: str):
        try:
            call = modal.FunctionCall.from_id(call_id)
            result = call.get(timeout=0)
        except TimeoutError:
            return JSONResponse({"status": "running"}, status_code=202)
        except modal.exception.OutputExpiredError:
            raise HTTPException(status_code=410, detail="el resultado expiró")
        except modal.exception.NotFoundError:
            raise HTTPException(status_code=404, detail="corrida no encontrada")
        except Exception as e:  # la corrida misma falló (timeout, error de Python, etc.)
            return JSONResponse({"status": "failed", "error": f"{type(e).__name__}: {e}"}, status_code=200)
        return {"status": "done", "result": result}

    @web.delete("/runs/{call_id}")
    def cancel_run(call_id: str):
        try:
            modal.FunctionCall.from_id(call_id).cancel()
        except modal.exception.NotFoundError:
            raise HTTPException(status_code=404, detail="corrida no encontrada")
        return {"status": "cancelled"}

    return web


@app.local_entrypoint()
def main(
    url: str,
    plugin: str = "auto",
    profile: str = "fast",
    seed: str = "",
    repo: str = "",
    commit: str = "",
    weak_email: str = "",
    weak_pass: str = "",
    read_only: bool = False,
    providers: bool = False,
):
    """Corrida a mano: modal run engine/modal_app.py --url https://... [--repo ...]"""
    spec: dict = {"url": url, "plugin": plugin, "profile": profile, "read_only": read_only, "providers": providers}
    if seed:
        spec["seed"] = seed
    if repo:
        spec["repo"] = repo
    if commit:
        spec["commit"] = commit
    if weak_email and weak_pass:
        spec["weak_login"] = {"email": weak_email, "password": weak_pass}
    result = run_engagement.remote(spec)
    print(result["log"])
    if result["stderr"]:
        print(result["stderr"])
    out = ENGINE_DIR / "out" / f"modal-{int(time.time())}"
    out.mkdir(parents=True, exist_ok=True)
    (out / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(f"\n{'✅' if result['ok'] else '❌'} exit {result['exit_code']} · {result['duration_s']} s · {out / 'result.json'}")
