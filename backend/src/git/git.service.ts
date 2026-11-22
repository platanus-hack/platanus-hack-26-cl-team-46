import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Env } from '../config/env.js';
import { GITHUB_URL_HINT, parseGitHubRepoUrl } from './github-url.js';

const exec = promisify(execFile);

/** clone/fetch/push: generoso (repos grandes), pero nunca colgado para siempre. */
const GIT_NETWORK_TIMEOUT_MS = 10 * 60_000;
/** Comandos locales (apply, add, commit, archive…). */
const GIT_LOCAL_TIMEOUT_MS = 3 * 60_000;
const GIT_NETWORK_COMMANDS = new Set(['clone', 'fetch', 'push']);
/** Corta una transferencia que se queda bajo 1 kB/s por 60 s (conexión muerta). */
const GIT_LOW_SPEED_ARGS = [
  '-c',
  'http.lowSpeedLimit=1000',
  '-c',
  'http.lowSpeedTime=60',
];
const GITHUB_API_TIMEOUT_MS = 30_000;

export interface FileChange {
  path: string;
  /** null = borrar el archivo. */
  content: string | null;
}

/**
 * Operaciones git + GitHub para los mirrors de sandboxes.
 *
 * Cada sandbox tiene un repo propio en GITHUB_ORG con un snapshot del repo
 * original. Render despliega desde ese mirror, y los parches del developer
 * se commitean ahí. El repo original nunca se toca.
 */
