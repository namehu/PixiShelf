'use client'

import { JOB_STATUS_VALUES, JOB_TYPE_VALUES } from '@pixishelf/job-contracts'
import { useEffect, useRef, useState } from 'react'
import { Filter, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { backgroundJobLabel, backgroundTriggerLabels } from '@/lib/background-job-labels'
import { formatBackgroundJobStatus } from './background-task-format'
import { emptyHistoryFilters, type HistoryFilters } from './background-history-state'

function MultiFilter<Value extends string>({
  label,
  values,
  options,
  onChange
}: {
  label: string
  values: Value[]
  options: { value: Value; label: string }[]
  onChange: (values: Value[]) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          {label}
          {values.length ? ` · ${values.length}` : ''}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 overflow-y-auto">
        <FieldSet>
          <FieldLegend>{label}</FieldLegend>
          <FieldGroup className="gap-3">
            {options.map((option) => (
              <Field key={option.value} orientation="horizontal">
                <Checkbox
                  id={`history-${option.value}`}
                  checked={values.includes(option.value)}
                  onCheckedChange={(checked) =>
                    onChange(checked ? [...values, option.value] : values.filter((value) => value !== option.value))
                  }
                />
                <FieldLabel htmlFor={`history-${option.value}`}>{option.label}</FieldLabel>
              </Field>
            ))}
          </FieldGroup>
        </FieldSet>
      </PopoverContent>
    </Popover>
  )
}

export function BackgroundHistoryFilters({
  filters,
  onChange,
  dateInvalid
}: {
  filters: HistoryFilters
  onChange: (filters: HistoryFilters) => void
  dateInvalid: boolean
}) {
  const [draft, setDraft] = useState(filters.search)
  const [composing, setComposing] = useState(false)
  const composingRef = useRef(false)
  const changeRef = useRef(onChange)
  const filtersRef = useRef(filters)
  changeRef.current = onChange
  filtersRef.current = filters
  useEffect(() => setDraft(filters.search), [filters.search])
  useEffect(() => {
    if (composing || draft.trim() === filtersRef.current.search) return
    const timer = setTimeout(() => changeRef.current({ ...filtersRef.current, search: draft.trim() }), 300)
    return () => clearTimeout(timer)
  }, [draft, composing])
  const extraCount =
    filters.triggerSources.length + Number(Boolean(filters.from || filters.to)) + Number(filters.includeBatchChildren)
  const activeCount = filters.statuses.length + filters.types.length + extraCount + Number(Boolean(filters.search))

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!composingRef.current && draft.trim() !== filters.search) onChange({ ...filters, search: draft.trim() })
      }}
      className="flex flex-col gap-3"
    >
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="history-search">搜索执行记录</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="history-search"
              value={draft}
              maxLength={500}
              autoComplete="off"
              placeholder="任务 ID、类型名称、消息或错误…"
              onChange={(event) => setDraft(event.target.value)}
              onCompositionStart={() => {
                composingRef.current = true
                setComposing(true)
              }}
              onCompositionEnd={(event) => {
                composingRef.current = false
                setComposing(false)
                setDraft(event.currentTarget.value)
              }}
            />
            <Button type="submit" size="icon" variant="outline" aria-label="搜索执行记录">
              <Search aria-hidden="true" />
            </Button>
          </div>
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-2">
        <MultiFilter
          label="状态"
          values={filters.statuses}
          options={JOB_STATUS_VALUES.map((value) => ({ value, label: formatBackgroundJobStatus(value) }))}
          onChange={(statuses) => onChange({ ...filters, statuses })}
        />
        <MultiFilter
          label="任务类型"
          values={filters.types}
          options={JOB_TYPE_VALUES.map((value) => ({ value, label: backgroundJobLabel(value) }))}
          onChange={(types) => onChange({ ...filters, types })}
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline">
              <Filter data-icon="inline-start" aria-hidden="true" />
              更多筛选{extraCount ? ` · ${extraCount}` : ''}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-[70dvh] overflow-y-auto">
            <FieldGroup>
              <MultiFilter
                label="触发来源"
                values={filters.triggerSources}
                options={Object.entries(backgroundTriggerLabels).map(([value, label]) => ({
                  value: value as HistoryFilters['triggerSources'][number],
                  label
                }))}
                onChange={(triggerSources) => onChange({ ...filters, triggerSources })}
              />
              <Field data-invalid={dateInvalid}>
                <FieldLabel htmlFor="history-from">创建日期 · 起</FieldLabel>
                <Input
                  id="history-from"
                  type="date"
                  value={filters.from}
                  aria-invalid={dateInvalid}
                  onChange={(event) => onChange({ ...filters, from: event.target.value })}
                />
              </Field>
              <Field data-invalid={dateInvalid}>
                <FieldLabel htmlFor="history-to">创建日期 · 止（含当天）</FieldLabel>
                <Input
                  id="history-to"
                  type="date"
                  value={filters.to}
                  aria-invalid={dateInvalid}
                  onChange={(event) => onChange({ ...filters, to: event.target.value })}
                />
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="history-children"
                  checked={filters.includeBatchChildren}
                  onCheckedChange={(checked) => onChange({ ...filters, includeBatchChildren: checked === true })}
                />
                <FieldLabel htmlFor="history-children">包含批次子任务</FieldLabel>
              </Field>
            </FieldGroup>
          </PopoverContent>
        </Popover>
        {activeCount > 0 || draft ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft('')
              onChange(emptyHistoryFilters())
            }}
          >
            <X data-icon="inline-start" aria-hidden="true" />
            清除筛选{activeCount ? ` · ${activeCount}` : ''}
          </Button>
        ) : null}
      </div>
      {dateInvalid ? (
        <p role="alert" className="text-sm text-destructive">
          开始日期不能晚于结束日期。
        </p>
      ) : null}
    </form>
  )
}
