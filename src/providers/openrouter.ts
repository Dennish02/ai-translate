import { buildMessages } from '../core/prompt.js'
import type { ProviderClient, TranslateBatchInput } from '../types.js'

export interface OpenRouterOptions {
  apiKey: string
  model: string
  baseUrl?: string
  /** Para el ranking de OpenRouter (opcional). */
  referer?: string
  title?: string
  fetchImpl?: typeof fetch
}

/**
 * Cliente compatible con la API de OpenRouter (esquema OpenAI chat/completions).
 * Una sola key da acceso a Claude, GPT, etc. eligiendo `model`.
 */
export function createOpenRouterClient(opts: OpenRouterOptions): ProviderClient {
  const baseUrl = opts.baseUrl ?? 'https://openrouter.ai/api/v1'
  const doFetch = opts.fetchImpl ?? fetch

  return {
    async translateBatch(input: TranslateBatchInput) {
      const { system, user } = buildMessages(input)

      const res = await doFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
          ...(opts.referer ? { 'HTTP-Referer': opts.referer } : {}),
          ...(opts.title ? { 'X-Title': opts.title } : {}),
        },
        body: JSON.stringify({
          model: opts.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(
          `[ai-translate] OpenRouter respondió ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
        )
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[]
      }
      const content = data.choices?.[0]?.message?.content
      if (!content) {
        throw new Error('[ai-translate] respuesta vacía del modelo')
      }

      return parseTranslations(content, input.entries)
    },
  }
}

/** Parsea el JSON del modelo de forma tolerante (a veces viene con ```json). */
export function parseTranslations(
  content: string,
  entries: Record<string, string>,
): Record<string, string> {
  const json = stripCodeFence(content).trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    // Último recurso: agarrar el primer objeto {...} del texto.
    const match = json.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('[ai-translate] no pude parsear JSON del modelo')
    parsed = JSON.parse(match[0])
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('[ai-translate] el modelo no devolvió un objeto JSON')
  }

  const result: Record<string, string> = {}
  for (const key of Object.keys(entries)) {
    const value = (parsed as Record<string, unknown>)[key]
    if (typeof value === 'string') result[key] = value
  }
  return result
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '')
}
