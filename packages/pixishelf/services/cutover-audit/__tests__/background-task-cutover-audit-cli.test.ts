import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const packageDirectory = process.cwd()
const tsxCli = path.join(packageDirectory, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const auditScript = path.join(packageDirectory, 'scripts', 'background-task-cutover-audit.ts')

function environmentWithoutDatabaseUrl(): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  environment.DATABASE_URL = ''
  return environment
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [tsxCli, auditScript, ...args], {
    cwd: packageDirectory,
    env: environmentWithoutDatabaseUrl(),
    encoding: 'utf8'
  })
}

describe('background task cutover audit CLI', () => {
  it('starts through tsx and reports an argument error without initializing Prisma', () => {
    const result = runCli(['--sample-limit', '0'])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Sample limit must be an integer between 1 and 100.')
    expect(result.stderr).not.toContain('TransformError')
    expect(result.stderr).not.toContain('PrismaClient')
  })

  it('checks DATABASE_URL before dynamically creating PrismaClient', () => {
    const result = runCli([])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('DATABASE_URL is required.')
    expect(result.stderr).not.toContain('PrismaClient')
  })
})
