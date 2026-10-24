import { describe, expect, it } from 'vitest'
import { parseArtworkDedupSourceSnapshot, serializeArtworkDedupSourceSnapshot } from '../artwork-dedup-source-snapshot'
const identity = { kind: 'PROVIDER' as const, providerKey: 'pixiv', externalId: '123' }
const snapshot = () =>
  serializeArtworkDedupSourceSnapshot([{ identity, sourceId: 'source-1', generation: 9007199254740993n }])
describe('server-frozen dedup source snapshot', () => {
  it('round trips bigint without numeric precision loss and supports two exact identities', () => {
    expect(parseArtworkDedupSourceSnapshot(JSON.parse(JSON.stringify(snapshot())))).toEqual({
      version: 1,
      sources: [{ identity, sourceId: 'source-1', generation: '9007199254740993' }]
    })
    expect(
      serializeArtworkDedupSourceSnapshot([
        { identity, sourceId: 'source-1', generation: 0n },
        {
          identity: {
            kind: 'PATH',
            logicalRoot: 'source-media:v1',
            rootIdentity: 'root',
            canonicalPath: 'a/meta.json'
          },
          sourceId: 'source-2',
          generation: 9223372036854775807n
        }
      ]).sources
    ).toHaveLength(2)
  })
  it.each([
    null,
    undefined,
    {},
    { version: 0, sources: [] },
    { ...snapshot(), unexpected: true },
    { version: 1, sources: [] }
  ])('rejects absent, legacy or expanded input %j', (value) => {
    expect(() => parseArtworkDedupSourceSnapshot(value)).toThrow()
  })
  it.each(['00', '-1', '+1', '1.0', '1e3', ' 0', '9223372036854775808', 0])(
    'rejects noncanonical generation %j',
    (generation) => {
      expect(() =>
        parseArtworkDedupSourceSnapshot({ version: 1, sources: [{ ...snapshot().sources[0], generation }] })
      ).toThrow()
    }
  )
  it('rejects duplicate identity/ID, a third source, forged fields and non-bigint serialization', () => {
    const source = snapshot().sources[0]!
    for (const sources of [
      [source, { ...source, sourceId: 'other' }],
      [source, { ...source, identity: { ...identity, externalId: 'other' } }],
      [source, source, source],
      [{ ...source, identity: { ...identity, canonicalPath: 'private' } }],
      [{ ...source, extra: true }]
    ])
      expect(() => parseArtworkDedupSourceSnapshot({ version: 1, sources })).toThrow()
    expect(() =>
      serializeArtworkDedupSourceSnapshot([{ identity, sourceId: 'source-1', generation: 0 as never }])
    ).toThrow()
  })
  it.each(['../a', '/a', 'a//b', 'a/./b', 'a\\b', 'C:/a', '', 'a\0b'])(
    'rejects noncanonical PATH %j',
    (canonicalPath) => {
      expect(() =>
        serializeArtworkDedupSourceSnapshot([
          {
            identity: { kind: 'PATH', logicalRoot: 'source-media:v1', rootIdentity: 'root', canonicalPath },
            sourceId: 'path',
            generation: 0n
          }
        ])
      ).toThrow()
    }
  )
})
