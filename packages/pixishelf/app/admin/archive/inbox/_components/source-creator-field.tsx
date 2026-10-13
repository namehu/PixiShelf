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
    <fieldset disabled={disabled} className="min-w-0 border-t pt-5">
      <Field data-disabled={disabled}>
        <FieldLabel>绑定艺术家（可选）</FieldLabel>
        <CreatorPicker value={value} onChange={onChange} presentation="dialog" disabled={disabled} />
        <FieldDescription>后续扫描沿用此绑定，可在来源详情调整。已有来源保留原绑定。</FieldDescription>
      </Field>
    </fieldset>
  )
}
