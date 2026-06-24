import { defineConfig } from 'ai-translate'

export default defineConfig({
  source: 'en',
  targets: ['es', 'pt'],
  path: './examples/locales/{lang}.json',
  model: 'anthropic/claude-sonnet-4-6',
  apiKey: process.env.OPENROUTER_API_KEY,
  // contexto opcional por key para desambiguar:
  context: './examples/locales/_context.json',
  instructions: 'App de gestión agropecuaria. Tono claro y directo, voseo argentino.',
})
