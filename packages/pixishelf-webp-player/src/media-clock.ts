/** Decoder throughput cannot slow this clock. Only the known input horizon can. */
export class MediaClock {
  position = 0
  started = false
  private at: number | null = null
  start(now: number) {
    this.started = true
    this.at = now
  }
  tick(now: number, horizon: number) {
    this.position = this.peek(now, horizon)
    if (this.at !== null) this.at = now
    return this.position
  }
  peek(now: number, horizon: number) {
    return (
      this.position +
      (this.at === null ? 0 : Math.min(Math.max(0, now - this.at), Math.max(0, horizon - this.position)))
    )
  }
  pause(now: number, horizon: number) {
    this.tick(now, horizon)
    this.at = null
  }
  resume(now: number) {
    if (this.started) this.at = now
  }
  reset() {
    this.position = 0
    this.started = false
    this.at = null
  }
}
