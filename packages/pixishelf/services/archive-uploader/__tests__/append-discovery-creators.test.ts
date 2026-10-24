import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { appendDiscoveryCreators } from '../discovery-creator-service'

const input = { sourceId: 'source', artistIds: [2, 2], expectedRulesVersion: 3 }
function setup() {
  const source = {
    id: 'source',
    sourceKind: 'TITLE_QUERY',
    rulesVersion: 3,
    status: 'ARCHIVED',
    titleQuery: { keyword: 'Example', matchMode: 'CONTAINS', uploaderUid: null },
    titleRules: null,
    defaultCreators: [{ artist: { id: 1, name: 'Existing', kind: 'PERSON' } }],
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSuccessAt: null,
    incrementalCursor: null,
    historyCursor: null
  }
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    archiveUploaderSource: {
      findUnique: vi.fn().mockResolvedValue(source),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({
          ...source,
          defaultCreators: [...source.defaultCreators, { artist: { id: 2, name: 'New', kind: 'PERSON' } }]
        })
    },
    artist: { count: vi.fn().mockResolvedValue(1) },
    discoverySourceCreator: { createMany: vi.fn().mockResolvedValue({ count: 1 }) }
  }
  const database = { $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)) }
  return { source, tx, database }
}

describe('append discovery default creators', () => {
  beforeEach(() => vi.clearAllMocks())
  it('appends deduplicated IDs under locks and preserves original bindings and disabled state', async () => {
    const { tx, database } = setup()
    const result = await appendDiscoveryCreators(input, database as never)
    expect(tx.$queryRaw).toHaveBeenCalledOnce()
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRawUnsafe.mock.invocationCallOrder[0]!)
    expect(tx.$queryRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
      tx.archiveUploaderSource.findUnique.mock.invocationCallOrder[0]!
    )
    expect(tx.discoverySourceCreator.createMany).toHaveBeenCalledWith({
      data: [{ sourceId: 'source', artistId: 2 }],
      skipDuplicates: true
    })
    expect(result.defaultCreators.map(({ id }) => id)).toEqual([1, 2])
    expect(result.status).toBe('ARCHIVED')
  })
  it.each(['missing', 'uploader', 'version', 'artist', 'capacity'] as const)(
    'rejects %s without writing',
    async (failure) => {
      const { source, tx, database } = setup()
      if (failure === 'missing') tx.archiveUploaderSource.findUnique.mockResolvedValue(null)
      if (failure === 'uploader') source.sourceKind = 'UPLOADER'
      if (failure === 'version') source.rulesVersion = 4
      if (failure === 'artist') tx.artist.count.mockResolvedValue(0)
    if (failure === 'capacity') {
        source.defaultCreators = Array.from({ length: 200 }, (_, i) => ({
          artist: { id: i + 10, name: 'Existing', kind: 'PERSON' }
        }))
    }
      await expect(appendDiscoveryCreators(input, database as never)).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
      expect(tx.discoverySourceCreator.createMany).not.toHaveBeenCalled()
    }
  )
  it('allows an idempotent append at the capacity limit', async () => {
    const { source, tx, database } = setup()
    source.defaultCreators = Array.from({ length: 200 }, (_, i) => ({
      artist: { id: i + 1, name: 'Existing', kind: 'PERSON' }
    }))
    await appendDiscoveryCreators(input, database as never)
    expect(tx.discoverySourceCreator.createMany).toHaveBeenCalledOnce()
  })
})
