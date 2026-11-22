/**
 * The only place that names the paid model. Callers pass the transport:
 * cron uses `buildCronContext(...).integrations.call`, the owner-only action
 * uses `tools.integration`. Both bill the app owner.
 */

import type { CallLLM } from './generate.js'

export const NEWS_ENDPOINT = 'anthropic/chat-completion'
export const NEWS_MODEL = 'claude-haiku-4-5'
export const NEWS_MAX_TOKENS = 200
export const NEWS_TEMPERATURE = 0.3

/** Sends a request body to an integration endpoint and returns the response data. */
export type IntegrationInvoke = (endpoint: string, body: Record<string, unknown>) => Promise<unknown>

/**
 * The response shape is undocumented (`outputSchema: null`), so accept the
 * Anthropic Messages shape, an OpenAI-style shape, or a bare string/text field.
 */
export function extractText(data: unknown): string {
  if (typeof data === 'string') return data
  if (!data || typeof data !== 'object') throw new Error('empty LLM response')
  const d = data as Record<string, unknown>
  if (Array.isArray(d.content)) {
    const text = d.content
      .map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
      .join('')
    if (text) return text
  }
  if (typeof d.content === 'string') return d.content
  if (typeof d.text === 'string') return d.text
  if (Array.isArray(d.choices)) {
    const msg = (d.choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content
    if (typeof msg === 'string') return msg
  }
  for (const key of ['data', 'response', 'message']) {
    if (d[key] && typeof d[key] === 'object') return extractText(d[key])
  }
  throw new Error('unrecognized LLM response shape')
}

export function makeCallLLM(invoke: IntegrationInvoke): CallLLM {
  return async ({ system, user }) => {
    const data = await invoke(NEWS_ENDPOINT, {
      model: NEWS_MODEL,
      max_tokens: NEWS_MAX_TOKENS,
      temperature: NEWS_TEMPERATURE,
      system,
      messages: [{ role: 'user', content: user }],
    })
    return extractText(data)
  }
}
