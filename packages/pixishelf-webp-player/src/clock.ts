/** A displayed frame owns its duration. Buffering never advances this clock. */
export class FrameClock {
  private remaining = 0
  private last: number | null = null
  private overdue = 0
  start(duration: number, now: number) {
    this.remaining = duration
    this.last = now
  }
  advance(now: number) {
    this.overdue = this.last === null ? 0 : Math.max(0, now - this.last - this.remaining)
    if (this.last !== null) this.remaining = Math.max(0, this.remaining - Math.max(0, now - this.last))
    this.last = now
    return this.remaining
  }
  pause(now: number) {
    if (this.last !== null) this.advance(now)
    this.last = null
  }
  resume(now: number) {
    this.last = now
  }
  reset() {
    this.remaining = 0
    this.last = null
    this.overdue = 0
  }
  get remainingMs() {
    return this.remaining
  }
  get overdueMs() {
    return this.overdue
  }
}
