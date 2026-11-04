import {
  compareReadingVersion,
  getReadingStatus,
  isVideoReadingComplete,
  type ReadingPlayback,
  READING_HEARTBEAT_INTERVAL_MS,
  READING_LAYOUT_VERSION_CONFLICT_CODE,
  READING_REPORT_INTERVAL_MS,
  READING_REPORT_MAX_AGE_MS,
  type ReadingContextDto,
  type ReadingReportEvent,
  type ReadingReportInput,
  type ReadingReportResult,
  type ReadingSummaryDto
} from '@pixishelf/db/reading-contract'

export interface ReadingObservation {
  advanceTo?: { mediaId: number; index: number }
  artworkId: number
  mediaId: number
  ready: boolean
  visible: boolean
  automatic: boolean
  active?: boolean
  /** A covered reader should have a lower priority than its covering reader. */
  priority?: number
  playback?: ReadingPlayback & { playing: boolean }
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
  sendAt: number
}

interface ArtworkQueue {
  revision: number
  events: QueuedEvent[]
  inFlight: QueuedEvent[]
  sending: boolean
  controller: AbortController | null
  retryAt: number
}

export interface ReadingCollectorOptions {
  report: (input: ReadingReportInput, signal: AbortSignal) => Promise<ReadingReportResult>
  onPendingChange?: () => void
  onSummary?: (summary: ReadingSummaryDto, ownerUserId: string, result: ReadingReportResult) => void
  onCompleted?: (summary: ReadingSummaryDto, ownerUserId: string) => void
  onInvalidated?: (artworkId: number, ownerUserId: string) => void
  onError?: (error: unknown, artworkId: number, ownerUserId: string) => void
  onDiscard?: (artworkId: number, ownerUserId: string) => void
  now?: () => number
}

