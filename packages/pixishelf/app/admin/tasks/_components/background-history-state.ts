import type { JobDto, JobStatus, JobType } from '@pixishelf/job-contracts'
import type { BackgroundHistoryItem } from '@/services/background-task/job-history-service'

export interface HistoryFilters {
  search: string
  statuses: JobStatus[]
  types: JobType[]
  triggerSources: JobDto['triggerSource'][]
  from: string
  to: string
  includeBatchChildren: boolean
}

export function emptyHistoryFilters(): HistoryFilters {
  return { search: '', statuses: [], types: [], triggerSources: [], from: '', to: '', includeBatchChildren: false }
}

export function historyDateBoundary(value: string, exclusiveEnd = false): string | undefined {
  if (!value) return undefined
  const date = new Date(`${value}T00:00:00`)
  if (!Number.isFinite(date.getTime())) return undefined
  if (exclusiveEnd) date.setDate(date.getDate() + 1)
  return date.toISOString()
}

export function historyStatusChanged(item: BackgroundHistoryItem, filters: HistoryFilters) {
  return filters.statuses.length > 0 && !filters.statuses.includes(item.status)
}

export function mergeHistorySnapshot(current: BackgroundHistoryItem, next: BackgroundHistoryItem) {
  return Date.parse(next.updatedAt) > Date.parse(current.updatedAt) ? next : current
}

export function uniqueHistoryItems(pages: { items: BackgroundHistoryItem[] }[]): BackgroundHistoryItem[] {
  const items = new Map<string, BackgroundHistoryItem>()
  for (const page of pages) {
    for (const item of page.items) {
      const previous = items.get(item.id)
      items.set(item.id, previous ? mergeHistorySnapshot(previous, item) : item)
    }
  }
  return [...items.values()]
}
