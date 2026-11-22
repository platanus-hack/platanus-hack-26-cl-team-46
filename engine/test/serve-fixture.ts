/**
 * Levanta un fixture local e imprime su URL. Lo usa el selftest de Modal para
 * corridas de punta a punta sin atacar nada externo.
 *   node test/serve-fixture.ts           → app víctima Apuntes
 *   node test/serve-fixture.ts generic   → app desconocida para el plugin genérico
 */
import { startFixture } from './fixture.ts';
import { startGenericFixture } from './fixtures/generic-fixture.ts';

const fx = process.argv[2] === 'generic' ? await startGenericFixture() : await startFixture();
console.log(fx.url);
