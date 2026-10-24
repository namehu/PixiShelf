'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

export function DuplicateRecoveryConsent({
  action,
  copyCount,
  hasOrganization,
  busy,
  disabled,
  onConfirm
}: {
  action: 'isolate' | 'purge'
  copyCount: number
  hasOrganization: boolean
  busy: boolean
  disabled: boolean
  onConfirm: (backupReference: string) => void
}) {
  const id = useId()
  const [reference, setReference] = useState('')
  const [backupConfirmed, setBackupConfirmed] = useState(false)
  const [writesStopped, setWritesStopped] = useState(false)
  const [impactConfirmed, setImpactConfirmed] = useState(false)
  const [deleteConfirmed, setDeleteConfirmed] = useState(false)
  const ready =
    Boolean(reference.trim()) &&
    backupConfirmed &&
    writesStopped &&
    (!hasOrganization || impactConfirmed) &&
    (action !== 'purge' || deleteConfirmed)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (ready && !busy && !disabled) onConfirm(reference.trim())
      }}
      className="flex flex-col gap-6"
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-backup`}>备份检查点</FieldLabel>
          <Input
            id={`${id}-backup`}
            className="min-h-11"
            value={reference}
            maxLength={200}
            disabled={busy || disabled}
            onChange={(event) => setReference(event.target.value)}
            placeholder="备份名称或 ID"
            aria-describedby={`${id}-backup-note`}
          />
          <FieldDescription id={`${id}-backup-note`}>只记录引用，不上传或校验备份内容。</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <FieldLabel className="min-h-11 items-start py-3">
            <Checkbox
              checked={backupConfirmed}
              disabled={busy || disabled}
              onCheckedChange={(value) => setBackupConfirmed(value === true)}
            />
            确认该备份适用于本批次
          </FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <FieldLabel className="min-h-11 items-start py-3">
            <Checkbox
              checked={writesStopped}
              disabled={busy || disabled}
              onCheckedChange={(value) => setWritesStopped(value === true)}
            />
            已暂停相关目录的外部同步和编辑
          </FieldLabel>
        </Field>
        {hasOrganization ? (
          <Field orientation="horizontal">
            <FieldLabel className="min-h-11 items-start py-3">
              <Checkbox
                checked={impactConfirmed}
                disabled={busy || disabled}
                onCheckedChange={(value) => setImpactConfirmed(value === true)}
              />
              我知道副本的整理记录不会合并到保留作品{action === 'purge' ? '，永久删除时也会移除' : ''}
            </FieldLabel>
          </Field>
        ) : null}
        {action === 'purge' ? (
          <Field orientation="horizontal">
            <FieldLabel className="min-h-11 items-start py-3">
              <Checkbox
                checked={deleteConfirmed}
                disabled={busy || disabled}
                onCheckedChange={(value) => setDeleteConfirmed(value === true)}
              />
              永久删除本批次的 {copyCount} 部副本，之后无法恢复
            </FieldLabel>
          </Field>
        ) : null}
      </FieldGroup>
      <Button
        type="submit"
        variant={action === 'purge' ? 'destructive' : 'default'}
        className="min-h-11 w-full"
        disabled={!ready || busy || disabled}
      >
        {busy ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
        {action === 'purge' ? `永久删除 ${copyCount} 部副本` : `隔离 ${copyCount} 部副本`}
      </Button>
    </form>
  )
}
