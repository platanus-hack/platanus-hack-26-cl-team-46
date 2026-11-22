/**
 * Cascada de providers con failover (reliability + costo). Intenta cada provider
 * en orden; si uno lanza (error, refusal/guard anti-ataque, timeout) pasa al
 * siguiente. Orden por defecto: Claude Sonnet 4.5 → DeepSeek → GLM.
 */
import { AnthropicProvider } from './anthropic.ts';
import { OpenAICompatProvider } from './openai-compat.ts';
import type { AnalysisProvider, GeneratedArtifact, ProbeGenInput, ProbeSpec, ProposedAngle, ProviderInput } from './types.ts';
import type { Usage } from '../core/ledger.ts';

export interface CascadeAttempt {
  provider: string;
  ok: boolean;
  error?: string;
}

export class CascadeProvider implements AnalysisProvider {
  readonly id = 'cascade';
  readonly free = false;
  readonly attempts: CascadeAttempt[] = [];
  private readonly providers: AnalysisProvider[];

  constructor(providers: AnalysisProvider[]) {
    this.providers = providers;
  }

  async analyze(input: ProviderInput): Promise<ProposedAngle[]> {
    let lastErr: unknown;
    for (const p of this.providers) {
      try {
        const angles = await p.analyze(input);
        this.attempts.push({ provider: p.id, ok: true });
        return angles;
      } catch (e) {
        lastErr = e;
        this.attempts.push({ provider: p.id, ok: false, error: e instanceof Error ? e.message : String(e) });
        // sigue al siguiente provider
      }
    }
    throw new Error(`todos los providers fallaron: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
  }

  async generateProbes(input: ProbeGenInput): Promise<ProbeSpec[]> {
    let lastErr: unknown;
    for (const p of this.providers) {
      if (!p.generateProbes) continue;
      try {
        const specs = await p.generateProbes(input);
        this.attempts.push({ provider: p.id, ok: true });
        return specs;
      } catch (e) {
        lastErr = e;
        this.attempts.push({ provider: p.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    throw new Error(`ningún provider generó probes: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
  }

  async adapt(input: ProviderInput, baseModuleId: string): Promise<GeneratedArtifact> {
    for (const p of this.providers) {
      if (!p.adapt) continue;
      try {
        return await p.adapt(input, baseModuleId);
      } catch {
        /* siguiente */
      }
    }
    throw new Error('ningún provider pudo adaptar el módulo');
  }
}

/**
 * Construye la cascada desde las variables de entorno disponibles:
 *   ANTHROPIC_API_KEY → Claude Sonnet 4.5 (primario)
 *   DEEPSEEK_API_KEY  → DeepSeek (fallback)
 *   GLM_API_KEY / ZHIPU_API_KEY → GLM (fallback)
 */
export function buildCascadeFromEnv(
  env: Record<string, string | undefined> = process.env,
  onUsage?: (model: string, usage: Usage, usd: number) => void,
): CascadeProvider | undefined {
  const providers: AnalysisProvider[] = [];
  if (env.ANTHROPIC_API_KEY) {
    providers.push(new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, tiers: { triage: 'claude-haiku-5-5', analysis: 'claude-sonnet-4-5', generation: 'claude-sonnet-4-5' }, onUsage }));
  }
  if (env.DEEPSEEK_API_KEY) {
    providers.push(new OpenAICompatProvider({ id: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: env.DEEPSEEK_API_KEY, model: 'deepseek-chat', onUsage }));
  }
  const glmKey = env.GLM_API_KEY ?? env.ZHIPU_API_KEY;
  if (glmKey) {
    providers.push(new OpenAICompatProvider({ id: 'glm', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: glmKey, model: 'glm-4', onUsage }));
  }
  return providers.length ? new CascadeProvider(providers) : undefined;
}
