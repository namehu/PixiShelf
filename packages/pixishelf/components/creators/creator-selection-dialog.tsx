'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Plus, X } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Button } from '@/components/ui/button'
import { Command, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import type { CreatorOption } from './creator-picker'

export function CreatorSelectionDialog({
  value,
  onChange,
  onCreate,
  disabled,
  maxSelected
}: {
  value: CreatorOption[]
  onChange: (value: CreatorOption[]) => void
  onCreate: () => void
  disabled: boolean
  maxSelected: number
}) {
  const trpc = useTRPC()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])
  const candidates = useQuery(
    trpc.artist.queryPage.queryOptions({ search: debouncedSearch, pageSize: 30 }, { enabled: open && !disabled })
  )
  const searching = search.trim() !== debouncedSearch || candidates.isPending || candidates.isFetching
  const selectedIds = new Set(value.map(({ id }) => id))
  const atLimit = value.length >= maxSelected

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="已绑定艺术家">
          {value.map((creator) => (
            <li
              key={creator.id}
              className="flex min-w-0 max-w-full items-center gap-1 rounded-md bg-muted pl-3 text-sm"
            >
              <PrivacySensitiveText className="min-w-0 truncate">{creator.name}</PrivacySensitiveText>
              <span className="shrink-0 text-xs text-muted-foreground">#{creator.id}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0"
                disabled={disabled}
                aria-label={`移除绑定 ${creator.name}`}
                onClick={() => onChange(value.filter(({ id }) => id !== creator.id))}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setSearch('')
            setDebouncedSearch('')
          }
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" variant="outline" className="h-11 self-start" disabled={disabled}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            添加绑定艺术家
          </Button>
        </DialogTrigger>
        <DialogContent
          fitViewport={open}
          className="flex h-[min(34rem,calc(100dvh-2rem))] min-h-0 flex-col gap-0 overflow-hidden p-0 [&>[data-slot=dialog-close]]:top-2 [&>[data-slot=dialog-close]]:right-2 [&>[data-slot=dialog-close]]:flex [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:items-center [&>[data-slot=dialog-close]]:justify-center"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            inputRef.current?.focus()
          }}
        >
          <DialogHeader className="shrink-0 px-5 pt-5 pb-4 pr-14 text-left">
            <DialogTitle>选择艺术家／社团</DialogTitle>
            <DialogDescription>可选多位，点击名称选择或取消选择。</DialogDescription>
          </DialogHeader>
          <Command
            label="搜索并选择艺术家或社团"
            shouldFilter={false}
            className="min-h-0 flex-1 rounded-none [&_[data-slot=command-input-wrapper]]:h-12"
          >
            <CommandInput
              ref={inputRef}
              value={search}
              onValueChange={setSearch}
              placeholder="搜索艺术家或社团名称"
              aria-label="搜索并选择艺术家或社团"
              className="h-11 text-base"
            />
            <CommandList
              className="min-h-0 flex-1 overscroll-contain p-2 [&]:max-h-none"
              label="艺术家搜索结果"
              aria-multiselectable="true"
            >
              {searching ? (
                <div
                  role="status"
                  className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
                >
                  <Spinner />
                  搜索中…
                </div>
              ) : candidates.isError ? (
                <div role="alert" className="flex flex-col items-center gap-3 py-8 text-sm">
                  <p>艺术家加载失败</p>
                  <Button type="button" variant="outline" onClick={() => void candidates.refetch()}>
                    重新加载
                  </Button>
                </div>
              ) : candidates.data?.data.length ? (
                candidates.data.data.map((artist) => {
                  const selected = selectedIds.has(artist.id)
                  return (
                    <CommandItem
                      key={artist.id}
                      value={String(artist.id)}
                      disabled={disabled || (!selected && atLimit)}
                      aria-selected={selected}
                      className="min-h-11 gap-3 px-3 py-3"
                      onMouseDown={(event) => event.preventDefault()}
                      onSelect={() =>
                        onChange(
                          selected
                            ? value.filter(({ id }) => id !== artist.id)
                            : [...value, { id: artist.id, name: artist.name, kind: artist.kind }]
                        )
                      }
                    >
                      <Check className={selected ? 'text-primary' : 'invisible'} aria-hidden="true" />
                      <PrivacySensitiveText className="min-w-0 flex-1 truncate">{artist.name}</PrivacySensitiveText>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {artist.kind === 'GROUP' ? '社团 · ' : ''}#{artist.id}
                      </span>
                      {selected && <span className="sr-only">已选择</span>}
                    </CommandItem>
                  )
                })
              ) : (
                <p role="status" className="py-8 text-center text-sm text-muted-foreground">
                  没有匹配的艺术家，可新建后绑定。
                </p>
              )}
            </CommandList>
          </Command>
          <DialogFooter className="shrink-0 flex-col gap-3 border-t px-5 py-4 sm:flex-col sm:items-stretch">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              已选 {value.length} 位{atLimit ? `，已达 ${maxSelected} 位上限` : ''}
            </p>
            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                aria-label="新建艺术家／社团"
                disabled={disabled || atLimit}
                onClick={onCreate}
              >
                <Plus data-icon="inline-start" aria-hidden="true" />
                新建
              </Button>
              <Button
                type="button"
                className="h-11"
                onClick={() => {
                  setOpen(false)
                  setSearch('')
                  setDebouncedSearch('')
                }}
              >
                完成选择
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
