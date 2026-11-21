#!/usr/bin/env node
// CLI de los threads de una simulación. La sirve el backend en GET /sim/cli.mjs?role=<rol>
// (el rol queda fijo en el archivo). Usa SIM_URL, SIM_TOKEN y SIM_ID (variables del workspace).
// Sin dependencias: Node 18+, git y tar.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROLE = '__SIM_ROLE__';
const { SIM_URL, SIM_TOKEN, SIM_ID } = process.env;
if (!SIM_URL || !SIM_TOKEN || !SIM_ID) fail('Faltan variables de entorno: SIM_URL, SIM_TOKEN y SIM_ID');
const MAX_CALL_MS = 9 * 60_000;
const base = `${SIM_URL.replace(/\/+$/, '')}/sim/${SIM_ID}`;

const HELP = `
sim (rol: ${ROLE}) <comando>

Todos:
  context                         Simulación, app desplegada, contexto, canales, estado del incidente, plan
  timeline [--since N] [--types a.*,b] [--limit N]   Eventos del timeline
  inbox                           Eventos nuevos para tu rol desde la última entrega
  post <tipo> "<título>" ["cuerpo"] [--severity s] [--vuln id] [--data '<json>' | --data-file f]
  source <dir>                    Descarga el código actual del sandbox (con git local)
  logs [app|build] [n]            Logs reales del servicio en Render
  deploy-wait                     Espera a que el sandbox termine de desplegar

coder / infra:
  push "<mensaje>"                Commit de los cambios del directorio actual + redeploy
  env set K=V [K2=V2…] | env generate K [K2…] | env unset K [K2…]   (redespliega)
  restart                         Reinicia el servicio
  db "<SQL>"                      Ejecuta SQL contra la base de la app

Atajos por rol:
  reply "<texto>"                                   coder: responde al developer
  notify <canal> "<título>" "<cuerpo>" [--from "Nombre <email>"] [--severity s] [--vuln id] [--data json]   generator
  state <state.json>                                observer: publica el estado del incidente
  control next|verify|pause|resume [vuln_id] ["motivo"]   observer
  finish <debrief.json>                             observer: cierra la simulación
  set-context <contexto.json>                       infra: publica el paquete de contexto
`;

const argv = process.argv.slice(2);
const [cmd, ...rest] = argv;
const { pos, flags } = parseArgs(rest);

try {
  switch (cmd) {
    case 'context':
      print(await api('GET', ''));
      break;
    case 'timeline': {
      const q = new URLSearchParams();
      if (flags.since) q.set('since', flags.since);
      if (flags.types) q.set('types', flags.types);
      q.set('limit', flags.limit ?? '60');
      printEvents((await api('GET', `/timeline?${q}`)).events);
      break;
    }
    case 'inbox':
      printEvents((await api('GET', '/inbox')).events);
      break;
    case 'post': {
      const [type, title, body] = pos;
      if (!type || !title) fail('Uso: sim post <tipo> "<título>" ["cuerpo"] [--severity s] [--vuln id] [--data json]');
      print(await postEvent(type, title, body, data()));
      break;
    }
    case 'source':
      await source(pos[0] ?? `/tmp/${SIM_ID}/${ROLE}/src`);
      break;
    case 'logs':
      process.stdout.write(await api('GET', `/logs?type=${pos[0] ?? 'app'}&limit=${pos[1] ?? 150}`, undefined, 'text'));
      break;
    case 'deploy-wait':
      await deployWait();
      break;
    case 'push':
      await push(pos[0]);
      break;
    case 'env':
      await env(pos);
      break;
    case 'restart':
      print(await api('POST', '/restart', {}));
      break;
    case 'db':
      if (!pos[0]) fail('Uso: sim db "<SQL>"');
      print(await api('POST', '/db', { sql: pos[0] }));
      break;
    case 'reply':
      if (!pos[0]) fail('Uso: sim reply "<texto>"');
      print(await postEvent('coder.reply', firstLine(pos[0]), pos[0], data()));
      break;
    case 'notify': {
      const [channel, title, body] = pos;
      if (!channel || !title) fail('Uso: sim notify <canal> "<título>" "<cuerpo>" [--from "Nombre <email>"]');
      print(await postEvent('notify', title, body, { ...data(), channel, ...(flags.from ? { from: flags.from } : {}) }));
      break;
    }
    case 'state': {
      if (!pos[0]) fail('Uso: sim state <state.json>');
      const st = JSON.parse(readFileSync(pos[0], 'utf8'));
      print(await postEvent('state.update', st.summary ? firstLine(st.summary) : 'Estado del incidente', '', st));
      break;
    }
    case 'control': {
      const [action, vuln, reason] = pos;
      if (!['next', 'verify', 'pause', 'resume'].includes(action)) fail('Uso: sim control next|verify|pause|resume [vuln_id] ["motivo"]');
      if (action === 'verify' && !vuln) fail('control verify necesita vuln_id');
      flags.vuln ??= vuln;
      print(await postEvent(`control.${action}`, `${action}${vuln ? ` ${vuln}` : ''}`, reason ?? '', vuln ? { vuln_id: vuln } : {}));
      break;
    }
    case 'finish': {
      if (!pos[0]) fail('Uso: sim finish <debrief.json>');
      const debrief = JSON.parse(readFileSync(pos[0], 'utf8'));
      print(await postEvent('sim.finished', 'Simulación terminada', debrief.summary ?? '', debrief));
      break;
    }
    case 'set-context': {
      if (!pos[0]) fail('Uso: sim set-context <contexto.json>');
      const ctx = JSON.parse(readFileSync(pos[0], 'utf8'));
      print(await postEvent('context.ready', 'Contexto del repo listo', ctx.summary ?? '', ctx));
      break;
    }
    case 'help':
    case undefined:
      console.log(HELP);
      break;
    default:
      console.log(HELP);
      process.exit(1);
  }
} catch (err) {
  fail(err.message);
}

