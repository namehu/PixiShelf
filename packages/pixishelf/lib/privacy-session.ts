import { z } from 'zod'
import {
  PRIVACY_MEMORY_DURATION,
  PRIVACY_MEMORY_KEY,
  privacyMemorySchema,
  privacyStore,
  privacyVisitSchema,
  type createPrivacyStore,
  type PrivacyMemory,
  type PrivacyMode,
  type PrivacyState,
  type PrivacyVisit
} from '@/store/privacy-store'

export const PRIVACY_SESSION_KEY = 'pixishelf-privacy-visit-v1'
export const PRIVACY_SNAPSHOT_KEY = 'pixishelf-privacy-snapshot-v1'
export const PRIVACY_HANDOFF_KEY = 'pixishelf-privacy-handoff-v1'
export const PRIVACY_CHANNEL = 'pixishelf-privacy-v1'
export const PRIVACY_DISCOVERY_MS = 500
export const PRIVACY_HANDOFF_MS = 5000
const BUS_KEY = `${PRIVACY_CHANNEL}-message`
const handoffSchema = z.object({ visit: privacyVisitSchema, validUntil: z.number().finite() })
const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), id: z.string() }),
  z.object({ type: z.literal('reply'), id: z.string(), visit: privacyVisitSchema }),
  z.object({ type: z.literal('change'), visit: privacyVisitSchema })
])
type Message = z.infer<typeof messageSchema>
type Store = ReturnType<typeof createPrivacyStore>
type Channel = Pick<BroadcastChannel, 'postMessage' | 'close' | 'onmessage'>

/** Injectable browser boundary also permits multi-tab tests without faking Zustand. */
export interface PrivacyBrowser {
  localStorage: Storage
  sessionStorage: Storage
  addEventListener: Window['addEventListener']
  removeEventListener: Window['removeEventListener']
  createChannel?: (name: string) => Channel
}

