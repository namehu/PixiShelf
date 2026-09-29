'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { archiveUploaderNameSchema, normalizeArchiveUploaderName } from '@pixishelf/job-contracts'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import type { UploaderIdentityResolution } from '@/services/archive-uploader/archive-uploader-identity'

export interface SavedUploaderOption {
  id: string
  sourceKind: string
  displayName: string
  identityValue: string | null
  uploaderUid: string | null
  status: string
}

export interface UploaderIdentityDraft {
  mode: 'NAME' | 'UID'
  value: string
  resolvedUid?: string
  displayName?: string
  sourceId?: string
}

export const emptyUploaderIdentity: UploaderIdentityDraft = { mode: 'NAME', value: '' }

export function useArchiveUploaderIdentity(active: boolean) {
  const trpc = useTRPC()
  const mutation = useMutation(trpc.archiveUploader.resolveIdentity.mutationOptions({ retry: false }))
  const mutationRef = useRef(mutation.mutateAsync)
  mutationRef.current = mutation.mutateAsync
  const [draft, setDraft] = useState<UploaderIdentityDraft>(emptyUploaderIdentity)
  const [result, setResult] = useState<UploaderIdentityResolution | null>(null)
  const [pending, setPending] = useState(false)
  const [composing, setComposing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revision = useRef(0)
  const request = useRef<{ revision: number; promise: Promise<UploaderIdentityResolution> } | null>(null)
  const resultRef = useRef<UploaderIdentityResolution | null>(null)
  const change = useCallback((value: UploaderIdentityDraft) => {
    revision.current += 1
    request.current = null
    resultRef.current = null
    setResult(null)
    setPending(false)
    setError(null)
    setDraft(value)
  }, [])

  const resolve = useCallback(async (): Promise<UploaderIdentityResolution | null> => {
    if (draft.mode !== 'NAME' || !draft.value.trim() || draft.resolvedUid) return null
    const parsed = archiveUploaderNameSchema.safeParse(draft.value)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '上传者名称无效')
      return null
    }
    if (resultRef.current) return resultRef.current
    if (request.current?.revision === revision.current) return request.current.promise
    const generation = revision.current
    setPending(true)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<UploaderIdentityResolution>((done) => {
      timer = setTimeout(
        () => done({ outcome: 'UNRESOLVED', reason: 'TIMEOUT', message: '识别超时，保存后按名称搜索。' }),
        20_000
      )
    })
    const operation = mutationRef.current({ name: parsed.data }).catch(
      (): UploaderIdentityResolution => ({
        outcome: 'UNRESOLVED',
        reason: 'UNAVAILABLE',
        message: '暂时无法识别，保存后按名称搜索。'
      })
    )
    const promise = Promise.race([operation, timeout])
      .then((value) => {
        if (generation === revision.current) {
          resultRef.current = value
          setResult(value)
        }
        return value
      })
      .finally(() => {
        clearTimeout(timer)
        if (generation === revision.current) setPending(false)
      })
    request.current = { revision: generation, promise }
    return promise
  }, [draft])

  useEffect(() => {
    if (!active || composing) return
    const timer = setTimeout(() => {
      void resolve()
    }, 1_000)
    return () => clearTimeout(timer)
  }, [active, composing, resolve])
  useEffect(() => {
    return () => {
      revision.current += 1
      request.current = null
      resultRef.current = null
    }
  }, [active])

  const getIdentity = async () => {
    if (!draft.value.trim()) return null
    if (draft.resolvedUid) {
      // Selected account labels are presentation text, not remote NAME query syntax.
      return { ...draft, mode: 'UID' as const, value: draft.resolvedUid }
    }
    if (draft.mode === 'UID') {
      if (!/^\d{1,20}$/.test(draft.value.trim()) || BigInt(draft.value.trim()) <= 0n) {
        setError('UID 必须是 1–20 位正整数。')
        throw new Error('上传者 UID 无效')
      }
      return { ...draft, resolvedUid: BigInt(draft.value.trim()).toString() }
    }
    const parsed = archiveUploaderNameSchema.safeParse(draft.value)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '上传者名称无效')
      throw new Error('上传者名称无效')
    }
    const generation = revision.current
    const matched = await resolve()
    if (generation !== revision.current) throw new Error('上传者输入已更改')
    return matched?.outcome === 'MATCHED'
      ? {
          mode: 'NAME' as const,
          value: parsed.data,
          resolvedUid: matched.uploaderUid,
          displayName: matched.uploaderName,
          sourceId: matched.existingSource?.id
        }
      : { ...draft, value: parsed.data }
  }

  return {
    draft,
    change,
    result,
    pending,
    setComposing,
    error,
    getIdentity,
    retry: () => {
      change({ ...draft })
    }
  }
}

