import type { TranslateBatchInput } from '../types.js'

/**
 * Construye los mensajes para el LLM. La estrategia clave:
 *  - pedir JSON estricto key -> traducción
 *  - pasar el key como pista de contexto
 *  - prohibir explícitamente tocar los placeholders
 *  - permitir contexto por key e instrucciones globales de tono
 */
export function buildMessages(input: TranslateBatchInput): {
  system: string
  user: string
} {
  const system = [
    'Sos un traductor profesional de software (i18n).',
    `Traducís del idioma "${input.sourceLang}" al idioma "${input.targetLang}".`,
    'Reglas estrictas:',
    '1. NUNCA traduzcas ni modifiques los placeholders. Conservalos tal cual.',
    '   Placeholders válidos: {name}, {{name}}, {count, plural, ...}, %s, %d, :name, ${expr}.',
    '2. Conservá el mismo número de placeholders que el texto fuente.',
    '3. Mantené el tono y registro propio de UI (conciso, natural).',
    '4. No agregues comillas, comentarios ni texto extra.',
    '5. Respondé EXCLUSIVAMENTE un objeto JSON válido: { "<key>": "<traducción>" }.',
    '   Usá exactamente las mismas keys que recibís.',
    input.instructions ? `Instrucciones del proyecto: ${input.instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const items = Object.entries(input.entries).map(([key, text]) => {
    const ctx = input.context?.[key]
    return {
      key,
      text,
      ...(ctx ? { context: ctx } : {}),
    }
  })

  const user = [
    'Traducí los siguientes textos. El campo "key" es solo contexto, no lo traduzcas.',
    'Devolvé un JSON { key: traducción } con todas las keys.',
    '',
    JSON.stringify(items, null, 2),
  ].join('\n')

  return { system, user }
}
