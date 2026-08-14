export interface HeartbeatScheduler {
  schedule(callback: () => void, delayMs: number): unknown
  cancel(handle: unknown): void
}

const defaultScheduler: HeartbeatScheduler = {
  schedule(callback, delayMs) {
    return setTimeout(callback, delayMs)
  },
  cancel(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
}

export interface HeartbeatLoopOptions {
  intervalMs: number
  beat: () => Promise<void>
  signal?: AbortSignal
  scheduler?: HeartbeatScheduler
  onError?: (error: unknown) => void | Promise<void>
  onRecovered?: () => void | Promise<void>
}

export interface HeartbeatLoop {
  stop(): Promise<void>
}

export function startHeartbeatLoop(options: HeartbeatLoopOptions): HeartbeatLoop {
  if (!Number.isInteger(options.intervalMs) || options.intervalMs < 1) {
    throw new Error('Heartbeat interval must be a positive integer')
  }

  const scheduler = options.scheduler ?? defaultScheduler
  let timer: unknown
  let stopped = false
  let unhealthy = false
  let inFlight: Promise<void> | null = null
  let stopPromise: Promise<void> | null = null

  const schedule = () => {
    if (stopped || options.signal?.aborted) return
    timer = scheduler.schedule(tick, options.intervalMs)
  }

  const runBeat = async () => {
    if (stopped || options.signal?.aborted) return
    try {
      await options.beat()
      if (unhealthy && !stopped && !options.signal?.aborted) {
        unhealthy = false
        await options.onRecovered?.()
      }
    } catch (error) {
      if (stopped || options.signal?.aborted) return
      unhealthy = true
      await options.onError?.(error)
    } finally {
      schedule()
    }
  }

  const tick = () => {
    if (stopped || options.signal?.aborted) return
    const current = Promise.resolve().then(runBeat)
    inFlight = current
    void current
      .finally(() => {
        if (inFlight === current) inFlight = null
      })
      .catch(() => undefined)
  }

  const stop = () => {
    if (!stopPromise) {
      stopped = true
      if (timer !== undefined) scheduler.cancel(timer)
      stopPromise = inFlight?.catch(() => undefined) ?? Promise.resolve()
    }
    return stopPromise
  }

  options.signal?.addEventListener('abort', () => void stop(), { once: true })
  schedule()
  return { stop }
}
