import { describe, expect, it } from 'vitest'
import { archiveDiscoverySourceHref, archiveTitleSearchHref } from '../archive-source-links'

describe('archive source navigation', () => {
  it('encodes a literal title query on the fixed HTTPS host', () => {
    const url = new URL(archiveTitleSearchHref({ keyword: '作者 & A / B ? # = +' })!)
    expect(url.origin + url.pathname).toBe('https://e-hentai.org/')
    expect([...url.searchParams.keys()]).toEqual(['f_search'])
    expect(url.searchParams.get('f_search')).toBe('title:"作者 & a / b ? # = +"')
    expect(url.hash).toBe('')
  })
  it.each(['', 'a"b', 'a*b', 'a%b', 'a\nb'])('does not silently broaden an invalid title %j', (keyword) => {
    expect(archiveTitleSearchHref({ keyword })).toBeNull()
  })
  it('keeps uploader restrictions in the remote query', () => {
    const href = archiveTitleSearchHref({ keyword: 'Art', uploaders: [{ uid: '123' }, { uid: '456' }] })!
    expect(new URL(href).searchParams.get('f_search')).toBe('title:"art" ~uploaduid:123 ~uploaduid:456')
    expect(
      new URL(archiveTitleSearchHref({ keyword: 'Art', uploaderName: 'Alice' })!).searchParams.get('f_search')
    ).toBe('title:"art" uploader:"alice"')
  })
  it('encodes source IDs without adding navigation parameters', () => {
    const url = new URL(archiveDiscoverySourceHref('one&tab=inbox'), 'https://local.test')
    expect(url.searchParams.get('sourceId')).toBe('one&tab=inbox')
    expect(url.searchParams.get('tab')).toBe('uploaders')
  })
})
