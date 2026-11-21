import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectTools } from './tools-detector.js';

let root: string;

async function repo(files: Record<string, string>) {
  root = await mkdtemp(path.join(tmpdir(), 'tools-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

afterEach(() => rm(root, { recursive: true, force: true }));

describe('detectTools', () => {
  it('detecta los SDKs declarados en package.json', async () => {
    const dir = await repo({
      'package.json': JSON.stringify({
        dependencies: {
          express: '^5',
          '@sentry/node': '^11',
          'posthog-node': '^6',
        },
      }),
    });
    expect(await detectTools(dir)).toEqual(['sentry', 'posthog']);
  });

  it('no cuenta menciones fuera de las dependencias', async () => {
    const dir = await repo({
      'package.json': JSON.stringify({
        description: 'sin sentry ni datadog todavía',
        dependencies: { express: '^5' },
      }),
      'README.md': 'TODO: agregar Sentry.init()',
    });
    expect(await detectTools(dir)).toEqual([]);
  });

  it('detecta la inicialización en el código y en otros ecosistemas', async () => {
    const dir = await repo({
      'requirements.txt': 'flask\nsentry-sdk[flask]==2.0\n',
      'app/tracing.js': "require('dd-trace').init()",
      'src/alerts.py':
        'requests.post("https://hooks.slack.com/services/T0/B0/x")',
      '.github/dependabot.yml': 'version: 2',
    });
    expect(await detectTools(dir)).toEqual([
      'sentry',
      'datadog',
      'slack',
      'github',
    ]);
  });

  it('ignora node_modules y tests', async () => {
    const dir = await repo({
      'node_modules/x/index.js': 'Sentry.init({})',
      'src/app.test.ts': 'posthog.init("k")',
      'src/app.ts': 'export {}',
    });
    expect(await detectTools(dir)).toEqual([]);
  });
});
