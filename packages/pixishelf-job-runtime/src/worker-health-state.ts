export interface WorkerHealthSnapshot {
  live: boolean
  ready: boolean
  preflightComplete: boolean
  draining: boolean
  lastError: string | null
}

export class WorkerHealthState {
  private live = true
  private preflightComplete = false
  private draining = false
  private lastError: string | null = null

  snapshot(): WorkerHealthSnapshot {
    return {
      live: this.live,
      ready: this.live && this.preflightComplete && !this.draining && this.lastError === null,
      preflightComplete: this.preflightComplete,
      draining: this.draining,
      lastError: this.lastError
    }
  }

  completePreflight() {
    this.preflightComplete = true
    this.lastError = null
  }

  fail(error: unknown) {
    this.lastError = errorMessage(error)
  }

  recover() {
    this.lastError = null
  }

  beginDrain() {
    this.draining = true
  }

  markStopped() {
    this.live = false
    this.draining = true
  }
}

export function redactSensitiveText(value: string) {
  return value
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:authorization|cookie|database[_-]?url|password|secret|token)["']?\s*[:=]\s*["']?)[^\s,"';}\]]+/gi,
      '$1[REDACTED]'
    )
}

export function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return redactSensitiveText(message).slice(0, 2_048)
}
