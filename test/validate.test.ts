import { describe, it, expect } from 'vitest'
import { extractPlaceholders, checkPlaceholders } from '../src/core/validate.js'

describe('extractPlaceholders', () => {
  it('detecta llave simple {name}', () => {
    const p = extractPlaceholders('Hola {name}, bienvenido')
    expect([...p.keys()]).toEqual(['{name}'])
  })

  it('detecta doble llave {{name}} y normaliza espacios', () => {
    const p = extractPlaceholders('Hola {{ name }}')
    expect([...p.keys()]).toEqual(['{{name}}'])
  })

  it('cuenta repeticiones del mismo token', () => {
    const p = extractPlaceholders('{x} y {x}')
    expect(p.get('{x}')).toBe(2)
  })

  it('detecta printf %s %d y posicionales', () => {
    const p = extractPlaceholders('Subiste %d de %s archivos (%1$s)')
    expect([...p.keys()].sort()).toEqual(['%1$s', '%d', '%s'])
  })

  it('detecta ICU plural sin confundirlo con llave simple', () => {
    const p = extractPlaceholders('{count, plural, one {# item} other {# items}}')
    const keys = [...p.keys()]
    expect(keys.some((k) => k.startsWith('{count,'))).toBe(true)
  })

  it('detecta named params :name y template ${expr}', () => {
    const p = extractPlaceholders('Hola :name, total ${total}')
    expect([...p.keys()].sort()).toEqual(['${total}', ':name'])
  })
})

describe('checkPlaceholders', () => {
  it('pasa cuando se conservan todos', () => {
    const r = checkPlaceholders('Hello {name}', 'Hola {name}')
    expect(r.ok).toBe(true)
  })

  it('falla si falta un placeholder', () => {
    const r = checkPlaceholders('Hello {name}', 'Hola')
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('{name}')
  })

  it('falla si el modelo tradujo el placeholder', () => {
    const r = checkPlaceholders('Hello {name}', 'Hola {nombre}')
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('{name}')
    expect(r.extra).toContain('{nombre}')
  })

  it('falla si pierde una de dos repeticiones', () => {
    const r = checkPlaceholders('{x} y {x}', 'Solo {x}')
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('{x}')
  })

  it('ignora espacios internos en doble llave', () => {
    const r = checkPlaceholders('Hi {{ name }}', 'Hola {{name}}')
    expect(r.ok).toBe(true)
  })
})
