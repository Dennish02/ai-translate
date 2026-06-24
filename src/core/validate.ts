/**
 * Extracción y validación de placeholders.
 *
 * Esta es la pieza que hace usable la traducción por IA: el LLM nunca debe
 * tocar los tokens de interpolación. Detectamos los formatos más comunes y,
 * si la traducción pierde o agrega tokens, la rechazamos para reintentar.
 *
 * Para ICU (`{count, plural, ...}`) validamos solo la VARIABLE, no el cuerpo:
 * los submensajes (`one {# item}`) sí se traducen, así que comparar el bloque
 * entero daría siempre falso negativo.
 */

export type PlaceholderCounts = Map<string, number>

/**
 * Devuelve un mapa token -> cantidad de apariciones.
 * Usamos cantidad porque "Hola {x} y {x}" debe conservar las dos.
 */
export function extractPlaceholders(text: string): PlaceholderCounts {
  const counts: PlaceholderCounts = new Map()
  const add = (token: string) =>
    counts.set(token, (counts.get(token) ?? 0) + 1)

  let remaining = text

  // 1. Template literal `${expr}` (antes que la llave simple, que lo partiría).
  remaining = remaining.replace(/\$\{[^{}]*\}/g, (m) => {
    add(normalize(m))
    return ' '
  })

  // 2. Doble llave `{{ name }}` (mustache / vue), antes del scanner balanceado.
  remaining = remaining.replace(/\{\{\s*[\w.$-]+\s*\}\}/g, (m) => {
    add(normalize(m))
    return ' '
  })

  // 3. Grupos `{...}` balanceados: distinguimos ICU de placeholder simple.
  remaining = consumeBraceGroups(remaining, (content) => {
    const icu = content.match(/^\s*([\w.$-]+)\s*,/)
    if (icu) {
      add(`{${icu[1]},...}`) // solo la variable de ICU
      return true
    }
    const simple = content.match(/^\s*([\w.$-]+)\s*$/)
    if (simple) {
      add(`{${simple[1]}}`)
      return true
    }
    return false // no es un placeholder reconocible: lo dejamos pasar
  })

  // 4. printf: %s %d %1$s
  remaining = remaining.replace(/%(?:\d+\$)?[sd@ifge]/g, (m) => {
    add(m)
    return ' '
  })

  // 5. Named params estilo rails: :name
  remaining.replace(/:[A-Za-z_]\w*/g, (m) => {
    add(m)
    return ' '
  })

  return counts
}

function normalize(token: string): string {
  // "{{ name }}" y "{{name}}" o "${ x }" y "${x}" son el mismo token.
  return token.replace(/\s+/g, '')
}

/**
 * Recorre el texto encontrando grupos `{...}` de primer nivel (llaves
 * balanceadas). Por cada grupo llama a `handler(content)`; si devuelve true el
 * grupo se consume (no se vuelve a inspeccionar), si no se deja tal cual.
 */
function consumeBraceGroups(
  text: string,
  handler: (content: string) => boolean,
): string {
  let result = ''
  let i = 0
  while (i < text.length) {
    if (text[i] === '{') {
      let depth = 0
      let j = i
      for (; j < text.length; j++) {
        if (text[j] === '{') depth++
        else if (text[j] === '}') {
          depth--
          if (depth === 0) break
        }
      }
      if (depth === 0 && j < text.length) {
        const whole = text.slice(i, j + 1)
        const consumed = handler(whole.slice(1, -1))
        result += consumed ? ' ' : whole
        i = j + 1
        continue
      }
    }
    result += text[i]
    i++
  }
  return result
}

export interface PlaceholderCheck {
  ok: boolean
  /** tokens del fuente que faltan en la traducción */
  missing: string[]
  /** tokens que aparecen en la traducción pero no en el fuente */
  extra: string[]
}

/** Verifica que la traducción conserve exactamente los placeholders del fuente. */
export function checkPlaceholders(
  source: string,
  translation: string,
): PlaceholderCheck {
  const src = extractPlaceholders(source)
  const out = extractPlaceholders(translation)

  const missing: string[] = []
  const extra: string[] = []

  for (const [token, n] of src) {
    if ((out.get(token) ?? 0) < n) missing.push(token)
  }
  for (const [token, n] of out) {
    if (n > (src.get(token) ?? 0)) extra.push(token)
  }

  return { ok: missing.length === 0 && extra.length === 0, missing, extra }
}
