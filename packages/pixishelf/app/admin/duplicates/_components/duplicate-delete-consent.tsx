'use client'

import { useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'

export function DuplicateDeleteConsent({
  copyCount,
  busy,
  disabled,
  secondaryAction,
  onConfirm
}: {
  copyCount: number
  busy: boolean
  disabled: boolean
  secondaryAction?: ReactNode
  onConfirm: () => void
}) {
  const id = useId()
  const [consequences, setConsequences] = useState(false)
  const [writesStopped, setWritesStopped] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <FieldSet className="gap-2" disabled={busy || disabled}>
        <FieldLegend variant="label" className="mb-1">
          删除前确认
        </FieldLegend>
        <FieldGroup className="gap-1">
          <Field orientation="horizontal" data-disabled={busy || disabled}>
            <Checkbox
              id={`${id}-consequences`}
              checked={consequences}
              onCheckedChange={(value) => setConsequences(value === true)}
            />
            <FieldLabel htmlFor={`${id}-consequences`} className="min-h-11 flex-1 py-2 text-sm leading-5 font-normal">
              我理解永久删除这 {copyCount} 部副本及其整理记录，无法恢复，也不会合并到保留作品
            </FieldLabel>
          </Field>
          <Field orientation="horizontal" data-disabled={busy || disabled}>
            <Checkbox
              id={`${id}-writes`}
              checked={writesStopped}
              onCheckedChange={(value) => setWritesStopped(value === true)}
            />
            <FieldLabel htmlFor={`${id}-writes`} className="min-h-11 flex-1 py-2 text-sm leading-5 font-normal">
              已暂停这些文件的同步和编辑，处理结束前不再修改
            </FieldLabel>
          </Field>
        </FieldGroup>
      </FieldSet>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {secondaryAction}
        <Button
          variant="destructive"
          className="min-h-11 flex-1 sm:flex-none"
          disabled={busy || disabled || !consequences || !writesStopped}
          onClick={() => onConfirm()}
        >
          {busy ? '正在提交删除' : `永久删除 ${copyCount} 部副本`}
        </Button>
      </div>
    </div>
  )
}
