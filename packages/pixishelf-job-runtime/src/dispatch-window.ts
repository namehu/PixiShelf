import type { JobTriggerSource } from '@pixishelf/job-contracts'

export const DEFAULT_DISPATCH_TIME_ZONE = 'Asia/Shanghai'
export const MANUAL_PRIORITY_MIN = 0
export const MANUAL_PRIORITY_MAX = 99
export const SCHEDULED_PRIORITY_MIN = 100
export const SCHEDULED_PRIORITY_MAX = 999

export interface DispatchWindowOptions {
  timeZone?: string
  startHour?: number
  endHour?: number
}

export interface LocalDispatchTime {
  date: string
  hour: number
  minute: number
  second: number
}

export interface DispatchCandidate {
  triggerSource: JobTriggerSource
  effectivePriority: number
  deadlineAt?: Date | null
}

export class DispatchWindowPolicy {
  readonly timeZone: string
  readonly startHour: number
  readonly endHour: number

  private readonly formatter: Intl.DateTimeFormat

  constructor(options: DispatchWindowOptions = {}) {
    this.timeZone = options.timeZone ?? DEFAULT_DISPATCH_TIME_ZONE
    this.startHour = options.startHour ?? 0
    this.endHour = options.endHour ?? 8

    if (
      !Number.isInteger(this.startHour) ||
      !Number.isInteger(this.endHour) ||
      this.startHour < 0 ||
      this.endHour > 24 ||
      this.startHour >= this.endHour
    ) {
      throw new Error('Dispatch window must be a same-day range with integer hours')
    }

    this.formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
  }

  localTime(now: Date): LocalDispatchTime {
    const parts = Object.fromEntries(
      this.formatter
        .formatToParts(now)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    )

    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second)
    }
  }

  isAutomaticWindowOpen(now: Date): boolean {
    const { hour } = this.localTime(now)
    return hour >= this.startHour && hour < this.endHour
  }

  canClaim(candidate: DispatchCandidate, now: Date): boolean {
    if (
      (candidate.triggerSource === 'MANUAL' || (candidate.triggerSource === 'RETRY' && candidate.deadlineAt == null)) &&
      candidate.effectivePriority >= MANUAL_PRIORITY_MIN &&
      candidate.effectivePriority <= MANUAL_PRIORITY_MAX
    ) {
      return true
    }

    if (
      candidate.triggerSource === 'SYSTEM' &&
      candidate.deadlineAt == null &&
      candidate.effectivePriority >= SCHEDULED_PRIORITY_MIN &&
      candidate.effectivePriority <= SCHEDULED_PRIORITY_MAX
    ) {
      return true
    }

    return (
      candidate.triggerSource !== 'LEGACY' &&
      candidate.effectivePriority >= SCHEDULED_PRIORITY_MIN &&
      candidate.effectivePriority <= SCHEDULED_PRIORITY_MAX &&
      this.isAutomaticWindowOpen(now)
    )
  }
}
