'use client'
import { useId, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'

export function ImageReplaceConfirmationDescription({
  mediaCount,
  onSkipChange
}: {
  mediaCount: number
  onSkipChange: (skip: boolean) => void
}) {
  const checkboxId = useId()
  const [skipForSession, setSkipForSession] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <p>将使用列表中的 {mediaCount} 个媒体替换当前内容；系统会先创建可回滚备份。</p>
      <FieldGroup className="gap-3">
        <Field orientation="horizontal">
          <Checkbox
            id={checkboxId}
            checked={skipForSession}
            onCheckedChange={(checked) => {
              const nextValue = checked === true
              setSkipForSession(nextValue)
              onSkipChange(nextValue)
            }}
          />
          <FieldContent>
            <FieldLabel htmlFor={checkboxId} className="font-normal">
              本次会话期间不再提示
            </FieldLabel>
            <FieldDescription>仅当前浏览器标签页有效，关闭后会恢复确认。</FieldDescription>
          </FieldContent>
        </Field>
      </FieldGroup>
    </div>
  )
}
