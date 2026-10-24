import { describe, expect, it } from 'vitest'
import {
  parseLocalScanSourceSnapshot,
  parsePixivScanSourceSnapshot,
  scanSourceProofs
} from '../dedup-source-snapshot.ts'
import { localSourceProofFixture, pixivSourceProofFixture } from './dedup-source-fixture.ts'

describe('scan input source identity binding', () => {
  it('retains both precise Pixiv identities and bigint generation', () => {
    const proof = pixivSourceProofFixture('flat/42-meta.json')
    expect(
      scanSourceProofs(
        parsePixivScanSourceSnapshot({
          snapshot: proof,
          relativePath: 'flat/42-meta.json',
          externalId: '42',
          rootIdentity: 'fixture-root'
        })
      ).map((item) => item.generation)
    ).toEqual([3n, 3n])
  })
  it.each([null, undefined, { version: 9, sources: [] }])(
    'rejects absent or unknown proof without capture',
    (snapshot) => {
      expect(() => parsePixivScanSourceSnapshot({ snapshot, relativePath: 'flat/42-meta.json' })).toThrow(
        'new scan intent'
      )
    }
  )
  it('rejects provider identity, exact path and root mismatches', () => {
    const snapshot = pixivSourceProofFixture('flat/42-meta.json')
    for (const changes of [
      { externalId: '43' },
      { relativePath: 'other/42-meta.json' },
      { rootIdentity: 'other-root' }
    ]) {
      expect(() => parsePixivScanSourceSnapshot({ snapshot, relativePath: 'flat/42-meta.json', ...changes })).toThrow(
        'new scan intent'
      )
    }
  })
  it('never treats a flat Pixiv parent directory as its ownership proof', () => {
    expect(() =>
      parsePixivScanSourceSnapshot({ snapshot: localSourceProofFixture('flat'), relativePath: 'flat/42-meta.json' })
    ).toThrow('new scan intent')
    expect(() =>
      parseLocalScanSourceSnapshot({ snapshot: pixivSourceProofFixture('flat/42-meta.json'), relativePath: 'flat' })
    ).toThrow('new scan intent')
  })
})
