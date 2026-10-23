import { webcrypto } from 'node:crypto'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixtureAuthorization } from '@/services/artwork-service/__tests__/media-content-fixture'
import { useReplacementRecovery } from '../use-replacement-recovery'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('crypto', webcrypto)
})
afterEach(() => vi.unstubAllGlobals())

describe('replacement recovery credentials', () => {
  it('restores the original owner credentials and exact pending commit after remount', () => {
    const first = renderHook(() => useReplacementRecovery('owner', 7))
    let headers: ReturnType<typeof first.result.current.replaceHeaders>
    act(() => {
      headers = first.result.current.replaceHeaders()
      first.result.current.pendingCommitRef.current = '{"images":[{"id":9}]}'
      first.result.current.persistReplacement({
        uploadTargetDir: 'work',
        targetRelDir: 'work',
        authorization: fixtureAuthorization()
      })
    })
    first.unmount()
    const resumed = renderHook(() => useReplacementRecovery('owner', 7))
    act(() => resumed.result.current.restoreRecovery())
    expect(resumed.result.current.recoverable).toBe(true)
    expect(resumed.result.current.pendingCommitRef.current).toBe('{"images":[{"id":9}]}')
    expect(resumed.result.current.replaceHeaders()).toMatchObject(headers!)
    act(() => resumed.result.current.forgetReplacement())
    expect(localStorage.getItem('pixishelf:replace:v1:owner:7')).toBeNull()
  })

  it('does not restore another account credentials', () => {
    const owner = renderHook(() => useReplacementRecovery('owner', 7))
    const original = owner.result.current.replaceHeaders()
    owner.unmount()
    const other = renderHook(() => useReplacementRecovery('other', 7))
    act(() => other.result.current.restoreRecovery())
    expect(other.result.current.recoverable).toBe(false)
    expect(other.result.current.replaceHeaders()['x-replace-token']).not.toBe(original['x-replace-token'])
    expect(localStorage.getItem('pixishelf:replace:v1:owner:7')).not.toBeNull()
  })
})
