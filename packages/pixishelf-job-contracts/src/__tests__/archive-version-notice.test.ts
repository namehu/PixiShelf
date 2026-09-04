import { describe, expect, it } from 'vitest'
import { formatArchiveVersionWarning, getEhentaiVersionNotice } from '../archive-version-notice.ts'

const legacy = '检测到 E-Hentai 画廊版本替代关系，将在关联作品存在时建立显式关系'
const history = '解析时发现此画廊关联了历史版本，不影响本次归档。'
const newer = '解析时此链接已是旧版，远端另有更新版本；本次仍归档此链接，新版需另行添加，不会覆盖旧版。'
const parent = { type: 'REPLACES', providerKey: 'e-hentai', externalId: '122', direction: 'OUTBOUND' }
const current = { ...parent, externalId: '124', direction: 'INBOUND' }

function format(relationships: unknown, warning: string | null = legacy, providerKey = 'e-hentai') {
  return formatArchiveVersionWarning({ providerKey, externalId: '123', normalizedMetadata: { relationships }, warning })
}

describe('archive version notices', () => {
  it('distinguishes historical versions from a newer remote version', () => {
    expect(getEhentaiVersionNotice('123', [parent])).toBe(history)
    expect(getEhentaiVersionNotice('123', [current])).toBe(newer)
  })

  it.each([
    [parent, current],
    [current, parent]
  ])('prioritizes the newer version for intermediate galleries', (...relations) => {
    expect(getEhentaiVersionNotice('123', relations)).toBe(newer)
  })

  it.each(
    [
      null,
      {},
      [],
      [null],
      [{ ...current, externalId: '123' }],
      [{ ...current, externalId: '0' }],
      [{ ...current, externalId: '-1' }],
      [{ ...current, providerKey: 'other' }],
      [{ ...current, type: 'OTHER' }],
      [{ ...current, direction: 'UNKNOWN' }]
    ].map((relationships) => ({ relationships }))
  )('ignores missing, invalid, foreign and self relationships: $relationships', ({ relationships }) => {
    expect(getEhentaiVersionNotice('123', relationships)).toBeNull()
  })

  it('reclassifies legacy messages and preserves unrelated warnings', () => {
    const warning = `媒体可能不完整\r\n${legacy}\r\n需要确认质量`
    expect(format([parent], warning)).toBe(`媒体可能不完整\n需要确认质量\n${history}`)
    expect(format([current], warning)).toBe(`媒体可能不完整\n需要确认质量\n${newer}`)
  })

  it('is idempotent for new records and restores a missing version notice from the snapshot', () => {
    expect(format([parent], history)).toBe(history)
    expect(format([current], `${newer}\n${legacy}`)).toBe(newer)
    expect(format([parent], null)).toBe(history)
  })

  it('keeps an indeterminate fallback when legacy metadata is unavailable', () => {
    expect(format(null)).toBe('解析时记录了画廊版本关系，但历史快照不足以区分新旧版本。')
    expect(
      formatArchiveVersionWarning({
        providerKey: 'e-hentai',
        externalId: '123',
        normalizedMetadata: null,
        warning: legacy
      })
    ).toBe(format(null))
  })

  it('does not change unrelated warnings or other providers', () => {
    expect(format([], null)).toBeNull()
    expect(format([], '普通警告')).toBe('普通警告')
    expect(format([current], legacy, 'other')).toBe(legacy)
  })
})
