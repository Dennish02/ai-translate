import { createOpenRouterClient } from './providers/openrouter.js'
import { checkPlaceholders } from './core/validate.js'
import type { ProviderClient } from './types.js'

export interface RuntimeOptions {
  /** Idioma activo, ej: 'es'. */
  lang: string
  /** Idioma fuente para traducción dinámica. Default 'en'. */
  sourceLang?: string
  /** Mensajes ya cargados (de los JSON generados en build-time). */
  messages?: Record<string, string>
  /** Habilita `t.dynamic()` para contenido en runtime. */
  ai?: {
    apiKey?: string
    model?: string
    /**
     * Base URL del endpoint. En browser, apuntá esto a un proxy de tu backend
     * para no exponer la API key en el cliente.
     */
    baseUrl?: string
    /** `fetch` custom (proxy, headers, auth del lado server). Default: global. */
    fetchImpl?: typeof fetch
    instructions?: string
    /** Override del cliente (tests). */
    client?: ProviderClient
  }
}

export interface Translator {
  /** Traducción de UI: lee de los mensajes cargados. */
  (key: string, params?: Record<string, string | number>): string
  /** Traducción al vuelo de texto arbitrario (con cache en memoria). */
  dynamic(text: string): Promise<string>
}

/**
 * Crea un traductor de runtime. Para la UI usa los mensajes generados por el
 * CLI (cero latencia). `dynamic()` traduce contenido arbitrario con IA + cache.
 */
export function createTranslator(opts: RuntimeOptions): Translator {
  const messages = opts.messages ?? {}
  const cache = new Map<string, string>()
  const sourceLang = opts.sourceLang ?? 'en'

  let client: ProviderClient | undefined
  if (opts.ai) {
    const { client: override, apiKey, baseUrl, fetchImpl, model } = opts.ai
    // En modo proxy la key vive en el server: alcanza con baseUrl o fetchImpl.
    if (override) {
      client = override
    } else if (apiKey || baseUrl || fetchImpl) {
      client = createOpenRouterClient({
        apiKey: apiKey ?? '',
        model: model ?? 'anthropic/claude-sonnet-4-6',
        baseUrl,
        fetchImpl,
        title: 'ai-translate-runtime',
      })
    }
  }

  const t = ((key: string, params?: Record<string, string | number>) => {
    const raw = messages[key] ?? key
    return params ? interpolate(raw, params) : raw
  }) as Translator

  t.dynamic = async (text: string): Promise<string> => {
    const cacheKey = `${opts.lang}::${text}`
    const hit = cache.get(cacheKey)
    if (hit != null) return hit
    if (!client) return text // sin IA configurada, devolvemos el original

    const out = await client.translateBatch({
      sourceLang,
      targetLang: opts.lang,
      entries: { _: text },
      instructions: opts.ai?.instructions,
    })
    const translation = out._
    if (translation == null || !checkPlaceholders(text, translation).ok) {
      return text
    }
    cache.set(cacheKey, translation)
    return translation
  }

  return t
}

/** Interpola {name} y {{name}} con los params dados. */
function interpolate(
  text: string,
  params: Record<string, string | number>,
): string {
  return text.replace(/\{\{?\s*([\w.$-]+)\s*\}?\}/g, (match, name: string) => {
    const value = params[name]
    return value == null ? match : String(value)
  })
}
