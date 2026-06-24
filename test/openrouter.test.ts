import { describe, it, expect } from 'vitest'
import { parseTranslations } from '../src/providers/openrouter.js'

describe('parseTranslations', () => {
  const entries = { 'home.title': 'Hello', 'home.sub': 'World' }

  it('parsea JSON limpio', () => {
    const out = parseTranslations(
      '{"home.title":"Hola","home.sub":"Mundo"}',
      entries,
    )
    expect(out).toEqual({ 'home.title': 'Hola', 'home.sub': 'Mundo' })
  })

  it('tolera code fences ```json', () => {
    const out = parseTranslations(
      '```json\n{"home.title":"Hola","home.sub":"Mundo"}\n```',
      entries,
    )
    expect(out['home.title']).toBe('Hola')
  })

  it('extrae el objeto si viene con texto alrededor', () => {
    const out = parseTranslations(
      'Acá tenés: {"home.title":"Hola","home.sub":"Mundo"} listo',
      entries,
    )
    expect(out['home.sub']).toBe('Mundo')
  })

  it('ignora keys que no pidió', () => {
    const out = parseTranslations(
      '{"home.title":"Hola","extra":"nope"}',
      entries,
    )
    expect(out).toEqual({ 'home.title': 'Hola' })
  })
})
