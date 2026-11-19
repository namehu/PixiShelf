'use client'
import { CreatorPicker, type CreatorOption } from '@/components/creators/creator-picker'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'

export function SourceCreatorField({
  value,
  onChange,
  disabled,
  confirmExisting = false
}: {
  value: CreatorOption[]
  onChange: (value: CreatorOption[]) => void
  disabled: boolean
  confirmExisting?: boolean
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0 border-t pt-5">
      <Field data-disabled={disabled}>
        <FieldLabel>绑定艺术家（可选）</FieldLabel>
        <CreatorPicker value={value} onChange={onChange} presentation="dialog" disabled={disabled} />
        <FieldDescription>
          从本来源加入收件箱时使用所选艺术家。
          {confirmExisting ? '相同条件已存在时，会先确认再追加绑定，保留原有艺术家。' : '已有来源保留原绑定。'}
        </FieldDescription>
      </Field>
    </fieldset>
  )
}
