import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { localePath } from './json.js'

/**
 * Sidecar que recuerda con qué hash del fuente se generó cada traducción.
 * Vive junto a los locales: `<dir>/.ai-translate-meta.json`.
 *
 * Estructura: { [lang]: { [key]: sourceHash } }
 */
export type Meta = Record<string, Record<string, string>>

function metaPath(pattern: string): string {
  // Usamos el directorio del patrón (reemplazando {lang} por el source para
  // resolver la carpeta) y guardamos un único meta para todos los idiomas.
  const sample = localePath(pattern, '_')
  return join(dirname(sample), '.ai-translate-meta.json')
}

export async function readMeta(pattern: string): Promise<Meta> {
  const file = metaPath(pattern)
  if (!existsSync(file)) return {}
  const raw = await readFile(file, 'utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw) as Meta
}

export async function writeMeta(pattern: string, meta: Meta): Promise<void> {
  const file = metaPath(pattern)
  const dir = dirname(file)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await writeFile(file, JSON.stringify(meta, null, 2) + '\n', 'utf8')
}
