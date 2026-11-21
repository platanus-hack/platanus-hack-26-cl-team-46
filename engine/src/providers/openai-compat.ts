/**
 * Provider para APIs compatibles con OpenAI (DeepSeek, GLM). Se usan como
 * fallback de Claude en la cascada cuando Claude falla, lo frenan guards o se
 * acaban los créditos. HTTP puro (sin dependencias).
 */
import { llmCost, type Usage } from '../core/ledger.ts';
import type { AnalysisProvider, ProposedAngle, ProviderInput } from './types.ts';

export class ProviderRefusal extends Error {}

export interface OpenAICompatOpts {
  id: string;
  baseUrl: string; // p.ej. https://api.deepseek.com
  apiKey: string;
  model: string; // p.ej. deepseek-chat | glm-4
  onUsage?: (model: string, usage: Usage, usd: number) => void;
}

export class OpenAICompatProvider implements AnalysisProvider {
  readonly id: string;
  readonly free = false;
  private readonly o: OpenAICompatOpts;

  constructor(o: OpenAICompatOpts) {
    this.o = o;
    this.id = o.id;
  }

  async analyze(input: ProviderInput): Promise<ProposedAngle[]> {
    const system = 'Eres un analista de seguridad ofensiva para un sandbox autorizado. Respondes SOLO un array JSON de {vuln_id?, title, rationale, where?, confidence}.';
    const user = JSON.stringify({ repo: input.repo, recon: input.recon, scope: input.scopeOrigins }).slice(0, 100_000);
    const res = await fetch(`${this.o.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.apiKey}` },
      body: JSON.stringify({ model: this.o.model, max_tokens: 4096, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) throw new Error(`${this.id} ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    const usage: Usage = { tokensIn: data.usage?.prompt_tokens, tokensOut: data.usage?.completion_tokens };
    this.o.onUsage?.(this.o.model, usage, llmCost(this.o.model, usage));
    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text) throw new ProviderRefusal(`${this.id}: respuesta vacía`);
    try {
      const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
}
