'use client'

import { useState } from 'react'
import { createParser, parseAsBoolean, parseAsJson, parseAsStringLiteral, useQueryStates } from 'nuqs'
import { z } from 'zod'
import { normalizeTaskFilters, type TaskFilters } from './archive-task-filters'
import type { ArchiveTaskCursorState } from './archive-task-view-state'

const EMPTY_FILTERS: TaskFilters = {
  status: 'ALL',
  providerKey: '',
  kind: 'ALL',
  submissionId: '',
  search: '',
  unboundOnly: false
}

function parseFilterText(maxLength: number) {
  return createParser({
    parse: (value) => {
      const text = value.trim()
      return text.length <= maxLength ? text : null
    },
    serialize: (value: string) => value
  }).withDefault('')
}

const filterParsers = {
  status: parseAsStringLiteral([
    'ALL',
    'PENDING',
    'RUNNING',
    'PAUSED',
    'CANCELLING',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
  ]).withDefault('ALL'),
  providerKey: parseFilterText(50),
  kind: parseAsStringLiteral(['ALL', 'NEW', 'UPDATE']).withDefault('ALL'),
  submissionId: parseFilterText(128),
  search: parseFilterText(500),
  unboundOnly: parseAsBoolean.withDefault(false),
  cursors: parseAsJson(z.array(z.string().min(1).max(512))).withDefault([])
}

export function useArchiveTaskFilters() {
  const [{ cursors, ...filters }, setQuery] = useQueryStates(filterParsers, {
    history: 'push',
    shallow: true,
    scroll: false,
    clearOnDefault: true
  })
  const filterKey = JSON.stringify(filters)
  const browseKey = JSON.stringify([filters, cursors])
  // The first page has no cursor; keep the remaining page boundaries in the URL
  // so a copied link can also navigate to the previous page.
  const cursorState: ArchiveTaskCursorState = {
    cursor: cursors.at(-1),
    previousCursors: cursors.length ? [undefined, ...cursors.slice(0, -1)] : []
  }
  const [draft, setDraft] = useState<{ filterKey: string; value: TaskFilters }>({ filterKey, value: filters })

  // 外部 URL 导航恢复已应用条件；内部即时筛选会先更新草稿的基准，保留尚未提交的文本。
  if (draft.filterKey !== filterKey) {
    setDraft({ filterKey, value: filters })
  }

  const applyFilters = (value: TaskFilters) => {
    const next = normalizeTaskFilters({ ...filters, ...value })
    setDraft({ filterKey: JSON.stringify(next), value: next })
    void setQuery({ ...next, cursors: null })
  }

  const applyImmediateFilters = (patch: Partial<TaskFilters>) => {
    const next = { ...filters, ...patch }
    setDraft((current) => ({
      filterKey: JSON.stringify(next),
      value: { ...(current.filterKey === filterKey ? current.value : filters), ...patch }
    }))
    void setQuery({ ...patch, cursors: null })
  }

  return {
    filters,
    browseKey,
    cursorState,
    setCursorState: (update: (current: ArchiveTaskCursorState) => ArchiveTaskCursorState) => {
      const next = update(cursorState)
      void setQuery({
        cursors: next.cursor
          ? [...next.previousCursors.filter((cursor): cursor is string => cursor !== undefined), next.cursor]
          : null
      })
    },
    draftFilters: draft.filterKey === filterKey ? draft.value : filters,
    setDraftFilters: (value: TaskFilters) => setDraft({ filterKey, value }),
    applyFilters,
    applyImmediateFilters,
    resetFilters: () => applyFilters(EMPTY_FILTERS)
  }
}
