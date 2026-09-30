import { beforeEach, describe, expect, it } from 'vitest'
import {
  readArchivePreviewReturnState,
  saveArchivePreviewReturnState,
  type ArchivePreviewReturnState
} from '../archive-preview-return-state'

describe('preview return state', () => {
  beforeEach(() => sessionStorage.clear())
  const state = (): ArchivePreviewReturnState => ({
    savedAt: Date.now(),
    sourceFilter: 'ALL',
    selectedSourceId: 'source-1',
    resultFeed: 'ARCHIVED',
    unboundOnly: true,
    resultView: 'cards',
    positions: [
      ['source-1:ARCHIVED:true', { anchorId: 'item-100', anchorOffset: 12, scrollTop: 5000, windowScrollY: 60 }]
    ]
  })
  it('restores filters and anchor once, isolated by account and route', () => {
    const saved = state()
    saveArchivePreviewReturnState('owner', '/inbox?source=1', saved)
    expect(readArchivePreviewReturnState('other', '/inbox?source=1')).toBeNull()
    expect(readArchivePreviewReturnState('owner', '/inbox?source=2')).toBeNull()
    expect(readArchivePreviewReturnState('owner', '/inbox?source=1')).toEqual(saved)
    expect(readArchivePreviewReturnState('owner', '/inbox?source=1')).toBeNull()
  })
  it('ignores expired snapshots', () => {
    saveArchivePreviewReturnState('owner', '/inbox', { ...state(), savedAt: 0 })
    expect(readArchivePreviewReturnState('owner', '/inbox')).toBeNull()
  })
})
