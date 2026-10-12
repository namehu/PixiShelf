import { FRAME_LIMIT, INPUT_BLOCK_LIMIT, INDEPENDENT_HEAP, independentHeader, MiB } from './independent-frame'
import type { PlayerLimits, PlayerErrorCode } from './types'

export const CACHE_BLOCK = 65536
export const CACHE_MAX_BYTES = 128 * MiB
export const CACHE_FILE_BYTES = 64 * MiB
const BRIDGE_RESERVE = INPUT_BLOCK_LIMIT + 2 * CACHE_BLOCK
// The fetch block plus both port buffers also fit the existing input-block allowance when caching is bypassed.
const FETCH_BLOCK_LIMIT = INPUT_BLOCK_LIMIT - 2 * CACHE_BLOCK
const rounded = (n: number) => Math.ceil(n / CACHE_BLOCK) * CACHE_BLOCK
interface Entry {
  blocks: Uint8Array[]
  bytes: number
  length: number
  reserved: number
  complete: boolean
  lastUsed: number
}
export interface InputLease {
  port: MessagePort
  release(): void
  validate(): void
  invalidate(): void
}

/** Ephemeral, single-preview cache. Owners must clear it on preview/auth lifecycle changes. */
export class CompressedInputCache {
  private entries = new Map<string, Entry>()
  private active: { stop: () => void; revoke: () => void; entry: () => Entry | undefined } | null = null
  private hits = 0
  private misses = 0
  constructor(private now = () => performance.now()) {}
  getSnapshot() {
    return { entries: this.entries.size, reservedBytes: this.reserved, hits: this.hits, misses: this.misses }
  }
  private get reserved() {
    return [...this.entries.values()].reduce((n, e) => n + e.reserved, 0)
  }
  private evict(cap: number, incoming = 0) {
    const pinned = this.active?.entry()
    for (const [key, e] of [...this.entries].sort((a, b) => a[1].lastUsed - b[1].lastUsed)) {
      if (e === pinned) continue
      if (
        this.reserved + incoming <= cap &&
        this.entries.size <= (incoming ? 7 : 8) &&
        this.now() - e.lastUsed < 300_000
      )
        continue
      this.entries.delete(key)
    }
    return this.reserved + incoming <= cap && this.entries.size <= (incoming ? 7 : 8)
  }
  /** Hidden previews retain only an input currently borrowed by playback. */
  trim() {
    const pinned = this.active?.entry()
    for (const [key, e] of this.entries) {
      if (e !== pinned || !e.complete) {
        this.entries.delete(key)
        e.blocks.length = 0
      }
    }
  }
  clear() {
    const active = this.active
    this.active = null
    active?.stop()
    active?.revoke()
    this.entries.clear()
  }
  connect(url: string, limits: PlayerLimits, revoke: () => void): InputLease {
    const resolved = new URL(url, location.href)
    if (resolved.origin !== location.origin || !['http:', 'https:'].includes(resolved.protocol))
      throw Error('unsupported')
    resolved.hash = ''
    const key = resolved.href
    const previous = this.active
    this.active = null
    previous?.stop()
    previous?.revoke()
    this.evict(CACHE_MAX_BYTES)
    const channel = new MessageChannel(),
      controller = new AbortController()
    let entry: Entry | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let block: Uint8Array | undefined,
      offset = 0,
      cacheIndex = 0,
      received = 0
    let stopped = false,
      opened = false,
      busy = false,
      eof = false,
      validated = false
    const send = (data: unknown, transfer: Transferable[] = []) => {
      if (!stopped) channel.port1.postMessage(data, transfer)
    }
    const remove = () => {
      if (entry && this.entries.get(key) === entry) this.entries.delete(key)
    }
    const stop = () => {
      if (stopped) return
      stopped = true
      controller.abort()
      void reader?.cancel().catch(() => {})
      channel.port1.close()
      block = undefined
      if (entry && !entry.complete) remove()
      entry = undefined
      pendingInitial = []
      reader = undefined
      if (this.active === active) this.active = null
    }
    const active = { stop, revoke, entry: () => entry }
    this.active = active
    const fail = (code: PlayerErrorCode) => {
      send({ type: 'error', code })
      remove()
      stop()
      if (code === 'auth') this.entries.clear()
    }
    const validate = () => {
      if (stopped) return
      validated = true
      if (entry && eof && entry.bytes === entry.length && entry.bytes === received && this.entries.get(key) === entry) {
        entry.complete = true
        entry.lastUsed = this.now()
      }
    }
    const cacheLimits = (prefix: Uint8Array, length: number) => {
      const header = prefix.length >= 44 ? independentHeader(prefix.subarray(0, 44)) : null
      if (
        !header ||
        header.totalBytes !== length ||
        length > CACHE_FILE_BYTES ||
        length > limits.maxInputBytes ||
        header.width * header.height > limits.maxPixels ||
        limits.maxHeapBytes < 2 * INDEPENDENT_HEAP
      )
        return null
      const needed =
        2 * INDEPENDENT_HEAP +
        rounded(length) +
        INPUT_BLOCK_LIMIT +
        FRAME_LIMIT * 6 +
        header.width * header.height * 4 * 5
      const capacity = Math.max(
        0,
        Math.min(
          CACHE_MAX_BYTES,
          Math.floor((limits.maxManagedBytes - needed - BRIDGE_RESERVE) / CACHE_BLOCK) * CACHE_BLOCK
        )
      )
      return { capacity, needed }
    }
    const open = async () => {
      const cached = this.entries.get(key)
      if (cached?.complete) {
        const budget = cacheLimits(cached.blocks[0]!, cached.bytes)
        entry = cached
        if (budget && this.evict(budget.capacity) && this.reserved <= budget.capacity) {
          this.hits++
          cached.lastUsed = this.now()
          this.entries.delete(key)
          this.entries.set(key, cached)
          send({
            type: 'opened',
            length: cached.bytes,
            limits: { ...limits, maxManagedBytes: limits.maxManagedBytes - this.reserved - BRIDGE_RESERVE },
            cached: true
          })
          return
        }
        entry = undefined
        this.entries.delete(key)
      }
      this.misses++
      const response = await fetch(key, { credentials: 'same-origin', signal: controller.signal })
      if (stopped) {
        void response.body?.cancel()
        return
      }
      if (response.status === 401 || response.status === 403) {
        fail('auth')
        return
      }
      if (!response.ok || !response.body) {
        fail('network')
        return
      }
      const length = Number(response.headers.get('content-length'))
      if (length > limits.maxInputBytes) {
        fail('file-limit')
        return
      }
      reader = response.body.getReader()
      // Preserve the first input chunk(s), without waiting for the file. The prefix is bounded to 44 bytes.
      const prefix = new Uint8Array(44)
      let prefixSize = 0
      const initial: Uint8Array[] = []
      while (prefixSize < 44) {
        const item = await reader.read()
        if (stopped) return
        if (item.done) {
          eof = true
          break
        }
        if (item.value.byteLength > FETCH_BLOCK_LIMIT) {
          fail('memory-limit')
          return
        }
        if (!item.value.length) continue
        const take = Math.min(44 - prefixSize, item.value.length)
        prefix.set(item.value.subarray(0, take), prefixSize)
        prefixSize += take
        initial.push(item.value)
      }
      // At most 43 tiny prefix chunks plus one bounded fetch block; release each after use.
      pendingInitial = initial
      const budget =
        response.status === 200 &&
        !response.redirected &&
        response.url === key &&
        resolved.pathname.startsWith('/api/v1/images/') &&
        resolved.searchParams.has('v') &&
        Number.isSafeInteger(length) &&
        length > 0
          ? cacheLimits(prefix.subarray(0, prefixSize), length)
          : null
      if (budget && this.evict(budget.capacity, rounded(length))) {
        entry = { blocks: [], bytes: 0, length, reserved: rounded(length), complete: false, lastUsed: this.now() }
        this.entries.set(key, entry)
        send({
          type: 'opened',
          length,
          limits: { ...limits, maxManagedBytes: limits.maxManagedBytes - this.reserved - BRIDGE_RESERVE },
          cached: false
        })
      } else {
        // No hidden retained bytes while the decoder receives its original memory allowance.
        this.entries.clear()
        send({ type: 'opened', length, limits, cached: false })
      }
    }
    let pendingInitial: Uint8Array[] = []
    const read = async () => {
      if (entry?.complete) {
        const next = entry.blocks[cacheIndex++]
        if (!next) {
          eof = true
          received = entry.bytes
          send({ type: 'chunk', done: true })
          return
        }
        const remaining = entry.bytes - (cacheIndex - 1) * CACHE_BLOCK
        const copy = next.slice(0, Math.min(CACHE_BLOCK, remaining))
        send({ type: 'chunk', bytes: copy.buffer }, [copy.buffer])
        return
      }
      while (!block || offset === block.length) {
        block = undefined
        offset = 0
        if (pendingInitial.length) block = pendingInitial.shift()!
        else if (!eof) {
          const item = await reader!.read()
          if (stopped) return
          if (item.done) eof = true
          else {
            if (item.value.byteLength > FETCH_BLOCK_LIMIT) {
              fail('memory-limit')
              return
            }
            block = item.value
          }
        }
        if (!block && eof) {
          if (entry && received !== entry.length) remove()
          if (validated) validate()
          send({ type: 'chunk', done: true })
          return
        }
        if (block?.length) break
      }
      const bytes = block!.slice(offset, offset + CACHE_BLOCK)
      offset += bytes.length
      received += bytes.length
      if (received > limits.maxInputBytes) {
        fail('file-limit')
        return
      }
      if (entry && this.entries.get(key) === entry) {
        if (received > entry.length) {
          remove()
          entry = undefined
        } else {
          // Pack even one-byte network deliveries into bounded backing blocks.
          let from = 0
          while (from < bytes.length) {
            const at = entry.bytes % CACHE_BLOCK
            if (!at) entry.blocks.push(new Uint8Array(CACHE_BLOCK))
            const n = Math.min(CACHE_BLOCK - at, bytes.length - from)
            entry.blocks.at(-1)!.set(bytes.subarray(from, from + n), at)
            entry.bytes += n
            from += n
          }
        }
      }
      send({ type: 'chunk', bytes: bytes.buffer }, [bytes.buffer])
    }
    channel.port1.onmessage = ({ data }) => {
      if (stopped) return
      if (data.type === 'cancel') {
        stop()
        return
      }
      if (busy || !['open', 'read'].includes(data.type) || (data.type === 'open') === opened) {
        fail('internal')
        return
      }
      busy = true
      if (data.type === 'open') opened = true
      void (data.type === 'open' ? open() : read())
        .catch(() => {
          if (!stopped) fail('network')
        })
        .finally(() => {
          busy = false
        })
    }
    return { port: channel.port2, release: stop, validate, invalidate: remove }
  }
}
