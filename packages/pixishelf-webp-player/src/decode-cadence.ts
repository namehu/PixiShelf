import type { EncodedFrame } from './independent-frame'

const interval = 1000 / 30
const rounding = 0.5
/** Admission/compositing remain the caller's responsibility. This only chooses independent frames. */
export class DecodeCadence {
  private durations: number[] = []
  private mean = 0
  private samples = 0
  private enabled = false
  private cycle = -1
  private slot = 0
  private due = 0
  private lastEnd = 0
  private aligned = false
  get sourceFps() {
    return this.durations.length ? (1000 * this.durations.length) / this.durations.reduce((a, b) => a + b, 0) : 0
  }
  enable() {
    this.enabled = true
  }
  observeFrame(durationMs: number) {
    this.durations.push(durationMs)
    if (this.durations.length > 32) this.durations.shift()
  }
  observeDecode(ms: number) {
    this.mean = this.samples ? this.mean * 0.9 + ms * 0.1 : ms
    this.samples++
    return { ratio: (this.sourceFps * this.mean) / 2000, sourceFps: this.sourceFps, samples: this.samples }
  }
  private align(frame: EncodedFrame) {
    if (this.cycle !== frame.cycleId) {
      this.cycle = frame.cycleId
      this.lastEnd = frame.cycleStartMs
      this.aligned = false
    }
    if (!this.aligned && this.enabled && this.sourceFps > 45) {
      this.slot = Math.max(0, Math.ceil((this.lastEnd - frame.cycleStartMs - rounding) / interval))
      this.due = frame.cycleStartMs + this.slot * interval
      this.aligned = true
    }
    return this.aligned
  }
  skip(frame: EncodedFrame, next?: EncodedFrame) {
    return (
      this.align(frame) && frame.index !== 0 && next?.cycleId === frame.cycleId && next.startMs <= this.due + rounding
    )
  }
  needsSuccessor(frame: EncodedFrame, last: boolean) {
    return this.align(frame) && frame.index !== 0 && !last && frame.endMs <= this.due + rounding
  }
  dispatched(frame: EncodedFrame, last: boolean) {
    if (this.align(frame)) {
      // Keep source timestamps for progress/EOF. The display deadline absorbs RIFF millisecond rounding.
      frame.presentationMs = frame.index === 0 || last ? frame.startMs : Math.max(frame.startMs, this.due + rounding)
      this.slot = Math.max(this.slot + 1, Math.floor((frame.startMs - frame.cycleStartMs + rounding) / interval) + 1)
      this.due = frame.cycleStartMs + this.slot * interval
    }
    this.lastEnd = frame.endMs
  }
}
