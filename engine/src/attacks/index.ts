import type { Attack } from '../types.ts';
import { weakPassword } from './weak-password.ts';
import { jwtReuse } from './jwt-reuse.ts';
import { idor } from './idor.ts';
import { adminExport } from './admin-export.ts';
import { massAssignment } from './mass-assignment.ts';
import { sqlInjection } from './sql-injection.ts';
import { verboseErrors } from './verbose-errors.ts';
import { storedXss } from './stored-xss.ts';

/** Todos los módulos de ataque, en el orden sugerido del storytelling. */
export const ATTACKS: Attack[] = [
  weakPassword,
  jwtReuse,
  idor,
  adminExport,
  massAssignment,
  verboseErrors, // habilita la SQLi a ciegas
  sqlInjection,
  storedXss,
];

export const ATTACKS_BY_ID: Record<string, Attack> = Object.fromEntries(
  ATTACKS.map((a) => [a.meta.id, a]),
);
