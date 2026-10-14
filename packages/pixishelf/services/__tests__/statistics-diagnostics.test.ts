// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@pixishelf/db'
import { diagnoseStatistics } from '../statistics-diagnostics'

const healthyTriggers = [
  { name: 'artwork_image_count_trigger', type: 4, enabled: 'O', function: 'update_artwork_image_count' },
  { name: 'artwork_image_count_delete_trigger', type: 8, enabled: 'O', function: 'update_artwork_image_count' },
  { name: 'artwork_image_count_update_trigger', type: 16, enabled: 'O', function: 'update_artwork_image_count' }
]
async function diagnostic(
  totals = { exact: 100n, optimized: 100n, mismatchedArtworks: 0n },
  triggers = healthyTriggers
) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce(triggers)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([totals])
      .mockResolvedValue([{ 'QUERY PLAN': [] }])
  }
  const transaction = vi.fn(async (read: (tx: unknown) => Promise<unknown>) => read(tx))
  const db = { $transaction: transaction } as unknown as PrismaClient
  const result = await diagnoseStatistics(db)
  return { result, tx, transaction }
}

describe('statistics rollout diagnostics', () => {
  it('permits a matching database with all three active triggers and uses a bounded read-only snapshot', async () => {
    const { result, tx, transaction } = await diagnostic()
    expect(result.safeToEnable).toBe(true)
    expect(tx.$executeRaw.mock.calls.map(([sql]) => sql.join(''))).toEqual([
      'SET TRANSACTION READ ONLY',
      "SET LOCAL statement_timeout = '30s'",
      "SET LOCAL lock_timeout = '2s'"
    ])
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
      timeout: 180000,
      maxWait: 5000
    })
  })

  it('rejects mismatched totals and offsetting per-artwork errors even if grand totals match', async () => {
    expect((await diagnostic({ exact: 100n, optimized: 99n, mismatchedArtworks: 1n })).result.safeToEnable).toBe(false)
    expect((await diagnostic({ exact: 100n, optimized: 100n, mismatchedArtworks: 2n })).result.safeToEnable).toBe(false)
  })

  it.each(['missing', 'disabled', 'replica-only', 'wrong-event', 'wrong-function'])(
    'rejects a %s counter trigger',
    async (failure) => {
      const triggers = healthyTriggers.map((trigger) => ({ ...trigger }))
      if (failure === 'missing') triggers.pop()
      if (failure === 'disabled') triggers[0]!.enabled = 'D'
      if (failure === 'replica-only') triggers[0]!.enabled = 'R'
      if (failure === 'wrong-event') triggers[0]!.type = 8
      if (failure === 'wrong-function') triggers[0]!.function = 'different_function'
      expect((await diagnostic(undefined, triggers)).result.safeToEnable).toBe(false)
    }
  )
})
