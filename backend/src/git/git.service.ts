import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Env } from '../config/env.js';

const exec = promisify(execFile);

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
  async cloneSource(
    sandboxId: string,
    repoUrl: string,
    ref?: string,
  ): Promise<{ dir: string; sha: string }> {
    const dir = this.workdir(sandboxId);
    await rm(dir, { recursive: true, force: true });
    await mkdir(this.reposDir, { recursive: true });
    const args = [
      'clone',
      '--depth',
      '1',
      ...(ref ? ['--branch', ref] : []),
      repoUrl,
      dir,
    ];
    // Con token, también se pueden clonar repos privados a los que el token tenga acceso.
    await this.git(args, this.reposDir, {
      auth: repoUrl.startsWith('https://github.com/'),
    });
    const sha = (await this.git(['rev-parse', 'HEAD'], dir)).trim();
    return { dir, sha };
  }

  /**
   * Convierte el clone en un snapshot de un solo commit y lo pushea a un repo
   * nuevo en la org. Devuelve el sha del commit en el mirror.
   */
  async pushSnapshotToMirror(
    sandboxId: string,
    repoName: string,
    source: { url: string; sha: string },
  ): Promise<{ mirrorUrl: string; sha: string }> {
    this.assertToken();
    const dir = this.workdir(sandboxId);
    await this.github('POST', `/orgs/${this.org}/repos`, {
      name: repoName,
      private: true,
      auto_init: false,
      description: `Sandbox snapshot de ${source.url}@${source.sha.slice(0, 7)}`,
    });

    await rm(path.join(dir, '.git'), { recursive: true, force: true });
    await this.git(['init', '-b', 'main'], dir);
    await this.git(['add', '-A'], dir);
    await this.commit(dir, `Snapshot de ${source.url}@${source.sha}`);
    await this.git(
      ['remote', 'add', 'origin', `${this.mirrorUrl(repoName)}.git`],
      dir,
    );
    await this.git(['push', '-u', 'origin', 'main'], dir, { auth: true });
    const sha = (await this.git(['rev-parse', 'HEAD'], dir)).trim();
    return { mirrorUrl: this.mirrorUrl(repoName), sha };
  }

  /** Aplica un diff unificado y/o cambios de archivos al mirror, commitea y pushea. */
  async applyChanges(
    sandboxId: string,
    repoName: string,
    change: { patch?: string; files?: FileChange[]; message: string },
  ): Promise<{ sha: string; changedFiles: string[] }> {
    this.assertToken();
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
    for (const f of change.files ?? []) {
      const target = path.resolve(dir, f.path);
      if (!target.startsWith(dir + path.sep))
        throw new Error(`Ruta fuera del repo: ${f.path}`);
      if (f.content === null) {
        await rm(target, { force: true });
      } else {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, f.content);
      }
    }

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
  }

  /** tar.gz del HEAD del mirror (sin .git), para que el agente lo descargue. */
  async archive(sandboxId: string, repoName: string): Promise<Buffer> {
    const dir = await this.ensureMirrorWorkdir(sandboxId, repoName);
    const { stdout } = await exec(
      'git',
      ['archive', '--format=tar.gz', 'HEAD'],
      {
        cwd: dir,
        encoding: 'buffer',
        maxBuffer: 256 * 1024 * 1024,
      },
    );
    return stdout;
  }

  async readFileFromWorkdir(
    sandboxId: string,
    relPath: string,
  ): Promise<string | undefined> {
    const file = path.join(this.workdir(sandboxId), relPath);
    return existsSync(file) ? readFile(file, 'utf8') : undefined;
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

  async removeWorkdir(sandboxId: string): Promise<void> {
    await rm(this.workdir(sandboxId), { recursive: true, force: true });
  }

  // -------------------------------------------------------------- privados

  /** Si el workdir se perdió (reinicio, otra máquina), vuelve a clonar el mirror. */
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
    opts: { auth?: boolean } = {},
  ): Promise<string> {
    // El token va como header HTTP de una sola invocación: nunca queda escrito en .git/config.
    const authArgs =
      opts.auth && this.token
        ? [
            '-c',
            `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(
              `x-access-token:${this.token}`,
            ).toString('base64')}`,
          ]
        : [];
    try {
      const { stdout } = await exec('git', [...authArgs, ...args], {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: 32 * 1024 * 1024,
      });
      return stdout;
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      const stderr = (e.stderr ?? e.message).replaceAll(
        this.token ?? '\0',
        '***',
      );
      throw new Error(`git ${args[0]} falló: ${stderr.trim()}`);
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
    });
    const text = await res.text();
    if (!res.ok)
      throw new Error(`GitHub ${method} ${apiPath} → ${res.status}: ${text}`);
    return text ? JSON.parse(text) : undefined;
  }
}
