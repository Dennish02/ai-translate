import { describe, it, expect } from 'vitest'
import { flatten, unflatten } from '../src/store/json.js'

describe('flatten / unflatten', () => {
  it('aplana objetos anidados a dot keys', () => {
    expect(flatten({ home: { title: 'Hi', sub: 'Yo' }, ok: 'OK' })).toEqual({
      'home.title': 'Hi',
      'home.sub': 'Yo',
      ok: 'OK',
    })
  })

  it('reconstruye el objeto anidado', () => {
    expect(unflatten({ 'a.b.c': 'x', 'a.b.d': 'y', z: 'w' })).toEqual({
      a: { b: { c: 'x', d: 'y' } },
      z: 'w',
    })
  })

  it('es ida y vuelta estable', () => {
    const obj = { menu: { file: { open: 'Open', save: 'Save' } }, quit: 'Quit' }
    expect(unflatten(flatten(obj))).toEqual(obj)
  })
})
