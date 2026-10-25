import type { ArtworkDedupRunDto } from '@pixishelf/job-contracts'
import { ScanSearch, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export function DuplicateCheckStart({
  mode,
  onModeChange,
  includeSuspectedVersions = false,
  onIncludeSuspectedVersionsChange,
  onStart,
  pending,
  disabled,
  repeat = false
}: {
  mode: ArtworkDedupRunDto['mode']
  includeSuspectedVersions?: boolean
  onIncludeSuspectedVersionsChange?: (value: boolean) => void
  onModeChange: (mode: ArtworkDedupRunDto['mode']) => void
  onStart: () => void
  pending: boolean
  disabled: boolean
  repeat?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Button type="button" className="min-h-11 w-fit" disabled={disabled} onClick={onStart}>
        {pending ? (
          <Spinner data-icon="inline-start" aria-hidden="true" />
        ) : (
          <ScanSearch data-icon="inline-start" aria-hidden="true" />
        )}
        {pending ? '正在提交' : repeat ? '重新检查' : '开始检查'}
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-label="检查选项"
            disabled={disabled}
          >
            <SlidersHorizontal aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent aria-label="检查选项" align="end" className="w-80 max-w-[calc(100vw-2rem)]">
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
                快速检查
              </ToggleGroupItem>
              <ToggleGroupItem value="FULL" className="min-h-11">
                逐一重查
              </ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription id="duplicate-check-mode-description">
              {mode === 'FULL'
                ? '重新读取需要比对的文件，适合核查外部修改，耗时较长。'
                : '已检查且未变化的文件会跳过，节省时间。'}
            </FieldDescription>
            <Field orientation="horizontal">
              <Checkbox
                id="duplicate-check-versions"
                checked={includeSuspectedVersions}
                onCheckedChange={(value) => onIncludeSuspectedVersionsChange?.(value === true)}
                disabled={disabled}
              />
              <FieldLabel htmlFor="duplicate-check-versions" className="min-h-11 flex-1 font-normal">
                检查疑似版本
              </FieldLabel>
            </Field>
          </FieldSet>
        </PopoverContent>
      </Popover>
    </div>
  )
}
