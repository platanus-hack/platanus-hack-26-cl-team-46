import {
  StandardSchemaValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';

process.env.RENDER_API_KEY ??= 'test-key';
process.env.DATA_DIR = '.data-test';
process.env.AGENT_API_SECRET = 'secreto-de-prueba-suficientemente-largo';

const { AppModule } = await import('./../src/app.module.js');
const { signAgentToken } = await import('./../src/agent/agent-token.js');

describe('API (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new StandardSchemaValidationPipe());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /health', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ ok: true, service: 'hack26-backend' });
  });

  it('POST /sandboxes valida el body', () => {
    return request(app.getHttpServer())
      .post('/sandboxes')
      .send({ repo_url: 'nope' })
      .expect(400);
  });

  it('GET /agent/cli.mjs es público', () => {
    return request(app.getHttpServer())
      .get('/agent/cli.mjs')
      .expect(200)
      .expect('content-type', /javascript/);
  });

  it('/agent/sandboxes/:id exige token', async () => {
    const server = app.getHttpServer();
    await request(server).get('/agent/sandboxes/sbx-1').expect(401);
    await request(server)
      .get('/agent/sandboxes/sbx-1')
      .set('Authorization', 'Bearer sbx-1.falso')
      .expect(401);
  });

  it('GET /sim/cli.mjs trae el rol fijo', async () => {
    const res = await request(app.getHttpServer())
      .get('/sim/cli.mjs?role=hacker')
      .expect(200);
    expect(res.text).toContain('const ROLE = "hacker"');
  });

  it('/sim/:id exige token de la simulación y un rol válido', async () => {
    const server = app.getHttpServer();
    await request(server).get('/sim/sim-1').expect(401);
    const { signSimToken } = await import('./../src/simulations/sim-token.js');
    const token = signSimToken(process.env.AGENT_API_SECRET!, 'sim-1');
    await request(server)
      .get('/sim/sim-2')
      .set('Authorization', `Bearer ${token}`)
      .set('x-sim-role', 'coder')
      .expect(401);
    await request(server)
      .get('/sim/sim-1')
      .set('Authorization', `Bearer ${token}`)
      .set('x-sim-role', 'root')
      .expect(403);
    await request(server)
      .get('/sim/sim-1')
      .set('Authorization', `Bearer ${token}`)
      .set('x-sim-role', 'coder')
      .expect(404);
  });

  it('GET /reports responde el historial (login apagado: todos)', async () => {
    const res = await request(app.getHttpServer()).get('/reports').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /simulations/:id/report de una simulación que no existe es 404', () => {
    return request(app.getHttpServer()).get('/simulations/sim-00000000/report').expect(404);
  });

  it('POST /simulations valida el body', () => {
    return request(app.getHttpServer())
      .post('/simulations')
      .send({})
      .expect(400);
  });

  it('el token de un sandbox no sirve para otro', () => {
    const token = signAgentToken(process.env.AGENT_API_SECRET!, 'sbx-1');
    return request(app.getHttpServer())
      .get('/agent/sandboxes/sbx-2')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('con token válido pasa el guard (404 si el sandbox no existe)', () => {
    const token = signAgentToken(process.env.AGENT_API_SECRET!, 'sbx-1');
    return request(app.getHttpServer())
      .get('/agent/sandboxes/sbx-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('GET /sandboxes/:id inexistente → 404', () => {
    return request(app.getHttpServer()).get('/sandboxes/sbx-nope').expect(404);
  });
});
