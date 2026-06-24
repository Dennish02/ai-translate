import { maskPlaceholders, unmaskPlaceholders } from '../core/validate.js'
import type {
  GenerationOptions,
  ProviderClient,
  TranslateBatchInput,
} from '../types.js'

export type { GenerationOptions } from '../types.js'

/**
 * Provider 'local': traduce con un modelo MT corriendo dentro de Node vía
 * transformers.js. Sin API key, sin costo, offline.
 *
 * Por defecto usa **MarianMT** (`Xenova/opus-mt-{src}-{tgt}`): modelos bilingües
 * chicos y rápidos, muy buenos con texto corto de UI. Como son por par de
 * idiomas, solo se descarga el que necesitás. Para pares sin modelo Marian
 * publicado, seteá `model` a uno multilingüe (ej. NLLB: cubre 200 idiomas en un
 * solo modelo, pero divaga más con labels sueltos).
 *
 * Compromiso vs. un LLM: estos modelos no "entienden" placeholders, así que los
 * enmascaramos (`[0]`, `[1]`) antes de traducir y los restauramos después. ICU
 * complejo (`{count, plural, ...}`) puede no sobrevivir: para eso conviene un
 * provider LLM (openrouter).
 */

/** Familia del modelo: define cómo se le pasan los idiomas. */
type ModelFamily = 'marian' | 'nllb' | 'm2m'

/** Firma mínima del pipeline de traducción de transformers.js. */
export type TranslatePipeline = (
  texts: string[],
  // Marian es bilingüe y no recibe códigos; NLLB/M2M sí (src_lang/tgt_lang).
  options: { src_lang?: string; tgt_lang?: string } & GenerationOptions,
) => Promise<Array<{ translation_text: string }>>

