'use client'
import { CreatorPicker, type CreatorOption } from '@/components/creators/creator-picker'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'

export function SourceCreatorField({
  value,
  onChange,
  disabled
}: {
  value: CreatorOption[]
  onChange: (value: CreatorOption[]) => void
  disabled: boolean
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <Field data-disabled={disabled}>
        <FieldLabel>绑定艺术家（可选）</FieldLabel>
        <CreatorPicker value={value} onChange={onChange} />
        <FieldDescription>
          保存为固定艺术家，后续扫描沿用此绑定；可在来源详情中调整。来源已存在时保留原绑定。
        </FieldDescription>
      </Field>
    </fieldset>
  )
}
