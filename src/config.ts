import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AiI18nConfig, ResolvedConfig } from './types.js'

const DEFAULTS = {
  provider: 'openrouter' as const,
  model: 'anthropic/claude-sonnet-4-6',
  baseUrl: 'https://openrouter.ai/api/v1',
  batchSize: 50,
  maxRetries: 2,
}

/** Helper tipado para `ai-translate.config.ts`. */
export function defineConfig(config: AiI18nConfig): AiI18nConfig {
  return config
}

export function resolveConfig(config: AiI18nConfig): ResolvedConfig {
  if (!config.source) throw new Error('[ai-translate] falta `source` en la config')
  if (!config.targets?.length)
    throw new Error('[ai-translate] `targets` no puede estar vacío')
  if (!config.path?.includes('{lang}'))
    throw new Error('[ai-translate] `path` debe incluir el token `{lang}`')

  return {
    source: config.source,
    targets: config.targets,
    path: config.path,
    provider: config.provider ?? DEFAULTS.provider,
    model: config.model ?? DEFAULTS.model,
    baseUrl: config.baseUrl ?? DEFAULTS.baseUrl,
    localModel: config.localModel,
    localDtype: config.localDtype,
    langMap: config.langMap ?? {},
    localGeneration: config.localGeneration,
    glossary: config.glossary ?? {},
    batchSize: config.batchSize ?? DEFAULTS.batchSize,
    maxRetries: config.maxRetries ?? DEFAULTS.maxRetries,
    apiKey: config.apiKey ?? process.env.OPENROUTER_API_KEY,
    context: config.context,
    instructions: config.instructions,
  }
}

const CANDIDATES = [
  'ai-translate.config.ts',
  'ai-translate.config.mjs',
  'ai-translate.config.js',
  'ai-translate.config.cjs',
  'ai-translate.config.json',
]

/** Busca y carga el archivo de configuración desde `cwd`. */
export async function loadConfig(
  cwd = process.cwd(),
  explicitPath?: string,
): Promise<ResolvedConfig> {
  const file = explicitPath
    ? resolve(cwd, explicitPath)
    : CANDIDATES.map((c) => resolve(cwd, c)).find((p) => existsSync(p))

  if (!file || !existsSync(file)) {
    throw new Error(
      `[ai-translate] no encontré config. Creá uno de: ${CANDIDATES.join(', ')}`,
    )
  }

  const raw = await importConfigFile(file)
  return resolveConfig(raw)
}

async function importConfigFile(file: string): Promise<AiI18nConfig> {
  if (file.endsWith('.json')) {
    return JSON.parse(await readFile(file, 'utf8')) as AiI18nConfig
  }

  // TS/ESM/CJS: jiti maneja transpilación on-the-fly de TypeScript.
  if (file.endsWith('.ts')) {
    // Import perezoso: jiti es Node-only (usa `module`/createRequire) y solo se
    // necesita para configs .ts. Cargarlo a nivel de módulo rompería bundlers.
    const { createJiti } = await import('jiti')
    const jiti = createJiti(import.meta.url, { interopDefault: true })
    const mod = (await jiti.import(file)) as { default?: AiI18nConfig } & AiI18nConfig
    return mod.default ?? mod
  }

  const mod = (await import(pathToFileURL(file).href)) as {
    default?: AiI18nConfig
  } & AiI18nConfig
  return mod.default ?? mod
}
