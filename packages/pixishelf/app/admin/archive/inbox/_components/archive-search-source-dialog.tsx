'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  ARCHIVE_TITLE_MATCH_LABELS,
  archiveTitleQuerySchema,
  normalizeArchiveTitleUploaders,
  MAX_ARCHIVE_TITLE_UPLOADERS,
  type ArchiveTitleUploader,
  type ArchiveTitleQuery
} from '@pixishelf/job-contracts'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
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
import {
  ArchiveUploaderIdentityField,
  useArchiveUploaderIdentity,
  emptyUploaderIdentity,
  type SavedUploaderOption
} from './archive-uploader-identity-field'

export interface ArchiveSearchDialogState {
  mode: 'CREATE' | 'COPY' | 'RENAME'
  source?: { id: string; displayName: string; titleQuery: ArchiveTitleQuery | null }
}

export function ArchiveSearchSourceDialog({
  state,
  onClose,
  onSaved,
  sources = []
}: {
  state: ArchiveSearchDialogState | null
  onClose: () => void
  onSaved: (sourceId: string) => Promise<void>
  sources?: SavedUploaderOption[]
}) {
  const trpc = useTRPC()
  const [displayName, setDisplayName] = useState('')
  const [keyword, setKeyword] = useState('')
  const [matchMode, setMatchMode] = useState<ArchiveTitleQuery['matchMode']>('CONTAINS')
  const identity = useArchiveUploaderIdentity(state !== null && state.mode !== 'RENAME')
  const [saving, setSaving] = useState(false)
  const [uploaders, setUploaders] = useState<ArchiveTitleUploader[]>([])
  const [error, setError] = useState<string | null>(null)
  const renameOnly = state?.mode === 'RENAME'
  useEffect(() => {
    setDisplayName(state?.source?.displayName ?? '')
    setKeyword(state?.source?.titleQuery?.keyword ?? '')
    setMatchMode(state?.source?.titleQuery?.matchMode ?? 'CONTAINS')
    const query = state?.source?.titleQuery
    setUploaders(query?.uploaders ?? [])
    identity.change(
      query?.uploaderName
        ? { mode: 'NAME', value: query.uploaderName }
        : query?.uploaderUid
          ? query.uploaderDisplayName
            ? {
                mode: 'NAME',
                value: query.uploaderDisplayName,
                resolvedUid: query.uploaderUid,
                displayName: query.uploaderDisplayName
              }
            : { mode: 'UID', value: query.uploaderUid, resolvedUid: query.uploaderUid }
          : emptyUploaderIdentity
    )
    setError(null)
  }, [state, identity.change])
  const onError = (cause: unknown) => setError(archiveClientErrorMessage(cause, '保存失败，请稍后重试。'))
  const create = useMutation(
    trpc.archiveSearch.createSource.mutationOptions({
      onSuccess: async (source) => {
        toast.success(source.status === 'ARCHIVED' ? '该条件已存在，可重新启用此来源' : '搜索来源已保存或复用', {
          description: source.titleQuery?.uploaderName ? '已保留上传者名称限制，当前按名称搜索。' : undefined
        })
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
  const pending = saving || create.isPending || rename.isPending
  const addUploader = async () => {
    setError(null)
    setSaving(true)
    try {
      const chosen = await identity.getIdentity()
      if (!chosen) return
      if (!chosen.resolvedUid) throw new Error('该名称尚未识别出 UID，请重试识别或手动填写 UID 后添加。')
      const next = normalizeArchiveTitleUploaders([
        ...uploaders,
        { uid: chosen.resolvedUid, ...(chosen.displayName ? { displayName: chosen.displayName } : {}) }
      ])
      if (next.length > MAX_ARCHIVE_TITLE_UPLOADERS) throw new Error('最多限定 10 个上传者。')
      setUploaders(next)
      identity.change({ mode: identity.draft.mode, value: '' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加上传者失败，请重试。')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setError(null)
            if (renameOnly && state?.source) {
              rename.mutate({ sourceId: state.source.id, displayName })
              return
            }
            const parsed = archiveTitleQuerySchema.safeParse({
              keyword,
              matchMode,
              uploaderUid: null
            })
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? '搜索条件无效')
              return
            }
            setSaving(true)
            try {
              const chosen = await identity.getIdentity()
              if (uploaders.length && chosen && !chosen.resolvedUid) {
                setError('该名称尚未识别出 UID，请重试或手动填写 UID；已有上传者已保留。')
                return
              }
              const selected = normalizeArchiveTitleUploaders([
                ...uploaders,
                ...(chosen?.resolvedUid
                  ? [{ uid: chosen.resolvedUid, ...(chosen.displayName ? { displayName: chosen.displayName } : {}) }]
                  : [])
              ])
              const query = archiveTitleQuerySchema.safeParse({
                ...parsed.data,
                ...(selected.length > 1
                  ? { uploaders: selected }
                  : selected[0]
                    ? {
                        uploaderUid: selected[0].uid,
                        ...(selected[0].displayName ? { uploaderDisplayName: selected[0].displayName } : {})
                      }
                    : chosen
                      ? { uploaderName: chosen.value }
                      : {})
              })
              if (!query.success) {
                setError(query.error.issues[0]?.message ?? '搜索条件无效')
                return
              }
              await create.mutateAsync({ displayName, ...query.data })
            } catch (cause) {
              onError(cause)
            } finally {
              setSaving(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {renameOnly ? '修改来源名称' : state?.mode === 'COPY' ? '另存搜索条件' : '新增标题关键词来源'}
            </DialogTitle>
            <DialogDescription>
              输入上传者名称后自动识别账号，可添加多个，匹配其中任意一个。条件保存后固定不变；修改条件请另存来源。
            </DialogDescription>
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
                匹配完整英/日标题，忽略大小写和首尾空白，保留括号和下划线。不是正则；不支持双引号、星号和百分号。
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
            {uploaders.length ? (
              <Field>
                <FieldLabel>
                  已限定上传者（{uploaders.length}/{MAX_ARCHIVE_TITLE_UPLOADERS}）
                </FieldLabel>
                <ul className="flex flex-wrap gap-2" aria-label="已限定上传者">
                  {uploaders.map((uploader) => (
                    <li key={uploader.uid} className="flex items-center gap-1">
                      <Badge variant="secondary">
                        <PrivacySensitiveText>{uploader.displayName ?? `UID ${uploader.uid}`}</PrivacySensitiveText>
                      </Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={renameOnly || pending}
                        aria-label={`移除 UID ${uploader.uid}`}
                        onClick={() => setUploaders(uploaders.filter(({ uid }) => uid !== uploader.uid))}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
                <FieldDescription>匹配其中任意一个上传者；重复 UID 会自动去重。</FieldDescription>
              </Field>
            ) : null}
            <ArchiveUploaderIdentityField
              identity={identity}
              label={uploaders.length ? '继续添加上传者' : '限定上传者（可选）'}
              optional={!uploaders.length}
              sources={sources}
              disabled={renameOnly || pending}
            />
            <Button
              type="button"
              variant="outline"
              disabled={renameOnly || pending || !identity.draft.value.trim()}
              onClick={() => void addUploader()}
            >
              <Plus data-icon="inline-start" />
              添加上传者
            </Button>
            {error ? <FieldError role="alert">{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              取消
            </Button>
            <Button type="submit" disabled={pending || !displayName.trim() || !keyword.trim()}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {renameOnly ? '保存名称' : saving && identity.pending ? '识别并保存中' : '保存搜索来源'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
