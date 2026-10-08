import { DecoderError } from './wasm-decoder'
/** Retains compressed chunks only while the independently decoded path can need replay. */
export class ReplayInput {
  readonly chunks: Uint8Array[] = []
  received = 0
  position = 0
  done = false
  private chunk = 0
  private offset = 0
  constructor(
    readonly reader: ReadableStreamDefaultReader<Uint8Array>,
    private limit: number,
    private notify: (bytes: number, done: boolean) => void,
    private measure?: (metric: 'readWait' | 'append', ms: number) => void,
    private waiting?: (waiting: boolean) => void
  ) {}
  private blockLimit = Infinity
  restrict(limit: number, blockLimit: number) {
    this.limit = limit
    this.blockLimit = blockLimit
    if (this.received > limit) throw new DecoderError('invalid')
  }
  async readMore() {
    if (this.done) return
    let item: ReadableStreamReadResult<Uint8Array>
    const begun = this.measure ? performance.now() : 0
    this.waiting?.(true)
    try {
      item = await this.reader.read()
    } catch {
      throw new DecoderError('network')
    } finally {
      this.measure?.('readWait', performance.now() - begun)
      this.waiting?.(false)
    }
    const appendAt = this.measure ? performance.now() : 0
    if (item.done) this.done = true
    else {
      if (item.value.byteLength > this.blockLimit) throw new DecoderError('memory-limit')
      this.received += item.value.byteLength
      if (this.received > this.limit) throw new DecoderError('file-limit')
      // Fixed backing blocks bound object count even for one-byte network chunks.
      let offset = 0
      while (offset < item.value.length) {
        let last = this.chunks.at(-1)
        if (!last || last.byteLength === 65536) {
          last = new Uint8Array(new ArrayBuffer(65536), 0, 0)
          this.chunks.push(last)
        }
        const n = Math.min(65536 - last.length, item.value.length - offset)
        const extended = new Uint8Array(last.buffer, 0, last.length + n)
        extended.set(item.value.subarray(offset, offset + n), last.length)
        if (this.chunk === this.chunks.length) {
          this.chunk--
          this.offset = last.length
        }
        this.chunks[this.chunks.length - 1] = extended
        offset += n
      }
    }
    this.measure?.('append', performance.now() - appendAt)
    this.notify(this.received, this.done)
  }
  async take(size: number): Promise<Uint8Array | null> {
    const out = new Uint8Array(size)
    let filled = 0
    while (filled < size) {
      if (this.chunk >= this.chunks.length) {
        await this.readMore()
        if (this.chunk >= this.chunks.length && this.done) return null
        continue
      }
      const bytes = this.chunks[this.chunk]!
      const n = Math.min(size - filled, bytes.length - this.offset)
      out.set(bytes.subarray(this.offset, this.offset + n), filled)
      this.offset += n
      filled += n
      this.position += n
      if (this.offset === bytes.length) {
        this.chunk++
        this.offset = 0
      }
    }
    return out
  }
  /** Advance without allocating a chunk-sized temporary; retained replay input stays budgeted. */
  async skip(size: number): Promise<boolean> {
    let remaining = size,
      batch = 0
    while (remaining > 0) {
      if (this.chunk >= this.chunks.length) {
        await this.readMore()
        if (this.chunk >= this.chunks.length && this.done) return false
        continue
      }
      const bytes = this.chunks[this.chunk]!
      const n = Math.min(remaining, bytes.length - this.offset)
      this.offset += n
      this.position += n
      remaining -= n
      batch += n
      if (this.offset === bytes.length) {
        this.chunk++
        this.offset = 0
      }
      if (batch >= 1024 * 1024) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        batch = 0
      }
    }
    return true
  }
  async eof() {
    while (!this.done && this.received === this.position) await this.readMore()
    if (this.received !== this.position) throw new DecoderError('invalid')
  }
  rewind() {
    this.position = 0
    this.chunk = 0
    this.offset = 0
  }
}
