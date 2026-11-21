/**
 * Variantes de ataque por objetivo (requisito F). Un objetivo (p. ej. SQLi) puede
 * tener varias estrategias (pasiva / error-based / blind / UNION) con distinta
 * precondición, costo, riesgo, señal/ruido y confianza. El runner prueba en orden
 * y documenta cuál usó y cuáles intentó, con fallback.
 */
import type { AttackContext, AttackStep, Exfil, Foothold } from './types.ts';

export interface AttackVariant {
  id: string;
  description: string;
  /** Costo relativo (requests/tiempo). */
  cost: 'low' | 'medium' | 'high';
  risk: 'read-only' | 'mutating' | 'destructive';
  /** Cuánto ruido deja (alarm footprint relativo). */
  signalToNoise: 'low' | 'medium' | 'high';
  /** Confianza si confirma (0..1). */
  confidence: number;
  run(ctx: AttackContext): Promise<VariantOutcome>;
}

export interface VariantOutcome {
  confirmed: boolean;
  blocked?: boolean;
  steps: AttackStep[];
  gained?: string[];
  foothold?: Foothold;
  data_exfiltrated?: Exfil;
  attacker_active?: boolean;
  summary: string;
}

export interface VariantsResult {
  confirmed: boolean;
  blocked: boolean;
  steps: AttackStep[];
  gained: string[];
  foothold?: Foothold;
  data_exfiltrated?: Exfil;
  attacker_active: boolean;
  summary: string;
  /** Variante que quedó (la que confirmó, o la última intentada). */
  variant_used: string;
  /** Todas las variantes intentadas, en orden, con su resultado. */
  variants_tried: Array<{ id: string; confirmed: boolean; confidence: number }>;
  /** Confianza de la variante que confirmó (0 si ninguna). */
  confidence: number;
}

/** Prueba las variantes en orden hasta que una confirme; documenta el camino. */
export async function runVariants(ctx: AttackContext, variants: AttackVariant[]): Promise<VariantsResult> {
  const tried: VariantsResult['variants_tried'] = [];
  const steps: AttackStep[] = [];
  let last: VariantOutcome | undefined;
  let lastId = '';

  for (const v of variants) {
    ctx.log(`  · variante ${v.id} (${v.description}) — costo ${v.cost}, ruido ${v.signalToNoise}`);
    const outcome = await v.run(ctx);
    steps.push(...outcome.steps);
    tried.push({ id: v.id, confirmed: outcome.confirmed, confidence: v.confidence });
    last = outcome;
    lastId = v.id;
    if (outcome.confirmed) {
      return {
        confirmed: true,
        blocked: false,
        steps,
        gained: outcome.gained ?? [],
        foothold: outcome.foothold,
        data_exfiltrated: outcome.data_exfiltrated,
        attacker_active: outcome.attacker_active ?? false,
        summary: outcome.summary,
        variant_used: v.id,
        variants_tried: tried,
        confidence: v.confidence,
      };
    }
    ctx.log(`  · variante ${v.id} no confirmó → fallback`);
  }

  // Ninguna confirmó: devuelve el último intento.
  return {
    confirmed: false,
    blocked: last?.blocked ?? false,
    steps,
    gained: last?.gained ?? [],
    attacker_active: false,
    summary: last?.summary ?? 'Ninguna variante confirmó.',
    variant_used: lastId,
    variants_tried: tried,
    confidence: 0,
  };
}
