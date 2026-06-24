import { maskPlaceholders, unmaskPlaceholders } from '../core/validate.js'
import type {
  GenerationOptions,
  ProviderClient,
  TranslateBatchInput,
} from '../types.js'

export type { GenerationOptions } from '../types.js'

/**
 * Provider 'local': traduce con un modelo MT corriendo dentro de Node vía
 * transformers.js (por defecto NLLB-200). Sin API key, sin costo, offline.
 *
 * Compromiso vs. un LLM: NLLB es excelente traduciendo pero no "entiende"
 * placeholders, así que los enmascaramos (`[0]`, `[1]`) antes de traducir y los
 * restauramos después. ICU complejo (`{count, plural, ...}`) puede no
 * sobrevivir: para eso conviene un provider LLM (openrouter).
 */

/** Firma mínima del pipeline de traducción de transformers.js. */
export type TranslatePipeline = (
  texts: string[],
  options: { src_lang: string; tgt_lang: string } & GenerationOptions,
) => Promise<Array<{ translation_text: string }>>

export interface LocalOptions {
  /** Modelo HF. Default: 'Xenova/nllb-200-distilled-600M'. */
  model?: string
  /**
   * Precisión de los pesos ONNX: 'fp32' (default, mejor calidad), 'fp16',
   * 'q8', 'q4'... Los cuantizados pesan y cargan menos pero degradan la calidad
   * (en NLLB, bastante). Útil si 'fp32' no carga por falta de memoria.
   */
  dtype?: string
  /** Override/extensión del mapa de códigos de idioma a FLORES-200. */
  langMap?: Record<string, string>
  /**
   * Parámetros de generación. Se mergean sobre los defaults pensados para
   * términos cortos sin contexto (labels), que es donde NLLB más alucina.
   * Ver {@link GenerationOptions}.
   */
  generation?: GenerationOptions
  /** Inyección del cargador de pipeline (para tests). */
  loadPipeline?: (model: string) => Promise<TranslatePipeline>
}

/**
 * Defaults anti-repetición. NLLB es muy bueno con oraciones, pero con palabras
 * sueltas tiende a repetir tokens ("Bull The bull Bull"). Estos valores cortan
 * ese comportamiento sin degradar la traducción de frases normales.
 */
const DEFAULT_GENERATION: GenerationOptions = {
  no_repeat_ngram_size: 3,
  repetition_penalty: 1.3,
  max_new_tokens: 256,
}

/**
 * Mapa de códigos cortos (ISO 639-1) a códigos FLORES-200 que usa NLLB.
 * Cubrimos los más comunes; cualquier otro se puede agregar vía `langMap`.
 */
const FLORES: Record<string, string> = {
  en: 'eng_Latn',
  es: 'spa_Latn',
  pt: 'por_Latn',
  fr: 'fra_Latn',
  de: 'deu_Latn',
  it: 'ita_Latn',
  nl: 'nld_Latn',
  ca: 'cat_Latn',
  gl: 'glg_Latn',
  ru: 'rus_Cyrl',
  uk: 'ukr_Cyrl',
  pl: 'pol_Latn',
  tr: 'tur_Latn',
  ar: 'arb_Arab',
  he: 'heb_Hebr',
  hi: 'hin_Deva',
  ja: 'jpn_Jpan',
  ko: 'kor_Hang',
  zh: 'zho_Hans',
  vi: 'vie_Latn',
  id: 'ind_Latn',
  th: 'tha_Thai',
  sv: 'swe_Latn',
  da: 'dan_Latn',
  fi: 'fin_Latn',
  no: 'nob_Latn',
  cs: 'ces_Latn',
  ro: 'ron_Latn',
  hu: 'hun_Latn',
  el: 'ell_Grek',
}

export function createLocalClient(opts: LocalOptions = {}): ProviderClient {
  const model = opts.model ?? 'Xenova/nllb-200-distilled-600M'
  const langMap = { ...FLORES, ...opts.langMap }
  const generation = { ...DEFAULT_GENERATION, ...opts.generation }
  const load =
    opts.loadPipeline ?? ((m: string) => defaultLoadPipeline(m, opts.dtype))

  // Cargar el modelo es caro: lo hacemos una sola vez por cliente.
  let pipePromise: Promise<TranslatePipeline> | undefined

  return {
    async translateBatch(input: TranslateBatchInput) {
      const src = toFlores(input.sourceLang, langMap)
      const tgt = toFlores(input.targetLang, langMap)

      const keys = Object.keys(input.entries)
      if (keys.length === 0) return {}

      const masked = keys.map((k) => maskPlaceholders(input.entries[k]!))

      if (!pipePromise) pipePromise = load(model)
      const translator = await pipePromise

      const outputs = await translator(masked.map((m) => m.masked), {
        src_lang: src,
        tgt_lang: tgt,
        ...generation,
      })

      const result: Record<string, string> = {}
      keys.forEach((key, i) => {
        const raw = outputs[i]?.translation_text
        if (raw == null) return
        result[key] = unmaskPlaceholders(raw, masked[i]!.tokens)
      })
      return result
    },
  }
}

function toFlores(lang: string, map: Record<string, string>): string {
  // Si ya viene en formato FLORES (xxx_Yyyy) lo respetamos.
  if (/^[a-z]{3}_[A-Z][a-z]{3}$/.test(lang)) return lang
  const code = map[lang] ?? map[lang.slice(0, 2)]
  if (!code) {
    throw new Error(
      `[ai-translate] no conozco el código FLORES-200 para "${lang}". ` +
        `Agregalo en la config con langMap: { "${lang}": "xxx_Yyyy" }.`,
    )
  }
  return code
}

async function defaultLoadPipeline(
  model: string,
  dtype?: string,
): Promise<TranslatePipeline> {
  let mod: {
    pipeline: (
      task: string,
      model: string,
      options?: Record<string, unknown>,
    ) => Promise<unknown>
  }
  try {
    // Import opcional: solo se necesita si se usa el provider 'local'.
    // Specifier no-literal a propósito: evita que TS resuelva el peer dep
    // opcional en build-time (puede no estar instalado).
    const pkg = '@huggingface/transformers'
    mod = (await import(pkg)) as typeof mod
  } catch {
    throw new Error(
      '[ai-translate] el provider "local" necesita @huggingface/transformers. ' +
        'Instalalo con: npm install @huggingface/transformers',
    )
  }
  const options = dtype ? { dtype } : undefined
  const pipe = (await mod.pipeline(
    'translation',
    model,
    options,
  )) as TranslatePipeline
  return pipe
}
