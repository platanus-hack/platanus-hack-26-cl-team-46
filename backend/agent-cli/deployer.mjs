#!/usr/bin/env node
// CLI del agente de deploy. La sirve el backend en GET /agent/cli.mjs.
// Usa DEPLOYER_URL, DEPLOYER_TOKEN y SANDBOX_ID (variables del workspace).
// Sin dependencias: Node 18+, git y tar.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { DEPLOYER_URL, DEPLOYER_TOKEN, SANDBOX_ID } = process.env;
if (!DEPLOYER_URL || !DEPLOYER_TOKEN || !SANDBOX_ID) {
  fail('Faltan variables de entorno: DEPLOYER_URL, DEPLOYER_TOKEN y SANDBOX_ID');
}
// Las herramientas del agente cortan comandos largos (~10 min): cada llamada espera como máximo esto.
const MAX_CALL_MS = 9 * 60_000;
const base = `${DEPLOYER_URL.replace(/\/+$/, '')}/agent/sandboxes/${SANDBOX_ID}`;
// Render free devuelve 502/503/504 mientras el backend despierta o se redespliega.
const TRANSIENT = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000];
// Reintentar es seguro en lecturas y en escrituras idempotentes. /changes, /plan y /report no se
// reintentan solos: si el backend alcanzó a aplicarlos, repetirlos duplicaría el parche o gastaría un plan.
const SAFE_POSTS = new Set(['/notes', '/users', '/input-request']);

const HELP = `
deployer <comando>

  context                         Estado del sandbox, último error, intentos restantes
  source <dir>                    Descarga el código del mirror en <dir> (con git local para diffs)
  push "<mensaje>"                Sube los cambios del directorio actual al mirror (commit)
  plan <manifest.json> ["nota"]   Despliega con ese manifest (crea o actualiza el servicio)
  wait                            Espera a que termine el deploy en curso y muestra el resultado
  logs [build|app] [n]            Últimas n líneas de logs del deploy actual (default: build 150)
  db                              Tablas y filas de la base del sandbox (verifica migraciones/seed)
  users <usuarios.json>           Registra usuarios de prueba: [{"email","password","role"}]
  note "<título>" ["detalle"]     Publica una nota en el timeline que ve el usuario
  ask KEY "descripción" [...]     Pide variables secretas al usuario y espera a que las entregue
  report deployed|gave_up "<resumen>"   Termina el trabajo (OBLIGATORIO al final)
`;

const [cmd, ...args] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'context':
      print(await api('GET', ''));
      break;
    case 'source':
      await source(args[0] ?? `/tmp/${SANDBOX_ID}`);
      break;
    case 'push':
      await push(args[0]);
      break;
    case 'plan':
      await plan(args[0], args[1]);
      break;
    case 'wait':
      await waitDeploy();
      break;
    case 'logs':
      process.stdout.write(await api('GET', `/logs?type=${args[0] ?? 'build'}&limit=${args[1] ?? 150}`, undefined, 'text'));
      break;
    case 'db':
      print(await api('GET', '/db'));
      break;
    case 'users':
      if (!args[0]) fail('Uso: deployer users <usuarios.json>');
      print(await api('POST', '/users', JSON.parse(readFileSync(args[0], 'utf8'))));
      break;
    case 'note':
      if (!args[0]) fail('Uso: deployer note "<título>" ["detalle"]');
      await api('POST', '/notes', { title: args[0], body: args[1] ?? '' });
      console.log('ok');
      break;
    case 'ask':
      await ask(args);
      break;
    case 'report':
      if (!['deployed', 'gave_up'].includes(args[0]) || !args[1]) fail('Uso: deployer report deployed|gave_up "<resumen>"');
      print(await api('POST', '/report', { outcome: args[0], summary: args[1] }));
      break;
    default:
      console.log(HELP);
      process.exit(cmd ? 1 : 0);
  }
} catch (err) {
  fail(err.message);
}

async function source(dir) {
  mkdirSync(dir, { recursive: true });
  const res = await api('GET', '/source.tar.gz', undefined, 'raw');
  const tgz = path.join(tmpdir(), `${SANDBOX_ID}.tgz`);
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['xzf', tgz, '-C', dir]);
  if (!existsSync(path.join(dir, '.git'))) {
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=agent', '-c', 'user.email=agent@local', 'commit', '-qm', 'base', '--allow-empty');
  }
  console.log(`Código en ${dir} (commit base local creado; edita y usa "deployer push" desde ahí)`);
}

