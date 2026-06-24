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

Traduce con [NLLB-200](https://huggingface.co/facebook/nllb-200-distilled-600M) corriendo **dentro de Node** vía [transformers.js](https://github.com/huggingface/transformers.js). Sin API key, sin costo, sin red.

```bash
npm install @huggingface/transformers   # peer dependency opcional
```

```ts
export default defineConfig({
  source: 'en',
  targets: ['es', 'pt'],
  path: './locales/{lang}.json',
  provider: 'local',
  // localModel: 'Xenova/nllb-200-distilled-600M', // default
})
```

```bash
npx ai-translate sync   # descarga el modelo (~1.2 GB) la 1ª vez, después offline
```

**Cómo maneja los placeholders**: NLLB es un modelo de traducción puro y tiende a traducir los `{name}`. Para evitarlo, `ai-translate` los **enmascara** (`[0]`, `[1]`) antes de traducir y los **restaura** después. Funciona muy bien con placeholders simples; el **ICU complejo** (`{count, plural, ...}`) puede no sobrevivir → ahí conviene `openrouter`.

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

Para la UI usá los JSON generados (instantáneo). Para texto arbitrario, `dynamic()`:

```ts
import { createTranslator } from 'ai-translate'
import es from './locales/es.json'

const t = createTranslator({
  lang: 'es',
  messages: flatten(es), // tus mensajes
  ai: { apiKey: process.env.OPENROUTER_API_KEY },
})

t('home.greeting', { name: 'Ana', count: 3 }) // de archivo, instantáneo
await t.dynamic('User generated content...')   // traduce al vuelo + cachea
```

## Placeholders soportados

`{name}` · `{{name}}` · `{count, plural, ...}` (ICU) · `%s %d %1$s` (printf) · `:name` · `${expr}`

## Licencia

MIT
