/**
 * Provider Anthropic (requisito C), tiered (Haiku/Sonnet/Opus). Usa la Messages
 * API por HTTP (fetch), para mantener el motor sin dependencias. NO se invoca en
 * la corrida autónoma ni en los tests: cuesta dinero y requiere el checkpoint de
 * supervisión con Sebastián. Se construye explícitamente con la API key.
 *
 * Nota: por defecto usa el tier "analysis" (Sonnet 5.5) por costo, según la
 * decisión de modelos de Sebastián; la generación de módulos usa Opus 5.5.
 */
import { llmCost, type Usage } from '../core/ledger.ts';
import { ProviderRefusal } from './openai-compat.ts';
import { DEFAULT_TIERS, type AnalysisProvider, type ProposedAngle, type ProviderInput, type TierConfig } from './types.ts';

const API = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01'; // ajustar al correr de verdad (ver skill claude-api)

export interface AnthropicOpts {
  apiKey: string;
  tiers?: TierConfig;
  /** Reporta el consumo para el cost ledger. */
  onUsage?: (model: string, usage: Usage, usd: number) => void;
}

export class AnthropicProvider implements AnalysisProvider {
  readonly id = 'anthropic';
  readonly free = false;
  private readonly apiKey: string;
  private readonly tiers: TierConfig;
  private readonly onUsage?: AnthropicOpts['onUsage'];

  constructor(opts: AnthropicOpts) {
    this.apiKey = opts.apiKey;
    this.tiers = opts.tiers ?? DEFAULT_TIERS;
    this.onUsage = opts.onUsage;
  }

  private async call(model: string, system: string, user: string, maxTokens = 4096): Promise<string> {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': API_VERSION },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    const usage: Usage = { tokensIn: data.usage?.input_tokens, tokensOut: data.usage?.output_tokens, cacheReadTokens: data.usage?.cache_read_input_tokens };
    this.onUsage?.(model, usage, llmCost(model, usage));
    // Guard anti-ataque (refusal): gatilla el fallback de la cascada.
    if (data.stop_reason === 'refusal') throw new ProviderRefusal(`Claude refusal (${data.stop_details?.category ?? 'guard'})`);
    const text = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    return text;
  }

  async analyze(input: ProviderInput): Promise<ProposedAngle[]> {
    const system = 'Eres un analista de seguridad ofensiva. Dado el modelo del repo, recon y telemetría, propones ángulos de ataque concretos. Respondes SOLO un array JSON de {vuln_id?, title, rationale, where?, confidence}.';
    const user = JSON.stringify({ repo: input.repo, recon: input.recon, scope: input.scopeOrigins }).slice(0, 100_000);
    const text = await this.call(this.tiers.analysis, system, user);
    try {
      const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
}
