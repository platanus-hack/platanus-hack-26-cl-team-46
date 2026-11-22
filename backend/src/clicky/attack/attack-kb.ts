import { readFileSync } from 'node:fs';

/**
 * La copia local de MITRE ATT&CK que usa Hinty (scripts/build-attack-kb.mjs la arma desde el
 * bundle STIX oficial). Así el profe razona con la matriz real, sin salir a internet:
 * 1. Se busca lo que calza con la pregunta (y, aparte, con las fallas del simulacro).
 * 2. Esas técnicas, con su táctica, mitigaciones y detección, van en el mensaje al modelo.
 * 3. El prompt le pide nombrar táctica y técnica con su ID solo desde esa lista.
 *
 * La búsqueda es BM25 sobre nombre (pesa 3), tácticas y descripción, con un puente
 * español → términos de ATT&CK (la matriz está en inglés y los developers preguntan en español)
 * y los IDs escritos tal cual (T1110, T1110.001, M1032, TA0006).
 */

export interface AttackTactic {
  id: string;
  key: string;
  name: string;
  desc: string;
}
export interface AttackTechnique {
  id: string;
  name: string;
  tactics: string[];
  platforms: string[];
  desc: string;
  mit: string[];
  detect: string[];
  seen: number;
}
export interface AttackMitigation {
  id: string;
  name: string;
  desc: string;
}
export interface AttackKb {
  version: string;
  notice: string;
  tactics: AttackTactic[];
  techniques: AttackTechnique[];
  mitigations: AttackMitigation[];
}

/** Las tácticas en español, como las nombra Hinty. */
export const TACTIC_ES: Record<string, string> = {
  reconnaissance: 'Reconocimiento',
  'resource-development': 'Preparación de recursos',
  'initial-access': 'Acceso inicial',
  execution: 'Ejecución',
  persistence: 'Persistencia',
  'privilege-escalation': 'Escalada de privilegios',
  stealth: 'Sigilo',
  'defense-evasion': 'Evasión de defensas',
  'defense-impairment': 'Debilitar defensas',
  'credential-access': 'Acceso a credenciales',
  discovery: 'Descubrimiento',
  'lateral-movement': 'Movimiento lateral',
  collection: 'Recolección',
  'command-and-control': 'Comando y control',
  exfiltration: 'Exfiltración',
  impact: 'Impacto',
};

// Español (sin tildes, en minúsculas) → términos de ATT&CK. Pensado para lo que pasa en un
// simulacro web: claves, tokens, secretos, inyecciones, accesos, fugas y lo que se hace después.
const BRIDGE: [RegExp, string][] = [
  [
    /fuerza bruta|adivina\w* (la )?clave|probar claves|credential stuffing|relleno de credenciales/,
    'brute force password guessing spraying stuffing',
  ],
  [/contrasena|password|clave(s)? de (acceso|usuario)/, 'password credentials'],
  [/credencial/, 'credentials valid accounts'],
  [
    /robo de (credenciales|cuentas)|robar (la )?(clave|cuenta|credencial)/,
    'credential access steal credentials',
  ],
  [
    /\btoken|jwt|bearer/,
    'steal application access token web session cookie forge',
  ],
  [/sesion|cookie/, 'web session cookie steal session'],
  [
    /secreto|api ?key|clave de (la )?api|\.env\b|variables? de entorno|hardcode/,
    'unsecured credentials credentials in files private keys',
  ],
  [
    /inyeccion sql|sql ?injection|sqli\b/,
    'exploit public-facing application sql database',
  ],
  [
    /inyeccion|injection/,
    'exploit public-facing application command injection',
  ],
  [
    /\bxss\b|cross.site scripting/,
    'drive-by compromise exploit public-facing application javascript',
  ],
  [
    /\bidor\b|referencia directa|acceso a datos de otro|autorizacion rota|broken access/,
    'exploit public-facing application valid accounts data from information repositories',
  ],
  [
    /\bssrf\b|metadata/,
    'cloud instance metadata api exploit public-facing application',
  ],
  [
    /\brce\b|ejecucion remota|ejecutar codigo|ejecuta comandos/,
    'command and scripting interpreter exploitation remote services',
  ],
  [/phishing|correo falso|suplantacion/, 'phishing spearphishing'],
  [
    /ransomware|secuestro de datos|cifra(r)? (los )?archivos/,
    'data encrypted for impact',
  ],
  [
    /exfiltra|fuga de datos|filtracion de datos|sacar (los )?datos|robo de datos/,
    'exfiltration over web service data',
  ],
  [/base de datos|\bdb\b/, 'data from information repositories database'],
  [
    /persistencia|se queda adentro|volver a entrar|mantener el acceso/,
    'persistence account manipulation create account',
  ],
  [/puerta trasera|backdoor/, 'create account web shell account manipulation'],
  [/web ?shell/, 'server software component web shell'],
  [
    /escalada|escalar privilegios|privilegios|admin/,
    'privilege escalation valid accounts privileged',
  ],
  [
    /movimiento lateral|moverse (a|por) otros/,
    'lateral movement remote services',
  ],
  [
    /reconocimiento|escane|enumera/,
    'reconnaissance active scanning gather victim',
  ],
  [/descubrimiento/, 'discovery'],
  [
    /borrar (los )?(logs|registros|huellas)|limpiar (los )?logs/,
    'indicator removal clear logs',
  ],
  [
    /desactivar (las )?defensas|apagar (el )?(antivirus|logging|alertas)/,
    'impair defenses disable',
  ],
  [
    /denegacion de servicio|\bddos\b|\bdos\b|tumbar (el|la) (sitio|app|servicio)/,
    'network denial of service endpoint denial of service',
  ],
  [/mineria|cripto|minar/, 'resource hijacking compute'],
  [/nube|cloud|\baws\b|\bgcp\b|azure/, 'cloud accounts cloud'],
  [/bucket|\bs3\b|almacenamiento/, 'data from cloud storage'],
  [
    /dependencia|paquete|npm|libreria|cadena de suministro/,
    'supply chain compromise software dependencies',
  ],
  [/contenedor|docker|kubernetes/, 'container deploy container escape to host'],
  [/\bmfa\b|2fa|doble factor|segundo factor/, 'multi-factor authentication'],
  [
    /rate ?limit|limitar intentos|bloqueo de cuenta/,
    'account use policies brute force',
  ],
  [/rotar|revocar/, 'credentials token revoke'],
  [/cuenta valida|cuentas? (validas|legitimas)/, 'valid accounts'],
];

