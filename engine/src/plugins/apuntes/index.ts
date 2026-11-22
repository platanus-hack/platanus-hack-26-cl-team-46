/**
 * Plugin de la app víctima "Apuntes": ensambla todo lo específico de esta app
 * (catálogo, ataques, rutas candidatas, storylines) en el contrato EnginePlugin.
 * El core consume este objeto por parámetro; no importa este archivo.
 *
 * Para soportar otra app, se agrega otro plugin como este, sin tocar el core.
 */
import type { EnginePlugin } from '../../core/types.ts';
import { ATTACKS } from './attacks/index.ts';
import { CATALOG } from './catalog.ts';
import { APUNTES_CANDIDATES } from './recon-candidates.ts';
import { APUNTES_STORYLINES } from './storylines.ts';

export const apuntesPlugin: EnginePlugin = {
  id: 'apuntes',
  scenarioNamespace: 'apuntes',
  catalog: CATALOG,
  attacks: ATTACKS,
  reconCandidates: APUNTES_CANDIDATES,
  storylines: APUNTES_STORYLINES,
};
