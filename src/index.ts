export { defineConfig, resolveConfig, loadConfig } from './config.js'
export { sync } from './core/translator.js'
export type {
  SyncOptions,
  SyncResult,
  LangResult,
} from './core/translator.js'
export { createTranslator } from './runtime.js'
export type { RuntimeOptions, Translator } from './runtime.js'
export { createOpenRouterClient } from './providers/openrouter.js'
export { createLocalClient } from './providers/local.js'
export type { LocalOptions, TranslatePipeline } from './providers/local.js'
export {
  checkPlaceholders,
  extractPlaceholders,
  maskPlaceholders,
  unmaskPlaceholders,
} from './core/validate.js'
export type { PlaceholderCheck } from './core/validate.js'
export type {
  AiI18nConfig,
  ResolvedConfig,
  Provider,
  ProviderClient,
  TranslateBatchInput,
} from './types.js'
