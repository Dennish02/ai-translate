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
  it('mapea idiomas a FLORES y restaura placeholders tras traducir', async () => {
    const seen: { texts: string[]; src: string; tgt: string }[] = []
    const fakePipe: TranslatePipeline = async (texts, opts) => {
      seen.push({ texts, src: opts.src_lang, tgt: opts.tgt_lang })
      // El "modelo" traduce y conserva los sentinelas [0], [1].
      return texts.map((t) => ({ translation_text: t.replace('Hello', 'Hola') }))
    }

    const client = createLocalClient({ loadPipeline: async () => fakePipe })
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

  it('respeta códigos FLORES pasados directo', async () => {
    let captured = ''
    const client = createLocalClient({
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

  it('falla con mensaje claro si el idioma no está mapeado', async () => {
    const client = createLocalClient({
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