function parseJSON(value: string | null): unknown {
  try {
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function id() {
  // randomUUID is unavailable on ordinary HTTP LAN origins.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function createPrivacySession(store: Store) {
  let browser: PrivacyBrowser | null = null
  let channel: Channel | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let discoveryId: string | null = null
  let stop: (() => void) | null = null
  let localOnly = false

  function update(state: Partial<PrivacyState>) {
    try {
      store.setState(state)
    } catch {
      // Zustand commits its in-memory state before persist writes. Keep that choice usable.
      try {
        store.setState({ storageError: true })
      } catch {
        /* storage remains unavailable */
      }
    }
  }

  function read(key: string, session = false) {
    try {
      return parseJSON((session ? browser?.sessionStorage : browser?.localStorage)?.getItem(key) ?? null)
    } catch {
      update({ storageError: true })
      return null
    }
  }

  function write(key: string, value: unknown, session = false) {
    try {
      ;(session ? browser?.sessionStorage : browser?.localStorage)?.setItem(key, JSON.stringify(value))
      return true
    } catch {
      update({ storageError: true })
      return false
    }
  }

  function snapshot() {
    const parsed = privacyVisitSchema.safeParse(read(PRIVACY_SNAPSHOT_KEY))
    return parsed.success ? parsed.data : null
  }

  function apply(visit: PrivacyVisit) {
    clearTimeout(timer)
    discoveryId = null
    update({ status: visit.mode, visit, remembered: visit.remembered })
    write(PRIVACY_SESSION_KEY, visit, true)
  }

  function send(message: Message) {
    try {
      channel?.postMessage(message)
    } catch {
      /* storage events still provide transport */
    }
    write(BUS_KEY, { ...message, nonce: id() })
  }

  function receive(value: unknown) {
    if (localOnly) return
    const parsed = messageSchema.safeParse(value)
    if (!parsed.success) return
    const message = parsed.data
    if (message.type === 'hello') {
      const visit = store.getState().visit
      if (visit) send({ type: 'reply', id: message.id, visit: snapshot() ?? visit })
    } else if (message.type === 'change' || message.id === discoveryId) {
      // Notifications may arrive out of order. The last shared write, not the payload, wins.
      const latest = snapshot() ?? message.visit
      if (latest.revision !== store.getState().visit?.revision) apply(latest)
    }
  }

  function publish(mode: PrivacyMode, remembered: PrivacyMemory | null) {
    const visit: PrivacyVisit = {
      visitId: store.getState().visit?.visitId ?? id(),
      revision: id(),
      mode,
      remembered
    }
    const shared = write(PRIVACY_SNAPSHOT_KEY, visit)
    localOnly = !shared
    apply(shared ? (snapshot() ?? visit) : visit)
    send({ type: 'change', visit })
  }

  function freshMemory() {
    const parsed = z
      .object({ state: z.object({ remembered: privacyMemorySchema.nullable() }) })
      .safeParse(read(PRIVACY_MEMORY_KEY))
    const remembered = parsed.success ? parsed.data.state.remembered : null
    return remembered && remembered.expiresAt > Date.now() ? remembered : null
  }

  function start(target: PrivacyBrowser) {
    if (stop) return stop
    browser = target
    try {
      channel = target.createChannel?.(PRIVACY_CHANNEL) ?? null
    } catch {
      channel = null
    }
    if (channel) channel.onmessage = (event) => receive(event.data)
    const onStorage = (event: StorageEvent) => {
      if (event.key === BUS_KEY) receive(parseJSON(event.newValue))
      if (event.key === PRIVACY_SNAPSHOT_KEY) {
        const latest = snapshot()
        if (!localOnly && latest && latest.revision !== store.getState().visit?.revision) apply(latest)
      }
    }
    const onPageHide = () => {
      const visit = store.getState().visit
      if (visit) write(PRIVACY_HANDOFF_KEY, { visit, validUntil: Date.now() + PRIVACY_HANDOFF_MS })
    }
    const reconcile = () => {
      const visit = store.getState().visit
      const latest = snapshot()
      if (!localOnly && visit && latest && visit.revision !== latest.revision) apply(latest)
    }
    target.addEventListener('storage', onStorage)
    target.addEventListener('pagehide', onPageHide)
    target.addEventListener('pageshow', reconcile)
    target.addEventListener('focus', reconcile)
    stop = () => {
      clearTimeout(timer)
      discoveryId = null
      target.removeEventListener('storage', onStorage)
      target.removeEventListener('pagehide', onPageHide)
      target.removeEventListener('pageshow', reconcile)
      target.removeEventListener('focus', reconcile)
      channel?.close()
      channel = null
      stop = null
    }

    // Read before the first setState: persist writes on every state change.
    const remembered = freshMemory()
    update({ remembered })
    const own = privacyVisitSchema.safeParse(read(PRIVACY_SESSION_KEY, true))
    const active = store.getState().visit ?? (own.success ? own.data : null)
    if (active) {
      apply(localOnly ? active : (snapshot() ?? active))
    } else {
      discoveryId = id()
      timer = setTimeout(() => {
        discoveryId = null
        const currentMemory = freshMemory()
        const handoff = handoffSchema.safeParse(read(PRIVACY_HANDOFF_KEY))
        if (currentMemory && currentMemory.expiresAt > Date.now()) {
          publish(currentMemory.mode, currentMemory)
        } else if (
          handoff.success &&
          handoff.data.validUntil > Date.now() &&
          handoff.data.validUntil <= Date.now() + PRIVACY_HANDOFF_MS
        ) {
          apply(snapshot() ?? handoff.data.visit)
        } else {
          update({ status: 'pending', remembered: null })
        }
      }, PRIVACY_DISCOVERY_MS)
      send({ type: 'hello', id: discoveryId })
    }
    return stop
  }

  return {
    start,
    choose(mode: PrivacyMode, remember = false) {
      publish(mode, remember ? { mode, expiresAt: Date.now() + PRIVACY_MEMORY_DURATION } : null)
    },
    toggle() {
      const state = store.getState()
      if (!state.visit) return
      const mode: PrivacyMode = state.visit.mode === 'privacy' ? 'direct' : 'privacy'
      const remembered =
        state.remembered && state.remembered.expiresAt > Date.now() ? { ...state.remembered, mode } : null
      publish(mode, remembered)
    },
    remember() {
      const { visit, remembered } = store.getState()
      if (!visit || (remembered && remembered.expiresAt > Date.now())) return
      publish(visit.mode, { mode: visit.mode, expiresAt: Date.now() + PRIVACY_MEMORY_DURATION })
    },
    forget() {
      const visit = store.getState().visit
      if (visit) publish(visit.mode, null)
    }
  }
}

export const privacySession = createPrivacySession(privacyStore)
