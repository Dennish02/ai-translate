# ai-translate

i18n con **traducción automática por IA**. Mantenés un solo idioma fuente (ej. `en.json`) y un comando traduce las claves faltantes a todos los idiomas usando un LLM vía [OpenRouter](https://openrouter.ai) (una sola key da acceso a Claude, GPT, etc.).

- ✅ **Build-time CLI** (`ai-translate sync`): traduce en tu repo, cero latencia/costo en runtime.
- ✅ **Dos providers**: `openrouter` (máxima calidad vía Claude/GPT) o `local` (NLLB-200 en tu máquina, **gratis y offline**).
- ✅ **Validación de placeholders**: el modelo nunca rompe `{name}`, `%s`, ICU, etc. — si lo hace, se reintenta.
- ✅ **Incremental**: re-traduce solo lo que falta o cambió (hash del fuente).
- ✅ **Runtime opcional** (`createTranslator`): traducción al vuelo de contenido dinámico, con cache.
- ✅ **TypeScript**, ESM, sin atarte a ningún framework.

## Instalación

```bash
npm install -D ai-translate
```

## Uso (build-time)

1. Creá `ai-translate.config.ts`:

```ts
import { defineConfig } from 'ai-translate'

export default defineConfig({
  source: 'en',
  targets: ['es', 'pt'],
  path: './locales/{lang}.json',
  model: 'anthropic/claude-sonnet-4-6', // cualquier modelo de OpenRouter
  apiKey: process.env.OPENROUTER_API_KEY,
})
```

2. Tené tu idioma fuente, ej. `locales/en.json`:

```json
{ "home": { "greeting": "Hello {name}, you have {count} tasks" } }
```

3. Traducí:

```bash
export OPENROUTER_API_KEY=sk-or-...
npx ai-translate sync
```

Genera/actualiza `locales/es.json`, `locales/pt.json` traduciendo solo lo que falta.

### En CI

```bash
npx ai-translate check   # exit 1 si faltan traducciones
```

## Comandos

| Comando | Descripción |
| --- | --- |
| `ai-translate sync` | Traduce las keys faltantes o cambiadas |
| `ai-translate check` | Falla si hay faltantes (para CI) |
| `--dry-run` | No escribe, solo reporta |
| `--force` | Re-traduce todo |
| `-c, --config <ruta>` | Config explícita |

## Providers

### `openrouter` (default) — máxima calidad

Usa cualquier modelo vía OpenRouter (Claude, GPT, etc.). Mejor para tono, contexto e ICU. Requiere `OPENROUTER_API_KEY`. Costo: centavos para la UI de una app.

### `local` — gratis y offline 🆓

Traduce con un modelo MT corriendo **dentro de Node** vía [transformers.js](https://github.com/huggingface/transformers.js). Sin API key, sin costo, sin red.

```bash
npm install @huggingface/transformers   # peer dependency opcional
```

```ts
export default defineConfig({
  source: 'en',
  targets: ['es'],
  path: './locales/{lang}.json',
  provider: 'local',
})
```

```bash
npx ai-translate sync   # descarga el modelo la 1ª vez, después offline
```

**Modelos** (se eligen con `localModel`):

| | default | cobertura | texto corto / UI | tamaño |
| --- | --- | --- | --- | --- |
| **MarianMT** (`opus-mt`) | ✅ por par | solo pares publicados | **muy bueno** | ~75 MB |
| **NLLB-200** | `Xenova/nllb-200-distilled-600M` | 200 idiomas, 1 modelo | divaga con labels | ~1.9 GB |
| **M2M-100** | `Xenova/m2m100_418M` | 100 idiomas, 1 modelo | flojo en labels | ~0.5 GB |

Por defecto se usa **MarianMT por par** (`Xenova/opus-mt-{src}-{tgt}`): chico, rápido y el mejor con strings cortos de UI. Como es bilingüe, solo descarga el modelo del par que necesitás. Para **varios idiomas con un solo modelo**, cambiá a NLLB:

```ts
provider: 'local',
localModel: 'Xenova/nllb-200-distilled-600M', // multilingüe
```

**Par sin modelo Marian** (ej. `es→pt` no está en ONNX): por defecto falla con un error claro. Para que **caiga automáticamente** a un multilingüe en vez de fallar, seteá `localFallbackModel` (solo se descarga si de verdad falta el par directo):

```ts
provider: 'local',                              // Marian por par cuando existe…
localFallbackModel: 'Xenova/m2m100_418M',       // …y M2M (~0.5 GB) cuando no
```

> **Ojo:** ningún modelo MT local "sigue instrucciones" — no podés pedirle "traducí literal, no interpretes" (eso es solo para `openrouter`). Y la jerga de dominio la fallan: cubrila con `glossary`.

**Cómo maneja los placeholders**: estos modelos tienden a traducir los `{name}`. Para evitarlo, `ai-translate` los **enmascara** (`[0]`, `[1]`) antes de traducir y los **restaura** después. Funciona muy bien con placeholders simples; el **ICU complejo** (`{count, plural, ...}`) puede no sobrevivir → ahí conviene `openrouter`.

**Términos sueltos / repeticiones (NLLB/M2M)**: con palabras sueltas, NLLB repite o divaga (`"Bull The bull Bull"`). Para esas familias `ai-translate` aplica defaults anti-repetición (`no_repeat_ngram_size`, `repetition_penalty`) y un `max_new_tokens` proporcional al input. Marian no los necesita (decodifica limpio) así que no se los aplica. Podés ajustar todo con `localGeneration`:

```ts
provider: 'local',
localModel: 'Xenova/nllb-200-distilled-600M',
localGeneration: {
  no_repeat_ngram_size: 2, // más agresivo contra repeticiones
  repetition_penalty: 1.5,
  num_beams: 4,            // beam search: mejor calidad, más lento
},
```

**Jerga de dominio → glosario**: para términos que el MT no acierta (ej. ganadería: `Novillo → "The boy"` 😬), fijá la traducción con `glossary`. Esas keys se escriben tal cual, **sin pasar por el modelo** (instantáneo y 100% confiable):

```ts
export default defineConfig({
  source: 'en',
  targets: ['es'],
  path: './locales/{lang}.json',
  provider: 'local',
  glossary: {
    es: { 'category.NOV': 'Novillo', 'category.TORO': 'Toro' },
  },
})
```

El glosario también sirve con `openrouter` y para imponer terminología de marca. Si cambiás un valor del glosario, esa key se reescribe en la próxima corrida aunque el texto fuente no haya cambiado. Ver el ejemplo completo en [`examples/ai-translate.local.config.ts`](examples/ai-translate.local.config.ts).

**Modelos cuantizados** (`localDtype: 'fp16' | 'q8'`): cargan más rápido y usan menos RAM, pero degradan la calidad (en NLLB, bastante) y debilitan la predicción de fin-de-secuencia (frases cortas "se contagian" de las largas en un batch). Si usás cuantización con NLLB, agregá `batchSize: 1`. El default no lo necesita.

| | `openrouter` | `local` |
| --- | --- | --- |
| Costo | centavos/uso | **$0** |
| Red | requerida | **offline** (tras descargar) |
| Calidad/tono | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| ICU complejo | ✅ | ⚠️ limitado |
| Privacidad | sale a un tercero | **no sale de tu máquina** |

## Contexto por key (opcional)

Mejorá la calidad pasando descripciones. En la config: `context: './locales/_context.json'`.

```json
{ "actions.save": "Botón para guardar un formulario" }
```

Y `instructions` para tono global: `'Tono informal, voseo argentino.'`

## Runtime (contenido dinámico)

Para la UI usá los JSON generados (instantáneo). Para texto arbitrario, `dynamic()`.

> **Browser / bundlers (Vite, Next, etc.):** importá desde el subpath `/runtime`.
> El entry raíz (`.`) incluye el CLI y el provider local, que usan APIs Node-only
> (`fs`, `jiti`, transformers) y **no** son bundleables para el cliente. El subpath
> `/runtime` solo trae `createTranslator` y bundlea limpio.

```ts
import { createTranslator } from '@dennish02/ai-translate/runtime'
import es from './locales/es.json'

const t = createTranslator({
  lang: 'es',
  messages: flatten(es), // tus mensajes
  ai: { apiKey: process.env.OPENROUTER_API_KEY },
})

t('home.greeting', { name: 'Ana', count: 3 }) // de archivo, instantáneo
await t.dynamic('User generated content...')   // traduce al vuelo + cachea
```

### `dynamic()` en el browser: no expongas tu API key

Llamar a OpenRouter directo desde el cliente **filtra tu API key** (queda en el
bundle / en el tráfico). En browser, apuntá `baseUrl` a un proxy de tu backend que
agregue la key del lado servidor, o pasá un `fetchImpl` propio:

```ts
const t = createTranslator({
  lang: 'es',
  ai: {
    baseUrl: '/api/translate-proxy', // tu endpoint; la key vive en el server
    // o: fetchImpl: (url, init) => fetch('/api/translate-proxy', init),
  },
})
```

## Placeholders soportados

`{name}` · `{{name}}` · `{count, plural, ...}` (ICU) · `%s %d %1$s` (printf) · `:name` · `${expr}`

## Licencia

MIT
