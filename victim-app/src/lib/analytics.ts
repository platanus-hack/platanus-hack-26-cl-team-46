import { PostHog } from 'posthog-node';

// Analítica de producto. Sin POSTHOG_API_KEY no se envía nada.
const client = process.env.POSTHOG_API_KEY
  ? new PostHog(process.env.POSTHOG_API_KEY, {
      host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
      flushAt: 20,
      flushInterval: 10_000,
    })
  : null;

export function track(distinctId: string, event: string, properties: Record<string, unknown> = {}): void {
  client?.capture({ distinctId, event, properties });
}

export async function shutdownAnalytics(): Promise<void> {
  await client?.shutdown();
}
