import { defineConfig } from 'ai-translate'

// Provider 'local': traduce con NLLB-200 corriendo en Node (transformers.js).
// Sin API key, sin costo, offline. Requiere: npm i @huggingface/transformers
export default defineConfig({
  source: 'en',
  targets: ['es', 'pt'],
  path: './examples/locales/{lang}.json',
  provider: 'local',
  // localModel: 'Xenova/nllb-200-distilled-600M', // default
  // langMap: { gn: 'grn_Latn' }, // agregar idiomas fuera del set común
})
