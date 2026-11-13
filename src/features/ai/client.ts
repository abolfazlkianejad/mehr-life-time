/**
 * Thin client for the optional server-side AI endpoint.
 *
 * Security rules enforced here:
 * - no API key is bundled in the client; only the endpoint URL is configurable
 *   (`VITE_AGENT_API_URL`), and the endpoint itself must hold any secret,
 * - every call is user-triggered (the UI never calls this on its own),
 * - failures are surfaced as errors so a module can fall back to local logic.
 */

const DEFAULT_TIMEOUT_MS = 20_000

export interface AiRequestOptions {
  /** Optional system instruction appended to the user prompt. */
  system?: string
  timeoutMs?: number
  /** Locale hint so the model answers in the right language. */
  locale?: string
}

export interface AiTextResult {
  text: string
  /** `true` when the answer came from the configured endpoint. */
  remote: boolean
}

/** `true` when an AI endpoint is configured in the environment. */
export function isAiConfigured(): boolean {
  const endpoint = import.meta.env.VITE_AGENT_API_URL
  return typeof endpoint === 'string' && endpoint.trim().length > 0
}

/** Endpoint URL or an empty string; never contains a secret. */
export function getAiEndpoint(): string {
  const endpoint = import.meta.env.VITE_AGENT_API_URL
  return typeof endpoint === 'string' ? endpoint.trim() : ''
}

function extractText(payload: unknown): string | undefined {
  if (typeof payload === 'string') return payload
  if (!payload || typeof payload !== 'object') return undefined
  const value = payload as {
    text?: unknown
    output_text?: unknown
    choices?: { message?: { content?: unknown } }[]
    candidates?: { content?: { parts?: { text?: unknown }[] } }[]
  }
  if (typeof value.text === 'string') return value.text
  if (typeof value.output_text === 'string') return value.output_text
  const openAi = value.choices?.[0]?.message?.content
  if (typeof openAi === 'string') return openAi
  const gemini = value.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter((text): text is string => typeof text === 'string')
    .join('\n')
  return gemini || undefined
}

/**
 * Sends one prompt to the configured endpoint and returns the plain answer.
 * Throws when the endpoint is missing or the request fails.
 */
export async function requestAiText(
  prompt: string,
  options: AiRequestOptions = {}
): Promise<string> {
  const endpoint = getAiEndpoint()
  if (!endpoint) throw new Error('AI endpoint is not configured')
  const trimmed = prompt.trim()
  if (!trimmed) throw new Error('AI prompt must not be empty')

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: trimmed,
      ...(options.system ? { system: options.system } : {}),
      locale: options.locale ?? document.documentElement.lang,
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`AI endpoint returned ${response.status}`)
  const answer = extractText(await response.json())
  if (!answer?.trim()) throw new Error('AI endpoint returned an empty answer')
  return answer.trim()
}

/**
 * Requests a JSON answer and parses it. The prompt must ask for JSON only.
 * Small numeric deviations are rejected instead of silently accepted.
 */
export async function requestAiJson<T>(
  prompt: string,
  options: AiRequestOptions = {}
): Promise<T> {
  const text = await requestAiText(prompt, options)
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI answer did not contain a JSON object')
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as T
  } catch {
    throw new Error('AI answer was not valid JSON')
  }
}