async function push(message) {
  if (!message) fail('Uso: deployer push "<mensaje>" (desde el directorio del código)');
  const dir = process.cwd();
  git(dir, 'add', '-A');
  const patch = git(dir, 'diff', '--cached', '--binary', 'HEAD');
  if (!patch.trim()) fail('No hay cambios para subir');
  const res = await api('POST', '/changes', { patch, message });
  git(dir, '-c', 'user.name=agent', '-c', 'user.email=agent@local', 'commit', '-qm', message);
  print(res);
}

async function plan(file, note) {
  if (!file) fail('Uso: deployer plan <manifest.json> ["nota"]');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  print(await api('POST', '/plan', { manifest, note }));
  console.log('Deploy en curso. Usa "deployer wait".');
}

async function waitDeploy() {
  const started = Date.now();
  for (;;) {
    const ctx = await api('GET', '?wait=45');
    if (!['deploying', 'provisioning'].includes(ctx.status)) {
      print({
        status: ctx.status,
        deployed_url: ctx.deployed_url,
        last_deploy: ctx.current_deploy,
        last_error: ctx.last_error,
        healthcheck: ctx.healthcheck,
        plans_left: ctx.plans_left,
      });
      return;
    }
    if (Date.now() - started > MAX_CALL_MS) {
      console.log(`El deploy sigue en curso (${ctx.current_deploy?.status ?? ctx.status}). Vuelve a ejecutar "deployer wait".`);
      return;
    }
    process.stderr.write(`… ${ctx.current_deploy?.status ?? ctx.status}\n`);
  }
}

async function ask(pairs) {
  if (pairs.length < 2 || pairs.length % 2) fail('Uso: deployer ask KEY "descripción" [KEY2 "descripción2" ...]');
  const variables = [];
  for (let i = 0; i < pairs.length; i += 2) variables.push({ key: pairs[i], description: pairs[i + 1] });
  await api('POST', '/input-request', { variables });
  console.error('Esperando a que el usuario entregue los valores…');
  const started = Date.now();
  for (;;) {
    const ctx = await api('GET', '');
    const pending = (ctx.pending_inputs ?? []).map((v) => v.key);
    if (variables.every((v) => !pending.includes(v.key))) {
      console.log(`Entregadas: ${variables.map((v) => v.key).join(', ')}. Ya quedan en el env del servicio en el próximo plan.`);
      return;
    }
    if (Date.now() - started > MAX_CALL_MS) {
      console.log('El usuario todavía no entrega los valores. Vuelve a ejecutar el mismo "deployer ask" para seguir esperando.');
      return;
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

async function api(method, p, body, as = 'json') {
  const retryable = method === 'GET' || SAFE_POSTS.has(p);
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${base}${p}`, {
        method,
        headers: { ...auth(), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        // Sin límite, un fetch colgado deja al agente esperando hasta que su herramienta lo mata.
        signal: AbortSignal.timeout(p.endsWith('.tar.gz') ? 5 * 60_000 : 2 * 60_000),
      });
    } catch (err) {
      if (retryable && attempt < RETRY_DELAYS_MS.length) {
        await retryAfter(attempt, `${method} ${p || '/'}: ${err.message}`);
        continue;
      }
      throw new Error(`${method} ${p || '/'} → sin respuesta del backend (${err.message}).${retryable ? '' : ' Puede que se haya aplicado igual: revisa "deployer context" antes de repetirlo.'}`);
    }
    if (TRANSIENT.has(res.status) && retryable && attempt < RETRY_DELAYS_MS.length) {
      await retryAfter(attempt, `${method} ${p || '/'} → ${res.status}`);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      const hint = TRANSIENT.has(res.status) && !retryable ? ' (error transitorio del backend: revisa "deployer context" antes de repetirlo)' : '';
      throw new Error(`${method} ${p || '/'} → ${res.status}: ${text}${hint}`);
    }
    if (as === 'raw') return res;
    const text = await res.text();
    return as === 'text' ? text : text ? JSON.parse(text) : {};
  }
}

async function retryAfter(attempt, why) {
  const ms = RETRY_DELAYS_MS[attempt];
  process.stderr.write(`${why}; reintentando en ${ms / 1000} s…\n`);
  await new Promise((r) => setTimeout(r, ms));
}

function auth() {
  return { authorization: `Bearer ${DEPLOYER_TOKEN}` };
}

function git(dir, ...a) {
  return execFileSync('git', a, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function print(x) {
  console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}
