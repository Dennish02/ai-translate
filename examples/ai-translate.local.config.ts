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

  // Precisión del modelo. 'fp32' (default) es la mejor calidad pero pesa ~1.9 GB
  // y puede no cargar en equipos con poca RAM. 'fp16' es un buen compromiso.
  localDtype: 'fp16',

  // Con dtype cuantizado ('fp16'/'q8') la predicción de fin-de-secuencia es
  // débil: al traducir varias frases juntas, las cortas "se contagian" de las
  // largas y generan basura. batchSize 1 las aísla. Con 'fp32' no hace falta.
  batchSize: 1,

  // Generación: los defaults ya combaten la repetición y max_new_tokens se
  // calcula proporcional al input. Solo descomentá para ajustar a mano:
  // localGeneration: {
  //   no_repeat_ngram_size: 3,
  //   repetition_penalty: 1.3,
  //   num_beams: 4, // beam search: más calidad, más lento
  // },

  // Glosario: traducciones fijas para jerga de dominio (ganadería) y labels
  // cortos que un MT local no acierta. Se aplican tal cual, sin pasar por NLLB.
  glossary: {
    es: {
      'category.NOV': 'Novillo',
      'category.TORO': 'Toro',
      'category.VACA': 'Vaca',
      'category.TERNERO': 'Ternero',
      'actions.save': 'Guardar',
      'actions.cancel': 'Cancelar',
    },
    pt: {
      'category.NOV': 'Novilho',
      'category.TORO': 'Touro',
      'category.VACA': 'Vaca',
      'category.TERNERO': 'Bezerro',
      'actions.save': 'Salvar',
      'actions.cancel': 'Cancelar',
    },
  },
})
