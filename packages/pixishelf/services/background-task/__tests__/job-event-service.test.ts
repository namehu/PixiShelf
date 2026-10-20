import { describe, expect, it, vi } from 'vitest'
import { listIncrementalJobEvents, writeJobEvent, writeJobEvents } from '../job-event-service'
import { eventRecord } from './test-fixtures'

describe('listIncrementalJobEvents', () => {
  it('uses a BigInt cursor while returning JSON-safe ids and redacted event data', async () => {
    const findMany = vi.fn().mockResolvedValue([
      eventRecord({
        id: BigInt('9223372036854775807'),
        type: 'job.failed',
        level: 'ERROR',
        message: 'request failed token=private-token postgresql://url-user:url-secret@postgres/pixishelf',
        data: {
          authorization: 'Bearer private-token',
          nested: { password: 'private', databaseUrl: 'postgresql://url-user:url-secret@postgres/pixishelf' }
        }
      })
    ])
    const result = await listIncrementalJobEvents({ jobId: 'job-1', afterEventId: '42', limit: 20 }, {
      systemJobEvent: { findMany }
    } as never)

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobId: 'job-1', id: { gt: BigInt(42) } } })
    )
    expect(result.lastEventId).toBe('9223372036854775807')
    expect(result.items[0]).toMatchObject({
      id: '9223372036854775807',
      data: {
        authorization: '[REDACTED]',
        nested: { password: '[REDACTED]', databaseUrl: '[REDACTED]' }
      }
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('url-user')
    expect(serialized).not.toContain('url-secret')
    expect(serialized).not.toContain('private-token')
  })

  it('removes archive URL path tokens from event messages and nested data', async () => {
    const privateUrl = 'https://e-hentai.org/g/123/private-token/'
    const findMany = vi.fn().mockResolvedValue([
      eventRecord({
        job: { type: 'ARCHIVE_RESOLVE_ITEM' },
        message: `failed ${privateUrl}`,
        data: { source: privateUrl }
      })
    ])
    const result = await listIncrementalJobEvents({ jobId: 'job-1' }, {
      systemJobEvent: { findMany }
    } as never)

    const serialized = JSON.stringify(result)
    expect(serialized).toContain('https://e-hentai.org/g/…')
    expect(serialized).not.toContain('private-token')
  })
})

describe('batch job events', () => {
  it('shares validation, defaults and redaction with single writes', async () => {
    const createMany = vi.fn<(input: unknown) => Promise<{ count: number }>>().mockResolvedValue({ count: 1 })
    const create = vi.fn<(input: unknown) => Promise<ReturnType<typeof eventRecord>>>().mockResolvedValue(eventRecord())
    const client = { systemJobEvent: { createMany, create } } as never
    const input = {
      jobId: 'job-1',
      type: 'job.queued' as const,
      message: 'Cookie=private-cookie',
      data: { password: 'private-password' }
    }
    await writeJobEvents(client, [input])
    await writeJobEvent(client, input)
    const batch = createMany.mock.calls[0]?.[0] as unknown as { data: unknown[] }
    const single = create.mock.calls[0]?.[0] as unknown as { data: unknown }
    expect(batch.data).toEqual([single.data])
    expect(batch.data[0]).toMatchObject({ attempt: 0, level: 'INFO', workerId: null, data: { password: '[REDACTED]' } })
    expect(JSON.stringify(batch)).not.toContain('private-')
  })

  it('validates the entire batch before writing and skips empty batches', async () => {
    const createMany = vi.fn()
    const client = { systemJobEvent: { createMany } } as never
    await expect(
      writeJobEvents(client, [
        { jobId: 'valid', type: 'job.queued' },
        { jobId: '', type: 'job.queued' }
      ])
    ).rejects.toThrow()
    expect(createMany).not.toHaveBeenCalled()
    expect(await writeJobEvents(client, [])).toEqual({ count: 0 })
    expect(createMany).not.toHaveBeenCalled()
  })
})
