// ElevenLabs: voz de Clicky (texto a voz con tiempos por carácter) y reconocimiento
// de lo que dice el usuario (Scribe, en vivo o al soltar). Docs: https://elevenlabs.io/docs/api-reference
const API = 'https://api.elevenlabs.io/v1';

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Audio listo para el navegador: mp3 en base64 y en qué segundo empieza cada palabra. */
export interface Speech {
  audio: string;
  mime: string;
  words: number[];
  duration: number;
}

/**
 * Segundo en que empieza cada palabra, separando por espacios igual que el
 * navegador (`text.split(/\s+/)`), para que el subtítulo siga a la voz.
 */
export function wordStarts(alignment: Alignment): {
  words: number[];
  duration: number;
} {
  const words: number[] = [];
  let inWord = false;
  alignment.characters.forEach((c, i) => {
    if (/\s/.test(c)) inWord = false;
    else if (!inWord) {
      inWord = true;
      words.push(alignment.character_start_times_seconds[i] ?? 0);
    }
  });
  const duration = alignment.character_end_times_seconds.at(-1) ?? 0;
  return { words, duration };
}

/**
 * ElevenLabs respondió con error: `status` es el código HTTP (0 si no hubo respuesta) y
 * `detail`, lo que dijo (para saber si el modelo no está disponible).
 */
export class TtsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail = '',
  ) {
    super(message);
  }
}

/**
 * Eleven v3 y v4 (v4 Turbo incluido) solo van por Text to Dialogue; Flash y Multilingual,
 * por Text to Speech. Los dos devuelven el audio con sus tiempos por carácter.
 */
export const isDialogueModel = (model: string) => /^eleven_v[34]/.test(model);

export async function textToSpeech(opts: {
  key: string;
  voiceId: string;
  model: string;
  format: string;
  text: string;
  previousText?: string;
  nextText?: string;
  timeoutMs?: number;
  /** Se corta si el cliente se fue: no se sigue esperando (ni pagando) esta voz. */
  signal?: AbortSignal;
}): Promise<Speech> {
  const format = `output_format=${encodeURIComponent(opts.format)}`;
  const dialogue = isDialogueModel(opts.model);
  const url = dialogue
    ? `${API}/text-to-dialogue/with-timestamps?${format}`
    : `${API}/text-to-speech/${encodeURIComponent(opts.voiceId)}/with-timestamps?${format}`;
  const body = dialogue
    ? {
        // Un solo hablante: Hinty. v4 entiende "32 %" sin forzar la normalización.
        inputs: [{ text: opts.text, voice_id: opts.voiceId }],
        model_id: opts.model,
        language_code: 'es',
        previous_text: opts.previousText?.slice(-100) || undefined,
      }
    : {
        text: opts.text,
        model_id: opts.model,
        language_code: 'es',
        // Flash no normaliza números por defecto: "32 %" se leería mal.
        apply_text_normalization: 'on',
        previous_text: opts.previousText,
        next_text: opts.nextText,
      };
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': opts.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([
        ...(opts.signal ? [opts.signal] : []),
        AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      ]),
    });
  } catch (err) {
    throw new TtsError(`ElevenLabs TTS: ${(err as Error).message}`, 0);
  }
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw new TtsError(`ElevenLabs TTS: ${(err as Error).message}`, 0);
  }
  if (!res.ok)
    throw new TtsError(
      `ElevenLabs TTS ${res.status} (${opts.model}): ${text.slice(0, 200)}`,
      res.status,
      text.slice(0, 500),
    );
  const data = JSON.parse(text) as {
    audio_base64: string;
    alignment: Alignment;
  };
  return {
    audio: data.audio_base64,
    mime: 'audio/mpeg',
    ...wordStarts(data.alignment),
  };
}

/** Términos del simulador que el reconocimiento de voz debe escuchar bien. */
export const KEYTERMS = [
  'JWT',
  'JWT_SECRET',
  'IDOR',
  'SQL injection',
  'XSS',
  'token',
  'endpoint',
  'deploy',
  'redeploy',
  'Render',
  'Sentry',
  'Datadog',
  'PostHog',
  'Slack',
  'GitHub',
  'rate limit',
  'mass assignment',
  'hash',
  'password',
  'rotar secretos',
  'parche',
  'sandbox',
];

export async function speechToText(opts: {
  key: string;
  model: string;
  audio: Buffer;
  mime: string;
}): Promise<string> {
  const send = async (withKeyterms: boolean) => {
    const form = new FormData();
    const ext = opts.mime.includes('mp4')
      ? 'mp4'
      : opts.mime.includes('ogg')
        ? 'ogg'
        : 'webm';
    form.append(
      'file',
      new Blob([new Uint8Array(opts.audio)], { type: opts.mime }),
      `audio.${ext}`,
    );
    form.append('model_id', opts.model);
    form.append('language_code', 'es');
    form.append('tag_audio_events', 'false');
    form.append('no_verbatim', 'true');
    if (withKeyterms) for (const k of KEYTERMS) form.append('keyterms', k);
    return fetch(`${API}/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': opts.key },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  };
  let res = await send(true);
  // Si la API rechaza los keyterms (formato o plan), se reintenta sin ellos.
  if (res.status === 400 || res.status === 422) res = await send(false);
  const body = await res.text();
  if (!res.ok)
    throw new Error(`ElevenLabs STT ${res.status}: ${body.slice(0, 200)}`);
  return ((JSON.parse(body) as { text?: string }).text ?? '').trim();
}

/**
 * Dirección del WebSocket de transcripción en vivo, con un token de un solo uso: el
 * navegador manda el audio directo a ElevenLabs mientras el usuario habla, sin ver la
 * key. El token se consume al conectar, vence en 15 minutos y la sesión se corta a los
 * `maxSeconds`.
 */
export async function realtimeSttUrl(opts: {
  key: string;
  model: string;
  maxSeconds: number;
}): Promise<string> {
  const res = await fetch(
    `${API}/single-use-token/realtime_scribe?max_session_duration_seconds=${opts.maxSeconds}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': opts.key },
      signal: AbortSignal.timeout(8_000),
    },
  );
  const body = await res.text();
  if (!res.ok)
    throw new Error(`ElevenLabs token ${res.status}: ${body.slice(0, 200)}`);
  const { token } = JSON.parse(body) as { token: string };
  return liveSttUrl(opts.model, token);
}

export function liveSttUrl(model: string, token: string): string {
  const q = new URLSearchParams({
    model_id: model,
    token,
    audio_format: 'pcm_16000',
    language_code: 'es',
    commit_strategy: 'manual',
    no_verbatim: 'true',
  });
  for (const k of KEYTERMS) q.append('keyterms', k);
  return `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${q}`;
}
