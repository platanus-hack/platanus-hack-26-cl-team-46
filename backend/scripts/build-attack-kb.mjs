#!/usr/bin/env node
// Arma la copia local de MITRE ATT&CK (Enterprise) que usa Hinty, desde el bundle STIX oficial:
//   https://github.com/mitre-attack/attack-stix-data (enterprise-attack/enterprise-attack-<versión>.json)
//
//   node scripts/build-attack-kb.mjs <enterprise-attack-X.Y.json>
//
// Deja en src/clicky/attack/enterprise-attack.kb.json solo lo que el profe necesita para explicar:
// tácticas en el orden de la matriz, técnicas y subtécnicas vigentes (descripción corta, sin citas),
// mitigaciones, nombres de las estrategias de detección y cuántos grupos, malware o campañas usan
// cada técnica. Lo revocado o deprecado queda fuera.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error(
    'Uso: node scripts/build-attack-kb.mjs <enterprise-attack-X.Y.json>',
  );
  process.exit(1);
}
const bundle = JSON.parse(readFileSync(src, 'utf8'));
const O = bundle.objects;
const live = (o) => !o.revoked && !o.x_mitre_deprecated;
const extId = (o) =>
  o.external_references?.find((r) => r.source_name === 'mitre-attack')
    ?.external_id;

// Texto de ATT&CK sin citas, enlaces markdown ni etiquetas, recortado en frases enteras.
function short(text = '', max) {
  const t = text
    .replace(/\(Citation:[^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,;:])/g, '$1')
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.'));
  return end > max * 0.5
    ? cut.slice(0, end + 1)
    : cut.replace(/\s+\S*$/, '') + '…';
}

const byRef = new Map(O.map((o) => [o.id, o]));
const matrix = O.find((o) => o.type === 'x-mitre-matrix' && live(o));
const tactics = matrix.tactic_refs
  .map((ref) => byRef.get(ref))
  .map((t) => ({
    id: extId(t),
    key: t.x_mitre_shortname,
    name: t.name,
    desc: short(t.description, 220),
  }));

const rels = O.filter((o) => o.type === 'relationship' && live(o));
const mitigates = new Map(); // técnica → [M…]
const detects = new Map(); // técnica → [nombres]
const seen = new Map(); // técnica → nº de grupos/malware/herramientas/campañas que la usan
for (const r of rels) {
  const s = byRef.get(r.source_ref),
    t = byRef.get(r.target_ref);
  if (!s || !t || !live(s) || !live(t) || t.type !== 'attack-pattern') continue;
  if (r.relationship_type === 'mitigates' && s.type === 'course-of-action') {
    const id = extId(s);
    if (id) (mitigates.get(t.id) ?? mitigates.set(t.id, []).get(t.id)).push(id);
  } else if (
    r.relationship_type === 'detects' &&
    s.type === 'x-mitre-detection-strategy'
  ) {
    (detects.get(t.id) ?? detects.set(t.id, []).get(t.id)).push(s.name);
  } else if (r.relationship_type === 'uses') {
    seen.set(t.id, (seen.get(t.id) ?? 0) + 1);
  }
}

const techniques = O.filter(
  (o) => o.type === 'attack-pattern' && live(o) && extId(o),
)
  .map((o) => ({
    id: extId(o),
    name: o.name,
    tactics: (o.kill_chain_phases ?? [])
      .filter((k) => k.kill_chain_name === 'mitre-attack')
      .map((k) => k.phase_name),
    platforms: o.x_mitre_platforms ?? [],
    desc: short(o.description, 520),
    mit: [...new Set(mitigates.get(o.id) ?? [])].sort(),
    detect: (detects.get(o.id) ?? [])
      .filter((d) => !/^Detection Strategy for /i.test(d))
      .slice(0, 2)
      .map((d) => short(d, 140)),
    seen: seen.get(o.id) ?? 0,
  }))
  .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

const used = new Set(techniques.flatMap((t) => t.mit));
const mitigations = O.filter(
  (o) => o.type === 'course-of-action' && live(o) && extId(o)?.startsWith('M'),
)
  .map((o) => ({ id: extId(o), name: o.name, desc: short(o.description, 260) }))
  .filter((m) => used.has(m.id))
  .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

const version =
  src.match(/attack-(\d+\.\d+)\.json$/)?.[1] ?? matrix.x_mitre_version ?? '?';
const kb = {
  source:
    'MITRE ATT&CK Enterprise (https://attack.mitre.org), bundle STIX de mitre-attack/attack-stix-data',
  version,
  notice:
    '© The MITRE Corporation. This work is reproduced and distributed with the permission of The MITRE Corporation. MITRE ATT&CK and ATT&CK are registered trademarks of The MITRE Corporation.',
  tactics,
  techniques,
  mitigations,
};
const out = join(
  dirname(new URL(import.meta.url).pathname),
  '../src/clicky/attack/enterprise-attack.kb.json',
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(kb));
console.log(
  `ATT&CK ${version}: ${tactics.length} tácticas, ${techniques.length} técnicas, ${mitigations.length} mitigaciones → ${out}`,
);
