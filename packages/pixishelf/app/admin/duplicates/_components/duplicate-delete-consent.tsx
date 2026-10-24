'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'

export function DuplicateDeleteConsent({
  copyCount,
  busy,
  disabled,
  onConfirm
}: {
  copyCount: number
  busy: boolean
  disabled: boolean
  onConfirm: () => void
}) {
  const id = useId()
  const [consequences, setConsequences] = useState(false)
  const [writesStopped, setWritesStopped] = useState(false)
  return (
    <FieldSet disabled={busy || disabled}>
      <FieldLegend>确认本次永久删除</FieldLegend>
      <p className="text-sm leading-6 text-muted-foreground">
        删除上方服务器冻结范围中的副本、原件和已登记附属文件。副本的标题、标签、系列关联、派生内容及评分、书签、喜欢、阅读记录随副本删除，不会合并到保留作品。逻辑大小不等于实际磁盘释放量。
      </p>
      <FieldGroup>
        <Field orientation="horizontal" data-disabled={busy || disabled}>
          <Checkbox
            id={`${id}-consequences`}
            checked={consequences}
            onCheckedChange={(value) => setConsequences(value === true)}
          />
          <FieldLabel htmlFor={`${id}-consequences`} className="min-h-11 flex-1 py-2">
            我理解永久删除这 {copyCount} 部副本及其整理记录，无法恢复，也不会合并到保留作品
          </FieldLabel>
        </Field>
        <Field orientation="horizontal" data-disabled={busy || disabled}>
          <Checkbox
            id={`${id}-writes`}
            checked={writesStopped}
            onCheckedChange={(value) => setWritesStopped(value === true)}
          />
          <FieldLabel htmlFor={`${id}-writes`} className="min-h-11 flex-1 py-2">
            已暂停相关目录的外部同步和编辑，并持续停写直到本次操作终结
          </FieldLabel>
        </Field>
      </FieldGroup>
      <Button
        variant="destructive"
        className="min-h-11 w-full"
        disabled={busy || disabled || !consequences || !writesStopped}
        onClick={() => onConfirm()}
      >
        {busy ? '正在提交删除' : `永久删除 ${copyCount} 部副本`}
      </Button>
    </FieldSet>
  )
}
