import {
  READING_HEARTBEAT_INTERVAL_MS,
  READING_MANUAL_VISIBLE_MS,
  READING_MEDIA_REVISION_CONFLICT_CODE,
  READING_REPORT_INTERVAL_MS,
  READING_REPORT_MAX_AGE_MS,
  type ReadingContextDto,
  type ReadingReportEvent,
  type ReadingReportInput,
  type ReadingReportResult,
  type ReadingSummaryDto
} from '@pixishelf/db/reading-contract'

export interface ReadingObservation {
  artworkId: number
  mediaId: number
  ready: boolean
  visible: boolean
  automatic: boolean
  active?: boolean
  /** A covered reader should have a lower priority than its covering reader. */
  priority?: number
}

interface Surface extends ReadingObservation {
  order: number
}

interface ActiveSurface {
  surfaceId: string
  artworkId: number
  mediaId: number
  automatic: boolean
  viewAccepted: boolean
  nextHeartbeatAt: number | null
  generation: number
}

interface QueuedEvent {
  event: ReadingReportEvent
  createdAt: number
}

interface ArtworkQueue {
  revision: number
  events: QueuedEvent[]
  sending: boolean
  controller: AbortController | null
}

export interface ReadingCollectorOptions {
  report: (input: ReadingReportInput, signal: AbortSignal) => Promise<ReadingReportResult>
  onSummary?: (summary: ReadingSummaryDto, ownerUserId: string) => void
  onInvalidated?: (artworkId: number, ownerUserId: string) => void
  onError?: (error: unknown, artworkId: number, ownerUserId: string) => void
  now?: () => number
}

function isRevisionConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const value = error as { message?: unknown; data?: { code?: unknown }; code?: unknown }
  return (
    value.message === READING_MEDIA_REVISION_CONFLICT_CODE ||
    (typeof value.message === 'string' && value.message.includes(READING_MEDIA_REVISION_CONFLICT_CODE)) ||
    value.data?.code === READING_MEDIA_REVISION_CONFLICT_CODE ||
    value.code === READING_MEDIA_REVISION_CONFLICT_CODE
  )
}

