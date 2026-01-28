import * as React from 'react'
import {
  format,
  subDays,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  isValid,
  type Locale
} from 'date-fns'
import { zhCN } from 'date-fns/locale' // 默认引入中文，可按需修改
import { Calendar as CalendarIcon, X } from 'lucide-react'
import { DateRange, Matcher, SelectRangeEventHandler, SelectSingleEventHandler } from 'react-day-picker'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'

// ----------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------

export type ProDatePickerMode = 'single' | 'range'

export interface ProDatePickerPreset {
  label: string
  value: Date | DateRange
}

export interface ProDatePickerProps {
  /** 组件模式 */
  mode?: ProDatePickerMode
  /** 受控值 */
  value?: Date | DateRange
  /** 默认值 (非受控) */
  defaultValue?: Date | DateRange
  /** 改变回调 */
  onChange?: (date: Date | DateRange | undefined) => void
  /** 占位符 */
  placeholder?: string
  /** 格式化 */
  format?: string
  /** 语言包 */
  locale?: Locale
  /** 禁用 */
  disabled?: boolean
  /** 禁用日期规则 */
  disabledDate?: Matcher | Matcher[]
  /** 快捷预设 */
  presets?: ProDatePickerPreset[]
  /** 是否允许清空 */
  clearable?: boolean
  /** 错误状态 */
  error?: boolean | string
  /** 范围选择选完后是否自动关闭 */
  closeOnSelect?: boolean
  className?: string
  /** 额外的 Popover 内容属性 */
  popoverProps?: React.ComponentPropsWithoutRef<typeof PopoverContent>
}

// ----------------------------------------------------------------------
// Helper Functions
// ----------------------------------------------------------------------

const formatDateValue = (
  value: Date | DateRange | undefined,
  formatStr: string,
  mode: ProDatePickerMode,
  placeholder: string,
  locale?: Locale
): string => {
  if (!value) return placeholder

  const formatOptions = { locale }

  if (mode === 'single' && value instanceof Date && isValid(value)) {
    return format(value, formatStr, formatOptions)
  }

  if (mode === 'range') {
    const range = value as DateRange
    // 只显示 from
    if (range.from && !range.to) {
      return format(range.from, formatStr, formatOptions)
    }
    // 显示完整区间
    if (range.from && range.to) {
      return `${format(range.from, formatStr, formatOptions)} - ${format(range.to, formatStr, formatOptions)}`
    }
  }

  return placeholder
}

// ----------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------

