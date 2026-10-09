import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPrivacyStore, PRIVACY_MEMORY_DURATION, PRIVACY_MEMORY_KEY } from '@/store/privacy-store'
import {
  createPrivacySession,
  PRIVACY_CHANNEL,
  PRIVACY_HANDOFF_KEY,
  PRIVACY_SESSION_KEY,
  PRIVACY_SNAPSHOT_KEY,
  type PrivacyBrowser
} from '../privacy-session'

function memoryStorage(
  data = new Map<string, string>(),
  changed?: (key: string, value: string | null) => void
): Storage {
  return {
    get length() {
      return data.size
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
      changed?.(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
      changed?.(key, null)
    },
    clear: () => data.clear()
  }
}

function world(useChannel = true) {
  const data = new Map<string, string>()
  const targets = new Set<EventTarget>()
  const channels = new Set<{ onmessage: ((event: MessageEvent) => void) | null }>()
  const tabs: Array<{ stop: () => void }> = []
  function tab(sessionStorage = memoryStorage()) {
    const target = new EventTarget()
    targets.add(target)
    const localStorage = memoryStorage(data, (key, newValue) => {
      for (const peer of targets) {
        if (peer !== target) {
          setTimeout(() => peer.dispatchEvent(new StorageEvent('storage', { key, newValue })), 0)
        }
      }
    })
    const browser: PrivacyBrowser = {
      localStorage,
      sessionStorage,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      createChannel: !useChannel
        ? undefined
        : () => {
            const channel = {
              onmessage: null as ((event: MessageEvent) => void) | null,
              postMessage(message: unknown) {
                for (const peer of channels) {
                  if (peer !== channel) {
                    setTimeout(() => {
                      if (channels.has(peer)) peer.onmessage?.(new MessageEvent('message', { data: message }))
                    }, 0)
                  }
                }
              },
              close() {
                channels.delete(channel)
              }
            }
            channels.add(channel)
            return channel
          }
    }
    const store = createPrivacyStore(localStorage)
    const controller = createPrivacySession(store)
    const stop = controller.start(browser)
    const result = {
      store,
      controller,
      target,
      localStorage,
      sessionStorage,
      stop: () => {
        stop()
        targets.delete(target)
      }
    }
    tabs.push(result)
    return result
  }
  return { tab, data, close: () => tabs.forEach((entry) => entry.stop()) }
}

const worlds: ReturnType<typeof world>[] = []
function setup(channel = true) {
  const result = world(channel)
  worlds.push(result)
  return result
}
function flush() {
  vi.advanceTimersByTime(20)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-09T00:00:00Z'))
})
afterEach(() => {
  worlds.splice(0).forEach((item) => item.close())
  vi.useRealTimers()
})

