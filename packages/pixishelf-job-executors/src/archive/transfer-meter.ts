import type { ArchiveTransferTelemetry } from '@pixishelf/job-contracts'

const SPEED_WINDOW_MS = 5_000

interface SpeedSample {
  at: number
  transferredBytes: bigint
}

export class ArchiveTransferMeter {
  private readonly activeBytes = new Map<string, bigint>()
  private readonly samples: SpeedSample[] = []
  private completedBytes: bigint
  private transferredBytes = 0n
  private completedItems: number
  private failedItems: number

  constructor(
    private readonly archiveImportId: string,
    private readonly concurrencyLimit: number,
    private readonly totalItems: number,
    initial: { completedBytes: bigint; completedItems: number; failedItems: number }
  ) {
    this.completedBytes = initial.completedBytes
    this.completedItems = initial.completedItems
    this.failedItems = initial.failedItems
  }

  begin(itemId: string): void {
    this.activeBytes.set(itemId, 0n)
  }

  addChunk(itemId: string, byteLength: number): void {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new Error('Chunk byte length must be non-negative')
    const current = this.activeBytes.get(itemId)
    if (current === undefined) return
    const bytes = BigInt(byteLength)
    this.activeBytes.set(itemId, current + bytes)
    this.transferredBytes += bytes
  }

  complete(itemId: string, byteCount: bigint): void {
    this.activeBytes.delete(itemId)
    this.completedBytes += byteCount
    this.completedItems += 1
  }

  fail(itemId: string, terminal: boolean): void {
    this.activeBytes.delete(itemId)
    if (terminal) this.failedItems += 1
  }

  sample(now: Date): ArchiveTransferTelemetry {
    const timestamp = now.getTime()
    this.samples.push({ at: timestamp, transferredBytes: this.transferredBytes })
    while (this.samples.length > 1 && this.samples[0]!.at < timestamp - SPEED_WINDOW_MS) this.samples.shift()
    const oldest = this.samples[0]
    const elapsedMs = oldest ? timestamp - oldest.at : 0
    const transferred = oldest ? this.transferredBytes - oldest.transferredBytes : 0n
    const bytesPerSecond = elapsedMs > 0 ? Number((transferred * 1_000n) / BigInt(elapsedMs)) : 0
    const activeBytes = [...this.activeBytes.values()].reduce((sum, value) => sum + value, 0n)

    return {
      version: 1,
      kind: 'archive.transfer',
      archiveImportId: this.archiveImportId,
      downloadedBytes: (this.completedBytes + activeBytes).toString(),
      bytesPerSecond: Math.max(0, bytesPerSecond),
      activeDownloads: this.activeBytes.size,
      concurrencyLimit: this.concurrencyLimit,
      completedItems: this.completedItems,
      failedItems: this.failedItems,
      totalItems: this.totalItems,
      sampledAt: now.toISOString()
    }
  }
}

export interface ArchiveTransferReporter {
  stop(): Promise<void>
}

export function startArchiveTransferReporter(input: {
  meter: ArchiveTransferMeter
  controller: AbortController
  report: (telemetry: ArchiveTransferTelemetry) => Promise<void>
  flush?: (telemetry: ArchiveTransferTelemetry) => Promise<void>
  now: () => Date
  intervalMs?: number
}): ArchiveTransferReporter {
  const stopController = new AbortController()
  let failure: unknown
  let lastSignature: string | null = null
  const intervalMs = input.intervalMs ?? 1_000
  input.meter.sample(input.now())

  const loop = (async () => {
    while (!stopController.signal.aborted) {
      try {
        await abortableDelay(intervalMs, stopController.signal)
      } catch (error) {
        if (stopController.signal.aborted) return
        throw error
      }
      const telemetry = input.meter.sample(input.now())
      const signature = telemetrySignature(telemetry)
      if (signature === lastSignature) continue
      lastSignature = signature
      await input.report(telemetry)
    }
  })().catch((error) => {
    failure = error
    if (!input.controller.signal.aborted) input.controller.abort(error)
  })

  return {
    async stop() {
      stopController.abort()
      await loop
      if (failure) throw failure
      const telemetry = input.meter.sample(input.now())
      if (input.flush) {
        try {
          await input.flush(telemetry)
        } catch (error) {
          if (!input.controller.signal.aborted) input.controller.abort(error)
          throw error
        }
      }
    }
  }
}

function telemetrySignature(telemetry: ArchiveTransferTelemetry): string {
  return [
    telemetry.downloadedBytes,
    telemetry.activeDownloads === 0 ? 0 : telemetry.bytesPerSecond,
    telemetry.activeDownloads,
    telemetry.completedItems,
    telemetry.failedItems
  ].join(':')
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    timer.unref()
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
