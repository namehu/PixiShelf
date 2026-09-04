import { describe, expect, it, vi } from 'vitest'
import { archiveTitleQuerySchema } from '@pixishelf/job-contracts'
import { EHentaiProvider } from '../providers/e-hentai.js'

const query = archiveTitleQuerySchema.parse({ keyword: 'Match', matchMode: 'STARTS_WITH' })
const input = { sourceId: 'source-1', query, cursor: null, stopAtExternalId: null, limit: 100 }
const link = (gid: number) => `<a href="https://e-hentai.org/g/${gid}/token${gid}/">Gallery</a>`

function fixture(
  ids: number[],
  titles: (gid: number) => { title: string; title_jpn?: string } = () => ({ title: 'other' })
) {
  const http = {
    text: vi.fn(async (_url: string) => ids.map(link).join('')),
    json: vi.fn(async (_url: string, options: { body: string }) => ({
      gmetadata: (JSON.parse(options.body).gidlist as [number, string][]).map(([gid, token]) => ({
        gid,
        token,
        uploader: `uploader-${gid}`,
        filecount: '1',
        tags: [],
        ...titles(gid)
      }))
    }))
  }
  return { http, provider: new EHentaiProvider(http as never) }
}

describe('E-Hentai title search', () => {
  it.each([950, 901, 900])('does not skip surviving tail candidates when GID %s disappears', async (removed) => {
    const ids = Array.from({ length: 101 }, (_, i) => 1000 - i)
    const { provider } = fixture(ids)
    const first = await provider.scanTitles(input)
    ids.splice(ids.indexOf(removed), 1)
    const second = await provider.scanTitles({ ...input, cursor: first.nextCursor })
    expect(second.items.map((item) => item.externalId)).toEqual(removed === 900 ? [] : ['900'])
    expect(second.nextCursor).toBeNull()
  })

  it('checks new front insertions and the original tail without rechecking the consumed prefix', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => 1000 - i)
    const { provider } = fixture(ids)
    const first = await provider.scanTitles(input)
    ids.unshift(2000, 2001)
    const second = await provider.scanTitles({ ...input, cursor: first.nextCursor })
    expect(second.items.map((item) => item.externalId)).toEqual(['2000', '2001', '900'])
    expect(second.items.every((item) => item.matchesQuery === false)).toBe(true)
    expect(second.nextCursor).toBeNull()
  })

  it('retains stable progress across repeated page mutations without assuming descending GIDs', async () => {
    const ids = Array.from({ length: 301 }, (_, i) => i + 1)
    const { provider } = fixture(ids)
    let cursor: string | null = null
    const checked = new Set<string>()
    for (let round = 0; round < 4; round += 1) {
      if (round > 0) {
        ids.unshift(1000 + round)
        ids.splice(ids.indexOf(round), 1)
      }
      const result = await provider.scanTitles({ ...input, cursor })
      expect(result.items.length).toBeLessThanOrEqual(100)
      for (const item of result.items) {
        expect(checked.has(item.externalId)).toBe(false)
        checked.add(item.externalId)
      }
      cursor = result.nextCursor
    }
    expect(cursor).toBeNull()
    expect(checked.size).toBe(304)
    expect(checked.has('301')).toBe(true)
  })

  it.each([0, 100])('replays legacy v1 offset %s conservatively and upgrades the next cursor', async (offset) => {
    const { provider } = fixture(Array.from({ length: 101 }, (_, i) => 1000 - i))
    const first = await provider.scanTitles(input)
    const outer = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8'))
    const inner = JSON.parse(Buffer.from(outer.cursor, 'base64url').toString('utf8'))
    outer.cursor = Buffer.from(JSON.stringify({ version: 1, url: inner.url, offset })).toString('base64url')
    const replay = await provider.scanTitles({
      ...input,
      cursor: Buffer.from(JSON.stringify(outer)).toString('base64url')
    })
    expect(replay.items.map((item) => item.externalId)).toEqual(first.items.map((item) => item.externalId))
    const nextOuter = JSON.parse(Buffer.from(replay.nextCursor!, 'base64url').toString('utf8'))
    expect(JSON.parse(Buffer.from(nextOuter.cursor, 'base64url').toString('utf8')).version).toBe(2)
    const tail = await provider.scanTitles({ ...input, cursor: replay.nextCursor })
    expect(tail.items.map((item) => item.externalId)).toEqual(['900'])
  })

  it('still stops at a raw nonmatching watermark after the page changes', async () => {
    const ids = [300, 200, 100]
    const { provider } = fixture(ids)
    const first = await provider.scanTitles({ ...input, limit: 1, stopAtExternalId: '100' })
    ids.unshift(400)
    const second = await provider.scanTitles({ ...input, cursor: first.nextCursor, stopAtExternalId: '100' })
    expect(second.items.map((item) => [item.externalId, item.matchesQuery])).toEqual([
      ['400', false],
      ['200', false]
    ])
    expect(second.reachedStop).toBe(true)
    expect(second.nextCursor).toBeNull()
  })

  it('clears page-local progress across pages while deduplicating candidates within a run', async () => {
    const { provider, http } = fixture([300, 200])
    http.text.mockImplementation(async (url) => {
      if (new URL(url).searchParams.has('next')) return [300, 200, 100, 50].map(link).join('')
      const nextUrl = new URL(url)
      nextUrl.searchParams.set('next', '200')
      return `${[300, 200].map(link).join('')}<a id="unext" href="${nextUrl.toString().replaceAll('&', '&amp;')}">Next</a>`
    })
    const first = await provider.scanTitles({ ...input, limit: 3 })
    expect(first.items.map((item) => item.externalId)).toEqual(['300', '200', '100'])
    const outer = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8'))
    expect(JSON.parse(Buffer.from(outer.cursor, 'base64url').toString('utf8')).checkedGids).toEqual([300, 200, 100])
    const second = await provider.scanTitles({ ...input, cursor: first.nextCursor })
    expect(second.items.map((item) => item.externalId)).toEqual(['50'])
    expect(second.nextCursor).toBeNull()
    const pageBoundary = await provider.scanTitles({ ...input, limit: 2 })
    const boundaryOuter = JSON.parse(Buffer.from(pageBoundary.nextCursor!, 'base64url').toString('utf8'))
    expect(JSON.parse(Buffer.from(boundaryOuter.cursor, 'base64url').toString('utf8')).checkedGids).toEqual([])
  })

  it('also protects uploader scans from page deletion and accepts their legacy cursors', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => 1000 - i)
    const { provider } = fixture(ids)
    const uploaderInput = {
      identityKind: 'UID' as const,
      identityValue: '123',
      cursor: null,
      stopAtExternalId: null,
      limit: 100
    }
    const first = await provider.scanUploader(uploaderInput)
    ids.splice(ids.indexOf(950), 1)
    const second = await provider.scanUploader({ ...uploaderInput, cursor: first.nextCursor })
    expect(second.items.map((item) => item.externalId)).toEqual(['900'])
    expect(second.nextCursor).toBeNull()
    const inner = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8'))
    const legacy = Buffer.from(JSON.stringify({ version: 1, url: inner.url, offset: 100 })).toString('base64url')
    const replay = await provider.scanUploader({ ...uploaderInput, cursor: legacy })
    expect(replay.items).toHaveLength(100)
    expect(replay.items.at(-1)?.externalId).toBe('900')
    expect(replay.nextCursor).toBeNull()
  })

  it('rejects malformed v2 progress and unsafe cursor URLs before fetching any page', async () => {
    const { provider, http } = fixture([300, 200])
    const first = await provider.scanTitles({ ...input, limit: 1 })
    const outer = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8'))
    const inner = JSON.parse(Buffer.from(outer.cursor, 'base64url').toString('utf8'))
    for (const change of [
      { checkedGids: null },
      { checkedGids: {} },
      { checkedGids: ['300'] },
      { checkedGids: [0] },
      { checkedGids: [-1] },
      { checkedGids: [1.5] },
      { checkedGids: [Number.MAX_SAFE_INTEGER + 1] },
      { checkedGids: [300, 300] },
      { checkedGids: Array.from({ length: 10_001 }, (_, i) => i + 1) },
      { offset: 1 },
      { version: 3 },
      { url: 'https://example.com/' },
      { url: inner.url.replace('https://', 'http://') },
      { url: inner.url.replace('e-hentai.org', 'user@e-hentai.org') },
      { url: inner.url.replace('e-hentai.org', 'e-hentai.org:444') },
      { url: 'https://e-hentai.org/?f_search=another-query' }
    ]) {
      const cursor = Buffer.from(
        JSON.stringify({
          ...outer,
          cursor: Buffer.from(JSON.stringify({ ...inner, ...change })).toString('base64url')
        })
      ).toString('base64url')
      await expect(provider.scanTitles({ ...input, cursor })).rejects.toMatchObject({ code: 'INVALID_URL' })
    }
    expect(http.text).toHaveBeenCalledTimes(1)
  })

  it('fails oversized remote pages instead of truncating stable progress', async () => {
    const { provider, http } = fixture(Array.from({ length: 10_001 }, (_, i) => i + 1))
    await expect(provider.scanTitles(input)).rejects.toMatchObject({ code: 'REMOTE_RESPONSE_INVALID' })
    expect(http.json).not.toHaveBeenCalled()
  })

  it('checks at most 100 distinct candidates even with zero matches, and continues inside the same page', async () => {
    const { http, provider } = fixture([...Array.from({ length: 101 }, (_, i) => 1000 - i), 1000])
    const first = await provider.scanTitles(input)
    expect(first.items).toHaveLength(100)
    expect(first.items.every((item) => item.matchesQuery === false)).toBe(true)
    expect(first.items[0]?.externalId).toBe('1000')
    expect(first.reachedStop).toBe(false)
    expect(first.nextCursor).not.toBeNull()
    const second = await provider.scanTitles({ ...input, cursor: first.nextCursor })
    expect(second.items.map((item) => item.externalId)).toEqual(['900'])
    expect(second.nextCursor).toBeNull()
    expect(http.text).toHaveBeenCalledTimes(2)
    expect(http.text.mock.calls.every(([url]) => !url.includes('/g/'))).toBe(true)
  })

  it('locally matches either original title independently, preserving internal whitespace and entities', async () => {
    const { provider } = fixture([300, 200, 100], (gid) => ({
      title: 'none',
      title_jpn: gid === 200 ? ' Match  &amp; 日本語 ' : 'Match &amp; 日本語'
    }))
    const result = await provider.scanTitles({ ...input, query: { ...query, keyword: 'match  & 日本語' } })
    expect(result.items.map((item) => item.matchesQuery)).toEqual([false, true, false])
    expect(result.discoveredUploaderUid).toBeNull()
  })

  it('uses the raw watermark even when the newest candidate does not match', async () => {
    const { provider } = fixture([300, 200, 100], (gid) => ({ title: gid === 200 ? 'Match' : 'other' }))
    const result = await provider.scanTitles({ ...input, stopAtExternalId: '100' })
    expect(result.items.map((item) => [item.externalId, item.matchesQuery])).toEqual([
      ['300', false],
      ['200', true]
    ])
    expect(result.reachedStop).toBe(true)
    expect(result.nextCursor).toBeNull()
  })

  it('ends normally if the former watermark disappeared', async () => {
    const { provider } = fixture([300, 100])
    const result = await provider.scanTitles({ ...input, stopAtExternalId: '200' })
    expect(result.items).toHaveLength(2)
    expect(result.reachedStop).toBe(false)
    expect(result.nextCursor).toBeNull()
  })

  it('binds continuation to source, keyword, mode and uploader scope before making requests', async () => {
    const { provider, http } = fixture([300, 200])
    const first = await provider.scanTitles({ ...input, limit: 1 })
    for (const changed of [
      { sourceId: 'another-source' },
      { query: { ...query, keyword: 'other' } },
      { query: { ...query, matchMode: 'ENDS_WITH' as const } },
      { query: { ...query, uploaderUid: '123' } }
    ])
      await expect(provider.scanTitles({ ...input, cursor: first.nextCursor, ...changed })).rejects.toThrow()
    expect(http.text).toHaveBeenCalledTimes(1)
  })

  it('rejects incomplete metadata instead of returning a committable partial page', async () => {
    const { provider, http } = fixture([300, 200])
    http.json.mockResolvedValueOnce({ gmetadata: [] })
    await expect(provider.scanTitles(input)).rejects.toMatchObject({ code: 'REMOTE_RESPONSE_INVALID' })
  })

  it('rejects unrepresentable query syntax before any network request', async () => {
    const { provider, http } = fixture([300])
    await expect(provider.scanTitles({ ...input, query: { ...query, keyword: 'foo" OR bar' } })).rejects.toThrow()
    expect(http.text).not.toHaveBeenCalled()
  })

  it('rejects a repeated next page even when the current page already fills the batch', async () => {
    const { provider, http } = fixture([300])
    http.text.mockImplementation(
      async (url) => `${link(300)}<a id="unext" href="${url.replaceAll('&', '&amp;')}">Next</a>`
    )
    await expect(provider.scanTitles({ ...input, limit: 1 })).rejects.toMatchObject({ code: 'REMOTE_RESPONSE_INVALID' })
    expect(http.json).not.toHaveBeenCalled()
  })
})
