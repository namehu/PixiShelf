export type WorkerShutdownSignal = 'SIGINT' | 'SIGTERM'

export interface SignalSource {
  once(signal: WorkerShutdownSignal, listener: () => void): unknown
  removeListener(signal: WorkerShutdownSignal, listener: () => void): unknown
}

export function registerShutdownSignals(source: SignalSource, shutdown: (signal: WorkerShutdownSignal) => void) {
  const listeners = new Map<WorkerShutdownSignal, () => void>()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const listener = () => shutdown(signal)
    listeners.set(signal, listener)
    source.once(signal, listener)
  }
  return () => {
    for (const [signal, listener] of listeners) source.removeListener(signal, listener)
  }
}
