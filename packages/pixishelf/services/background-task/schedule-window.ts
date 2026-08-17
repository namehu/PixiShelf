export const CENTRAL_SCHEDULE_TIMEZONE = 'Asia/Shanghai'

const WINDOW_START_HOUR = 0
const WINDOW_END_HOUR = 8
const ONE_DAY_MS = 24 * 60 * 60 * 1_000

export interface ShanghaiScheduleWindow {
  scheduledForDate: string
  availableAt: Date
  deadlineAt: Date
  isOpen: boolean
}

export function isShanghaiWeeklyReconciliationDate(scheduledForDate: string) {
  // Date-only UTC parsing is deterministic; weekdays are identical in every timezone for this value.
  return new Date(`${scheduledForDate}T00:00:00.000Z`).getUTCDay() === 1
}

export function getShanghaiScheduleWindow(now: Date): ShanghaiScheduleWindow {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: CENTRAL_SCHEDULE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  })
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]))
  const scheduledForDate = `${parts.year}-${parts.month}-${parts.day}`
  const localHour = Number(parts.hour)

  return {
    scheduledForDate,
    availableAt: new Date(`${scheduledForDate}T00:00:00+08:00`),
    deadlineAt: new Date(`${scheduledForDate}T08:00:00+08:00`),
    isOpen: localHour >= WINDOW_START_HOUR && localHour < WINDOW_END_HOUR
  }
}

export function getCurrentOrNextShanghaiScheduleWindow(now: Date): ShanghaiScheduleWindow {
  const current = getShanghaiScheduleWindow(now)
  return current.isOpen ? current : getShanghaiScheduleWindow(new Date(current.availableAt.getTime() + ONE_DAY_MS))
}
