/**
 * Catálogo de conocimiento por vulnerabilidad para la app víctima "Apuntes".
 *
 * Es la capa de enseñanza: cada entrada mapea la vuln a MITRE ATT&CK/ATLAS, a
 * una contramedida D3FEND, a un caso real conocido y a los arreglos correctos e
 * incorrectos. El motor la combina con el ataque real grabado para producir la
 * guía del hackeo y los escenarios. Derivado de docs/victim/ANSWER_KEY.md.
 */
import type { VulnMeta } from './types.ts';

export const CATALOG: Record<string, VulnMeta> = {
  'weak-password-no-rate-limit': {
    id: 'weak-password-no-rate-limit',
    title: 'Login sin límite de intentos + contraseña débil',
    severity: 'high',
    difficulty: 1,
    order: 1,
    cwe: ['CWE-307 Improper Restriction of Excessive Authentication Attempts', 'CWE-521 Weak Password Requirements'],
    owasp: ['A07:2021 Identification and Authentication Failures'],
    mitre_attack: [
      'T1110.001 — Brute Force: Password Guessing',
      'T1110.004 — Brute Force: Credential Stuffing',
      'T1078 — Valid Accounts',
    ],
    d3fend: ['D3-AL Account Locking', 'D3-MFA Multi-factor Authentication', 'Política de contraseñas + lista de filtradas'],
    code_location: 'src/routes/auth.ts:41 (API) y src/routes/web.ts:19 (form); seed débil src/db/seed.ts:27',
    real_case:
      'iCloud / "Celebgate" (2014): Find My iPhone no limitaba intentos y se usó para fuerza bruta (iBrute). 23andMe (2023): credential stuffing sin 2FA expuso ~6,9M de usuarios.',
    fix_correct:
      'Rate limit por cuenta y por IP en ambas rutas, backoff/lockout temporal, política mínima de contraseñas y reset forzado de cuentas débiles. Opcional: 2FA.',
    fix_wrong: [
      'Cambiarle solo la contraseña a la víctima: el login sigue sin límite y el atacante pasa a la siguiente cuenta.',
      'Bloquear la IP: el atacante rota IPs y con trust proxy puede falsear el X-Forwarded-For.',
      'Poner el límite solo en el form web o solo en la API.',
      'Captcha solo en el frontend.',
    ],
    teaching: 'Autenticar no es solo verificar la contraseña: hay que limitar los intentos y exigir contraseñas fuertes.',
  },

  'jwt-not-invalidated-on-password-change': {
    id: 'jwt-not-invalidated-on-password-change',
    title: 'El cambio de contraseña no invalida los JWT',
    severity: 'high',
    difficulty: 2,
    order: 2,
    cwe: ['CWE-613 Insufficient Session Expiration', 'CWE-384 Session Fixation (relacionado)'],
    owasp: ['A07:2021 Identification and Authentication Failures'],
    mitre_attack: [
      'T1528 — Steal Application Access Token',
      'T1550.001 — Use Alternate Authentication Material: Application Access Token',
      'T1078 — Valid Accounts',
    ],
    d3fend: ['D3-CR Credential Rotation (rotar JWT_SECRET)', 'Invalidación de sesión (token_version / password_changed_at)', 'Access tokens cortos + refresh revocable'],
    code_location: 'src/routes/users.ts:30 + src/middleware/auth.ts:25 (no compara iat) + src/config.ts:14 (30d)',
    real_case:
      'CircleCI (ene 2023): robaron la cookie de sesión de un ingeniero (con 2FA) y entraron sin contraseña; pidieron a todos rotar secretos. Okta (oct 2023): tokens robados de archivos HAR usados para secuestrar sesiones.',
    fix_correct:
      'Inmediato: rotar JWT_SECRET (invalida todas las sesiones). De fondo: token_version/password_changed_at en el JWT, rechazar iat anterior, emitir token nuevo al cambiar contraseña y bajar la expiración.',
    fix_wrong: [
      'Cambiar la contraseña y darlo por resuelto (el escenario clave): el token robado sigue vivo 30 días.',
      'Hacer logout en el navegador propio: solo afecta a ese navegador.',
      'Reiniciar o redeployar sin rotar JWT_SECRET: el token sigue siendo válido.',
      'Bajar JWT_EXPIRES_IN sin rotar el secreto: los tokens ya emitidos conservan su exp.',
    ],
    teaching: 'Con sesiones stateless, cambiar la contraseña no saca al atacante: hay que invalidar los tokens ya emitidos.',
  },

  idor: {
    id: 'idor',
    title: 'IDOR: lectura de notas de otros usuarios',
    severity: 'high',
    difficulty: 1,
    order: 3,
    cwe: ['CWE-639 Authorization Bypass Through User-Controlled Key', 'CWE-284 Improper Access Control'],
    owasp: ['A01:2021 Broken Access Control'],
    mitre_attack: ['T1213 — Data from Information Repositories', 'T1078 — Valid Accounts'],
    d3fend: ['Autorización a nivel de objeto (WHERE id = $1 AND user_id = $2)', 'D3-UAC User Account Permissions'],
    code_location: 'src/routes/notes.ts:23 (API) y src/routes/web.ts:67 (vista); getNote() sin filtro de dueño en src/models/notes.ts:22',
    real_case:
      'First American (2019): cambiar un número secuencial en la URL exponía ~885M de documentos. Optus (2022): API con IDs incrementales expuso ~10M de clientes.',
    fix_correct:
      'Filtrar por dueño en la query en ambos handlers (o centralizar en getNoteForUser) y devolver 404 si no es del usuario. Revisar logs para saber qué se leyó.',
    fix_wrong: [
      'Cambiar los IDs a UUID: es seguridad por oscuridad, la autorización sigue rota.',
      'Arreglar solo la API y no la vista /notes/:id, o al revés.',
      'Esconder el link en el frontend.',
    ],
    teaching: 'Que el objeto exista no significa que este usuario pueda verlo: autoriza por dueño, no por ID.',
  },

  'admin-endpoint-no-authz': {
    id: 'admin-endpoint-no-authz',
    title: 'Endpoint de admin sin control de autorización',
    severity: 'critical',
    difficulty: 1,
    order: 4,
    cwe: ['CWE-862 Missing Authorization', 'CWE-200 Exposure of Sensitive Information'],
    owasp: ['A01:2021 Broken Access Control'],
    mitre_attack: ['T1190 — Exploit Public-Facing Application', 'T1213 — Data from Information Repositories', 'T1078 — Valid Accounts'],
    d3fend: ['Autorización obligatoria a nivel de router (requireAdmin)', 'Minimización de datos (no exponer password_hash)'],
    code_location: 'src/routes/admin.ts:33 — /api/admin/users/export usa requireAuth pero le falta requireAdmin; hace SELECT * con password_hash',
    real_case:
      'USPS "Informed Visibility" (2018): cualquier usuario logueado consultaba datos de ~60M de cuentas. Peloton (2021): una API devolvía datos privados sin verificar autorización.',
    fix_correct:
      'adminRouter.use(requireAdmin) a nivel de router; el export no debe incluir password_hash. Respuesta al incidente: asumir hashes filtrados, forzar reset de contraseñas, rotar JWT_SECRET, avisar.',
    fix_wrong: [
      'Quitar el link "Descargar respaldo" de la vista: el endpoint sigue expuesto.',
      'Cambiar la URL a algo "secreto".',
      'Bloquear al usuario que lo descargó: cualquier cuenta nueva puede repetirlo.',
      'Arreglar la autorización y no hacer nada con los datos ya filtrados.',
    ],
    teaching: 'Autenticado ≠ autorizado. Cada endpoint sensible necesita verificar rol, de preferencia a nivel de router.',
  },

  'mass-assignment': {
    id: 'mass-assignment',
    title: 'Mass assignment: auto-escalada a admin',
    severity: 'critical',
    difficulty: 2,
    order: 5,
    cwe: ['CWE-915 Improperly Controlled Modification of Dynamically-Determined Object Attributes'],
    owasp: ['A08:2021 Software and Data Integrity Failures', 'A01:2021 Broken Access Control'],
    mitre_attack: ['T1068 — Exploitation for Privilege Escalation', 'T1078.003 — Valid Accounts: Local Accounts'],
    d3fend: ['Allowlist de campos editables', 'Separar el cambio de rol en un flujo de admin'],
    code_location: 'src/models/users.ts:47 (USER_COLUMNS incluye role) usado desde src/routes/users.ts:20 (PATCH /api/users/me)',
    real_case:
      'GitHub (2012): Egor Homakov explotó el mass assignment de Rails para agregar su llave SSH a la org rails y commitear en el repo oficial. Rails cambió su default (strong parameters).',
    fix_correct:
      'Allowlist explícita de campos que el propio usuario puede editar (name, phone, bio); cambios de rol solo por flujo de admin. Respuesta: revertir roles escalados y auditar qué hicieron.',
    fix_wrong: [
      'Quitar el campo del formulario o validarlo en el frontend: el atacante usa la API directo.',
      'Revertir el rol de una cuenta sin arreglar el código: vuelve a escalar en segundos.',
      'Usar blocklist (delete body.role) en vez de allowlist: el próximo campo sensible queda expuesto.',
    ],
    teaching: 'Nunca mapees el body del request directo al modelo: define explícitamente qué puede cambiar el usuario.',
  },

  'sql-injection': {
    id: 'sql-injection',
    title: 'SQL injection en la búsqueda de notas',
    severity: 'critical',
    difficulty: 3,
    order: 6,
    cwe: ['CWE-89 SQL Injection'],
    owasp: ['A03:2021 Injection'],
    mitre_attack: ['T1190 — Exploit Public-Facing Application', 'T1005 — Data from Local System', 'T1213 — Data from Information Repositories'],
    d3fend: ['Queries parametrizadas', 'D3-IV Input Validation', 'Mínimo privilegio del usuario de BDD'],
    code_location: 'src/models/notes.ts:15 — search concatenado dentro de ILIKE \'%...%\' (GET /api/notes?q= y /?q=)',
    real_case:
      'TalkTalk (2015): una SQLi en páginas legacy expuso ~157.000 clientes y multa de £400.000. MOVEit Transfer (2023, CVE-2023-34362): SQLi explotada masivamente por Cl0p.',
    fix_correct:
      'Query parametrizada: WHERE user_id = $1 AND (title ILIKE \'%\'||$2||\'%\' OR body ILIKE \'%\'||$2||\'%\'). Respuesta: asumir que users se leyó completa, forzar reset de contraseñas, rotar JWT_SECRET y credenciales de BDD.',
    fix_wrong: [
      'Escapar comillas a mano o filtrar UNION/SELECT con regex: se evade.',
      'Ocultar los errores (arreglar verbose-errors) y creer que se cerró: sigue siendo explotable a ciegas.',
      'Arreglar solo la API y olvidar el buscador del dashboard (aquí usan la misma función).',
    ],
    teaching: 'Nunca concatenes input en SQL. Parametriza siempre: una sola búsqueda vulnerable expone toda la base.',
  },

  'verbose-errors': {
    id: 'verbose-errors',
    title: 'Errores verbosos: fuga de información interna',
    severity: 'medium',
    difficulty: 1,
    order: 7,
    cwe: ['CWE-209 Generation of Error Message Containing Sensitive Information'],
    owasp: ['A05:2021 Security Misconfiguration', 'A09:2021 Security Logging and Monitoring Failures (relacionado)'],
    mitre_attack: ['T1592 — Gather Victim Host Information', 'T1190 — Exploit Public-Facing Application (habilitador)'],
    d3fend: ['Mensajes de error genéricos al cliente + request_id', 'Logging del detalle solo del lado del servidor'],
    code_location: 'src/middleware/errors.ts:31-44 — devuelve code, detail, hint, position, stack al cliente sin mirar NODE_ENV',
    real_case:
      'Patreon (2015): un debugger de Werkzeug expuesto en producción permitió RCE y la fuga de ~2,3M de cuentas. Aquí el impacto es fuga de información, pero la lección es la misma.',
    fix_correct:
      'Responder un mensaje genérico ({error, request_id}) y loguear el detalle solo en el servidor, correlacionado por request_id.',
    fix_wrong: [
      'Setear NODE_ENV=production: no cambia nada, el handler no lo mira (y en Render ya está así).',
      'Borrar el log del servidor en vez de la respuesta: pierdes visibilidad y el atacante sigue viendo el stack.',
      'Quitar solo stack y dejar detail/hint/position, que siguen sirviendo para armar la inyección.',
    ],
    teaching: 'El detalle de los errores es un mapa para el atacante: al cliente, mensaje genérico; el detalle, solo en tus logs.',
  },

  'stored-xss': {
    id: 'stored-xss',
    title: 'Stored XSS en el cuerpo de las notas',
    severity: 'high',
    difficulty: 3,
    order: 8,
    cwe: ['CWE-79 Cross-site Scripting', 'CWE-1004 Sensitive Cookie Without HttpOnly Flag'],
    owasp: ['A03:2021 Injection'],
    mitre_attack: ['T1059.007 — Command and Scripting Interpreter: JavaScript', 'T1539 — Steal Web Session Cookie', 'T1189 — Drive-by Compromise'],
    mitre_atlas: ['(n/a para esta app — reservado para vulns de componentes LLM)'],
    d3fend: ['Output encoding (<%= %>) o sanitización con allowlist', 'Cookie httpOnly + secure', 'Content Security Policy'],
    code_location: 'views/note.ejs:6 y views/admin.ejs:24 (<%- %> sin escapar); cookie sin httpOnly en src/routes/web.ts:12',
    real_case:
      'Samy worm, MySpace (2005): un XSS almacenado se autopropagó a >1M de usuarios en ~20h. TweetDeck (2014): un tweet con XSS se retuiteaba solo al verse.',
    fix_correct:
      'Escapar en ambas vistas (<%= %>) o sanitizar con allowlist. Cookie httpOnly y secure, CSP que bloquee inline, limpiar notas maliciosas y rotar JWT_SECRET (asumir tokens robados).',
    fix_wrong: [
      'Arreglar solo note.ejs y olvidar admin.ejs, donde está la víctima de más valor (la admin).',
      'Blocklist que borra <script>: se evade con onerror y otros handlers.',
      'Borrar la nota maliciosa sin arreglar la vista ni rotar el secreto: el token robado sigue sirviendo (ver jwt).',
    ],
    teaching: 'Todo contenido de usuario es ejecutable hasta que lo escapes: encode en la salida y protege la cookie con httpOnly.',
  },
};

export const VULN_ORDER = Object.values(CATALOG)
  .sort((a, b) => a.order - b.order)
  .map((v) => v.id);
