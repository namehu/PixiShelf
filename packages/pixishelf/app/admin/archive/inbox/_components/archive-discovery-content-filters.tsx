'use client'

import { useId, useState } from 'react'
import { SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react'
import { useMediaQuery } from '@/hooks/use-media-query'
import { DISCOVERY_CATEGORIES, DISCOVERY_LANGUAGES, DISCOVERY_UNKNOWN } from '@/lib/archive-discovery-filters'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerTrigger
} from '@/components/ui/drawer'
import { DEFAULT_DISCOVERY_FILTERS, type DiscoveryFilterDraft } from './archive-discovery-filter-state'

export function ArchiveDiscoveryContentFilters({
  value,
  onChange
}: {
  value: DiscoveryFilterDraft
  onChange: (value: DiscoveryFilterDraft) => void
}) {
  const desktop = useMediaQuery('(min-width: 768px)')
  const id = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [search, setSearch] = useState(value.search)
  const changeOpen = (next: boolean) => {
    if (next) setDraft(value)
    setOpen(next)
  }
  const toggle = (key: 'categories' | 'languages', item: string, checked: boolean) =>
    setDraft((current) => ({
      ...current,
      [key]: checked ? [...current[key], item] : current[key].filter((entry) => entry !== item)
    }))
  const invalidDate = Boolean(!draft.unknownDate && draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo)
  const chips: Array<{ key: string; label: string; remove: () => void }> = [
    ...(value.search
      ? [
          {
            key: 'search',
            label: `标题：${value.search}`,
            remove: () => {
              setSearch('')
              onChange({ ...value, search: '' })
            }
          }
        ]
      : []),
    ...value.categories.map((item) => ({
      key: `category:${item}`,
      label: item === DISCOVERY_UNKNOWN ? '分类未知' : item,
      remove: () => onChange({ ...value, categories: value.categories.filter((entry) => entry !== item) })
    })),
    ...value.languages.map((item) => ({
      key: `language:${item}`,
      label: item === DISCOVERY_UNKNOWN ? '语言未知' : (DISCOVERY_LANGUAGES[item] ?? item),
      remove: () => onChange({ ...value, languages: value.languages.filter((entry) => entry !== item) })
    })),
    ...(value.unknownDate
      ? [{ key: 'unknown-date', label: '发布时间未知', remove: () => onChange({ ...value, unknownDate: false }) }]
      : []),
    ...(value.dateFrom || value.dateTo
      ? [
          {
            key: 'date',
            label: `${value.dateFrom || '不限'} 至 ${value.dateTo || '不限'}`,
            remove: () => onChange({ ...value, dateFrom: '', dateTo: '' })
          }
        ]
      : []),
    ...(value.unboundOnly
      ? [{ key: 'unbound', label: '仅看未绑定', remove: () => onChange({ ...value, unboundOnly: false }) }]
      : [])
  ]
  const form = (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (!invalidDate) {
          onChange(draft)
          setOpen(false)
        }
      }}
    >
      <FieldGroup className="max-h-[50dvh] gap-5 overflow-y-auto p-1">
        <FieldSet className="gap-2">
          <FieldLegend variant="label">分类</FieldLegend>
          <div className="grid grid-cols-2 gap-3">
            {[...DISCOVERY_CATEGORIES, DISCOVERY_UNKNOWN].map((item) => (
              <Field key={item} orientation="horizontal">
                <Checkbox
                  id={`${id}-category-${item}`}
                  checked={draft.categories.includes(item)}
                  onCheckedChange={(checked) => toggle('categories', item, checked === true)}
                />
                <FieldLabel htmlFor={`${id}-category-${item}`}>
                  {item === DISCOVERY_UNKNOWN ? '分类未知' : item}
                </FieldLabel>
              </Field>
            ))}
          </div>
        </FieldSet>
        <FieldSet className="gap-2">
          <FieldLegend variant="label">语言</FieldLegend>
          <div className="grid max-h-40 grid-cols-2 gap-3 overflow-y-auto">
            {[...Object.entries(DISCOVERY_LANGUAGES), [DISCOVERY_UNKNOWN, '语言未知']].map(([item, label]) => (
              <Field key={item} orientation="horizontal">
                <Checkbox
                  id={`${id}-language-${item}`}
                  checked={draft.languages.includes(item!)}
                  onCheckedChange={(checked) => toggle('languages', item!, checked === true)}
                />
                <FieldLabel htmlFor={`${id}-language-${item}`}>{label}</FieldLabel>
              </Field>
            ))}
          </div>
        </FieldSet>
        <FieldSet className="gap-3">
          <FieldLegend variant="label">发布时间</FieldLegend>
          <Field orientation="horizontal">
            <Checkbox
              id={`${id}-unknown-date`}
              checked={draft.unknownDate}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, unknownDate: checked === true, dateFrom: '', dateTo: '' })
              }
            />
            <FieldLabel htmlFor={`${id}-unknown-date`}>发布时间未知</FieldLabel>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field data-invalid={invalidDate || undefined}>
              <FieldLabel htmlFor={`${id}-from`}>开始日期</FieldLabel>
              <Input
                id={`${id}-from`}
                type="date"
                disabled={draft.unknownDate}
                value={draft.dateFrom}
                max={draft.dateTo || undefined}
                aria-invalid={invalidDate}
                onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })}
              />
            </Field>
            <Field data-invalid={invalidDate || undefined}>
              <FieldLabel htmlFor={`${id}-to`}>结束日期</FieldLabel>
              <Input
                id={`${id}-to`}
                type="date"
                disabled={draft.unknownDate}
                value={draft.dateTo}
                min={draft.dateFrom || undefined}
                aria-invalid={invalidDate}
                onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })}
              />
            </Field>
          </div>
          {invalidDate ? (
            <p role="alert" className="text-sm text-destructive">
              开始日期不能晚于结束日期
            </p>
          ) : null}
        </FieldSet>
        <Field orientation="horizontal">
          <Checkbox
            id={`${id}-unbound`}
            checked={draft.unboundOnly}
            onCheckedChange={(checked) => setDraft({ ...draft, unboundOnly: checked === true })}
          />
          <FieldLabel htmlFor={`${id}-unbound`}>仅看未绑定</FieldLabel>
        </Field>
      </FieldGroup>
      <div className="flex shrink-0 justify-between gap-2 pt-4 pb-[env(safe-area-inset-bottom)]">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setDraft({ ...DEFAULT_DISCOVERY_FILTERS, search: value.search })}
        >
          重置条件
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button type="submit" disabled={invalidDate}>
            应用筛选
          </Button>
        </div>
      </div>
    </form>
  )
  const trigger = (
    <Button variant="outline">
      <SlidersHorizontalIcon data-icon="inline-start" aria-hidden="true" />
      筛选{chips.length ? `（${chips.length}）` : ''}
    </Button>
  )
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-0 flex-1 gap-2 sm:max-w-lg"
          onSubmit={(event) => {
            event.preventDefault()
            onChange({ ...value, search: search.trim() })
          }}
        >
          <Input
            type="search"
            aria-label="搜索内容标题"
            placeholder="搜索标题"
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button type="submit" variant="outline" size="icon" aria-label="搜索内容">
            <SearchIcon aria-hidden="true" />
          </Button>
        </form>
        {desktop ? (
          <Popover open={open} onOpenChange={changeOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent align="end" className="w-[min(28rem,calc(100vw-2rem))]" aria-label="内容筛选">
              {form}
            </PopoverContent>
          </Popover>
        ) : (
          <Drawer autoFocus open={open} onOpenChange={changeOpen}>
            <DrawerTrigger asChild>{trigger}</DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>内容筛选</DrawerTitle>
                <DrawerDescription>选择条件后点击应用。</DrawerDescription>
              </DrawerHeader>
              <div className="min-h-0 px-4 pb-4">{form}</div>
            </DrawerContent>
          </Drawer>
        )}
      </div>
      {chips.length ? (
        <div className="flex flex-wrap gap-2" aria-label="已应用筛选">
          {chips.map((chip) => (
            <Button key={chip.key} variant="secondary" size="sm" onClick={chip.remove} aria-label={`移除${chip.label}`}>
              <PrivacySensitiveText className="max-w-48 truncate">{chip.label}</PrivacySensitiveText>
              <XIcon data-icon="inline-end" aria-hidden="true" />
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('')
              onChange(DEFAULT_DISCOVERY_FILTERS)
            }}
          >
            清空筛选
          </Button>
        </div>
      ) : null}
    </div>
  )
}
