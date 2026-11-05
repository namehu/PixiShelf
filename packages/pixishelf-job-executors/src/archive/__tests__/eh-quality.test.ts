import { describe, expect, it } from 'vitest'
import { classifyEhDelivery, isEhOriginalEndpoint, parseEhOriginalClaim } from '../eh-quality.js'

const original = 'a'.repeat(40)
const delivered = 'b'.repeat(40)
const facts = { byteCount: 100, width: 1280, height: 900, mimeType: 'image/webp', sha1: delivered }
const descriptor = `${delivered}-100-1280-900-wbp`
const url = (path: string) => `https://node.hath.network:2443/${path}`

describe('EH actual delivered quality', () => {
  it('does not treat a successful original endpoint as proof without metadata matching the file', () => {
    expect(classifyEhDelivery({ url: 'https://e-hentai.org/fullimg/123/key/1/source', actual: facts, originalResponse: true }).quality).toBe('UNKNOWN')
  })
  it('rejects HTTP MIME claims that conflict with the received file even when its URL claims an original', () => {
    expect(
      classifyEhDelivery({ url: url(`om/1/${descriptor}/x/name.webp`), actual: facts, responseMimeType: 'image/jpeg' })
    ).toEqual({ quality: 'UNKNOWN', reason: 'RESPONSE_MIME_CONFLICTS_WITH_FILE' })
  })
  it.each([
    [`om/1/${original}-200-2400-1688-jpg/${descriptor}/1280/key/name.webp`, 'DISPLAY'],
    [`om/1/${descriptor}/x/0/key/name.webp`, 'ORIGINAL'],
    [`om/1/${descriptor}/${descriptor}/0/key/name.webp`, 'ORIGINAL'],
    [`h/${descriptor}/keystamp=key;fileindex=1;xres=org/name.webp`, 'ORIGINAL'],
    [`h/${descriptor}/keystamp=key;fileindex=1;xres=1280/name.webp`, 'DISPLAY'],
    [`h/${descriptor}/key/name.webp`, 'UNKNOWN'],
    [`om/1/${descriptor}/${delivered}-101-1280-900-wbp/0/name.webp`, 'UNKNOWN']
  ])('classifies trusted representations: %s', (path, quality) => {
    expect(classifyEhDelivery({ url: url(path), actual: facts }).quality).toBe(quality)
  })

  it.each(['780', '800', '980', '1280', '1600', '2400'])('supports xres=%s at the matching width', (xres) => {
    expect(
      classifyEhDelivery({
        url: url(`h/${delivered}-100-${xres}-900-wbp/key;xres=${xres}/name.webp`),
        actual: { ...facts, width: Number(xres) }
      })
    ).toEqual({ quality: 'DISPLAY', reason: 'HATH_H_XRES_DISPLAY' })
  })

  it.each([
    ['key;xres=1280/file.webp', 900, 'HATH_H_XRES_WIDTH_MISMATCH'],
    ['key;xres=800/file.webp', 900, 'HATH_H_XRES_WIDTH_MISMATCH'],
    ['key;xres=920/file.webp', 920, 'HATH_H_UNSUPPORTED_XRES'],
    ['key;xres=original/file.webp', 1280, 'HATH_H_UNSUPPORTED_XRES'],
    ['key;xres=1280/file.webp?xres=org', 1280, 'CONFLICTING_HATH_XRES'],
    ['key;xres=org;xres=1280/file.webp', 1280, 'CONFLICTING_HATH_XRES'],
    ['key;xres=org;xres=org/file.webp', 1280, 'DUPLICATE_HATH_XRES'],
    ['key/file.webp?xres=org', 1280, 'HATH_H_WITHOUT_EXPLICIT_XRES']
  ])('explains unverified xres evidence in %s at width %s', (suffix, width, reason) => {
    const actual = { ...facts, width }
    expect(
      classifyEhDelivery({
        url: url(`h/${delivered}-100-${width}-900-wbp/${suffix}`),
        actual,
        originalClaim: { width, height: actual.height, minBytes: 99, maxBytes: 101 }
      })
    ).toEqual({ quality: 'UNKNOWN', reason })
  })

  it.each([{ byteCount: 101 }, { width: 1 }, { height: 1 }, { mimeType: 'image/jpeg' }, { sha1: original }])(
    'rejects an original URL whose file contradicts its descriptor: %j',
    (changed) => {
      expect(
        classifyEhDelivery({ url: url(`om/1/${descriptor}/x/name.webp`), actual: { ...facts, ...changed } })
      ).toEqual({
        quality: 'UNKNOWN',
        reason: 'DELIVERED_FILE_CONFLICTS_WITH_DESCRIPTOR'
      })
    }
  )

  it.each(['https://hath.network.evil.test', 'http://node.hath.network', 'https://user:pass@node.hath.network'])(
    'rejects untrusted host %s',
    (host) => {
      expect(classifyEhDelivery({ url: `${host}/om/1/${descriptor}/x/name.webp`, actual: facts }).quality).toBe(
        'UNKNOWN'
      )
    }
  )

  it('preserves an explicit original declaration across a CDN redirect and checks rounded MiB precisely', () => {
    const originalClaim = parseEhOriginalClaim('Download original 1992 x 2912 4.45 MiB', 'original.png')!
    const actual = { byteCount: 4670970, width: 1992, height: 2912, mimeType: 'image/png' }
    expect(classifyEhDelivery({ url: 'https://cdn.e-hentai.org/opaque.png', actual, originalClaim }).quality).toBe(
      'ORIGINAL'
    )
    expect(
      classifyEhDelivery({
        url: 'https://cdn.e-hentai.org/opaque.png',
        actual: { ...actual, mimeType: 'image/webp' },
        originalClaim
      }).quality
    ).toBe('UNKNOWN')
    expect(
      classifyEhDelivery({
        url: 'https://cdn.e-hentai.org/opaque.png',
        actual: { ...actual, byteCount: 4600000 },
        originalClaim
      }).quality
    ).toBe('UNKNOWN')
  })

  it.each(['0.5 B', '100.5 B', '0 KiB', '9007199254740992 B'])(
    'rejects an original declaration without a possible safe byte count: %s',
    (size) => {
      expect(parseEhOriginalClaim(`Download original 1992 x 2912 ${size}`, 'original.png')).toBeUndefined()
    }
  )

  it('does not let a declaration override positive derivative evidence', () => {
    const originalClaim = { width: 1280, height: 900, minBytes: 99, maxBytes: 101 }
    expect(
      classifyEhDelivery({
        url: url(`om/1/${original}-200-2400-1688-jpg/${descriptor}/1280/name.webp`),
        actual: facts,
        originalClaim
      }).quality
    ).toBe('DISPLAY')
  })

  describe('same-page original comparison for a narrower display delivery', () => {
    const actual = { ...facts, width: 900 }
    const displayDescriptor = `${delivered}-100-900-900-wbp`
    const downloadUrl = url(`h/${displayDescriptor}/key;xres=1280/file.webp`)
    const matchingClaim = { width: 900, height: 900, mimeType: 'image/webp', minBytes: 99, maxBytes: 101 }

    it.each([{ width: 1800 }, { height: 1800 }, { mimeType: 'image/png' }, { minBytes: 102, maxBytes: 104 }])(
      'proves a display variant when the original declaration differs: %j',
      (different) => {
        expect(
          classifyEhDelivery({ url: downloadUrl, actual, sourceOriginalClaim: { ...matchingClaim, ...different } })
        ).toEqual({ quality: 'DISPLAY', reason: 'EH_DISPLAY_DIFFERS_FROM_ORIGINAL_DECLARATION' })
      }
    )

    it('does not infer an original from matching dimensions, format and rounded bytes', () => {
      expect(classifyEhDelivery({ url: downloadUrl, actual, sourceOriginalClaim: matchingClaim })).toEqual({
        quality: 'UNKNOWN',
        reason: 'HATH_H_XRES_WIDTH_MISMATCH'
      })
    })

    it('requires a matching observed SHA-1 before using the source comparison', () => {
      const { sha1, ...withoutSha1 } = actual
      const sourceOriginalClaim = { ...matchingClaim, width: 1800 }
      expect(classifyEhDelivery({ url: downloadUrl, actual: withoutSha1, sourceOriginalClaim })).toEqual({
        quality: 'UNKNOWN',
        reason: 'HATH_H_XRES_WIDTH_MISMATCH'
      })
      expect(
        classifyEhDelivery({ url: downloadUrl, actual: { ...actual, sha1: original }, sourceOriginalClaim })
      ).toEqual({ quality: 'UNKNOWN', reason: 'DELIVERED_FILE_CONFLICTS_WITH_DESCRIPTOR' })
    })

    it.each([
      ['key;xres=1280;xres=800/file.webp', 'CONFLICTING_HATH_XRES'],
      ['key;xres=920/file.webp', 'HATH_H_UNSUPPORTED_XRES'],
      ['key/file.webp', 'HATH_H_WITHOUT_EXPLICIT_XRES']
    ])('leaves an unverified delivery path unchanged: %s', (suffix, reason) => {
      expect(
        classifyEhDelivery({
          url: url(`h/${displayDescriptor}/${suffix}`),
          actual,
          sourceOriginalClaim: { ...matchingClaim, width: 1800 }
        })
      ).toEqual({ quality: 'UNKNOWN', reason })
    })
  })

  it.each([
    ['https://e-hentai.org/fullimg/123/key/1/file', true],
    ['https://e-hentai.org:443/fullimg.php?gid=1', true],
    ['https://api.e-hentai.org/fullimg.php', false],
    ['https://e-hentai.org:8443/fullimg.php', false],
    ['http://e-hentai.org/fullimg.php', false],
    ['https://e-hentai.org/g/1/token/?fullimg.php', false],
    ['https://e-hentai.org/fullimg.php/extra', false],
    ['https://e-hentai.org.evil.test/fullimg.php', false],
    ['https://u:p@e-hentai.org/fullimg.php', false]
  ])('recognizes exact original endpoints %s', (input, expected) => expect(isEhOriginalEndpoint(input)).toBe(expected))
})