describe('browser privacy visits', () => {
  it.each([true, false])(
    'shares choices with new and pending tabs, then synchronizes both directions (BroadcastChannel=%s)',
    (channel) => {
      const browser = setup(channel)
      const a = browser.tab()
      const b = browser.tab()
      expect(a.store.getState().status).toBe('initializing')
      vi.advanceTimersByTime(500)
      expect(a.store.getState().status).toBe('pending')
      a.controller.choose('privacy')
      flush()
      expect(b.store.getState().status).toBe('privacy')
      const c = browser.tab()
      flush()
      expect(c.store.getState().visit?.visitId).toBe(a.store.getState().visit?.visitId)
      b.controller.toggle()
      flush()
      expect([a, b, c].map((item) => item.store.getState().status)).toEqual(['direct', 'direct', 'direct'])
    }
  )

  it('continues refresh, hard navigation and restored tabs with the latest shared choice', () => {
    const browser = setup()
    const a = browser.tab()
    vi.advanceTimersByTime(500)
    a.controller.choose('direct')
    const session = a.sessionStorage
    a.stop()
    const restored = browser.tab(session)
    expect(restored.store.getState().status).toBe('direct')
    const b = browser.tab()
    flush()
    b.controller.toggle()
    flush()
    restored.stop()
    expect(browser.tab(session).store.getState().status).toBe('privacy')
  })

  it('does not treat a durable snapshot as a live visit once all tabs close', () => {
    const browser = setup()
    const a = browser.tab()
    vi.advanceTimersByTime(500)
    a.controller.choose('direct')
    a.stop() // crash, with no pagehide
    const b = browser.tab()
    vi.advanceTimersByTime(500)
    expect(b.store.getState().status).toBe('pending')
  })

  it('allows only the five-second pagehide handoff', () => {
    const browser = setup()
    const a = browser.tab()
    vi.advanceTimersByTime(500)
    a.controller.choose('privacy')
    a.target.dispatchEvent(new Event('pagehide'))
    a.stop()
    const b = browser.tab()
    vi.advanceTimersByTime(500)
    expect(b.store.getState().status).toBe('privacy')
    b.stop()
    vi.advanceTimersByTime(5001)
    const c = browser.tab()
    vi.advanceTimersByTime(500)
    expect(c.store.getState().status).toBe('pending')
  })

  it('remembers either mode for a fixed duration and changes it without renewing', () => {
    const browser = setup()
    const a = browser.tab()
    vi.advanceTimersByTime(500)
    a.controller.choose('privacy', true)
    const expiresAt = a.store.getState().remembered!.expiresAt
    expect(expiresAt).toBe(Date.now() + PRIVACY_MEMORY_DURATION)
    vi.advanceTimersByTime(60_000)
    a.controller.toggle()
    a.controller.remember()
    expect(a.store.getState().remembered).toEqual({ mode: 'direct', expiresAt })
    a.stop()
    const b = browser.tab()
    vi.advanceTimersByTime(500)
    expect(b.store.getState().status).toBe('direct')
    expect(b.store.getState().remembered?.expiresAt).toBe(expiresAt)
  })

  it('keeps an active visit and its new tabs past expiry, but asks on the next independent visit', () => {
    const browser = setup()
    const a = browser.tab()
    vi.advanceTimersByTime(500)
    a.controller.choose('privacy', true)
    vi.advanceTimersByTime(PRIVACY_MEMORY_DURATION + 1)
    const b = browser.tab()
    flush()
    expect(b.store.getState().status).toBe('privacy')
    a.stop()
    b.stop()
    const c = browser.tab()
    vi.advanceTimersByTime(500)
    expect(c.store.getState().status).toBe('pending')
  })

  it('forgets across tabs without interrupting this visit or resurrecting the old memory', () => {
    const browser = setup()
    const a = browser.tab()
    vi.advanceTimersByTime(500)
    a.controller.choose('direct', true)
    const b = browser.tab()
    flush()
    a.controller.forget()
    flush()
    expect(b.store.getState().status).toBe('direct')
    expect(b.store.getState().remembered).toBeNull()
    a.stop()
    b.stop()
    const c = browser.tab()
    vi.advanceTimersByTime(500)
    expect(c.store.getState().status).toBe('pending')
  })

  it('reads the latest snapshot when old notifications arrive and when a suspended tab resumes', () => {
    const browser = setup(false)
    const a = browser.tab()
    vi.advanceTimersByTime(500)
    a.controller.choose('privacy')
    const old = a.store.getState().visit
    a.controller.toggle()
    a.target.dispatchEvent(
      new StorageEvent('storage', {
        key: `${PRIVACY_CHANNEL}-message`,
        newValue: JSON.stringify({ type: 'change', visit: old })
      })
    )
    expect(a.store.getState().status).toBe('direct')
    browser.data.set(PRIVACY_SNAPSHOT_KEY, JSON.stringify({ ...old, revision: 'new-decision', mode: 'privacy' }))
    a.target.dispatchEvent(new Event('pageshow'))
    expect(a.store.getState().status).toBe('privacy')
  })

  it('converges concurrent choices without reapplying a queued older choice', () => {
    const browser = setup()
    const a = browser.tab()
    const b = browser.tab()
    vi.advanceTimersByTime(500)
    a.controller.choose('privacy', true)
    b.controller.choose('direct')
    flush()
    expect(a.store.getState().status).toBe('direct')
    expect(a.store.getState().remembered).toBeNull()
    expect(b.store.getState().status).toBe('direct')
  })

  it('rejects malformed data and overlong handoffs', () => {
    const browser = setup()
    browser.data.set(PRIVACY_MEMORY_KEY, '{broken')
    browser.data.set(PRIVACY_SNAPSHOT_KEY, JSON.stringify({ mode: 'direct' }))
    browser.data.set(
      PRIVACY_HANDOFF_KEY,
      JSON.stringify({
        visit: { visitId: 'old', revision: 'old', mode: 'direct', remembered: null },
        validUntil: Date.now() + 90000
      })
    )
    const a = browser.tab()
    a.sessionStorage.setItem(PRIVACY_SESSION_KEY, '{}')
    vi.advanceTimersByTime(500)
    expect(a.store.getState().status).toBe('pending')
  })

  it('keeps choices usable when reads and persistence throw', () => {
    const unavailable = memoryStorage()
    unavailable.getItem = () => {
      throw new Error('denied')
    }
    unavailable.setItem = () => {
      throw new Error('quota')
    }
    const store = createPrivacyStore(unavailable)
    const controller = createPrivacySession(store)
    const target = new EventTarget()
    const stop = controller.start({
      localStorage: unavailable,
      sessionStorage: unavailable,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target)
    })
    vi.advanceTimersByTime(500)
    expect(store.getState().status).toBe('pending')
    expect(() => controller.choose('privacy', true)).not.toThrow()
    expect(store.getState().status).toBe('privacy')
    controller.toggle()
    expect(store.getState().status).toBe('direct')
    expect(store.getState().storageError).toBe(true)
    stop()
  })

  it('does not restore an old snapshot if storage becomes read-only during a toggle', () => {
    const browser = setup()
    const a = browser.tab()
    vi.advanceTimersByTime(500)
    a.controller.choose('direct')
    a.localStorage.setItem = () => {
      throw new Error('quota')
    }
    a.controller.toggle()
    expect(a.store.getState().status).toBe('privacy')
    a.target.dispatchEvent(new Event('focus'))
    a.target.dispatchEvent(new Event('pageshow'))
    expect(a.store.getState().status).toBe('privacy')
  })
})