/** One in-memory collector coordinates every local reader on the page. */
export class ReadingCollector {
  private readonly options: ReadingCollectorOptions
  private readonly now: () => number
  private ownerUserId: string | null = null
  private epoch = 0
  private contexts = new Map<number, ReadingContextDto>()
  private surfaces = new Map<string, Surface>()
  private queues = new Map<number, ArtworkQueue>()
  private invalidated = new Set<number>()
  private active: ActiveSurface | null = null
  private order = 0
  private generation = 0
  private foreground = true
  private online = true
  private manualTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private reportTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: ReadingCollectorOptions) {
    this.options = options
    this.now = options.now ?? Date.now
  }

  setAccount(userId: string | null) {
    if (this.ownerUserId === userId) return
    this.epoch++
    this.cancelObservation()
    this.cancelReportTimer()
    for (const queue of this.queues.values()) queue.controller?.abort()
    this.contexts.clear()
    this.surfaces.clear()
    this.queues.clear()
    this.invalidated.clear()
    this.ownerUserId = userId
  }

  setContext(context: ReadingContextDto, expectedUserId: string) {
    if (!this.ownerUserId || this.ownerUserId !== expectedUserId || this.invalidated.has(context.artworkId)) return
    const prior = this.contexts.get(context.artworkId)
    if (prior && prior.mediaRevision !== context.mediaRevision) {
      this.dropArtwork(context.artworkId)
      return
    }
    this.contexts.set(context.artworkId, context)
    this.reconcileActive()
  }

  /** Only a fresh context fetch following explicit reopen may leave a revision conflict. */
  resetArtwork(artworkId: number, context: ReadingContextDto, expectedUserId: string) {
    if (this.ownerUserId !== expectedUserId || context.artworkId !== artworkId) return
    this.invalidated.delete(artworkId)
    this.contexts.set(artworkId, context)
    for (const [id, surface] of this.surfaces) {
      if (surface.artworkId === artworkId) this.surfaces.delete(id)
    }
    this.reconcileActive()
  }

  /** Repeated observations with unchanged facts preserve the dwell timer. */
  observe(surfaceId: string, observation: ReadingObservation) {
    const prior = this.surfaces.get(surfaceId)
    const same = prior &&
      prior.artworkId === observation.artworkId &&
      prior.mediaId === observation.mediaId &&
      prior.ready === observation.ready &&
      prior.visible === observation.visible &&
      prior.automatic === observation.automatic &&
      prior.active === observation.active &&
      prior.priority === observation.priority
    if (same) return
    this.surfaces.set(surfaceId, { ...observation, order: ++this.order })
    this.reconcileActive()
  }

  clearSurface(surfaceId: string) {
    if (!this.surfaces.delete(surfaceId)) return
    this.reconcileActive()
  }

  clearArtwork(artworkId: number) {
    for (const [id, surface] of this.surfaces) {
      if (surface.artworkId === artworkId) this.surfaces.delete(id)
    }
    this.reconcileActive()
    void this.flush()
  }

  setAvailability(foreground: boolean, online: boolean) {
    if (this.foreground === foreground && this.online === online) return
    const wasAvailable = this.foreground && this.online
    this.foreground = foreground
    this.online = online
    if (wasAvailable && (!foreground || !online)) {
      // A mounted reader's last visible flag is not fresh evidence after a tab/network transition.
      this.surfaces.clear()
    }
    if (!wasAvailable && foreground && online) {
      // Resume requires the reader adapter to submit a new observation.
      for (const queue of this.queues.values()) queue.controller?.abort()
      this.queues.clear()
    }
    this.reconcileActive()
    if (wasAvailable && !foreground) void this.flush()
  }

  getInvalidated(artworkId: number) {
    return this.invalidated.has(artworkId)
  }

  /** Best-effort; in-memory events are intentionally not persisted offline. */
  async flush() {
    this.cancelReportTimer()
    if (!this.ownerUserId || !this.online) return
    const owner = this.ownerUserId
    const epoch = this.epoch
    const tasks: Promise<void>[] = []
    for (const [artworkId, queue] of this.queues) {
      queue.events = queue.events.filter((entry) => this.now() - entry.createdAt < READING_REPORT_MAX_AGE_MS)
      if (queue.sending || queue.events.length === 0 || this.invalidated.has(artworkId)) continue
      const events = queue.events.splice(0)
      queue.sending = true
      const controller = new AbortController()
      queue.controller = controller
      tasks.push(this.sendBatch({ artworkId, queue, events, owner, epoch, controller }))
    }
    await Promise.all(tasks)
  }

  dispose() {
    this.setAccount(null)
  }

  private async sendBatch(args: {
    artworkId: number
    queue: ArtworkQueue
    events: QueuedEvent[]
    owner: string
    epoch: number
    controller: AbortController
  }) {
    const { artworkId, queue, events, owner, epoch, controller } = args
    const oldestCreatedAt = Math.min(...events.map((entry) => entry.createdAt))
    const expiryTimer = setTimeout(
      () => controller.abort(),
      Math.max(0, READING_REPORT_MAX_AGE_MS - (this.now() - oldestCreatedAt))
    )
    try {
      const result = await this.options.report({
        artworkId,
        mediaRevision: queue.revision,
        expectedUserId: owner,
        events: events.map(({ event }) => event)
      }, controller.signal)
      if (epoch !== this.epoch || owner !== this.ownerUserId || this.queues.get(artworkId) !== queue) return
      if (result.mediaRevision !== queue.revision) {
        this.dropArtwork(artworkId)
        return
      }
      const context = this.contexts.get(artworkId)
      if (context) this.contexts.set(artworkId, { ...context, summary: result.summary })
      this.options.onSummary?.(result.summary, owner)
      if (this.active?.artworkId === artworkId && events.some(({ event }) =>
        event.type === 'VIEW' && event.mediaId === this.active?.mediaId
      )) {
        this.active.viewAccepted = true
        this.scheduleHeartbeat(this.active.generation)
      }
    } catch (error) {
      if (epoch !== this.epoch || owner !== this.ownerUserId || this.queues.get(artworkId) !== queue) return
      if (isRevisionConflict(error)) {
        this.dropArtwork(artworkId)
        return
      }
      queue.events.unshift(...events.filter((entry) => this.now() - entry.createdAt < READING_REPORT_MAX_AGE_MS))
      this.options.onError?.(error, artworkId, owner)
    } finally {
      clearTimeout(expiryTimer)
      if (this.queues.get(artworkId) === queue) {
        queue.sending = false
        queue.controller = null
      }
      if (epoch === this.epoch && owner === this.ownerUserId) this.scheduleReport()
    }
  }

  private dropArtwork(artworkId: number) {
    const queue = this.queues.get(artworkId)
    queue?.controller?.abort()
    this.queues.delete(artworkId)
    this.contexts.delete(artworkId)
    this.invalidated.add(artworkId)
    for (const [id, surface] of this.surfaces) {
      if (surface.artworkId === artworkId) this.surfaces.delete(id)
    }
    this.reconcileActive()
    if (this.ownerUserId) this.options.onInvalidated?.(artworkId, this.ownerUserId)
  }

  private reconcileActive() {
    let selected: [string, Surface] | null = null
    if (this.ownerUserId && this.foreground && this.online) {
      for (const candidate of this.surfaces) {
        const surface = candidate[1]
        if (!surface.ready || !surface.visible || surface.active === false ||
          !this.contexts.has(surface.artworkId) || this.invalidated.has(surface.artworkId)) continue
        if (!selected || (surface.priority ?? 0) > (selected[1].priority ?? 0) ||
          ((surface.priority ?? 0) === (selected[1].priority ?? 0) && surface.order > selected[1].order)) {
          selected = candidate
        }
      }
    }
    const [surfaceId, surface] = selected ?? []
    const active = this.active
    if (surface && active && active.surfaceId === surfaceId &&
      active.artworkId === surface.artworkId && active.mediaId === surface.mediaId &&
      active.automatic === surface.automatic) return
    this.cancelObservation()
    if (!surface || !surfaceId) return
    const generation = ++this.generation
    this.active = {
      surfaceId,
      artworkId: surface.artworkId,
      mediaId: surface.mediaId,
      automatic: surface.automatic,
      viewAccepted: false,
      nextHeartbeatAt: null,
      generation
    }
    if (surface.automatic) this.recordView(generation)
    else this.manualTimer = setTimeout(() => this.recordView(generation), READING_MANUAL_VISIBLE_MS)
  }

  private recordView(generation: number) {
    if (!this.active || this.active.generation !== generation) return
    this.manualTimer = null
    this.active.nextHeartbeatAt = this.now() + READING_HEARTBEAT_INTERVAL_MS
    this.enqueue(this.active.artworkId, {
      type: 'VIEW', mediaId: this.active.mediaId, observedAt: new Date(this.now()).toISOString()
    })
  }

  private scheduleHeartbeat(generation: number) {
    if (this.heartbeatTimer || !this.active || this.active.generation !== generation) return
    const delay = Math.max(0, (this.active.nextHeartbeatAt ?? this.now() + READING_HEARTBEAT_INTERVAL_MS) - this.now())
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null
      if (!this.active || this.active.generation !== generation || !this.active.viewAccepted) return
      this.enqueue(this.active.artworkId, {
        type: 'HEARTBEAT', mediaId: this.active.mediaId, observedAt: new Date(this.now()).toISOString()
      })
      this.active.nextHeartbeatAt = this.now() + READING_HEARTBEAT_INTERVAL_MS
      this.scheduleHeartbeat(generation)
    }, delay)
  }

  private enqueue(artworkId: number, event: ReadingReportEvent) {
    const context = this.contexts.get(artworkId)
    if (!context || !this.ownerUserId || this.invalidated.has(artworkId)) return
    let queue = this.queues.get(artworkId)
    if (!queue) {
      queue = { revision: context.mediaRevision, events: [], sending: false, controller: null }
      this.queues.set(artworkId, queue)
    }
    if (queue.revision !== context.mediaRevision) {
      this.dropArtwork(artworkId)
      return
    }
    queue.events.push({ event, createdAt: this.now() })
    this.scheduleReport()
  }

  private scheduleReport() {
    if (this.reportTimer || !this.ownerUserId || !this.online ||
      ![...this.queues.values()].some((queue) => queue.events.length > 0 && !queue.sending)) return
    this.reportTimer = setTimeout(() => {
      this.reportTimer = null
      void this.flush()
    }, READING_REPORT_INTERVAL_MS)
  }

  private cancelObservation() {
    if (this.manualTimer) clearTimeout(this.manualTimer)
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.manualTimer = null
    this.heartbeatTimer = null
    this.active = null
  }

  private cancelReportTimer() {
    if (this.reportTimer) clearTimeout(this.reportTimer)
    this.reportTimer = null
  }
}
