import { describe, expect, it } from 'vitest'
import { inferMediaTypeFromPath, needsAnimationContentScan } from '../media-types.ts'
import { mediaClassificationCases } from './fixtures/media-classification.ts'

describe('shared initial media classification', () => {
  it.each(mediaClassificationCases)('%s => %s, content scan %s', (name, kind, scan) => {
    expect(inferMediaTypeFromPath(`/work/${name}`)).toBe(kind)
    expect(inferMediaTypeFromPath(`C:\\work\\${name}?version=1`)).toBe(kind)
    expect(needsAnimationContentScan(name)).toBe(scan)
  })
  it('does not treat a directory extension as a file extension', () => {
    expect(inferMediaTypeFromPath('/work.jpg/no-extension')).toBe('UNKNOWN')
  })
})
