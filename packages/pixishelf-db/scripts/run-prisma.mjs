import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const packageDirectory = path.resolve(scriptDirectory, '..')

const childEnvironment = { ...process.env }
if (!childEnvironment.DATABASE_URL?.trim()) {
  const envCandidates = [
    path.join(packageDirectory, '.env'),
    path.resolve(packageDirectory, '../pixishelf/.env.local')
  ]
  const loaded = envCandidates.find((candidate) => loadDatabaseUrl(candidate, childEnvironment))
  if (!loaded) {
    console.error(
      '[pixishelf-db] DATABASE_URL is missing. Set it in the current environment or packages/pixishelf/.env.local.'
    )
    process.exit(1)
  }
  console.log(`[pixishelf-db] Loaded DATABASE_URL from ${path.relative(packageDirectory, loaded)}`)
}

const require = createRequire(import.meta.url)
const prismaCli = require.resolve('prisma')
const result = spawnSync(process.execPath, [prismaCli, ...process.argv.slice(2)], {
  cwd: packageDirectory,
  env: childEnvironment,
  stdio: 'inherit'
})

if (result.error) {
  console.error(`[pixishelf-db] Failed to start Prisma CLI: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)

function loadDatabaseUrl(filePath, environment) {
  if (!fs.existsSync(filePath)) return false
  const source = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of source.split(/\r?\n/u)) {
    const match = rawLine.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)\s*$/u)
    if (!match) continue
    const value = parseEnvValue(match[1] ?? '')
    if (!value) return false
    environment.DATABASE_URL = value
    return true
  }
  return false
}

function parseEnvValue(rawValue) {
  const value = rawValue.trim()
  if (!value) return ''
  const quote = value[0]
  if ((quote === '"' || quote === "'") && value.at(-1) === quote) {
    return value.slice(1, -1)
  }
  return value.replace(/\s+#.*$/u, '').trim()
}