const STOP = new Set(
  'a an and are as at be by can for from has have in into is it may of on or such that the their them these this to use used using via when which with without within el la los las un una unos unas de del y o que en por para con sin se su sus es son al lo como mas pero ya mi tu me te le les esto esta este eso esa ese hay'.split(
    ' ',
  ),
);

const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const stem = (w: string) =>
  w.length > 4 ? w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '') : w;
const tokens = (s: string) =>
  fold(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);

let kb: AttackKb | null = null;
interface Doc {
  t: AttackTechnique;
  tf: Map<string, number>;
  len: number;
}
let docs: Doc[] = [];
let idf = new Map<string, number>();
let avg = 1;

export function attackKb(): AttackKb {
  if (kb) return kb;
  kb = JSON.parse(
    readFileSync(
      new URL('./enterprise-attack.kb.json', import.meta.url),
      'utf8',
    ),
  ) as AttackKb;
  docs = kb.techniques.map((t) => {
    const words = [
      ...Array<string[]>(3).fill(tokens(t.name)).flat(),
      ...tokens(t.tactics.join(' ').replace(/-/g, ' ')),
      ...tokens(t.desc),
    ];
    const tf = new Map<string, number>();
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { t, tf, len: words.length };
  });
  avg = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length);
  const df = new Map<string, number>();
  for (const d of docs)
    for (const w of d.tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  idf = new Map(
    [...df].map(([w, n]) => [
      w,
      Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)),
    ]),
  );
  return kb;
}

/**
 * Una técnica (T1552, T1552.001) o mitigación (M1041) de ATT&CK por su ID, con su nombre oficial;
 * null si no existe en la copia local (así la pizarra nunca muestra un ID inventado).
 */
export function attackRef(id: unknown): { id: string; name: string } | null {
  const key = typeof id === 'string' ? id.trim().toUpperCase() : '';
  if (!/^(T\d{4}(\.\d{3})?|M\d{4})$/.test(key)) return null;
  const k = attackKb();
  const hit = key.startsWith('M')
    ? k.mitigations.find((m) => m.id === key)
    : k.techniques.find((t) => t.id === key);
  return hit ? { id: hit.id, name: hit.name } : null;
}

/** Lo que el texto pide, en términos de ATT&CK: sus palabras más las del puente. */
export function queryTerms(text: string): string[] {
  const f = fold(text);
  const extra = BRIDGE.filter(([re]) => re.test(f)).map(([, en]) => en);
  return [...new Set(tokens([text, ...extra].join(' ')))];
}

