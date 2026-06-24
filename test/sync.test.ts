import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sync } from '../src/core/translator.js'
import { resolveConfig } from '../src/config.js'
import { readLocale } from '../src/store/json.js'
import type { ProviderClient } from '../src/types.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ai-i18n-'))
  await mkdir(join(dir, 'locales'), { recursive: true })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function config(extra?: Parameters<typeof resolveConfig>[0]) {
  return resolveConfig({
    source: 'en',
    targets: ['es'],
    path: join(dir, 'locales', '{lang}.json'),
    apiKey: 'test',
    ...extra,
  })
}

describe('sync', () => {
  it('traduce solo las keys faltantes y conserva las existentes', async () => {
    await writeFile(
      join(dir, 'locales', 'en.json'),
      JSON.stringify({ greet: 'Hello {name}', bye: 'Bye' }),
    )
    await writeFile(
      join(dir, 'locales', 'es.json'),
      JSON.stringify({ greet: 'Hola {name}' }), // ya existe
    )

    const calls: string[][] = []
    const client: ProviderClient = {
      async translateBatch(input) {
        calls.push(Object.keys(input.entries))
        return { bye: 'Chau' }
      },
    }

    const result = await sync(config(), { client })

    expect(calls).toEqual([['bye']]) // solo pidió la faltante
    expect(result.totalTranslated).toBe(1)

    const es = JSON.parse(await readFile(join(dir, 'locales', 'es.json'), 'utf8'))
    expect(es).toEqual({ greet: 'Hola {name}', bye: 'Chau' })
  })

  it('reintenta cuando el modelo rompe un placeholder', async () => {
    await writeFile(
      join(dir, 'locales', 'en.json'),
      JSON.stringify({ greet: 'Hello {name}' }),
    )

    let attempt = 0
    const client: ProviderClient = {
      async translateBatch() {
        attempt++
        // primer intento rompe el placeholder, segundo lo respeta
        return attempt === 1 ? { greet: 'Hola {nombre}' } : { greet: 'Hola {name}' }
      },
    }

    const result = await sync(config(), { client })

    expect(attempt).toBe(2)
    expect(result.totalFailed).toBe(0)
    const es = JSON.parse(await readFile(join(dir, 'locales', 'es.json'), 'utf8'))
    expect(es.greet).toBe('Hola {name}')
  })

  it('marca como failed si nunca respeta el placeholder', async () => {
    await writeFile(
      join(dir, 'locales', 'en.json'),
      JSON.stringify({ greet: 'Hello {name}' }),
    )
    const client: ProviderClient = {
      async translateBatch() {
        return { greet: 'Hola sin placeholder' }
      },
    }
    const result = await sync(config(), { client })
    expect(result.totalFailed).toBe(1)
    expect(result.langs[0]!.failed).toEqual(['greet'])
  })

  it('no re-traduce si el fuente no cambió (hash)', async () => {
    await writeFile(
      join(dir, 'locales', 'en.json'),
      JSON.stringify({ greet: 'Hello' }),
    )
    let calls = 0
    const client: ProviderClient = {
      async translateBatch() {
        calls++
        return { greet: 'Hola' }
      },
    }

    await sync(config(), { client })
    await sync(config(), { client }) // segunda corrida: ya está al día

    expect(calls).toBe(1)
  })

  it('re-traduce cuando el texto fuente cambia', async () => {
    const en = join(dir, 'locales', 'en.json')
    await writeFile(en, JSON.stringify({ greet: 'Hello' }))
    let last = ''
    const client: ProviderClient = {
      async translateBatch(input) {
        last = input.entries.greet!
        return { greet: 'Hola' }
      },
    }
    await sync(config(), { client })
    expect(last).toBe('Hello')

    await writeFile(en, JSON.stringify({ greet: 'Hello there' }))
    await sync(config(), { client })
    expect(last).toBe('Hello there') // detectó el cambio y re-tradujo
  })

  it('aplica el glosario sin pasar por el modelo', async () => {
    await writeFile(
      join(dir, 'locales', 'en.json'),
      JSON.stringify({ 'cat.NOV': 'Steer', greet: 'Hello' }),
    )
    const calls: string[][] = []
    const client: ProviderClient = {
      async translateBatch(input) {
        calls.push(Object.keys(input.entries))
        return { greet: 'Hola' }
      },
    }

    const cfg = config({
      source: 'en',
      targets: ['es'],
      path: join(dir, 'locales', '{lang}.json'),
      apiKey: 'test',
      glossary: { es: { 'cat.NOV': 'Novillo' } },
    })
    await sync(cfg, { client })

    expect(calls).toEqual([['greet']]) // 'cat.NOV' no fue al modelo
    const es = await readLocale(join(dir, 'locales', 'es.json'))
    expect(es).toEqual({ 'cat.NOV': 'Novillo', greet: 'Hola' })
  })

  it('reaplica el glosario si cambia el override (sin tocar el fuente)', async () => {
    await writeFile(
      join(dir, 'locales', 'en.json'),
      JSON.stringify({ 'cat.NOV': 'Steer' }),
    )
    const client: ProviderClient = {
      async translateBatch() {
        return {}
      },
    }
    const mk = (val: string) =>
      config({
        source: 'en',
        targets: ['es'],
        path: join(dir, 'locales', '{lang}.json'),
        apiKey: 'test',
        glossary: { es: { 'cat.NOV': val } },
      })

    await sync(mk('Novillo'), { client })
    let es = await readLocale(join(dir, 'locales', 'es.json'))
    expect(es['cat.NOV']).toBe('Novillo')

    await sync(mk('Toro'), { client }) // cambió el override, fuente igual
    es = await readLocale(join(dir, 'locales', 'es.json'))
    expect(es['cat.NOV']).toBe('Toro')
  })

  it('detecta keys huérfanas', async () => {
    await writeFile(
      join(dir, 'locales', 'en.json'),
      JSON.stringify({ a: 'A' }),
    )
    await writeFile(
      join(dir, 'locales', 'es.json'),
      JSON.stringify({ a: 'A-es', viejo: 'sobra' }),
    )
    const client: ProviderClient = {
      async translateBatch() {
        return {}
      },
    }
    const result = await sync(config(), { client })
    expect(result.langs[0]!.orphaned).toEqual(['viejo'])
  })
})
