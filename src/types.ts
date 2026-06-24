export type Provider = 'openrouter' | 'local'

/**
 * Parámetros de generación del provider 'local' (kwargs de `model.generate` de
 * transformers.js). Tipamos los que de verdad usamos para combatir las
 * repeticiones de NLLB y dejamos abierto el resto.
 */
export interface GenerationOptions {
  /** Prohíbe repetir n-gramas de este tamaño. Evita "bull bull". */
  no_repeat_ngram_size?: number
  /** >1 penaliza tokens ya emitidos. Evita "Toro Tauro". */
  repetition_penalty?: number
  /**
   * Tope duro de tokens generados. Si no se especifica, el provider 'local' lo
   * calcula proporcional al input (los labels cortos no necesitan 256 tokens, y
   * darles tantos invita a que el modelo divague).
   */
  max_new_tokens?: number
  /** Beam search: mejora calidad a costa de velocidad. */
  num_beams?: number
  /** Corta beam search apenas hay candidatos completos. */
  early_stopping?: boolean
  [key: string]: unknown
}

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
  /** Proveedor: 'openrouter' (IA por API) o 'local' (modelo en proceso, gratis). */
  provider?: Provider
  /** Modelo en formato OpenRouter, ej: 'anthropic/claude-sonnet-4-6'. */
  model?: string
  /** API key. Por defecto toma process.env.OPENROUTER_API_KEY. */
  apiKey?: string
  /** Base URL del provider (override para self-host/proxy). */
  baseUrl?: string
  /**
   * Modelo del provider 'local' (transformers.js). Si se omite, se usa MarianMT
   * por par de idiomas (`Xenova/opus-mt-{src}-{tgt}`): chico, rápido y bueno con
   * texto corto, pero solo cubre pares publicados. Para multilingüe en un solo
   * modelo: 'Xenova/nllb-200-distilled-600M'.
   */
  localModel?: string
  /**
   * Modelo de respaldo del provider 'local' cuando el par Marian directo no
   * existe (ej. es->pt). Si se setea, en vez de fallar se cae a este modelo
   * multilingüe (ej. 'Xenova/m2m100_418M' ~0.5 GB). Solo se descarga si hace
   * falta. Sin esto, un par faltante lanza un error con las opciones.
   */
  localFallbackModel?: string
  /**
   * Precisión de los pesos del modelo 'local': 'fp32' (default), 'fp16', 'q8',
   * 'q4'. Cuantizar reduce memoria/tiempo de carga pero degrada la calidad
   * (en NLLB, bastante). Usalo solo si 'fp32' no carga por memoria.
   */
  localDtype?: string
  /**
   * Override del mapeo de códigos de idioma a FLORES-200 para el provider
   * 'local'. Ej: { gn: 'grn_Latn' }. Se mergea sobre el mapa interno.
   */
  langMap?: Record<string, string>
  /**
   * Parámetros de generación para el provider 'local'. Se mergean sobre defaults
   * anti-repetición pensados para términos cortos (labels), donde NLLB alucina.
   */
  localGeneration?: GenerationOptions
  /**
   * Traducciones fijas por idioma y key, que se aplican tal cual saltándose el
   * modelo. Imprescindible para jerga de dominio que un MT local no acierta
   * (ej. ganadería: "Novillo" -> "Steer"). Forma: { en: { "cat.NOV": "Steer" } }.
   */
  glossary?: Record<string, Record<string, string>>
  /** Ruta a un JSON con contexto por key: { "home.title": "Título del hero" }. */
  context?: string
  /** Instrucciones globales de tono/estilo para el traductor. */
  instructions?: string
  /** Cuántas keys mandar por request al LLM. Default 50. */
  batchSize?: number
  /** Reintentos cuando la validación de placeholders falla. Default 2. */
  maxRetries?: number
}

export interface ResolvedConfig {
  source: string
  targets: string[]
  path: string
  provider: Provider
  model: string
  baseUrl: string
  localModel?: string
  localFallbackModel?: string
  localDtype?: string
  langMap: Record<string, string>
  localGeneration?: GenerationOptions
  glossary: Record<string, Record<string, string>>
  batchSize: number
  maxRetries: number
  apiKey?: string
  context?: string
  instructions?: string
}
