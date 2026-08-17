import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const servicesRoot = path.resolve(__dirname, '..', '..')
const central = readFileSync(path.join(servicesRoot, 'pending-replace-central-service.ts'), 'utf8')
const compatibility = readFileSync(path.join(servicesRoot, 'pending-replace-service', 'index.ts'), 'utf8')
const router = readFileSync(path.resolve(servicesRoot, '..', 'server', 'routers', 'pending-replace.ts'), 'utf8')

describe('pending replacement central cutover inventory', () => {
  it('covers every strict operation with atomic queue/operation creation and no detached execution', () => {
    for (const mode of ['DISCOVER', 'BATCH', 'RESTORE', 'CLEANUP']) {
      expect(central).toContain(`mode: '${mode}'`)
    }
    expect(central).toContain('pendingReplaceOperation.create')
    expect(central).toContain('enqueueJob(')
    expect(central).toContain('cancelJobCommand({ jobId:')
    expect(central).not.toMatch(/void\s*\(async\s*\(\)/)
    expect(central).not.toContain('setInterval(')
  })

  it('hard-branches before legacy IIFEs and keeps the status route read-only/admin-only', () => {
    expect(compatibility.match(/if \(isCentralDispatcherCutoverEnabled\(\)\)/g)?.length).toBeGreaterThanOrEqual(6)
    expect(router).not.toContain('authProcedure')
    expect(router).toContain('status: adminProcedure')
    expect(router).toContain('scanPathForExecution()')
  })
})
