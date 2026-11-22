/**
 * Levanta el fixture local (app víctima de prueba) e imprime su URL. Lo usa el
 * selftest de Modal para una corrida de punta a punta sin atacar nada externo.
 */
import { startFixture } from './fixture.ts';

const fx = await startFixture();
console.log(fx.url);
