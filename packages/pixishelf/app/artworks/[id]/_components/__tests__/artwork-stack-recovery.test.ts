import { beforeEach, describe, expect, it } from 'vitest'
import { saveStackRecovery, takeStackRecovery } from '../artwork-stack-recovery'

beforeEach(() => sessionStorage.clear())
describe('source-conflict stack recovery', () => {
  it('restores once, scoped to the artwork and signed-in owner', () => {
    const value = { mediaId: 19, mode: 'stack' as const, savedAt: 1000 }
    saveStackRecovery(sessionStorage, 1, 'alice', value)
    expect(takeStackRecovery(sessionStorage, 1, 'bob', 1001)).toBeNull()
    expect(takeStackRecovery(sessionStorage, 2, 'alice', 1001)).toBeNull()
    expect(takeStackRecovery(sessionStorage, 1, 'alice', 1001)).toEqual(value)
    expect(takeStackRecovery(sessionStorage, 1, 'alice', 1001)).toBeNull()
  })
  it('expires without changing a later normal visit', () => {
    saveStackRecovery(sessionStorage, 1, 'alice', { mediaId: 19, mode: 'stack', savedAt: 1000 })
    expect(takeStackRecovery(sessionStorage, 1, 'alice', 61000)).toBeNull()
  })
  it('fails safely when browser storage is unavailable', () => {
    const storage = { setItem() { throw new Error('blocked') }, getItem() { throw new Error('blocked') } } as unknown as Storage
    expect(() => saveStackRecovery(storage, 1, 'alice', { mediaId: 19, mode: 'stack', savedAt: 1000 })).not.toThrow()
    expect(takeStackRecovery(storage, 1, 'alice')).toBeNull()
    const denied = () => { throw new DOMException('Blocked', 'SecurityError') }
    expect(() => saveStackRecovery(denied, 1, 'alice', { mediaId: 19, mode: 'stack', savedAt: 1000 })).not.toThrow()
    expect(takeStackRecovery(denied, 1, 'alice')).toBeNull()
  })
})
