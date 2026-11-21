import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Token de un agente: `<sandbox_id>.<hmac>`. Se deriva del secreto maestro
 * (AGENT_API_SECRET) y solo autoriza operaciones sobre ese sandbox, así que
 * un agente comprometido (p. ej. por prompt injection desde el repo que
 * analiza) no puede tocar otros sandboxes.
 */
export function signAgentToken(secret: string, sandboxId: string): string {
  return `${sandboxId}.${mac(secret, sandboxId)}`;
}

export function verifyAgentToken(secret: string, token: string, sandboxId: string): boolean {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const id = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(secret, sandboxId));
  return id === sandboxId && given.length === expected.length && timingSafeEqual(given, expected);
}

function mac(secret: string, sandboxId: string): string {
  return createHmac('sha256', secret).update(`agent:${sandboxId}`).digest('base64url');
}