// ------------------------------------------------------------------ comandos

function data() {
  if (flags['data-file']) return JSON.parse(readFileSync(flags['data-file'], 'utf8'));
  if (flags.data) return JSON.parse(flags.data);
  return {};
}

function postEvent(type, title, body, raw) {
  return api('POST', '/events', {
    type,
    title: String(title).slice(0, 200),
    body: body ?? '',
    severity: flags.severity,
    vuln_id: flags.vuln,
    raw,
  });
}

async function source(dir) {
  mkdirSync(dir, { recursive: true });
  const res = await fetch(`${base}/source.tar.gz`, { headers: headers() });
  if (!res.ok) throw new Error(`source → ${res.status}: ${await res.text()}`);
  const tgz = path.join(tmpdir(), `${SIM_ID}-${ROLE}.tgz`);
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['xzf', tgz, '-C', dir]);
  if (!existsSync(path.join(dir, '.git'))) {
    git(dir, 'init', '-q', '-b', 'main');
  }
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=sim', '-c', 'user.email=sim@local', 'commit', '-qm', 'snapshot del sandbox', '--allow-empty');
  console.log(`Código en ${dir} (git local con un commit "snapshot"; edita y usa "sim push" desde ahí)`);
}

async function push(message) {
  if (!message) fail('Uso: sim push "<mensaje>" (desde el directorio del código)');
  const dir = process.cwd();
  git(dir, 'add', '-A');
  const patch = git(dir, 'diff', '--cached', '--binary', 'HEAD');
  if (!patch.trim()) fail('No hay cambios para subir');
  const res = await api('POST', '/changes', { patch, message });
  git(dir, '-c', 'user.name=sim', '-c', 'user.email=sim@local', 'commit', '-qm', message);
  print(res);
  console.log('Redeploy en curso. El resultado llega como change.deployed / change.deploy_failed.');
}

async function env(args) {
  const [op, ...items] = args;
  if (!['set', 'generate', 'unset'].includes(op) || !items.length) {
    fail('Uso: sim env set K=V [K2=V2] | sim env generate K | sim env unset K');
  }
  const body = {};
  if (op === 'set') {
    body.env = Object.fromEntries(
      items.map((kv) => {
        const i = kv.indexOf('=');
        if (i <= 0) fail(`Formato inválido: ${kv} (usa K=V)`);
        return [kv.slice(0, i), kv.slice(i + 1)];
      }),
    );
  } else body[op] = items;
  print(await api('POST', '/env', body));
}

async function deployWait() {
  const started = Date.now();
  for (;;) {
    const d = await api('GET', '/deploy?wait=45');
    if (!['deploying', 'provisioning', 'analyzing', 'needs_input'].includes(d.status)) {
      print(d);
      return;
    }
    if (Date.now() - started > MAX_CALL_MS) {
      console.log(`El sandbox sigue en ${d.status}. Vuelve a ejecutar "sim deploy-wait".`);
      return;
    }
    process.stderr.write(`… ${d.status}\n`);
  }
}

// ------------------------------------------------------------------ helpers

function printEvents(events) {
  if (!events.length) return console.log('(sin eventos)');
  for (const e of events) {
    const head = `#${e.seq} ${e.t.slice(11, 19)} ${e.actor} ${e.type}${e.vuln_id ? ` [${e.vuln_id}]` : ''} ${e.severity !== 'info' ? `(${e.severity}) ` : ''}— ${e.title}`;
    console.log(head);
    if (e.body) console.log(indent(e.body));
    if (e.raw && Object.keys(e.raw).length) console.log(indent(`raw: ${JSON.stringify(e.raw)}`));
  }
}

function indent(s) {
  return String(s)
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}

function firstLine(s) {
  const l = String(s).split('\n').find((x) => x.trim()) ?? String(s);
  return l.replace(/^#+\s*/, '').slice(0, 100);
}

function parseArgs(args) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = args[i + 1];
      if (v === undefined || v.startsWith('--')) flags[k] = 'true';
      else {
        flags[k] = v;
        i++;
      }
    } else pos.push(a);
  }
  return { pos, flags };
}

async function api(method, p, body, as = 'json') {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { ...headers(), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p || '/'} → ${res.status}: ${text}`);
  return as === 'text' ? text : text ? JSON.parse(text) : {};
}

function headers() {
  return { authorization: `Bearer ${SIM_TOKEN}`, 'x-sim-role': ROLE };
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
