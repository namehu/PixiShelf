'use client'

import { useState } from 'react'
import { createParser, parseAsBoolean, parseAsStringLiteral, useQueryStates } from 'nuqs'
import { normalizeTaskFilters, type TaskFilters } from './archive-task-filters'

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
  unboundOnly: parseAsBoolean.withDefault(false)
}

export function useArchiveTaskFilters() {
  const [filters, setFilters] = useQueryStates(filterParsers, {
    history: 'push',
    shallow: true,
    scroll: false,
    clearOnDefault: true
  })
  const filterKey = JSON.stringify(filters)
  const [draft, setDraft] = useState<{ filterKey: string; value: TaskFilters }>({ filterKey, value: filters })

  // 外部 URL 导航恢复已应用条件；内部即时筛选会先更新草稿的基准，保留尚未提交的文本。
  if (draft.filterKey !== filterKey) {
    setDraft({ filterKey, value: filters })
  }

  const applyFilters = (value: TaskFilters) => {
    const next = normalizeTaskFilters({ ...filters, ...value })
    setDraft({ filterKey: JSON.stringify(next), value: next })
    void setFilters(next)
  }

  const applyImmediateFilters = (patch: Partial<TaskFilters>) => {
    const next = { ...filters, ...patch }
    setDraft((current) => ({
      filterKey: JSON.stringify(next),
      value: { ...(current.filterKey === filterKey ? current.value : filters), ...patch }
    }))
    void setFilters(patch)
  }

  return {
    filters,
    filterKey,
    draftFilters: draft.filterKey === filterKey ? draft.value : filters,
    setDraftFilters: (value: TaskFilters) => setDraft({ filterKey, value }),
    applyFilters,
    applyImmediateFilters,
    resetFilters: () => applyFilters(EMPTY_FILTERS)
  }
}
