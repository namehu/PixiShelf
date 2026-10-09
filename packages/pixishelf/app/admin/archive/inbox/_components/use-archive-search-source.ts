'use client'
import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  archiveTitleQuerySchema,
  normalizeArchiveTitleUploaders,
  MAX_ARCHIVE_TITLE_UPLOADERS,
  type ArchiveTitleUploader,
  type ArchiveTitleQuery
} from '@pixishelf/job-contracts'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { archiveClientErrorMessage } from '@/app/admin/archive/_components/archive-client-error'
import { useArchiveUploaderIdentity, emptyUploaderIdentity } from './archive-uploader-identity-field'

export interface ArchiveSearchDialogState {
  mode: 'CREATE' | 'COPY' | 'RENAME'
  source?: { id: string; displayName: string; titleQuery: ArchiveTitleQuery | null }
}
export function useArchiveSearchSource({
  state,
  onClose,
  onSaved,
  artistIds
}: {
  state: ArchiveSearchDialogState | null
  onClose: () => void
  onSaved: (sourceId: string) => Promise<void>
  artistIds: number[]
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
  const submit = async () => {
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
      await create.mutateAsync({
        displayName: displayName.trim() || query.data.keyword,
        ...query.data,
        ...(artistIds.length ? { artistIds } : {})
      })
    } catch (cause) {
      onError(cause)
    } finally {
      setSaving(false)
    }
  }
  return {
    displayName,
    setDisplayName,
    keyword,
    setKeyword,
    matchMode,
    setMatchMode,
    identity,
    saving,
    uploaders,
    setUploaders,
    error,
    renameOnly,
    pending,
    addUploader,
    submit
  }
}
