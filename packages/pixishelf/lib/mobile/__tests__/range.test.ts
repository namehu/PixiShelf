import { describe, expect, it } from 'vitest'
import { parseMobileRange } from '../range'
describe('video byte ranges', () => {
  it.each([
    ['bytes=0-99', { start: 0, end: 99 }],
    ['bytes=90-', { start: 90, end: 99 }],
    ['bytes=-20', { start: 80, end: 99 }],
    ['bytes=0-999', { start: 0, end: 99 }]
  ])('supports %s', (value, result) => expect(parseMobileRange(value as string, 100)).toEqual(result))
  it.each([
    'bytes=100-',
    'bytes=9-2',
    'bytes=-0',
    'bytes=-',
    'bytes=0-1,3-4',
    'bytes=abc-5',
    'bytes=999999999999999999999-'
  ])('rejects %s', (value) => expect(parseMobileRange(value, 100)).toBe(false))
  it('supports ordinary reads and rejects ranges of empty files', () => {
    expect(parseMobileRange(null, 100)).toBeNull()
    expect(parseMobileRange('bytes=0-', 0)).toBe(false)
  })
})
