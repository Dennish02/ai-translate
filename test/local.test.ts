import { describe, it, expect, vi } from 'vitest'
import { createLocalClient, type TranslatePipeline } from '../src/providers/local.js'
import { maskPlaceholders, unmaskPlaceholders } from '../src/core/validate.js'

describe('maskPlaceholders / unmaskPlaceholders', () => {
  it('enmascara y restaura placeholders simples', () => {
    const { masked, tokens } = maskPlaceholders('Hello {name}, you have %d msgs')
    expect(masked).toBe('Hello [0], you have [1] msgs')
    expect(tokens).toEqual(['{name}', '%d'])
    expect(unmaskPlaceholders(masked, tokens)).toBe('Hello {name}, you have %d msgs')
  })

  it('restaura aunque el modelo agregue espacios en el sentinela', () => {
    const tokens = ['{name}']
    expect(unmaskPlaceholders('Hola [ 0 ]', tokens)).toBe('Hola {name}')
  })

  it('no toca bloques ICU (llaves anidadas)', () => {
    const { masked, tokens } = maskPlaceholders('{count, plural, one {# item} other {# items}}')
    expect(tokens).toEqual([]) // ICU no se enmascara
    expect(masked).toContain('{count,')
  })
})

describe('createLocalClient', () => {
  it('por defecto usa MarianMT por par y NO pasa códigos de idioma', async () => {
    const seen: { model: string; opts: Record<string, unknown> }[] = []
    const client = createLocalClient({
      loadPipeline: async (model) => async (texts, opts) => {
        seen.push({ model, opts: opts as Record<string, unknown> })
        return texts.map((t) => ({ translation_text: t.replace('Hello', 'Hola') }))
      },
    })
    const out = await client.translateBatch({
      sourceLang: 'en',
      targetLang: 'es',
      entries: { greet: 'Hello {name}' },
    })

    expect(seen[0]!.model).toBe('Xenova/opus-mt-en-es') // modelo por par
    expect(seen[0]!.opts.src_lang).toBeUndefined() // Marian es bilingüe
    expect(seen[0]!.opts.tgt_lang).toBeUndefined()
    expect(out.greet).toBe('Hola {name}') // placeholder restaurado
  })

  it('limpia los marcadores KDE que Marian pega en strings cortos', async () => {
    const client = createLocalClient({
      // default Marian: el "modelo" devuelve la basura típica de OPUS
      loadPipeline: async () => async (texts) =>
        texts.map(() => ({ translation_text: 'Guardar@info: whatsthis' })),
    })
    const out = await client.translateBatch({
      sourceLang: 'en',
      targetLang: 'es',
      entries: { save: 'Save' },
    })
    expect(out.save).toBe('Guardar')
  })

  it('con modelo NLLB mapea idiomas a FLORES', async () => {
    const seen: { src?: string; tgt?: string; texts: string[] }[] = []
    const fakePipe: TranslatePipeline = async (texts, opts) => {
      seen.push({ texts, src: opts.src_lang, tgt: opts.tgt_lang })
      return texts.map((t) => ({ translation_text: t.replace('Hello', 'Hola') }))
    }

    const client = createLocalClient({
      model: 'Xenova/nllb-200-distilled-600M',
      loadPipeline: async () => fakePipe,
    })
    const out = await client.translateBatch({
      sourceLang: 'en',
      targetLang: 'es',
      entries: { greet: 'Hello {name}' },
    })

    expect(seen[0]!.src).toBe('eng_Latn')
    expect(seen[0]!.tgt).toBe('spa_Latn')
    expect(seen[0]!.texts).toEqual(['Hello [0]']) // se enmascaró antes de traducir
    expect(out.greet).toBe('Hola {name}') // se restauró después
  })

  it('con modelo M2M-100 pasa códigos ISO 639-1', async () => {
    let captured: Record<string, unknown> = {}
    const client = createLocalClient({
      model: 'Xenova/m2m100_418M',
      loadPipeline: async () => async (texts, opts) => {
        captured = opts as Record<string, unknown>
        return texts.map((t) => ({ translation_text: t }))
      },
    })
    await client.translateBatch({
      sourceLang: 'en',
      targetLang: 'pt',
      entries: { a: 'A' },
    })
    expect(captured.src_lang).toBe('en')
    expect(captured.tgt_lang).toBe('pt')
  })

  it('error claro si el par Marian no existe (sin fallback a otro modelo)', async () => {
    const client = createLocalClient({
      // default Marian; el load falla como si el modelo no estuviera publicado
      loadPipeline: async () => {
        throw new Error('404 Not Found')
      },
    })
    await expect(
      client.translateBatch({ sourceLang: 'en', targetLang: 'pt', entries: { a: 'A' } }),
    ).rejects.toThrow(/no está publicado en ONNX|nllb-200/)
  })

  it('carga el pipeline una sola vez (cache por modelo)', async () => {
    const load = vi.fn(async (): Promise<TranslatePipeline> => {
      return async (texts) => texts.map((t) => ({ translation_text: t }))
    })
    const client = createLocalClient({
      model: 'test-cache-model',
      loadPipeline: load,
    })

    await client.translateBatch({ sourceLang: 'en', targetLang: 'es', entries: { a: 'A' } })
    await client.translateBatch({ sourceLang: 'en', targetLang: 'es', entries: { b: 'B' } })

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('NLLB aplica defaults anti-repetición y permite override', async () => {
    let opts: Record<string, unknown> = {}
    const makeClient = (generation?: Record<string, unknown>) =>
      createLocalClient({
        model: 'Xenova/nllb-200-distilled-600M',
        generation,
        loadPipeline: async () => async (texts, o) => {
          opts = o as Record<string, unknown>
          return texts.map((t) => ({ translation_text: t }))
        },
      })

    await makeClient().translateBatch({
      sourceLang: 'en',
      targetLang: 'es',
      entries: { a: 'A' },
    })
    expect(opts.no_repeat_ngram_size).toBe(3)
    expect(opts.repetition_penalty).toBe(1.3)
    expect(opts.early_stopping).toBe(true)

    await makeClient({ repetition_penalty: 2, num_beams: 4 }).translateBatch({
      sourceLang: 'en',
      targetLang: 'es',
      entries: { a: 'A' },
    })
    expect(opts.repetition_penalty).toBe(2) // override gana
    expect(opts.num_beams).toBe(4) // extra se pasa tal cual
    expect(opts.no_repeat_ngram_size).toBe(3) // default se conserva
  })

  it('Marian decodifica natural: no fuerza anti-repetición ni max_new_tokens', async () => {
    let opts: Record<string, unknown> = {}
    const client = createLocalClient({
      // default Marian
      loadPipeline: async () => async (texts, o) => {
        opts = o as Record<string, unknown>
        return texts.map((t) => ({ translation_text: t }))
      },
    })
    await client.translateBatch({
      sourceLang: 'en',
      targetLang: 'es',
      entries: { a: 'Save' },
    })
    expect(opts.no_repeat_ngram_size).toBeUndefined()
    expect(opts.repetition_penalty).toBeUndefined()
    expect(opts.max_new_tokens).toBeUndefined()

    // pero si el usuario fija algo, se respeta
    let opts2: Record<string, unknown> = {}
    const client2 = createLocalClient({
      generation: { num_beams: 4 },
      loadPipeline: async () => async (texts, o) => {
        opts2 = o as Record<string, unknown>
        return texts.map((t) => ({ translation_text: t }))
      },
    })
    await client2.translateBatch({
      sourceLang: 'en',
      targetLang: 'es',
      entries: { a: 'Save' },
    })
    expect(opts2.num_beams).toBe(4)
  })

  it('NLLB deriva max_new_tokens del input más largo del lote', async () => {
    let opts: Record<string, unknown> = {}
    const makeClient = (generation?: Record<string, unknown>) =>
      createLocalClient({
        model: 'Xenova/nllb-200-distilled-600M',
        generation,
        loadPipeline: async () => async (texts, o) => {
          opts = o as Record<string, unknown>
          return texts.map((t) => ({ translation_text: t }))
        },
      })

    // 1 palabra -> 1*3 + 8 = 11
    await makeClient().translateBatch({
      sourceLang: 'en',
      targetLang: 'es',
      entries: { a: 'Save' },
    })
    expect(opts.max_new_tokens).toBe(11)

    // lote: usa el más largo (5 palabras) -> 5*3 + 8 = 23
    await makeClient().translateBatch({
      sourceLang: 'en',
      targetLang: 'es',
      entries: { a: 'Save', b: 'one two three four five' },
    })
    expect(opts.max_new_tokens).toBe(23)

    // si el usuario lo fija, manda el suyo
    await makeClient({ max_new_tokens: 99 }).translateBatch({
      sourceLang: 'en',
      targetLang: 'es',
      entries: { a: 'Save' },
    })
    expect(opts.max_new_tokens).toBe(99)
  })

  it('con NLLB respeta códigos FLORES pasados directo', async () => {
    let captured: string | undefined = ''
    const client = createLocalClient({
      model: 'Xenova/nllb-200-distilled-600M',
      loadPipeline: async () => async (texts, opts) => {
        captured = opts.tgt_lang
        return texts.map((t) => ({ translation_text: t }))
      },
    })
    await client.translateBatch({
      sourceLang: 'en',
      targetLang: 'grn_Latn', // guaraní directo en FLORES
      entries: { a: 'A' },
    })
    expect(captured).toBe('grn_Latn')
  })

  it('con NLLB falla con mensaje claro si el idioma no está mapeado', async () => {
    const client = createLocalClient({
      model: 'Xenova/nllb-200-distilled-600M',
      loadPipeline: async () => async (texts) =>
        texts.map((t) => ({ translation_text: t })),
    })
    await expect(
      client.translateBatch({
        sourceLang: 'en',
        targetLang: 'xx',
        entries: { a: 'A' },
      }),
    ).rejects.toThrow(/langMap/)
  })
})