export function ProDatePicker({
  mode = 'single',
  value: valueProp,
  defaultValue,
  onChange,
  placeholder = '请选择日期',
  format: formatStr = 'yyyy-MM-dd',
  locale = zhCN,
  disabled = false,
  disabledDate,
  presets = [],
  clearable = true,
  error,
  closeOnSelect = true,
  className,
  popoverProps
}: ProDatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const [internalDate, setInternalDate] = React.useState<Date | DateRange | undefined>(defaultValue)

  // 1. 核心状态逻辑：判断是受控还是非受控
  const isControlled = valueProp !== undefined
  const date = isControlled ? valueProp : internalDate

  // 2. 统一处理选值
  const handleSelect = React.useCallback(
    (selected: Date | DateRange | undefined) => {
      if (!isControlled) {
        setInternalDate(selected)
      }
      onChange?.(selected)

      // 自动关闭逻辑
      if (closeOnSelect) {
        if (mode === 'single' && selected) {
          setOpen(false)
        } else if (mode === 'range') {
          const range = selected as DateRange
          // 当 from 和 to 都存在时才关闭，且防止同日点击造成的闪烁
          if (range?.from && range?.to) {
            setOpen(false)
          }
        }
      }
    },
    [isControlled, onChange, closeOnSelect, mode]
  )

  // 3. 处理清空
  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    handleSelect(undefined)
  }

  // 4. 处理预设点击
  const handlePresetSelect = (presetValue: Date | DateRange) => {
    handleSelect(presetValue)
    // 预设点击通常直接关闭弹窗
    setOpen(false)
  }

  const displayValue = formatDateValue(date, formatStr, mode, placeholder, locale)
  const hasValue = mode === 'single' ? date instanceof Date && isValid(date) : !!(date as DateRange)?.from

  // 5. 分离 Single 和 Range 的 Props 以满足 TypeScript 类型检查
  const renderCalendar = () => {
    if (mode === 'range') {
      return (
        <Calendar
          mode="range"
          selected={date as DateRange | undefined}
          onSelect={handleSelect as SelectRangeEventHandler}
          disabled={disabledDate}
          numberOfMonths={2}
          locale={locale}
        />
      )
    }

    return (
      <Calendar
        mode="single"
        selected={date as Date | undefined}
        onSelect={handleSelect as SelectSingleEventHandler}
        disabled={disabledDate}
        locale={locale}
      />
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={'outline'}
          disabled={disabled}
          className={cn(
            'flex w-full justify-start text-left font-normal relative',
            !hasValue && 'text-muted-foreground',
            error && 'border-destructive text-destructive hover:bg-destructive/5 focus-visible:ring-destructive/20',
            // 给清除按钮留出 padding
            clearable && hasValue ? 'pr-8' : 'pr-3',
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 opacity-50" />
          <span className="truncate">{displayValue}</span>

          {clearable && hasValue && !disabled && (
            <div
              role="button"
              tabIndex={0}
              onClick={handleClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-accent rounded-full text-muted-foreground hover:text-foreground transition-colors z-10"
            >
              <X className="h-3 w-3" />
              <span className="sr-only">Clear date</span>
            </div>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="start" {...popoverProps}>
        <div className="flex h-full w-full">
          {presets.length > 0 && (
            <>
              <div className="py-2 w-[120px] flex flex-col shrink-0">
                <div className="px-3 py-1 text-xs font-semibold text-muted-foreground mb-1">快速选择</div>
                <div className="grid gap-1 px-2 flex-1 overflow-auto max-h-[300px]">
                  {presets.map((preset) => (
                    <Button
                      key={preset.label}
                      variant="ghost"
                      size="sm"
                      className={cn(
                        'justify-start font-normal text-xs h-8 px-2 overflow-hidden text-ellipsis whitespace-nowrap'
                        // 可选：如果预设值等于当前值，高亮显示（比较复杂，这里暂略）
                      )}
                      onClick={() => handlePresetSelect(preset.value)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>
              <Separator orientation="vertical" className="h-auto" />
            </>
          )}

          <div className="p-0">{renderCalendar()}</div>
        </div>

        {/* 错误信息展示 (可选) */}
        {typeof error === 'string' && error && (
          <div className="border-t p-2 px-3 bg-destructive/10 text-destructive text-[11px] font-medium">{error}</div>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ----------------------------------------------------------------------
// Common Presets (Exports)
// ----------------------------------------------------------------------

export const ProDatePickerPresets = {
  single: [
    { label: '今天', value: startOfDay(new Date()) },
    { label: '昨天', value: startOfDay(subDays(new Date(), 1)) },
    { label: '一周前', value: startOfDay(subDays(new Date(), 7)) }
  ],
  range: [
    {
      label: '今天',
      value: { from: startOfDay(new Date()), to: endOfDay(new Date()) }
    },
    {
      label: '昨天',
      value: { from: startOfDay(subDays(new Date(), 1)), to: endOfDay(subDays(new Date(), 1)) }
    },
    {
      label: '最近7天',
      value: { from: subDays(new Date(), 6), to: new Date() }
    },
    {
      label: '最近30天',
      value: { from: subDays(new Date(), 29), to: new Date() }
    },
    {
      label: '本周',
      value: { from: startOfWeek(new Date(), { weekStartsOn: 1 }), to: endOfWeek(new Date(), { weekStartsOn: 1 }) }
    },
    {
      label: '本月',
      value: { from: startOfMonth(new Date()), to: endOfMonth(new Date()) }
    }
  ]
}
