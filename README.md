# ai-translate

i18n con **traducción automática por IA**. Mantenés un solo idioma fuente (ej. `en.json`) y un comando traduce las claves faltantes a todos los idiomas usando un LLM vía [OpenRouter](https://openrouter.ai) (una sola key da acceso a Claude, GPT, etc.).

- ✅ **Build-time CLI** (`ai-translate sync`): traduce en tu repo, cero latencia/costo en runtime.
- ✅ **Validación de placeholders**: el LLM nunca rompe `{name}`, `%s`, ICU, etc. — si lo hace, se reintenta.
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