export function ArchiveUploaderIdentityField({
  identity,
  label = '上传者名称',
  optional = false,
  disabled = false,
  sources = []
}: {
  identity: ReturnType<typeof useArchiveUploaderIdentity>
  label?: string
  optional?: boolean
  disabled?: boolean
  sources?: SavedUploaderOption[]
}) {
  const id = useId()
  const [advanced, setAdvanced] = useState(false)
  const { draft, result, pending, error } = identity
  const candidates =
    draft.mode === 'NAME' && !draft.resolvedUid && draft.value.trim()
      ? sources
          .filter(
            (source) =>
              source.sourceKind === 'UPLOADER' &&
              normalizeArchiveUploaderName(source.displayName).includes(normalizeArchiveUploaderName(draft.value))
          )
          .slice(0, 5)
      : []
  return (
    <Field data-disabled={disabled} data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{draft.mode === 'UID' ? '上传者 UID' : label}</FieldLabel>
      <Input
        id={id}
        value={draft.value}
        disabled={disabled}
        autoComplete="off"
        maxLength={draft.mode === 'UID' ? 20 : 180}
        inputMode={draft.mode === 'UID' ? 'numeric' : 'text'}
        placeholder={draft.mode === 'UID' ? '输入数字 UID' : '粘贴原站上的完整上传者名称'}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-status`}
        onCompositionStart={() => identity.setComposing(true)}
        onCompositionEnd={() => identity.setComposing(false)}
        onChange={(event) => identity.change({ mode: draft.mode, value: event.target.value })}
      />
      {candidates.length ? (
        <div className="flex flex-col items-start gap-1" aria-label="已保存上传者候选">
          <span className="text-xs text-muted-foreground">已保存上传者</span>
          {candidates.map((source) => (
            <Button
              key={source.id}
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() =>
                identity.change({
                  mode: 'NAME',
                  value: source.uploaderUid ? source.displayName : (source.identityValue ?? source.displayName),
                  ...(source.uploaderUid ? { resolvedUid: source.uploaderUid, displayName: source.displayName } : {}),
                  sourceId: source.id
                })
              }
            >
              <PrivacySensitiveText>{source.displayName}</PrivacySensitiveText>
              {source.status === 'ARCHIVED' ? '（已停用）' : ''}
            </Button>
          ))}
        </div>
      ) : null}
      <FieldDescription id={`${id}-status`} role="status" aria-live="polite">
        {pending ? (
          <span className="inline-flex items-center gap-2">
            <Spinner aria-hidden="true" />
            正在识别上传者，可能需要数秒…
          </span>
        ) : draft.resolvedUid || result?.outcome === 'MATCHED' ? (
          <>
            已识别：
            <PrivacySensitiveText>
              {draft.displayName ?? (result?.outcome === 'MATCHED' ? result.uploaderName : draft.value)}
            </PrivacySensitiveText>
          </>
        ) : result?.outcome === 'UNRESOLVED' ? (
          result.message
        ) : draft.mode === 'UID' ? (
          '按填写的 UID 保存；如只知道名称，请切换回名称输入。'
        ) : optional && !draft.value ? (
          '留空表示不限上传者。输入完整名称后自动识别。'
        ) : (
          '输入完整名称后自动识别；暂时查不到账号也可按名称保存。'
        )}
      </FieldDescription>
      {error ? <FieldError role="alert">{error}</FieldError> : null}
      <div className="flex flex-wrap items-center gap-2">
        {result?.outcome === 'UNRESOLVED' ? (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={identity.retry}>
            重试识别
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-expanded={advanced || draft.mode === 'UID'}
          onClick={() => setAdvanced(!advanced)}
        >
          高级选项
        </Button>
      </div>
      {advanced || draft.mode === 'UID' ? (
        <div className="flex flex-col gap-2">
          {draft.resolvedUid || result?.outcome === 'MATCHED' ? (
            <span className="text-xs text-muted-foreground">
              UID {draft.resolvedUid ?? (result?.outcome === 'MATCHED' ? result.uploaderUid : '')}
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => identity.change({ mode: draft.mode === 'NAME' ? 'UID' : 'NAME', value: '' })}
          >
            {draft.mode === 'NAME' ? '手动填写 UID' : '改用上传者名称'}
          </Button>
        </div>
      ) : null}
    </Field>
  )
}
