import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'

export type NestedJson = { [key: string]: string | NestedJson }

/** Convierte { a: { b: "x" } } -> { "a.b": "x" } */
export function flatten(obj: NestedJson, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') {
      Object.assign(out, flatten(value, path))
    } else {
      out[path] = String(value)
    }
  }
  return out
}

/** Convierte { "a.b": "x" } -> { a: { b: "x" } } */
export function unflatten(flat: Record<string, string>): NestedJson {
  const root: NestedJson = {}
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!
      if (typeof node[part] !== 'object' || node[part] === null) {
        node[part] = {}
      }
      node = node[part] as NestedJson
    }
    node[parts[parts.length - 1]!] = value
  }
  return root
}

export function localePath(pattern: string, lang: string): string {
  return pattern.replace(/\{lang\}/g, lang)
}

export async function readLocale(file: string): Promise<Record<string, string>> {
  if (!existsSync(file)) return {}
  const raw = await readFile(file, 'utf8')
  if (!raw.trim()) return {}
  return flatten(JSON.parse(raw) as NestedJson)
}

export async function writeLocale(
  file: string,
  flat: Record<string, string>,
): Promise<void> {
  // Ordenamos las keys para diffs estables en git.
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(flat).sort()) sorted[key] = flat[key]!
  const json = JSON.stringify(unflatten(sorted), null, 2)
  await ensureDir(file)
  await writeFile(file, json + '\n', 'utf8')
}

async function ensureDir(file: string): Promise<void> {
  const dir = dirname(file)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
}