export interface LocalOptions {
  /**
   * Modelo HF. Si se omite, se usa MarianMT por par: `Xenova/opus-mt-{src}-{tgt}`.
   * Para multilingüe en un solo modelo: 'Xenova/nllb-200-distilled-600M'.
   */
  model?: string
  /**
   * Modelo de respaldo cuando el par Marian directo no existe (ej. es->pt no
   * está en ONNX). Si se setea, en vez de fallar caemos a este modelo
   * multilingüe (ej. 'Xenova/m2m100_418M' ~0.5 GB, o NLLB ~1.9 GB). Solo se
   * descarga si de verdad hace falta. Sin esto, un par faltante lanza un error.
   */
  fallbackModel?: string
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
 * Defaults anti-repetición SOLO para NLLB/M2M: con palabras sueltas tienden a
 * repetir tokens ("Bull The bull Bull") o a divagar. Estos valores lo cortan.
 *
 * MarianMT NO los recibe: decodifica limpio por su cuenta y forzarle estos
 * parámetros (pensados para otra familia) le mete ruido (puntuación de más,
 * marcadores de localización). Para Marian dejamos el decoding natural.
 *
 * `max_new_tokens` tampoco va acá: para NLLB/M2M lo calculamos proporcional al
 * input (ver {@link estimateMaxNewTokens}); para Marian no lo fijamos.
 */
const ANTI_REPEAT_GENERATION: GenerationOptions = {
  no_repeat_ngram_size: 3,
  repetition_penalty: 1.3,
  early_stopping: true,
}

/**
 * Estima el tope de tokens de salida a partir del input más largo del lote.
 * Una traducción rara vez supera ~3x la longitud del fuente; el +8 da aire a
 * los textos muy cortos. El cap de 512 evita runaways en inputs largos.
 */
function estimateMaxNewTokens(texts: string[]): number {
  const longest = texts.reduce((max, t) => {
    const words = t.trim() ? t.trim().split(/\s+/).length : 0
    return Math.max(max, words)
  }, 0)
  return Math.min(512, longest * 3 + 8)
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
  const langMap = { ...FLORES, ...opts.langMap }
  const load =
    opts.loadPipeline ?? ((m: string) => defaultLoadPipeline(m, opts.dtype))

  // Cargar un modelo es caro: cacheamos un pipeline por nombre de modelo. Con el
  // default Marian (por par) eso es uno por idioma destino; con NLLB, uno solo.
  const pipes = new Map<string, Promise<TranslatePipeline>>()
  const loadCached = (model: string): Promise<TranslatePipeline> => {
    let p = pipes.get(model)
    if (!p) {
      p = load(model)
      pipes.set(model, p)
    }
    return p
  }

  /**
   * Resuelve y carga el modelo para un par. Con el default Marian (por par), si
   * el modelo no existe cae a `fallbackModel` si está configurado; si no, lanza
   * un error claro con las opciones.
   */
  const resolveTranslator = async (
    src: string,
    tgt: string,
  ): Promise<{ model: string; translator: TranslatePipeline }> => {
    const primary = opts.model ?? marianModel(src, tgt)
    try {
      return { model: primary, translator: await loadCached(primary) }
    } catch (err) {
      pipes.delete(primary) // no cachear un fallo
      const usingDefaultMarian = !opts.model && modelFamily(primary) === 'marian'
      if (usingDefaultMarian && opts.fallbackModel) {
        try {
          return {
            model: opts.fallbackModel,
            translator: await loadCached(opts.fallbackModel),
          }
        } catch (fbErr) {
          pipes.delete(opts.fallbackModel)
          throw new Error(
            `[ai-translate] falló el modelo Marian "${primary}" (${src}->${tgt}) ` +
              `y también el fallback "${opts.fallbackModel}". ` +
              `Detalle: ${(fbErr as Error).message}`,
          )
        }
      }
      if (usingDefaultMarian) {
        throw new Error(
          `[ai-translate] no pude cargar el modelo Marian "${primary}" para ` +
            `${src}->${tgt}: ese par no está publicado en ONNX. Opciones: ` +
            `(1) localFallbackModel: 'Xenova/m2m100_418M' para caer a un ` +
            `multilingüe automáticamente; (2) localModel: ` +
            `'Xenova/nllb-200-distilled-600M'; o (3) usá el provider 'openrouter'. ` +
            `Detalle: ${(err as Error).message}`,
        )
      }
      throw err
    }
  }

  return {
    async translateBatch(input: TranslateBatchInput) {
      const keys = Object.keys(input.entries)
      if (keys.length === 0) return {}

      const { sourceLang, targetLang } = input

      const masked = keys.map((k) => maskPlaceholders(input.entries[k]!))
      const maskedTexts = masked.map((m) => m.masked)

      const { model, translator } = await resolveTranslator(sourceLang, targetLang)
      const family = modelFamily(model)

      // Idiomas: Marian es bilingüe (no recibe códigos); NLLB usa FLORES-200;
      // M2M-100 usa ISO 639-1.
      const langOpts =
        family === 'nllb'
          ? { src_lang: toFlores(sourceLang, langMap), tgt_lang: toFlores(targetLang, langMap) }
          : family === 'm2m'
            ? { src_lang: short(sourceLang), tgt_lang: short(targetLang) }
            : {}

      // Marian decodifica natural (sin anti-repetición ni tope forzado); NLLB/M2M
      // sí necesitan los frenos. En ambos casos el usuario puede sobreescribir.
      let gen: GenerationOptions
      if (family === 'marian') {
        gen = { ...opts.generation }
      } else {
        gen = { ...ANTI_REPEAT_GENERATION, ...opts.generation }
        if (gen.max_new_tokens == null) {
          gen.max_new_tokens = estimateMaxNewTokens(maskedTexts)
        }
      }

      const outputs = await translator(maskedTexts, { ...langOpts, ...gen })

      const result: Record<string, string> = {}
      keys.forEach((key, i) => {
        let raw = outputs[i]?.translation_text
        if (raw == null) return
        if (family === 'marian') raw = stripKdeMarkers(raw)
        result[key] = unmaskPlaceholders(raw, masked[i]!.tokens)
      })
      return result
    },
  }
}

/** Nombre del modelo Marian por par de idiomas (códigos ISO 639-1). */
function marianModel(src: string, tgt: string): string {
  return `Xenova/opus-mt-${short(src)}-${short(tgt)}`
}

/** Reduce un código a ISO 639-1 (toma las 2 primeras letras: 'spa_Latn' -> 'sp' no aplica; usá códigos cortos). */
function short(lang: string): string {
  return lang.slice(0, 2).toLowerCase()
}

/**
 * Quita los marcadores de contexto de localización KDE/Qt que MarianMT (OPUS)
 * a veces pega en strings cortos, p.ej. "Guardar@info: whatsthis". Son ruido de
 * su data de entrenamiento y jamás forman parte de una traducción real.
 */
function stripKdeMarkers(text: string): string {
  return text
    .replace(
      /\s*@(info|action|title|label|option|item|tooltip|status|message|note)\b.*$/is,
      '',
    )
    .trim()
}

/** Detecta la familia del modelo por su nombre para saber cómo pasar idiomas. */
function modelFamily(model: string): ModelFamily {
  const m = model.toLowerCase()
  if (m.includes('nllb')) return 'nllb'
  if (m.includes('m2m')) return 'm2m'
  return 'marian' // opus-mt y bilingües en general
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
