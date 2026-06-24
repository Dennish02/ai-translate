import { defineConfig } from 'ai-translate'

// Provider 'local': traduce con un modelo MT corriendo en Node (transformers.js).
// Sin API key, sin costo, offline. Requiere: npm i @huggingface/transformers
//
// Por defecto usa MarianMT por par de idiomas (Xenova/opus-mt-en-es): chico,
// rápido y bueno con texto corto de UI. Solo descarga el modelo del par que usás.
export default defineConfig({
  source: 'en',
  targets: ['es'],
  path: './examples/locales/{lang}.json',
  provider: 'local',

  // Marian es por par. Para un par sin modelo publicado (ej. en->pt no está en
  // ONNX) o para varios idiomas con un solo modelo, usá NLLB:
  //   localModel: 'Xenova/nllb-200-distilled-600M',
  // (NLLB cubre 200 idiomas pero divaga más con labels sueltos.)

  // Glosario: jerga de dominio que el MT no acierta (la deja sin traducir o la
  // inventa). Se aplica tal cual, sin pasar por el modelo.
  glossary: {
    es: {
      'category.NOV': 'Novillo',
      'category.TORO': 'Toro',
      'category.VACA': 'Vaca',
      'category.TERNERO': 'Ternero',
    },
  },
})
