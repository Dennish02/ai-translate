#!/usr/bin/env node
import { loadConfig } from './config.js'
import { sync } from './core/translator.js'

interface Flags {
  config?: string
  dryRun: boolean
  force: boolean
}

const HELP = `
ai-translate — i18n con traducción por IA (OpenRouter / Claude / GPT)

Uso:
  ai-translate sync     Traduce las keys faltantes o cambiadas a todos los targets
  ai-translate check    Falla (exit 1) si hay traducciones faltantes (para CI)

Opciones:
  -c, --config <ruta>   Ruta al archivo de config (autodetecta por defecto)
      --dry-run         No escribe archivos, solo reporta
      --force           Re-traduce todo, ignorando lo existente
  -h, --help            Muestra esta ayuda
`

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  const flags = parseFlags(rest)

  if (!command || command === '-h' || command === '--help' || command === 'help') {
    process.stdout.write(HELP)
    return 0
  }

  if (command !== 'sync' && command !== 'check') {
    process.stderr.write(`Comando desconocido: ${command}\n${HELP}`)
    return 1
  }

  const config = await loadConfig(process.cwd(), flags.config)
  const log = (msg: string) => process.stdout.write(msg + '\n')

  if (command === 'check') {
    log('🔎 Buscando traducciones faltantes...')
    const result = await sync(config, { dryRun: true, log })
    if (result.totalTranslated > 0) {
      log(`\n❌ Faltan ${result.totalTranslated} traducciones. Corré "ai-translate sync".`)
      return 1
    }
    log('\n✅ Todo traducido.')
    return 0
  }

  log('🌐 Traduciendo con IA...')
  const result = await sync(config, {
    dryRun: flags.dryRun,
    force: flags.force,
    log,
  })

  log(
    `\n✅ Listo: ${result.totalTranslated} traducidas` +
      (result.totalFailed ? `, ⚠ ${result.totalFailed} fallaron` : ''),
  )
  for (const lang of result.langs) {
    if (lang.orphaned.length) {
      log(`   ℹ ${lang.lang}: ${lang.orphaned.length} keys huérfanas (ya no en el fuente)`)
    }
  }
  return result.totalFailed > 0 ? 1 : 0
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { dryRun: false, force: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--force') flags.force = true
    else if (arg === '-c' || arg === '--config') flags.config = args[++i]
  }
  return flags
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
