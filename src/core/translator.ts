import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createOpenRouterClient } from '../providers/openrouter.js'
import { createLocalClient } from '../providers/local.js'
import { readLocale, writeLocale, localePath } from '../store/json.js'
import { readMeta, writeMeta, type Meta } from '../store/meta.js'
import { checkPlaceholders } from './validate.js'
import { hashSource } from './hash.js'
import type { ProviderClient, ResolvedConfig } from '../types.js'

export interface SyncOptions {
  /** No escribe archivos, solo reporta qué haría. */
  dryRun?: boolean
  /** Re-traduce todo, ignorando lo existente. */
  force?: boolean
  /** Override del cliente (para tests). */
  client?: ProviderClient
  /** Logger inyectable. */
  log?: (msg: string) => void
}

export interface LangResult {
  lang: string
  translated: string[]
  /** keys que el LLM no devolvió o no pasaron validación tras reintentos */
  failed: string[]
  /** keys que sobran en el target (existen pero ya no en el fuente) */
  orphaned: string[]
}

export interface SyncResult {
  langs: LangResult[]
  totalTranslated: number
  totalFailed: number
}

export async function sync(
  config: ResolvedConfig,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const log = options.log ?? (() => {})
  // En dry-run no tocamos el modelo, así que no exigimos API key.
  const client =
    options.client ?? (options.dryRun ? undefined : buildClient(config))

  const sourceFile = localePath(config.path, config.source)
  const source = await readLocale(sourceFile)
  if (Object.keys(source).length === 0) {
    throw new Error(`[ai-translate] el locale fuente está vacío: ${sourceFile}`)
  }

  const projectContext = await loadContext(config.context)
  const meta = await readMeta(config.path)
  const langs: LangResult[] = []

  for (const target of config.targets) {
    if (target === config.source) continue
    const result = await syncLang({
      config,
      client,
      target,
      source,
      projectContext,
      meta,
      options,
      log,
    })
    langs.push(result)
  }

  if (!options.dryRun) await writeMeta(config.path, meta)

  return {
    langs,
    totalTranslated: langs.reduce((n, l) => n + l.translated.length, 0),
    totalFailed: langs.reduce((n, l) => n + l.failed.length, 0),
  }
}

async function syncLang(args: {
  config: ResolvedConfig
  client: ProviderClient | undefined
  target: string
  source: Record<string, string>
  projectContext: Record<string, string>
  meta: Meta
  options: SyncOptions
  log: (msg: string) => void
}): Promise<LangResult> {
  const { config, client, target, source, projectContext, meta, options, log } =
    args

  const file = localePath(config.path, target)
  const existing = await readLocale(file)
  const langMeta = (meta[target] ??= {})

  // Decidir qué traducir: faltante, o el fuente cambió desde la última vez.
  // Si una traducción ya existe pero no tiene metadata (ej. primera corrida
  // sobre locales preexistentes), la ADOPTAMOS sembrando su hash en vez de
  // re-traducirla: solo re-traducimos cuando el fuente realmente cambió.
  const todo: Record<string, string> = {}
  for (const [key, text] of Object.entries(source)) {
    const currentHash = hashSource(text)
    const missing = !(key in existing)
    const tracked = key in langMeta
    const changed = tracked && langMeta[key] !== currentHash

    if (options.force || missing || changed) {
      todo[key] = text
    } else if (!tracked) {
      langMeta[key] = currentHash // adoptar traducción preexistente
    }
  }

  const orphaned = Object.keys(existing).filter((k) => !(k in source))

  if (Object.keys(todo).length === 0) {
    log(`  ${target}: al día ✓`)
    return { lang: target, translated: [], failed: [], orphaned }
  }

  log(`  ${target}: ${Object.keys(todo).length} a traducir...`)

  if (options.dryRun) {
    return {
      lang: target,
      translated: Object.keys(todo),
      failed: [],
      orphaned,
    }
  }

  if (!client) throw new Error('[ai-translate] cliente no inicializado')

  const translated: Record<string, string> = {}
  const failed: string[] = []
  const batches = chunk(Object.entries(todo), config.batchSize)

  for (const batch of batches) {
    const entries = Object.fromEntries(batch)
    const { ok, retry } = await translateWithValidation({
      client,
      config,
      target,
      entries,
      projectContext,
      maxRetries: config.maxRetries,
    })
    Object.assign(translated, ok)
    failed.push(...retry)
  }

  // Merge: conservamos lo existente, pisamos lo nuevo, y actualizamos hashes.
  const merged = { ...existing }
  for (const [key, value] of Object.entries(translated)) {
    merged[key] = value
    langMeta[key] = hashSource(source[key]!)
  }
  await writeLocale(file, merged)

  if (failed.length) log(`  ${target}: ⚠ ${failed.length} fallaron: ${failed.join(', ')}`)

  return { lang: target, translated: Object.keys(translated), failed, orphaned }
}

/** Traduce un batch y reintenta SOLO las keys que rompen placeholders. */
async function translateWithValidation(args: {
  client: ProviderClient
  config: ResolvedConfig
  target: string
  entries: Record<string, string>
  projectContext: Record<string, string>
  maxRetries: number
}): Promise<{ ok: Record<string, string>; retry: string[] }> {
  const { client, config, target, projectContext, maxRetries } = args

  const ok: Record<string, string> = {}
  let pending = { ...args.entries }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (Object.keys(pending).length === 0) break

    const context = pick(projectContext, Object.keys(pending))
    const out = await client.translateBatch({
      sourceLang: config.source,
      targetLang: target,
      entries: pending,
      context: Object.keys(context).length ? context : undefined,
      instructions: config.instructions,
    })

    const stillPending: Record<string, string> = {}
    for (const [key, sourceText] of Object.entries(pending)) {
      const translation = out[key]
      if (translation == null) {
        stillPending[key] = sourceText
        continue
      }
      const check = checkPlaceholders(sourceText, translation)
      if (check.ok) {
        ok[key] = translation
      } else {
        stillPending[key] = sourceText
      }
    }
    pending = stillPending
  }

  return { ok, retry: Object.keys(pending) }
}

function buildClient(config: ResolvedConfig): ProviderClient {
  if (config.provider === 'local') {
    return createLocalClient({ model: config.localModel, langMap: config.langMap })
  }
  if (!config.apiKey) {
    throw new Error(
      '[ai-translate] falta API key. Definí OPENROUTER_API_KEY o `apiKey` en la config.',
    )
  }
  return createOpenRouterClient({
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
    title: 'ai-translate',
  })
}

async function loadContext(path?: string): Promise<Record<string, string>> {
  if (!path || !existsSync(path)) return {}
  const raw = await readFile(path, 'utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw) as Record<string, string>
}

function pick(
  obj: Record<string, string>,
  keys: string[],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of keys) if (key in obj) out[key] = obj[key]!
  return out
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
