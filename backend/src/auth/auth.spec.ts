import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeNext } from './auth.controller.js';
import {
  authConfigProblem,
  AuthService,
  isProductionEnv,
} from './auth.service.js';
import { rejectForeignOrigins } from './origin-check.js';
import {
  decryptToken,
  encryptToken,
  readCookie,
  serializeCookie,
  signSession,
  verifySession,
} from './session.js';

const SECRET = 'x'.repeat(32);

describe('sesión firmada', () => {
  const data = { uid: 42, login: 'duena', exp: Date.now() + 60_000 };

  it('verifica una cookie propia', () => {
    expect(verifySession(SECRET, signSession(SECRET, data))).toEqual(data);
  });

  it('rechaza una cookie alterada o firmada con otro secreto', () => {
    const token = signSession(SECRET, data);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...data, uid: 1 })).toString(
      'base64url',
    );
    expect(verifySession(SECRET, `${forged}.${sig}`)).toBeNull();
    expect(verifySession('y'.repeat(32), token)).toBeNull();
    expect(verifySession(SECRET, `${payload}.`)).toBeNull();
    expect(verifySession(SECRET, 'basura')).toBeNull();
  });

  it('rechaza una sesión vencida', () => {
    expect(
      verifySession(
        SECRET,
        signSession(SECRET, { ...data, exp: Date.now() - 1 }),
      ),
    ).toBeNull();
  });
});

describe('cookies', () => {
  it('lee una cookie entre varias', () => {
    expect(
      readCookie('a=1; mayday_session=abc.def; b=2', 'mayday_session'),
    ).toBe('abc.def');
    expect(readCookie('a=1', 'mayday_session')).toBeUndefined();
  });

  it('es host-only (sin Domain), httpOnly y SameSite=Lax', () => {
    const c = serializeCookie('__Host-mayday_session', 'v', {
      maxAgeMs: 1000,
      secure: true,
    });
    expect(c).not.toMatch(/Domain=/i);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Lax/);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/Path=\//);
  });
});

describe('tokens de GitHub cifrados', () => {
  it('se descifran solo con el mismo secreto', () => {
    const sealed = encryptToken(SECRET, 'ghu_secreto');
    expect(sealed).not.toContain('ghu_secreto');
    expect(decryptToken(SECRET, sealed)).toBe('ghu_secreto');
    expect(decryptToken('y'.repeat(32), sealed)).toBeNull();
  });
});

describe('safeNext (sin redirecciones abiertas)', () => {
  it('acepta rutas internas', () => {
    expect(safeNext('/deploy?sandbox=sbx-1')).toBe('/deploy?sandbox=sbx-1');
  });
  it('rechaza URLs externas o protocol-relative', () => {
    for (const bad of [
      'https://evil.com',
      '//evil.com',
      '/\\evil.com',
      'evil',
      undefined,
    ])
      expect(safeNext(bad)).toBe('/start/repos');
  });
});

