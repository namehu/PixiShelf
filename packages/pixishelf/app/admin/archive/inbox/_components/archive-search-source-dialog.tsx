'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ARCHIVE_TITLE_MATCH_LABELS, archiveTitleQuerySchema, type ArchiveTitleQuery } from '@pixishelf/job-contracts'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Spinner } from '@/components/ui/spinner'
import { archiveClientErrorMessage } from '@/app/admin/archive/_components/archive-client-error'

export interface ArchiveSearchDialogState {
  mode: 'CREATE' | 'COPY' | 'RENAME'
  source?: { id: string; displayName: string; titleQuery: ArchiveTitleQuery | null }
}

export function ArchiveSearchSourceDialog({
  state,
  onClose,
  onSaved
}: {
  state: ArchiveSearchDialogState | null
  onClose: () => void
  onSaved: (sourceId: string) => Promise<void>
}) {
  const trpc = useTRPC()
  const [displayName, setDisplayName] = useState('')
  const [keyword, setKeyword] = useState('')
  const [matchMode, setMatchMode] = useState<ArchiveTitleQuery['matchMode']>('CONTAINS')
  const [uploaderUid, setUploaderUid] = useState('')
  const [error, setError] = useState<string | null>(null)
  const renameOnly = state?.mode === 'RENAME'
  useEffect(() => {
    setDisplayName(state?.source?.displayName ?? '')
    setKeyword(state?.source?.titleQuery?.keyword ?? '')
    setMatchMode(state?.source?.titleQuery?.matchMode ?? 'CONTAINS')
    setUploaderUid(state?.source?.titleQuery?.uploaderUid ?? '')
    setError(null)
  }, [state])
  const onError = (cause: unknown) => setError(archiveClientErrorMessage(cause, '保存失败，请稍后重试。'))
  const create = useMutation(
    trpc.archiveSearch.createSource.mutationOptions({
      onSuccess: async (source) => {
        toast.success(source.status === 'ARCHIVED' ? '该条件已存在，可重新启用此来源' : '搜索来源已保存或复用')
        onClose()
        await onSaved(source.id)
      },
      onError
    })
  )
  const rename = useMutation(
    trpc.archiveSearch.renameSource.mutationOptions({
      onSuccess: async (source) => {
        onClose()
        await onSaved(source.id)
      },
      onError
    })
  )
  const pending = create.isPending || rename.isPending
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            if (renameOnly && state?.source) {
              rename.mutate({ sourceId: state.source.id, displayName })
              return
            }
            const parsed = archiveTitleQuerySchema.safeParse({
              keyword,
              matchMode,
              uploaderUid: uploaderUid.trim() || null
            })
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? '搜索条件无效')
              return
            }
            create.mutate({ displayName, ...parsed.data })
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {renameOnly ? '修改来源名称' : state?.mode === 'COPY' ? '另存搜索条件' : '新增标题关键词来源'}
            </DialogTitle>
            <DialogDescription>条件保存后固定不变；修改条件请另存来源。只有手动扫描才会访问站点。</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-5">
            <Field>
              <FieldLabel htmlFor="search-source-name">来源名称</FieldLabel>
              <Input
                id="search-source-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                maxLength={180}
                disabled={pending}
              />
            </Field>
            <Field data-disabled={renameOnly || pending} data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="search-source-keyword">标题关键词</FieldLabel>
              <Input
                id="search-source-keyword"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                required
                maxLength={160}
                disabled={renameOnly || pending}
                aria-invalid={Boolean(error)}
                aria-describedby="search-keyword-description"
              />
              <FieldDescription id="search-keyword-description">
                匹配完整英/日标题，忽略大小写和首尾空白，保留括号。不是正则；不支持双引号、星号、下划线和百分号。
              </FieldDescription>
            </Field>
            <Field data-disabled={renameOnly || pending}>
              <FieldLabel id="search-match-label">匹配方式</FieldLabel>
              <ToggleGroup
                type="single"
                variant="outline"
                value={matchMode}
                onValueChange={(value) => {
                  if (value) setMatchMode(value as ArchiveTitleQuery['matchMode'])
                }}
                disabled={renameOnly || pending}
                aria-labelledby="search-match-label"
              >
                {Object.entries(ARCHIVE_TITLE_MATCH_LABELS).map(([value, label]) => (
                  <ToggleGroupItem key={value} value={value}>
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            <Field data-disabled={renameOnly || pending}>
              <FieldLabel htmlFor="search-source-uid">限定上传者 UID（可选）</FieldLabel>
              <Input
                id="search-source-uid"
                inputMode="numeric"
                maxLength={20}
                value={uploaderUid}
                onChange={(event) => setUploaderUid(event.target.value)}
                disabled={renameOnly || pending}
              />
              <FieldDescription>
                留空跨上传者搜索。每次检查最多 100 个候选，匹配数可能为 0；仍可继续扫描。
              </FieldDescription>
            </Field>
            {error ? <FieldError role="alert">{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              取消
            </Button>
            <Button type="submit" disabled={pending || !displayName.trim() || !keyword.trim()}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {renameOnly ? '保存名称' : '保存搜索来源'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
