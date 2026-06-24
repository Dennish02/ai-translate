import { createHash } from 'node:crypto'

/**
 * Hash corto y estable del texto fuente. Lo guardamos junto a cada traducción
 * para re-traducir SOLO cuando el original cambia (no en cada `sync`).
 */
export function hashSource(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 12)
}
