'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FingerprintIcon, InfoIcon, WandSparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { archiveClientErrorMessage } from '@/app/admin/archive/_components/archive-client-error'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Spinner } from '@/components/ui/spinner'
import { useTRPC } from '@/lib/trpc'

interface UploaderUidSource {
  id: string
  displayName: string
  uploaderUid: string | null
}

export function ArchiveUploaderUidDialog({
  source,
  open,
  onOpenChange,
  onUpdated,
  onConflict
}: {
  source: UploaderUidSource | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: () => Promise<void>
  onConflict: (sourceId: string) => void
}) {
  const trpc = useTRPC()
  const [uidValue, setUidValue] = useState('')
  const [confirmationReady, setConfirmationReady] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const currentDialog = useRef({ open, sourceId: source?.id })
  currentDialog.current = { open, sourceId: source?.id }
  const [matchEvidence, setMatchEvidence] = useState<{
    uploaderName: string
    externalId: string
    conflict: boolean
  } | null>(null)
  const normalizedUid = useMemo(() => normalizeUid(uidValue), [uidValue])
  const isCorrection = Boolean(source?.uploaderUid)
  const unchanged = normalizedUid !== null && normalizedUid === source?.uploaderUid
  const invalid = uidValue.length > 0 && normalizedUid === null

  useEffect(() => {
    if (!open) return
    setUidValue(source?.uploaderUid ?? '')
    setConfirmationReady(false)
    setMatchEvidence(null)
    setShowManual(Boolean(source?.uploaderUid))
  }, [open, source?.id, source?.uploaderUid])

  const matchMutation = useMutation(
    trpc.archiveUploader.matchUploaderUid.mutationOptions({
      onSuccess: (result) => {
        if (!currentDialog.current.open || currentDialog.current.sourceId !== result.sourceId) return
        setUidValue(result.uploaderUid)
        setConfirmationReady(false)
        setMatchEvidence({
          uploaderName: result.uploaderName,
          externalId: result.evidenceExternalId,
          conflict: result.outcome === 'CONFLICT'
        })
        if (result.outcome === 'CONFLICT') {
          toast.warning(`自动匹配到 UID ${result.uploaderUid}，但它已绑定到其他来源`, {
            description: '未修改当前来源；你可以手动修改，或查看已有来源。',
            action: { label: '查看来源', onClick: () => onConflict(result.conflictingSourceId) }
          })
          return
        }
        toast.success('已识别上传者账号', {
          description: '核对上传者名称后即可确认使用。'
        })
      },
      onError: (error) =>
        toast.error('自动匹配 UID 失败', {
          description: archiveClientErrorMessage(error, '你仍可手动填写上传者 UID。')
        })
    })
  )

  const matchRef = useRef(matchMutation.mutate)
  matchRef.current = matchMutation.mutate
  useEffect(() => {
    if (open && source && !source.uploaderUid) matchRef.current({ sourceId: source.id })
  }, [open, source?.id, source?.uploaderUid])

  const mutation = useMutation(
    trpc.archiveUploader.setUploaderUid.mutationOptions({
      onSuccess: async (result) => {
        onOpenChange(false)
        await onUpdated()
        if (result.outcome === 'CONFLICT') {
          toast.warning(`UID ${result.uploaderUid} 已绑定到其他来源`, {
            description: '未修改当前来源。',
            action: { label: '查看来源', onClick: () => onConflict(result.conflictingSourceId) }
          })
          return
        }
        toast.success(result.outcome === 'UPDATED' ? '上传者 UID 已更新' : '上传者 UID 未发生变化')
      },
      onError: (error) =>
        toast.error(isCorrection ? '更正 UID 失败' : '绑定 UID 失败', {
          description: archiveClientErrorMessage(error, '请刷新来源状态后重试。')
        })
    })
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!source || !normalizedUid || unchanged) return
            if ((isCorrection || showManual) && !confirmationReady) {
              setConfirmationReady(true)
              return
            }
            mutation.mutate({ sourceId: source.id, uploaderUid: normalizedUid })
          }}
        >
          <DialogHeader>
            <DialogTitle>{isCorrection ? '更正上传者账号' : '识别上传者账号'}</DialogTitle>
            <DialogDescription>
              按已保存的上传者名称识别账号；确认后保留现有目录和归档，重新核对扫描范围。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-5">
            <Field data-invalid={invalid || undefined}>
              <PrivacySensitiveText>{source?.displayName}</PrivacySensitiveText>
              {showManual ? (
                <>
                  <FieldLabel htmlFor="archive-uploader-uid">上传者 UID</FieldLabel>
                  <Input
                    id="archive-uploader-uid"
                    value={uidValue}
                    onChange={(event) => {
                      setUidValue(event.target.value)
                      setConfirmationReady(false)
                      setMatchEvidence(null)
                    }}
                    placeholder="例如 1234567"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={invalid || undefined}
                    required
                  />
                </>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => source && matchMutation.mutate({ sourceId: source.id })}
                  disabled={!source || mutation.isPending || matchMutation.isPending}
                >
                  {matchMutation.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <WandSparklesIcon data-icon="inline-start" aria-hidden="true" />
                  )}
                  {matchMutation.isPending ? '正在识别' : '重新识别'}
                </Button>
                {matchEvidence ? (
                  <span className="text-sm text-muted-foreground">
                    已由 <PrivacySensitiveText>{matchEvidence.uploaderName}</PrivacySensitiveText> 的画廊 GID{' '}
                    {matchEvidence.externalId} 验证
                    {matchEvidence.conflict ? '；该 UID 已属于其他来源' : ''}
                  </span>
                ) : null}
              </div>
              {invalid ? <FieldError>UID 必须是 1–20 位正整数。</FieldError> : null}
              {!showManual ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowManual(true)}>
                  高级：手动填写 UID
                </Button>
              ) : null}
              <FieldDescription>识别不会直接修改来源。未能识别时仍可关闭弹窗，继续按名称扫描。</FieldDescription>
            </Field>
            {confirmationReady && source && normalizedUid ? (
              <Alert variant="warning">
                <InfoIcon aria-hidden="true" />
                <AlertTitle>{isCorrection ? '确认更正稳定身份' : '确认绑定稳定身份'}</AlertTitle>
                <AlertDescription>
                  <p>
                    <PrivacySensitiveText>{source.displayName}</PrivacySensitiveText>
                    {source.uploaderUid
                      ? `：UID ${source.uploaderUid} → UID ${normalizedUid}`
                      : ` → UID ${normalizedUid}`}
                  </p>
                  <p>现有目录和归档关联会保留；扫描水位将重置，并显示“UID 覆盖待校验”。</p>
                </AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending || matchMutation.isPending}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={!normalizedUid || unchanged || mutation.isPending || matchMutation.isPending}
            >
              {mutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FingerprintIcon data-icon="inline-start" aria-hidden="true" />
              )}
              {confirmationReady
                ? isCorrection
                  ? '确认更正'
                  : '确认绑定'
                : isCorrection || showManual
                  ? '检查变更'
                  : '确认使用此账号'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function normalizeUid(value: string): string | null {
  const trimmed = value.trim()
  if (!/^\d{1,20}$/.test(trimmed) || BigInt(trimmed) <= 0n) return null
  return BigInt(trimmed).toString(10)
}
