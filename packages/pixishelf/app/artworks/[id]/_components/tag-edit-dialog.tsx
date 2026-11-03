'use client'

import { useState } from 'react'
import { useDebounce } from 'ahooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import type { TArtworkTagDto } from '@/schemas/artwork.dto'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { getTranslateName } from '@/utils/tags'

interface TagEditDialogProps {
  artworkId: number
  tags: TArtworkTagDto[]
  onCancel: () => void
  onSaved: (tags: TArtworkTagDto[]) => void
}

export function TagEditDialog({ artworkId, tags, onCancel, onSaved }: TagEditDialogProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(tags)
  const [newNames, setNewNames] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const name = query.trim()
  const debouncedName = useDebounce(name, { wait: 250 })
  const search = useQuery(
    trpc.tag.list.queryOptions({ query: debouncedName, pageSize: 30 }, { enabled: !!debouncedName })
  )
  const results: TArtworkTagDto[] = name === debouncedName ? (search.data?.items ?? []) : []
  const searching = name !== debouncedName || search.isFetching
  const available = results.filter((tag) => !draft.some((item) => item.id === tag.id))
  const canCreate =
    !!name &&
    !searching &&
    search.isSuccess &&
    !results.some((tag) => tag.name === name) &&
    !draft.some((tag) => tag.name === name) &&
    !newNames.includes(name)
  const addTagIds = draft.filter((tag) => !tags.some((item) => item.id === tag.id)).map((tag) => tag.id)
  const removeTagIds = tags.filter((tag) => !draft.some((item) => item.id === tag.id)).map((tag) => tag.id)
  const changed = !!(addTagIds.length || removeTagIds.length || newNames.length)

  const save = useMutation(
    trpc.artwork.updateTags.mutationOptions({
      onSuccess: (saved) => {
        onSaved(saved)
        toast.success('标签已保存')
        // Mark related screens stale without refetching the active reader/media query.
        void queryClient.invalidateQueries({ queryKey: trpc.artwork.pathKey(), refetchType: 'none' })
        void queryClient.invalidateQueries({ queryKey: ['artwork'], refetchType: 'none' })
        void queryClient.invalidateQueries({ queryKey: trpc.tag.pathKey(), refetchType: 'none' })
      }
    })
  )
  const saveError =
    save.error &&
    (['BAD_REQUEST', 'CONFLICT', 'NOT_FOUND'].includes(save.error.data?.code ?? '')
      ? save.error.message
      : '保存失败，请重试。')

  return (
    <DialogContent
      fitViewport
      showCloseButton={false}
      className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden"
      onEscapeKeyDown={(event) => {
        if (save.isPending) event.preventDefault()
      }}
      onInteractOutside={(event) => {
        if (save.isPending) event.preventDefault()
      }}
    >
      <DialogHeader className="shrink-0">
        <DialogTitle>编辑标签</DialogTitle>
        <DialogDescription>添加或移除本作品的标签，保存后生效。</DialogDescription>
      </DialogHeader>

      <div className="min-h-0 overflow-y-auto overscroll-contain">
        <FieldGroup>
          <Field>
            <FieldLabel asChild>
              <span id="artwork-tag-draft-label">作品标签 · {draft.length + newNames.length}</span>
            </FieldLabel>
            {draft.length + newNames.length === 0 ? (
              <FieldDescription>暂无标签，搜索已有标签或创建新标签。</FieldDescription>
            ) : (
              <div className="flex flex-wrap gap-2" role="group" aria-labelledby="artwork-tag-draft-label">
                {draft.map((tag) => (
                  <Badge variant="secondary" key={tag.id} className="max-w-full gap-0 rounded-xl py-0 pl-3 pr-0">
                    <PrivacySensitiveText className="min-w-0 break-all whitespace-normal">
                      #{tag.name}
                    </PrivacySensitiveText>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 rounded-full"
                      aria-label={`移除标签 ${tag.name}`}
                      disabled={save.isPending}
                      onClick={() => setDraft((items) => items.filter((item) => item.id !== tag.id))}
                    >
                      <XIcon />
                    </Button>
                  </Badge>
                ))}
                {newNames.map((newName) => (
                  <Badge variant="outline" key={newName} className="max-w-full gap-2 rounded-xl py-0 pl-3 pr-0">
                    <PrivacySensitiveText className="min-w-0 break-all whitespace-normal">
                      #{newName}
                    </PrivacySensitiveText>
                    <span>待创建</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 rounded-full"
                      aria-label={`移除待创建标签 ${newName}`}
                      disabled={save.isPending}
                      onClick={() => setNewNames((items) => items.filter((item) => item !== newName))}
                    >
                      <XIcon />
                    </Button>
                  </Badge>
                ))}
              </div>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="artwork-tag-search">搜索或创建标签</FieldLabel>
            <Command shouldFilter={false} className="h-auto border [&_[data-slot=command-input-wrapper]]:h-11">
              <CommandInput
                id="artwork-tag-search"
                value={query}
                onValueChange={setQuery}
                placeholder="输入标签名称或译名"
                disabled={save.isPending}
                className="min-h-11"
              />
              <CommandList className="max-h-52" aria-label="标签搜索结果" aria-busy={searching}>
                {!name ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">输入名称搜索已有标签。</p>
                ) : searching ? (
                  <p role="status" className="px-3 py-4 text-sm text-muted-foreground">
                    正在搜索…
                  </p>
                ) : search.isError ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="text-sm text-muted-foreground">搜索失败，请重试。</span>
                    <Button variant="ghost" className="min-h-11" onClick={() => void search.refetch()}>
                      重试
                    </Button>
                  </div>
                ) : (
                  <>
                    {available.length > 0 && (
                      <CommandGroup heading="已有标签">
                        {available.map((tag) => (
                          <CommandItem
                            key={tag.id}
                            value={`tag-${tag.id}`}
                            className="min-h-11"
                            disabled={save.isPending}
                            onSelect={() => {
                              setDraft((items) => [...items, tag])
                              setNewNames((items) => items.filter((item) => item !== tag.name))
                              setQuery('')
                            }}
                          >
                            <PlusIcon />
                            <PrivacySensitiveText className="min-w-0 break-all">#{tag.name}</PrivacySensitiveText>
                            {getTranslateName(tag) && (
                              <PrivacySensitiveText className="ml-auto min-w-0 truncate text-muted-foreground">
                                {getTranslateName(tag)}
                              </PrivacySensitiveText>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {canCreate && (
                      <CommandGroup heading="新标签">
                        <CommandItem
                          value="create-new-tag"
                          className="min-h-11"
                          disabled={save.isPending}
                          onSelect={() => {
                            setNewNames((items) => [...items, name])
                            setQuery('')
                          }}
                        >
                          <PlusIcon />
                          <span>创建并加入</span>
                          <PrivacySensitiveText className="min-w-0 break-all">「{name}」</PrivacySensitiveText>
                        </CommandItem>
                      </CommandGroup>
                    )}
                    {!available.length && !canCreate && (
                      <p className="px-3 py-4 text-sm text-muted-foreground">匹配的标签已加入草稿。</p>
                    )}
                  </>
                )}
              </CommandList>
            </Command>
            <FieldDescription>新标签只需名称，将在保存时创建。</FieldDescription>
          </Field>
          <FieldDescription>扫描、来源同步或媒体更新后，自动标签可能重新出现。</FieldDescription>
        </FieldGroup>
      </div>

      {save.isError && <FieldError>{saveError} 草稿已保留，可重试或取消。</FieldError>}
      <DialogFooter className="shrink-0">
        <Button variant="outline" className="min-h-11" disabled={save.isPending} onClick={onCancel}>
          取消
        </Button>
        <Button
          className="min-h-11"
          disabled={!changed || save.isPending}
          onClick={() => save.mutate({ artworkId, addTagIds, removeTagIds, newTagNames: newNames })}
        >
          {save.isPending && <Spinner data-icon="inline-start" />}
          {save.isPending ? '保存中…' : '保存'}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
