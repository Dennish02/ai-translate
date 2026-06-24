export type Provider = 'openrouter'

export interface ProviderClient {
  /**
   * Traduce un lote de entradas. Devuelve un mapa key -> texto traducido.
   * Debe respetar los placeholders del texto fuente (no traducirlos).
   */
  translateBatch(input: TranslateBatchInput): Promise<Record<string, string>>
}

export interface TranslateBatchInput {
  sourceLang: string
  targetLang: string
  /** key -> texto en el idioma fuente */
  entries: Record<string, string>
  /** key -> descripción/contexto opcional para desambiguar */
  context?: Record<string, string>
  /** instrucciones extra de tono/estilo para todo el proyecto */
  instructions?: string
}

export interface AiI18nConfig {
  /** Idioma fuente (verdad de referencia), ej: 'en' */
  source: string
  /** Idiomas a generar, ej: ['es', 'pt'] */
  targets: string[]
  /**
   * Patrón de ruta de los archivos de locale. Debe incluir `{lang}`.
   * Ej: './locales/{lang}.json'
   */
  path: string
  /** Proveedor de IA. Por ahora 'openrouter'. */
  provider?: Provider
  /** Modelo en formato OpenRouter, ej: 'anthropic/claude-sonnet-4-6'. */
  model?: string
  /** API key. Por defecto toma process.env.OPENROUTER_API_KEY. */
  apiKey?: string
  /** Base URL del provider (override para self-host/proxy). */
  baseUrl?: string
  /** Ruta a un JSON con contexto por key: { "home.title": "Título del hero" }. */
  context?: string
  /** Instrucciones globales de tono/estilo para el traductor. */
  instructions?: string
  /** Cuántas keys mandar por request al LLM. Default 50. */
  batchSize?: number
  /** Reintentos cuando la validación de placeholders falla. Default 2. */
  maxRetries?: number
}

export type ResolvedConfig = Required<
  Omit<AiI18nConfig, 'context' | 'instructions' | 'apiKey'>
> & {
  context?: string
  instructions?: string
  apiKey?: string
}