describe('rejectForeignOrigins (CSRF desde el preview)', () => {
  const run = (method: string, url: string, origin?: string) => {
    const mw = rejectForeignOrigins(['https://mayday.rip']);
    const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    mw(
      { method, url, headers: origin ? { origin } : {} } as IncomingMessage,
      res as unknown as ServerResponse,
      next,
    );
    return { status: res.statusCode, passed: next.mock.calls.length === 1 };
  };

  it('bloquea escrituras desde un subdominio del preview', () => {
    expect(
      run(
        'POST',
        '/sandboxes/sbx-1/restart',
        'https://sbx-1.preview.mayday.rip',
      ),
    ).toEqual({
      status: 403,
      passed: false,
    });
    expect(run('DELETE', '/sandboxes/sbx-1', 'https://evil.com').passed).toBe(
      false,
    );
  });

  it('deja pasar el frontend, las lecturas, los scripts sin Origin y las rutas de agentes', () => {
    expect(run('POST', '/sandboxes', 'https://mayday.rip').passed).toBe(true);
    expect(run('GET', '/sandboxes', 'https://evil.com').passed).toBe(true);
    expect(run('POST', '/sandboxes').passed).toBe(true);
    expect(
      run('POST', '/agent/sandboxes/sbx-1/plan', 'https://evil.com').passed,
    ).toBe(true);
    expect(run('POST', '/sim/sim-1/events', 'https://evil.com').passed).toBe(
      true,
    );
  });

  it('no se salta con mayúsculas (Express no distingue) ni en rutas nuevas', () => {
    const evil = 'https://evil.com';
    for (const url of [
      '/SANDBOXES/sbx-1/restart',
      '/Sandboxes/sbx-1',
      '/Clicky/lesson',
      '/simulations/sim-1/stop',
      '/SIMULATIONS',
      '/reports',
      '/cualquier-ruta-nueva',
      '//sandboxes/sbx-1',
    ])
      expect(run('POST', url, evil).passed, url).toBe(false);
    // /simulations no es /sim.
    expect(run('POST', '/simulation', evil).passed).toBe(false);
    // Las de agentes sí, también en mayúsculas (el router las atiende igual).
    expect(run('POST', '/AGENT/sandboxes/sbx-1/plan', evil).passed).toBe(true);
  });

  it('el origen permitido se compara sin / final ni mayúsculas', () => {
    const mw = rejectForeignOrigins(['https://Mayday.rip/']);
    const next = vi.fn();
    mw(
      {
        method: 'post',
        url: '/sandboxes',
        headers: { origin: 'https://mayday.rip' },
      } as IncomingMessage,
      { setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('arranque del login (falla cerrado)', () => {
  const all = {
    clientId: 'Iv1.x',
    clientSecret: 's',
    sessionSecret: SECRET,
  };

  it('a medio configurar es un error siempre, también en desarrollo', () => {
    expect(
      authConfigProblem({
        clientId: 'Iv1.x',
        production: false,
        disabled: false,
      }),
    ).toMatch(/GITHUB_APP_CLIENT_SECRET, SESSION_SECRET/);
    expect(
      authConfigProblem({
        ...all,
        sessionSecret: undefined,
        production: true,
        disabled: true,
      }),
    ).toMatch(/SESSION_SECRET/);
  });

  it('apagado en producción solo con AUTH_DISABLED', () => {
    expect(authConfigProblem({ production: true, disabled: false })).toMatch(
      /AUTH_DISABLED/,
    );
    expect(authConfigProblem({ production: true, disabled: true })).toBeNull();
  });

  it('apagado en desarrollo y encendido completo arrancan', () => {
    expect(
      authConfigProblem({ production: false, disabled: false }),
    ).toBeNull();
    expect(
      authConfigProblem({ ...all, production: true, disabled: false }),
    ).toBeNull();
  });

  it('producción = RENDER o NODE_ENV=production', () => {
    expect(isProductionEnv({ RENDER: 'true' })).toBe(true);
    expect(isProductionEnv({ NODE_ENV: 'production' })).toBe(true);
    expect(isProductionEnv({ NODE_ENV: 'test' })).toBe(false);
  });
});

describe('AuthService › reglas de acceso', () => {
  const service = (env: Record<string, unknown>) =>
    new AuthService(
      {
        get: (k: string) =>
          ({
            CORS_ORIGIN: 'http://localhost:3000',
            PORT: 3001,
            ADMIN_GITHUB_LOGINS: ['equipo'],
            ...env,
          })[k],
      } as never,
      { get: () => undefined } as never,
    );
  const on = () =>
    service({
      GITHUB_APP_CLIENT_ID: 'Iv1.x',
      GITHUB_APP_CLIENT_SECRET: 's',
      SESSION_SECRET: SECRET,
    });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('no arranca con el login a medio configurar', () => {
    expect(() => service({ GITHUB_APP_CLIENT_ID: 'Iv1.x' })).toThrow(
      /medio configurar/,
    );
  });

  it('en Render no arranca con el login apagado, salvo AUTH_DISABLED', () => {
    vi.stubEnv('RENDER', 'true');
    expect(() => service({})).toThrow(/AUTH_DISABLED/);
    expect(service({ AUTH_DISABLED: true }).enabled).toBe(false);
    expect(on().enabled).toBe(true);
  });

  it('repoAccessFor rechaza URLs que no son https://github.com/dueño/repo exacto', async () => {
    const auth = on();
    for (const bad of [
      'https://github.com/hack26-sandboxes/%73bx-1a2b3c4d',
      'https://github.com/a/b/c',
      'https://gitlab.com/a/b',
    ]) {
      await expect(
        auth.repoAccessFor(duena, bad, 'external'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(auth.repoAccessFor(null, bad, 'org')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  const duena = { github_id: 1, login: 'duena', admin: false };
  const otro = { github_id: 2, login: 'otro', admin: false };
  const admin = { github_id: 3, login: 'equipo', admin: true };
  const owner = { github_id: 1, login: 'duena' };

  it('con el login apagado, todo es de todos', () => {
    const auth = service({});
    expect(auth.enabled).toBe(false);
    expect(auth.canAccess(null, owner)).toBe(true);
  });

  it('con login: solo el dueño (o un admin) accede', () => {
    const auth = on();
    expect(auth.canAccess(duena, owner)).toBe(true);
    expect(auth.canAccess(otro, owner)).toBe(false);
    expect(auth.canAccess(null, owner)).toBe(false);
    expect(auth.canAccess(admin, owner)).toBe(true);
  });

  it('con login: lo que no tiene dueño solo lo ven los admins', () => {
    const auth = on();
    expect(auth.canAccess(duena, undefined)).toBe(false);
    expect(auth.canAccess(admin, undefined)).toBe(true);
  });

  it('lo ajeno responde 404, no 403 (no confirma que existe)', () => {
    expect(() => on().assertAccess(otro, owner, 'Sandbox sbx-1')).toThrow(
      NotFoundException,
    );
  });

  it('la sesión no vale si el usuario no está en el store', () => {
    const auth = on();
    const cookie = `mayday_session=${signSession(SECRET, { uid: 9, login: 'x', exp: Date.now() + 60_000 })}`;
    expect(
      auth.userFrom({ headers: { cookie } } as IncomingMessage),
    ).toBeNull();
  });
});