/** Las técnicas que más calzan con el texto (IDs escritos primero), de mayor a menor. */
export function searchAttack(text: string, k = 4): AttackTechnique[] {
  const base = attackKb();
  const byId = new Map(base.techniques.map((t) => [t.id, t]));
  const direct = [...text.matchAll(/\bT\d{4}(?:\.\d{3})?\b/gi)]
    .map((m) => byId.get(m[0].toUpperCase()))
    .filter((t): t is AttackTechnique => !!t);
  const terms = queryTerms(text);
  if (!terms.length) return direct.slice(0, k);
  const k1 = 1.2,
    b = 0.75;
  const scored = docs
    .map((d) => {
      let s = 0;
      for (const w of terms) {
        const f = d.tf.get(w);
        if (f)
          s +=
            (idf.get(w) ?? 0) *
            ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)));
      }
      // a igual calce, lo que más se ve en ataques reales (y la técnica madre antes que sus variantes)
      if (s > 0)
        s += 0.15 * Math.log1p(d.t.seen) - (d.t.id.includes('.') ? 0.3 : 0);
      return { t: d.t, s };
    })
    .filter((x) => x.s > 1.5)
    .sort((x, y) => y.s - x.s)
    .map((x) => x.t);
  return [...new Set([...direct, ...scored])].slice(0, k);
}

/** Las mitigaciones (M…) que calzan con el texto: "¿por qué activar MFA?" → M1032. */
export function searchMitigations(text: string, k = 2): AttackMitigation[] {
  const base = attackKb();
  const direct = [...text.matchAll(/\bM1\d{3}\b/gi)]
    .map((m) => base.mitigations.find((x) => x.id === m[0].toUpperCase()))
    .filter((m): m is AttackMitigation => !!m);
  const terms = new Set(queryTerms(text));
  const scored = base.mitigations
    .map((m) => {
      const name = tokens(m.name);
      const hits = name.filter((w) => terms.has(w)).length;
      // el nombre entero tiene que calzar casi completo: "Multi-factor Authentication", no solo "account"
      return { m, s: name.length ? hits / name.length : 0 };
    })
    .filter((x) => x.s >= 0.66)
    .sort((x, y) => y.s - x.s)
    .map((x) => x.m);
  return [...new Set([...direct, ...scored])].slice(0, k);
}

function mitigationLine(m: AttackMitigation): string {
  const covers = attackKb()
    .techniques.filter((t) => t.mit.includes(m.id) && !t.id.includes('.'))
    .sort((a, b) => b.seen - a.seen)
    .slice(0, 4)
    .map((t) => `${t.id} ${t.name}`)
    .join('; ');
  return [
    `- ${m.id} ${m.name}: ${clip(m.desc, 240)}`,
    covers && `  Corta técnicas como: ${covers}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const clip = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;

function techniqueLine(t: AttackTechnique): string {
  const base = attackKb();
  const tactic = t.tactics
    .map((key) => {
      const ta = base.tactics.find((x) => x.key === key);
      return `${TACTIC_ES[key] ?? key}${ta ? ` (${ta.id})` : ''}`;
    })
    .join(', ');
  const parent = t.id.includes('.')
    ? base.techniques.find((x) => x.id === t.id.split('.')[0])
    : undefined;
  const mit = t.mit
    .slice(0, 4)
    .map((id) => base.mitigations.find((m) => m.id === id))
    .filter((m): m is AttackMitigation => !!m)
    .map((m) => `${m.id} ${m.name}`)
    .join('; ');
  return [
    `- ${t.id} ${t.name}${parent ? ` (variante de ${parent.id} ${parent.name})` : ''} · táctica: ${tactic}`,
    `  Qué es: ${clip(t.desc, 360)}`,
    mit && `  Cómo se corta (mitigaciones): ${mit}`,
    t.detect[0] && `  Cómo se detecta: ${t.detect[0]}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * El bloque de ATT&CK para el mensaje al modelo: lo que calza con la pregunta y, aparte, cómo se
 * ve en la matriz lo que hace el atacante de este simulacro. Vacío si nada calza.
 */
export function attackReference(question: string, simTopics = ''): string {
  let base: AttackKb;
  try {
    base = attackKb();
  } catch {
    return '';
  }
  const asked = searchAttack(question, 4);
  const sim = simTopics
    ? searchAttack(simTopics, 3).filter((t) => !asked.includes(t))
    : [];
  const fixes = searchMitigations(question);
  if (!asked.length && !sim.length && !fixes.length) return '';
  const chain = base.tactics
    .map((t) => `${TACTIC_ES[t.key] ?? t.name} (${t.id})`)
    .join(' → ');
  return [
    `## MITRE ATT&CK (tu copia local, v${base.version})`,
    'Las técnicas reales que calzan. Nombra táctica y técnica con su ID solo desde aquí; si nada calza, no cites IDs.',
    `Orden de las tácticas en la matriz: ${chain}.`,
    asked.length && `Para la pregunta:\n${asked.map(techniqueLine).join('\n')}`,
    fixes.length &&
      `Mitigaciones que nombra la pregunta:\n${fixes.map(mitigationLine).join('\n')}`,
    sim.length &&
      `Lo que hace el atacante de este simulacro, en la matriz (mientras corre es parte de la clave del profesor):\n${sim.map(techniqueLine).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n');
}
