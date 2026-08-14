import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const archiveRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('archive executor architecture boundary', () => {
  it('contains no Next aliases, process exit, queue claim, heartbeat, or hidden maintenance loops', () => {
    for (const sourcePath of productionSources(archiveRoot)) {
      const source = readFileSync(sourcePath, 'utf8')
      expect(source, sourcePath).not.toMatch(/from\s+['"]@\//)
      expect(source, sourcePath).not.toMatch(/server-only|\.\.\/\.\.\/\.\.\/pixishelf|process\.exit/)
    }

    const executorSource = readFileSync(path.join(archiveRoot, 'executor.ts'), 'utf8')
    expect(executorSource).not.toMatch(/claimNext|heartbeat|setInterval|recoverStale|purgeExpired|reconcilePending/)
    expect(executorSource).not.toMatch(/\.systemJob\.(?:update|updateMany|create)/)
    const publisherSource = readFileSync(path.join(archiveRoot, 'publisher.ts'), 'utf8')
    expect(publisherSource).not.toMatch(/\.systemJob\.(?:update|updateMany|create)/)
  })
})

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : productionSources(target)
    return entry.name.endsWith('.ts') ? [target] : []
  })
}