export function isRevisionConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const value = error as { message?: unknown; data?: { code?: unknown }; code?: unknown }
  return (
    value.message === READING_LAYOUT_VERSION_CONFLICT_CODE ||
    (typeof value.message === 'string' && value.message.includes(READING_LAYOUT_VERSION_CONFLICT_CODE)) ||
    value.data?.code === READING_LAYOUT_VERSION_CONFLICT_CODE ||
    value.code === READING_LAYOUT_VERSION_CONFLICT_CODE
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
  private completedNotifications = new Set<string>()
  private presented = new WeakSet<Surface>()
  private accepted = new WeakSet<Surface>()
  private active: ActiveSurface | null = null
  private order = 0
  private generation = 0
  private foreground = true
  private online = true
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
    this.completedNotifications.clear()
    this.ownerUserId = userId
  }

  setContext(context: ReadingContextDto, expectedUserId: string) {
    if (!this.ownerUserId || this.ownerUserId !== expectedUserId || this.invalidated.has(context.artworkId)) return
    const prior = this.contexts.get(context.artworkId)
    if (prior && prior.readingLayoutVersion !== context.readingLayoutVersion) {
      this.invalidateArtwork(context.artworkId)
      return
    }
    if (prior && compareReadingVersion(context.summary, prior.summary) < 0) return
    this.contexts.set(context.artworkId, context)
    this.reconcileActive()
  }

  /** Project pending observations without assigning a server stateVersion. */
  projectContext(context: ReadingContextDto): ReadingContextDto {
    const queue = this.queues.get(context.artworkId)
    if (!queue || queue.revision !== context.readingLayoutVersion) return context
    const events = [...queue.inFlight, ...queue.events].filter((item) => this.now() - item.createdAt < READING_REPORT_MAX_AGE_MS)
    if (!events.length) return context
    let summary = { ...context.summary }
    for (const { event } of events) {
      if (event.type !== 'VIEW') continue
      const item = context.media[event.index]
      if (!item || item.mediaId !== event.mediaId || (item.isVideo && !event.playback)) continue
      const advances = !item.isVideo || Boolean(event.playback && isVideoReadingComplete(event.playback))
      const target = event.advanceTo ?? { mediaId: event.mediaId, index: event.index }
      const furthest = advances && target.index > (summary.furthestMediaIndex ?? -1)
      const completed = summary.completed || (advances && target.index === summary.totalCount - 1)
      summary = { ...summary, viewCount: Math.max(1, summary.viewCount), completed,
        progressCount: completed ? summary.totalCount : Math.max(summary.progressCount, advances ? target.index + 1 : 0),
        ...(furthest ? { furthestMediaId: target.mediaId, furthestMediaIndex: target.index } : {}),
        lastMediaId: item.mediaId, lastMediaIndex: item.index,
        lastViewedAt: event.observedAt, lastActiveAt: event.observedAt }
    }
    summary.status = getReadingStatus(summary)
    return { ...context, summary, resume: summary.lastMediaId === null || summary.lastMediaIndex === null ? context.resume :
      { mediaId: summary.lastMediaId, index: summary.lastMediaIndex } }
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

  /** Repeated observations with unchanged facts do not create another view. */
  observe(surfaceId: string, observation: ReadingObservation) {
    const prior = this.surfaces.get(surfaceId)
    const same = prior &&
      prior.artworkId === observation.artworkId &&
      prior.mediaId === observation.mediaId &&
      prior.advanceTo?.mediaId === observation.advanceTo?.mediaId &&
      prior.advanceTo?.index === observation.advanceTo?.index &&
      prior.ready === observation.ready &&
      prior.visible === observation.visible &&
      prior.automatic === observation.automatic &&
      prior.active === observation.active &&
      prior.priority === observation.priority
    if (same) {
      const completed = observation.playback && isVideoReadingComplete(observation.playback)
      const newlyCompleted = completed && (!prior.playback || !isVideoReadingComplete(prior.playback))
      const newlyStarted = observation.playback && !prior.playback
      prior.playback = observation.playback
      if (newlyCompleted || newlyStarted) {
        this.presented.delete(prior)
        this.reconcileActive()
      }
      return
    }
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
    void this.flush(artworkId)
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
      void this.flush()
    }
    this.reconcileActive()
    if (wasAvailable && !foreground) void this.flush()
  }

  getInvalidated(artworkId: number) {
    return this.invalidated.has(artworkId)
  }

  /** Best-effort; in-memory events are intentionally not persisted offline. */
  async flush(onlyArtworkId?: number) {
    // Explicit exit/background flushes include events queued behind an in-flight request.
    for (const [artworkId, queue] of this.queues) {
      if (onlyArtworkId !== undefined && artworkId !== onlyArtworkId) continue
      for (const entry of queue.events) entry.sendAt = this.now()
      queue.retryAt = 0
    }
    await this.sendDue(onlyArtworkId)
  }

  private async sendDue(onlyArtworkId?: number) {
    this.cancelReportTimer()
    if (!this.ownerUserId || !this.online) return
    const owner = this.ownerUserId
    const epoch = this.epoch
    const tasks: Promise<void>[] = []
    for (const [artworkId, queue] of this.queues) {
      if (onlyArtworkId !== undefined && artworkId !== onlyArtworkId) continue
      const unexpired = queue.events.filter((entry) => this.now() - entry.createdAt < READING_REPORT_MAX_AGE_MS)
      if (unexpired.length !== queue.events.length) {
        this.notifyDiscard(queue.events.filter((entry) => !unexpired.includes(entry)), artworkId, owner)
        queue.events = unexpired
        this.options.onPendingChange?.()
        this.options.onError?.(new Error('阅读进度未保存，请重新查看相关媒体。'), artworkId, owner)
      }
      if (queue.sending || queue.events.length === 0 || this.invalidated.has(artworkId) || queue.retryAt > this.now()) continue
      const firstFuture = queue.events.findIndex((entry) => entry.sendAt > this.now())
      const count = Math.min(100, firstFuture < 0 ? queue.events.length : firstFuture)
      if (!count) continue
      const events = queue.events.splice(0, count)
      queue.inFlight = events
      queue.sending = true
      const controller = new AbortController()
      queue.controller = controller
      tasks.push(this.sendBatch({ artworkId, queue, events, owner, epoch, controller }))
    }
    this.scheduleReport()
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
    let succeeded = false
    const oldestCreatedAt = Math.min(...events.map((entry) => entry.createdAt))
    const expiryTimer = setTimeout(
      () => controller.abort(),
      Math.max(0, READING_REPORT_MAX_AGE_MS - (this.now() - oldestCreatedAt))
    )
    try {
      const result = await this.options.report({
        artworkId,
        readingLayoutVersion: queue.revision,
        expectedUserId: owner,
        events: events.map(({ event }) => event)
      }, controller.signal)
      if (epoch !== this.epoch || owner !== this.ownerUserId || this.queues.get(artworkId) !== queue) return
      if (result.readingLayoutVersion !== queue.revision) {
        this.invalidateArtwork(artworkId)
        return
      }
      succeeded = true
      const context = this.contexts.get(artworkId)
      const current = !context || compareReadingVersion(result.summary, context.summary) >= 0
      if (context && current) this.contexts.set(artworkId, { ...context, summary: result.summary })
      if (current) this.options.onSummary?.(result.summary, owner, result)
      for (const surface of this.surfaces.values()) {
        if (surface.artworkId === artworkId && events.some(({ event }) =>
          event.type === 'VIEW' && Boolean(context?.media[event.index]?.memberMediaIds.includes(surface.mediaId)))) this.accepted.add(surface)
      }
      if (this.active?.artworkId === artworkId && events.some(({ event }) =>
        event.type === 'VIEW' && Boolean(context?.media[event.index]?.memberMediaIds.includes(this.active!.mediaId))
      )) {
        this.active.viewAccepted = true
        this.scheduleHeartbeat(this.active.generation)
      }
    } catch (error) {
      if (epoch !== this.epoch || owner !== this.ownerUserId || this.queues.get(artworkId) !== queue) return
      if (isRevisionConflict(error)) {
        this.invalidateArtwork(artworkId)
        return
      }
      const code = (error as { data?: { code?: string } })?.data?.code
      let retry: QueuedEvent[] = []
      if (!['BAD_REQUEST', 'FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND'].includes(code ?? '')) {
        retry = events.filter((entry) => this.now() - entry.createdAt < READING_REPORT_MAX_AGE_MS)
        queue.events.unshift(...retry)
      }
      this.notifyDiscard(events.filter((entry) => !retry.includes(entry)), artworkId, owner)
      queue.retryAt = this.now() + READING_REPORT_INTERVAL_MS
      this.options.onError?.(error, artworkId, owner)
    } finally {
      clearTimeout(expiryTimer)
      if (this.queues.get(artworkId) === queue) {
        queue.inFlight = []
        queue.sending = false
        queue.controller = null
      }
      if (epoch === this.epoch && owner === this.ownerUserId) {
        this.options.onPendingChange?.()
        if (succeeded && this.queues.get(artworkId) === queue && queue.events.length) await this.sendDue(artworkId)
        else this.scheduleReport()
      }
    }
  }

  invalidateArtwork(artworkId: number) {
    const queue = this.queues.get(artworkId)
    if (queue && this.ownerUserId) this.notifyDiscard([...queue.inFlight, ...queue.events], artworkId, this.ownerUserId)
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
    // A viewport can contain several media. Record every uncovered item, even when
    // the reading context arrives after their intersection observations.
    for (const candidate of this.surfaces.values()) {
      const eligible = surface && candidate.ready && candidate.visible && candidate.active !== false &&
        this.contexts.has(candidate.artworkId) && !this.invalidated.has(candidate.artworkId) &&
        (candidate.priority ?? 0) === (surface.priority ?? 0)
      if (!eligible) {
        this.presented.delete(candidate)
      } else if (!this.presented.has(candidate)) {
        const context = this.contexts.get(candidate.artworkId)!
        const item = context.media.find((entry) => entry.memberMediaIds.includes(candidate.mediaId))
        if (!item || (item.isVideo && !candidate.playback)) continue
        this.presented.add(candidate)
        this.enqueue(candidate.artworkId, {
          type: 'VIEW', mediaId: item.mediaId, index: item.index, observedAt: new Date(this.now()).toISOString(),
          ...(candidate.advanceTo && !item.isVideo ? { advanceTo: candidate.advanceTo } : {}),
          ...(candidate.playback ? { playback: this.playbackEvidence(candidate.playback) } : {})
        })
      }
    }
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
      viewAccepted: this.accepted.has(surface),
      nextHeartbeatAt: this.now() + READING_HEARTBEAT_INTERVAL_MS,
      generation
    }
    if (this.active.viewAccepted) this.scheduleHeartbeat(generation)
  }

  private scheduleHeartbeat(generation: number) {
    if (this.heartbeatTimer || !this.active || this.active.generation !== generation) return
    const delay = Math.max(0, (this.active.nextHeartbeatAt ?? this.now() + READING_HEARTBEAT_INTERVAL_MS) - this.now())
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null
      if (!this.active || this.active.generation !== generation || !this.active.viewAccepted) return
      const playback = this.surfaces.get(this.active.surfaceId)?.playback
      if (!playback || playback.playing) {
        const item = this.contexts.get(this.active.artworkId)?.media.find((entry) => entry.memberMediaIds.includes(this.active!.mediaId))
        if (item) {
          this.enqueue(this.active.artworkId, {
            type: 'HEARTBEAT', mediaId: item.mediaId, index: item.index, observedAt: new Date(this.now()).toISOString(),
            ...(playback ? { playback: this.playbackEvidence(playback) } : {})
          })
        }
      }
      this.active.nextHeartbeatAt = this.now() + READING_HEARTBEAT_INTERVAL_MS
      this.scheduleHeartbeat(generation)
    }, delay)
  }

  private enqueue(artworkId: number, event: ReadingReportEvent) {
    const context = this.contexts.get(artworkId)
    if (!context || !this.ownerUserId || this.invalidated.has(artworkId)) return
    let queue = this.queues.get(artworkId)
    if (!queue) {
      queue = { revision: context.readingLayoutVersion, events: [], inFlight: [], sending: false, controller: null, retryAt: 0 }
      this.queues.set(artworkId, queue)
    }
    if (queue.revision !== context.readingLayoutVersion) {
      this.invalidateArtwork(artworkId)
      return
    }
    const now = this.now()
    const pendingWindow = queue.events.at(-1)?.sendAt
    queue.events.push({ event, createdAt: now,
      sendAt: pendingWindow !== undefined && pendingWindow > now ? pendingWindow : now + READING_REPORT_INTERVAL_MS })
    if (event.type === 'VIEW') this.notifyLocalCompletion(context)
    this.options.onPendingChange?.()
    this.scheduleReport()
  }

  private playbackEvidence(playback: ReadingPlayback): ReadingPlayback {
    return { currentTime: playback.currentTime, duration: playback.duration }
  }

  private notifyLocalCompletion(context: ReadingContextDto) {
    const key = `${context.artworkId}:${context.readingLayoutVersion}`
    if (!this.ownerUserId || context.summary.status === 'COMPLETED' || context.summary.totalCount === 0 ||
      this.completedNotifications.has(key)) return
    const summary = this.projectContext(context).summary
    if (summary.status !== 'COMPLETED') return
    // Keep this marker through rollback/retry and navigation; a server acknowledgement never toasts.
    this.completedNotifications.add(key)
    this.options.onCompleted?.(summary, this.ownerUserId)
  }

  private scheduleReport() {
    this.cancelReportTimer()
    if (!this.ownerUserId || !this.online) return
    const deadlines = [...this.queues.values()].flatMap((queue) =>
      !queue.sending && queue.events[0] ? [Math.max(queue.events[0].sendAt, queue.retryAt)] : [])
    if (!deadlines.length) return
    this.reportTimer = setTimeout(() => {
      this.reportTimer = null
      void this.sendDue()
    }, Math.max(0, Math.min(...deadlines) - this.now()))
  }

  private notifyDiscard(events: QueuedEvent[], artworkId: number, owner: string) {
    if (events.some(({ event }) => event.type === 'VIEW')) this.options.onDiscard?.(artworkId, owner)
  }

  private cancelObservation() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.active = null
  }

  private cancelReportTimer() {
    if (this.reportTimer) clearTimeout(this.reportTimer)
    this.reportTimer = null
  }
}
