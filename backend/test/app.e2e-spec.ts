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
