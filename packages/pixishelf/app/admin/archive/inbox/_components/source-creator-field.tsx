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
          可在来源详情调整。标题来源在人工入箱时追加，上传者来源在首次扫描匹配时追加。
          {confirmExisting ? '相同条件已存在时，会先确认再追加绑定，保留原有艺术家。' : '已有来源保留原绑定。'}
        </FieldDescription>
      </Field>
    </fieldset>
  )
}