@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);
  private readonly token?: string;
  readonly org: string;
  private readonly reposDir: string;
  /**
   * Una operación git a la vez por workdir: commitChanges, archive y sourceDir
   * hacen fetch + reset --hard del mismo checkout y se pisarían. Es un lock
   * propio (no runExclusive del sandbox) porque ese se mantiene durante todo
   * un deploy (minutos) y aquí solo hace falta mientras corre git.
   */
  private readonly workdirLocks = new Map<string, Promise<void>>();

  constructor(config: ConfigService<Env, true>) {
    this.token = config.get('GITHUB_TOKEN', { infer: true });
    this.org = config.get('GITHUB_ORG', { infer: true });
    this.reposDir = path.resolve(
      config.get('DATA_DIR', { infer: true }),
      'repos',
    );
  }

  get mirrorsEnabled(): boolean {
    return Boolean(this.token);
  }

  workdir(sandboxId: string): string {
    return path.join(this.reposDir, sandboxId);
  }

  mirrorUrl(repoName: string): string {
    return `https://github.com/${this.org}/${repoName}`;
  }

  /** Clona (shallow) el repo fuente en el workdir del sandbox y devuelve el sha. */
  cloneSource(
    sandboxId: string,
    repoUrl: string,
    ref?: string,
    /** Token del dueño (GitHub App): solo para repos privados que compartió con Mayday. */
    userToken?: string,
  ): Promise<{ dir: string; sha: string }> {
    // El token solo se usa con los repos de nuestra org (p. ej. la app víctima, que es privada).
    // Con cualquier otro repo, usarlo dejaría clonar lo que el token alcance a ver.
    const kind = classifySourceRepo(repoUrl, this.org);
    if (kind === 'mirror') {
      throw new Error(
        `${repoUrl} es el mirror de otro sandbox: no se puede desplegar`,
      );
    }
    // A git se le pasa la URL canónica, nunca la cruda (ya validada arriba).
    const { owner, repo } = parseGitHubRepoUrl(repoUrl)!;
    const cloneUrl = `https://github.com/${owner}/${repo}`;
    return this.withWorkdir(sandboxId, async () => {
      const dir = this.workdir(sandboxId);
      await rm(dir, { recursive: true, force: true });
      await mkdir(this.reposDir, { recursive: true });
      const args = [
        'clone',
        '--depth',
        '1',
        ...(ref ? ['--branch', ref] : []),
        '--',
        cloneUrl,
        dir,
      ];
      try {
        await this.git(args, this.reposDir, {
          auth:
            kind === 'org' ? true : kind === 'external' ? userToken : undefined,
        });
      } catch (err) {
        const msg = (err as Error).message;
        if (ref && /Remote branch .* not found/i.test(msg)) {
          throw new Error(`El repo ${repoUrl} no tiene la rama o tag "${ref}"`);
        }
        if (
          /not found|could not read Username|Authentication failed|terminal prompts disabled/i.test(
            msg,
          )
        ) {
          throw new Error(
            userToken
              ? `No pudimos clonar ${repoUrl}: el repo no existe o no lo compartiste con Mayday en GitHub.`
              : `No pudimos clonar ${repoUrl}: el repo no existe o es privado. Para un repo privado, entra con GitHub y compártelo con Mayday.`,
          );
        }
        throw err;
      }
      const sha = (await this.git(['rev-parse', 'HEAD'], dir)).trim();
      return { dir, sha };
    });
  }

  /**
   * Convierte el clone en un snapshot de un solo commit y lo pushea a un repo
   * nuevo en la org. Devuelve el sha del commit en el mirror.
   */
  async pushSnapshotToMirror(
    sandboxId: string,
    repoName: string,
    source: { url: string; sha: string },
  ): Promise<{ mirrorUrl: string; sha: string; removedWorkflows: boolean }> {
    this.assertToken();
    try {
      await this.github('POST', `/orgs/${this.org}/repos`, {
        name: repoName,
        private: true,
        auto_init: false,
        description: `Sandbox snapshot de ${source.url}@${source.sha.slice(0, 7)}`,
      });
    } catch (err) {
      // Idempotente: si un intento anterior (cortado por un reinicio del backend)
      // ya creó el repo, se reutiliza y el snapshot se sube con force push.
      if (!isRepoAlreadyExists(err)) throw err;
    }

    return this.withWorkdir(sandboxId, async () => {
      const dir = this.workdir(sandboxId);
      await rm(path.join(dir, '.git'), { recursive: true, force: true });
      const removedWorkflows = await stripWorkflows(dir);
      await this.git(['init', '-b', 'main'], dir);
      await this.git(['add', '-A'], dir);
      await this.commit(dir, `Snapshot de ${source.url}@${source.sha}`);
      await this.git(
        ['remote', 'add', 'origin', `${this.mirrorUrl(repoName)}.git`],
        dir,
      );
      await this.git(['push', '--force', '-u', 'origin', 'main'], dir, {
        auth: true,
      });
      const sha = (await this.git(['rev-parse', 'HEAD'], dir)).trim();
      return { mirrorUrl: this.mirrorUrl(repoName), sha, removedWorkflows };
    });
  }

  /** Aplica un diff unificado y/o cambios de archivos al mirror, commitea y pushea. */
  async applyChanges(
    sandboxId: string,
    repoName: string,
    change: { patch?: string; files?: FileChange[]; message: string },
  ): Promise<{ sha: string; changedFiles: string[] }> {
    this.assertToken();
    return this.withWorkdir(sandboxId, async () => {
      const dir = await this.ensureMirrorWorkdir(sandboxId, repoName);

      if (change.patch) {
        const patchFile = path.join(this.reposDir, `${sandboxId}.patch`);
        await writeFile(
          patchFile,
          change.patch.endsWith('\n') ? change.patch : `${change.patch}\n`,
        );
        try {
          await this.git(
            ['apply', '--whitespace=nowarn', '--recount', patchFile],
            dir,
          );
        } finally {
          await unlink(patchFile).catch(() => undefined);
        }
      }
      await writeRepoFiles(dir, change.files ?? []);

      await stripWorkflows(dir);
      await this.git(['add', '-A'], dir);
      const changed = (await this.git(['diff', '--cached', '--name-only'], dir))
        .split('\n')
        .filter(Boolean);
      if (changed.length === 0)
        throw new Error('El cambio no modifica ningún archivo');
      await this.commit(dir, change.message);
      await this.git(['push', 'origin', 'HEAD:main'], dir, { auth: true });
      const sha = (await this.git(['rev-parse', 'HEAD'], dir)).trim();
      return { sha, changedFiles: changed };
    });
  }

  /** tar.gz del HEAD del mirror (sin .git), para que el agente lo descargue. */
  archive(sandboxId: string, repoName: string): Promise<Buffer> {
    return this.withWorkdir(sandboxId, async () => {
      const dir = await this.ensureMirrorWorkdir(sandboxId, repoName);
      try {
        const { stdout } = await exec(
          'git',
          ['archive', '--format=tar.gz', 'HEAD'],
          {
            cwd: dir,
            encoding: 'buffer',
            maxBuffer: 256 * 1024 * 1024,
            timeout: GIT_LOCAL_TIMEOUT_MS,
            killSignal: 'SIGKILL',
          },
        );
        return stdout;
      } catch (err) {
        const e = err as { killed?: boolean; message: string };
        throw new Error(
          e.killed
            ? `git archive superó el tiempo máximo (${GIT_LOCAL_TIMEOUT_MS / 60_000} min)`
            : `git archive falló: ${e.message}`,
        );
      }
    });
  }

  /**
   * Checkout del HEAD actual del mirror, para leer el código desde el backend.
   * El lock cubre el fetch + reset; la lectura posterior la hace quien llama.
   */
  snapshotDir(sandboxId: string, repoName: string): Promise<string> {
    return this.withWorkdir(sandboxId, () =>
      this.ensureMirrorWorkdir(sandboxId, repoName),
    );
  }

  readFileFromWorkdir(
    sandboxId: string,
    relPath: string,
  ): Promise<string | undefined> {
    return this.withWorkdir(sandboxId, async () => {
      const file = path.join(this.workdir(sandboxId), relPath);
      return existsSync(file) ? readFile(file, 'utf8') : undefined;
    });
  }

  async deleteMirror(repoName: string): Promise<void> {
    if (!this.token) return;
    try {
      await this.github('DELETE', `/repos/${this.org}/${repoName}`);
    } catch (err) {
      // El token puede no tener permiso de borrado; no es crítico.
      this.logger.warn(
        `No se pudo borrar el mirror ${repoName}: ${(err as Error).message}`,
      );
    }
  }

  /** Espera a que termine lo que esté corriendo en el workdir antes de borrarlo. */
  removeWorkdir(sandboxId: string): Promise<void> {
    return this.withWorkdir(sandboxId, () =>
      rm(this.workdir(sandboxId), { recursive: true, force: true }),
    );
  }

  // -------------------------------------------------------------- privados

  /** Encola `fn` detrás de las otras operaciones git del mismo workdir. */
  private withWorkdir<T>(sandboxId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.workdirLocks.get(sandboxId) ?? Promise.resolve();
    const run = prev.then(fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.workdirLocks.set(sandboxId, tail);
    void tail.then(() => {
      if (this.workdirLocks.get(sandboxId) === tail)
        this.workdirLocks.delete(sandboxId);
    });
    return run;
  }

  /**
   * Si el workdir se perdió (reinicio, otra máquina), vuelve a clonar el mirror.
   * Solo se llama con el lock del workdir tomado (withWorkdir).
   */
  private async ensureMirrorWorkdir(
    sandboxId: string,
    repoName: string,
  ): Promise<string> {
    const dir = this.workdir(sandboxId);
    if (existsSync(path.join(dir, '.git'))) {
      await this.git(['fetch', 'origin', 'main'], dir, { auth: true });
      await this.git(['reset', '--hard', 'origin/main'], dir);
      return dir;
    }
    await rm(dir, { recursive: true, force: true });
    await mkdir(this.reposDir, { recursive: true });
    await this.git(
      ['clone', `${this.mirrorUrl(repoName)}.git`, dir],
      this.reposDir,
      { auth: true },
    );
    return dir;
  }

  private commit(dir: string, message: string) {
    return this.git(
      [
        '-c',
        'user.name=hack26-deployer',
        '-c',
        'user.email=deployer@hack26.local',
        'commit',
        '-m',
        message,
      ],
      dir,
    );
  }

  private assertToken(): void {
    if (!this.token)
      throw new Error(
        'GITHUB_TOKEN no configurado: los mirrors están deshabilitados',
      );
  }

  private async git(
    args: string[],
    cwd: string,
    /** true = token de la org; string = token del usuario (repo privado propio). */
    opts: { auth?: boolean | string } = {},
  ): Promise<string> {
    // El token va como header HTTP de una sola invocación: nunca queda escrito en .git/config.
    const token =
      typeof opts.auth === 'string'
        ? opts.auth
        : opts.auth
          ? this.token
          : undefined;
    const authArgs = token
      ? [
          '-c',
          `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(
            `x-access-token:${token}`,
          ).toString('base64')}`,
        ]
      : [];
    const sub = gitSubcommand(args);
    const network = GIT_NETWORK_COMMANDS.has(sub);
    const timeout = network ? GIT_NETWORK_TIMEOUT_MS : GIT_LOCAL_TIMEOUT_MS;
    try {
      const { stdout } = await exec(
        'git',
        [...authArgs, ...(network ? GIT_LOW_SPEED_ARGS : []), ...args],
        {
          cwd,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          maxBuffer: 32 * 1024 * 1024,
          timeout,
          killSignal: 'SIGKILL',
        },
      );
      return stdout;
    } catch (err) {
      const e = err as { stderr?: string; message: string; killed?: boolean };
      if (e.killed)
        throw new Error(
          `git ${sub} superó el tiempo máximo (${timeout / 60_000} min)`,
        );
      const stderr = (e.stderr ?? e.message)
        .replaceAll(this.token ?? '\0', '***')
        .replaceAll(token ?? '\0', '***');
      throw new Error(`git ${sub} falló: ${stderr.trim()}`);
    }
  }

  private async github(
    method: string,
    apiPath: string,
    body?: unknown,
  ): Promise<unknown> {
    const res = await fetch(`https://api.github.com${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok)
      throw new Error(`GitHub ${method} ${apiPath} → ${res.status}: ${text}`);
    return text ? JSON.parse(text) : undefined;
  }
}

/**
 * Saca los workflows de GitHub Actions del mirror. Render no los usa, pushearlos
 * exige el scope `workflow` en el token, y no queremos que el CI del usuario
 * corra en nuestra org (con nuestros minutos y nuestros secretos).
 */
export async function stripWorkflows(dir: string): Promise<boolean> {
  // Un .github que es symlink (p. ej. creado por un parche) apuntaría fuera del repo: no se sigue.
  if (await isSymlink(path.join(dir, '.github'))) return false;
  const workflows = path.join(dir, '.github', 'workflows');
  if (!existsSync(workflows) && !(await isSymlink(workflows))) return false;
  // rm no sigue un symlink final: borra el enlace, no su destino.
  await rm(workflows, { recursive: true, force: true });
  return true;
}

/**
 * Escribe o borra archivos del repo. Rechaza rutas que salen del repo y rutas
 * que pasan por un symlink: un parche puede crear `x -> /etc` y después
 * `x/passwd` escribiría fuera. Se revisa cada componente con lstat.
 */
export async function writeRepoFiles(
  dir: string,
  files: FileChange[],
): Promise<void> {
  for (const f of files) {
    const target = path.resolve(dir, f.path);
    if (!target.startsWith(dir + path.sep))
      throw new Error(`Ruta fuera del repo: ${f.path}`);
    const parts = path.relative(dir, target).split(path.sep);
    let current = dir;
    for (const [i, part] of parts.entries()) {
      current = path.join(current, part);
      const last = i === parts.length - 1;
      // Borrar un symlink final es seguro (rm borra el enlace); escribir en él, no.
      if (last && f.content === null) break;
      if (await isSymlink(current))
        throw new Error(`Ruta con enlace simbólico: ${f.path}`);
    }
    if (f.content === null) {
      await rm(target, { force: true });
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, f.content);
    }
  }
}

/** true si `p` existe y es un symlink (no lo sigue). */
async function isSymlink(p: string): Promise<boolean> {
  try {
    return (await lstat(p)).isSymbolicLink();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/** Subcomando de git saltando los `-c clave=valor` del principio. */
function gitSubcommand(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c') {
      i++;
      continue;
    }
    return args[i];
  }
  return '';
}

/**
 * Qué es un repo fuente respecto a nuestra org de GitHub:
 * - `mirror`: el mirror de un sandbox (`<org>/sbx-xxxxxxxx`); nunca se despliega como fuente.
 * - `org`: otro repo de la org (app víctima, demos); se clona con el token.
 * - `external`: cualquier otro; se clona sin credenciales.
 *
 * Solo acepta `https://github.com/dueño/repo` exacta (400 si no): clasificar
 * una URL cruda dejaba pasar `%73bx-…` como repo de la org y clonarlo con el token.
 */
export function classifySourceRepo(
  repoUrl: string,
  org: string,
): 'mirror' | 'org' | 'external' {
  const parsed = parseGitHubRepoUrl(repoUrl);
  if (!parsed) throw new BadRequestException(GITHUB_URL_HINT);
  if (parsed.owner.toLowerCase() !== org.toLowerCase()) return 'external';
  return /^sbx-[0-9a-f]{8}(-\d+)?$/i.test(parsed.repo) ? 'mirror' : 'org';
}

/** GitHub responde 422 "name already exists on this account" al crear un repo repetido. */
export function isRepoAlreadyExists(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('→ 422') && /already exists/i.test(msg);
}
