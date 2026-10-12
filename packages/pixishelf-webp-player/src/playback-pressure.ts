/** One continuous preview owns this state; it contains no media or device identifiers. */
export class PlaybackPressure {
  private token: object | null = null
  private position = 0
  private ratio: number | null = null
  private highMs = 0
  private idleAt: number | null = null
  private reduced = false
  private resetNextAttempt = false

  begin(now: number) {
    if (this.resetNextAttempt || (this.idleAt !== null && now - this.idleAt >= 60_000)) this.reset()
    this.token = {}
    this.position = 0
    this.ratio = null
    this.idleAt = null
    return this.token
  }
  observe(token: object, ratio: number, sourceFps: number, samples: number) {
    if (token !== this.token) return
    this.ratio = samples >= 8 && Number.isFinite(ratio) && sourceFps > 45 ? ratio : null
    if (sourceFps <= 45 || (this.ratio !== null && this.ratio < 0.95)) this.highMs = 0
  }
  advance(token: object, position: number) {
    if (token !== this.token || !Number.isFinite(position) || position < this.position) return false
    const elapsed = position - this.position
    this.position = position
    if (this.ratio !== null && this.ratio >= 0.95) this.highMs += elapsed
    if (this.highMs >= 8000) this.reduced = true
    return this.reduced
  }
  inactive(token: object, now: number) {
    if (token === this.token) this.idleAt ??= now
  }
  active(token: object, now: number) {
    if (token !== this.token) return
    if (this.idleAt !== null && now - this.idleAt >= 60_000) this.resetNextAttempt = true
    this.idleAt = null
  }
  reset() {
    this.token = null
    this.position = 0
    this.ratio = null
    this.highMs = 0
    this.idleAt = null
    this.reduced = false
    this.resetNextAttempt = false
  }
}
