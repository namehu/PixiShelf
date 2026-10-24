import { describe, expect, it } from 'vitest'
import { serializeArtworkDedupSourceSnapshot } from '@pixishelf/job-contracts'
import { parseArchiveSourceSnapshot, assertArchiveSourceUnchanged } from '../dedup-source-snapshot.ts'

const owner = { providerKey: 'test', externalId: '42' }
const proof = serializeArtworkDedupSourceSnapshot([{ identity: { kind: 'PROVIDER', ...owner }, sourceId: 'original-source', generation: 9007199254740993n }])

describe('archive original source proof identity', () => {
  it('preserves the exact bigint decimal and original source ID', () => {
    expect(parseArchiveSourceSnapshot({ ...owner, dedupSourceSnapshot: proof })).toEqual(proof)
  })
  it.each([null, undefined, {}, { ...proof, extra: true }])('rejects missing or non-contract proof %j', (dedupSourceSnapshot) => {
    expect(() => parseArchiveSourceSnapshot({ ...owner, dedupSourceSnapshot })).toThrow('持久来源证明')
  })
  it('rejects a resolved provider identity different from the submitted URL identity', () => {
    expect(() => parseArchiveSourceSnapshot({ ...owner, externalId: '43', dedupSourceSnapshot: proof })).toThrow('持久来源证明')
  })
  it('rejects a newly captured proof replacing the original during the same execution', () => {
    const replacement = serializeArtworkDedupSourceSnapshot([{ ...proof.sources[0]!, generation: 9007199254740994n }])
    expect(() => assertArchiveSourceUnchanged({ ...owner, dedupSourceSnapshot: replacement }, { ...owner, dedupSourceSnapshot: proof })).toThrow('持久来源证明')
  })
  it('rejects an additional directory proof for URL archive ownership', () => {
    const mixed = serializeArtworkDedupSourceSnapshot([
      { ...proof.sources[0]!, generation: 9007199254740993n },
      { identity: { kind: 'DIRECTORY', logicalRoot: 'archive-media:v1', rootIdentity: 'root', canonicalPath: '' }, sourceId: 'directory', generation: 1n }
    ])
    expect(() => parseArchiveSourceSnapshot({ ...owner, dedupSourceSnapshot: mixed })).toThrow('持久来源证明')
  })
})
