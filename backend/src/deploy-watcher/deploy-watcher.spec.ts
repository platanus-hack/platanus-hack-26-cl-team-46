import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DeployWatcher, remoteHead } from './deploy-watcher.js';

/** Un repo git de verdad (local) con un commit en main. */
function repo(): { dir: string; sha: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'watch-'));
  const git = (...a: string[]) =>
    execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'a.txt'), 'hola');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'uno');
  return { dir, sha: git('rev-parse', 'HEAD') };
}

function watcher(
  repoUrl: string | undefined,
  latest: Record<string, string | undefined>,
) {
  const config = {
    get: (k: string) =>
      ({
        SELF_DEPLOY_REPO_URL: repoUrl,
        SELF_DEPLOY_BRANCH: 'main',
        SELF_DEPLOY_SERVICE_IDS: ['srv-back', 'srv-front'],
        SELF_DEPLOY_INTERVAL_SECONDS: 60,
      })[k],
  };
  const render = {
    latestDeploy: vi.fn(async (id: string) =>
      latest[id] ? { commit: { id: latest[id] } } : undefined,
    ),
    triggerDeploy: vi.fn(async () => ({ id: 'dep-1' })),
  };
  return { w: new DeployWatcher(config as never, render as never), render };
}

describe('deploy automático desde el repo de la organización', () => {
  it('lee la punta de la rama con git ls-remote', async () => {
    const { dir, sha } = repo();
    expect(await remoteHead(dir, 'main')).toBe(sha);
    expect(await remoteHead(dir, 'no-existe')).toBeUndefined();
  });

  it('despliega el commit nuevo solo en los servicios que no lo tienen', async () => {
    const { dir, sha } = repo();
    const { w, render } = watcher(dir, {
      'srv-back': sha,
      'srv-front': 'viejo',
    });
    expect(await w.check()).toEqual(['srv-front']);
    expect(render.triggerDeploy).toHaveBeenCalledWith('srv-front', {
      commitId: sha,
    });
  });

  it('si todo está al día no hace nada', async () => {
    const { dir, sha } = repo();
    const { w, render } = watcher(dir, { 'srv-back': sha, 'srv-front': sha });
    expect(await w.check()).toEqual([]);
    expect(render.triggerDeploy).not.toHaveBeenCalled();
  });

  it('sin repo configurado está apagado', async () => {
    const { w, render } = watcher(undefined, {});
    expect(w.enabled).toBe(false);
    expect(await w.check()).toEqual([]);
    expect(render.latestDeploy).not.toHaveBeenCalled();
  });
});
