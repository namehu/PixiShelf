import type { ArtworkDedupRunDto } from '@pixishelf/job-contracts'
import { ScanSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldDescription, FieldLegend, FieldSet } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export function DuplicateCheckStart({
  mode,
  onModeChange,
  onStart,
  pending,
  disabled,
  repeat = false
}: {
  mode: ArtworkDedupRunDto['mode']
  onModeChange: (mode: ArtworkDedupRunDto['mode']) => void
  onStart: () => void
  pending: boolean
  disabled: boolean
  repeat?: boolean
}) {
  return (
    <div className="flex w-full flex-col gap-6 text-left">
      <FieldSet disabled={disabled}>
        <FieldLegend variant="label">检查方式</FieldLegend>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value === 'FULL' || value === 'INCREMENTAL') onModeChange(value)
          }}
          variant="outline"
          disabled={disabled}
          aria-label="检查方式"
          aria-describedby="duplicate-check-mode-description"
        >
          <ToggleGroupItem value="INCREMENTAL" className="min-h-11">
            增量检查
          </ToggleGroupItem>
          <ToggleGroupItem value="FULL" className="min-h-11">
            完整检查
          </ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription id="duplicate-check-mode-description">
          {mode === 'FULL' ? '重新读取候选内容，耗时会更长。' : '复用未变化内容的检查记录。'}
        </FieldDescription>
      </FieldSet>
      <Button type="button" className="min-h-11 w-fit" disabled={disabled} onClick={onStart}>
        {pending ? (
          <Spinner data-icon="inline-start" aria-hidden="true" />
        ) : (
          <ScanSearch data-icon="inline-start" aria-hidden="true" />
        )}
        {pending ? '正在提交' : repeat ? '重新检查' : '开始检查'}
      </Button>
    </div>
  )
}
