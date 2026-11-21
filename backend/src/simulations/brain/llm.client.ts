import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Modelo y esfuerzo de una tarea del cerebro (context, generator, observer, debrief). */
export interface TaskModel {
  model: string;
  effort: Effort;
  maxTokens: number;
  timeoutMs: number;
}

export interface StructuredCall<S extends z.ZodType> {
  model: TaskModel;
  /** Instrucciones del rol (iguales en todas las llamadas). */
  system: string;
  /** Datos estables de la simulación (contexto, plan): van cacheados después del system. */
  stable?: string;
  /** Lo que cambia en cada llamada (eventos nuevos, estado actual). */
  prompt: string;
  schema: S;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  ms: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

export class LlmRefusalError extends Error {}

/**
 * Llamadas a la API de Claude con salida estructurada (JSON validado con Zod).
 * Sin estado y sin Nest: lo usan el SimulationBrain y el script de replay.
 */
export class SimLlm {
  constructor(private readonly client: Anthropic) {}

  static fromApiKey(apiKey: string) {
    return new SimLlm(new Anthropic({ apiKey }));
  }

  async structured<S extends z.ZodType>(
    call: StructuredCall<S>,
  ): Promise<StructuredResult<z.infer<S>>> {
    const { model } = call;
    const started = Date.now();
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: 'text', text: call.system },
    ];
    if (call.stable)
      system.push({
        type: 'text',
        text: call.stable,
        cache_control: { type: 'ephemeral' },
      });
    // Fallback del servidor ante un rechazo de los clasificadores de seguridad:
    // el tema (ataques a una app) puede gatillar la categoría `cyber`.
    const fallback = /^claude-(opus|sonnet|fable)-/.test(model.model)
      ? {
          betas: [
            'server-side-fallback-2026-07-01',
          ] as Anthropic.Beta.AnthropicBeta[],
          fallbacks: 'default' as const,
        }
      : {};
    const res = await this.client.beta.messages.parse(
      {
        model: model.model,
        max_tokens: model.maxTokens,
        system,
        messages: [{ role: 'user', content: call.prompt }],
        output_config: {
          effort: model.effort,
          format: betaZodOutputFormat(call.schema),
        },
        ...fallback,
      },
      { timeout: model.timeoutMs },
    );
    if (res.stop_reason === 'refusal')
      throw new LlmRefusalError(
        `${model.model} rechazó la tarea (${res.stop_details?.category ?? 'sin categoría'})`,
      );
    if (res.stop_reason === 'max_tokens')
      throw new Error(
        `${model.model} se quedó sin tokens (max_tokens=${model.maxTokens})`,
      );
    if (!res.parsed_output)
      throw new Error(`${model.model} no devolvió JSON válido`);
    return {
      data: res.parsed_output as z.infer<S>,
      model: res.model,
      ms: Date.now() - started,
      usage: {
        input_tokens: res.usage.input_tokens,
        output_tokens: res.usage.output_tokens,
        cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
