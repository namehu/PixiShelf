import { describe, expect, it } from 'vitest'
import { compareFileNamesNaturally } from '../natural-file-name-order'

describe('compareFileNamesNaturally', () => {
  it('sorts numeric filename segments like Windows Explorer name ascending', () => {
    const fileNames = ['10.jpg', '2.jpg', '00261-2153324271.jpg', '00260-9.jpg']

    expect(fileNames.sort(compareFileNamesNaturally)).toEqual([
      '2.jpg',
      '10.jpg',
      '00260-9.jpg',
      '00261-2153324271.jpg'
    ])
  })
})
