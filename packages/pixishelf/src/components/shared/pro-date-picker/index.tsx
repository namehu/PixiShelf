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
  isSameMonth,
  type Locale
} from 'date-fns'
import { zhCN } from 'date-fns/locale'
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
      return `${format(range.from, formatStr, formatOptions)} - ` // AntD 风格：只选开始时显示 "开始 - "
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

  // 核心修复1：显式控制日历当前显示的月份
  const [currentMonth, setCurrentMonth] = React.useState<Date>(new Date())

  const isControlled = valueProp !== undefined
  const date = isControlled ? valueProp : internalDate

  // 核心修复1续：当弹窗打开时，定位到当前选中的月份
  React.useEffect(() => {
    if (open) {
      let targetMonth = new Date()
      if (mode === 'single' && date instanceof Date) {
        targetMonth = date
      } else if (mode === 'range') {
        const range = date as DateRange
        if (range?.from) targetMonth = range.from
        // 如果有 to 且 from 和 to 不在同一个月，AntD通常也是定位到 from
      }
      setCurrentMonth(startOfMonth(targetMonth))
    }
  }, [open, mode, date])

  const handleSelect = React.useCallback(
    (selected: Date | DateRange | undefined) => {
      let finalSelected = selected

      // 核心修复2 & 3：Range 模式下的 AntD 逻辑对其
      if (mode === 'range' && selected) {
        const range = selected as DateRange

        // 1. 强制时间标准化：From 设为 00:00:00, To 设为 23:59:59
        const normalizedRange: DateRange = {
          from: range.from ? startOfDay(range.from) : undefined,
          to: range.to ? endOfDay(range.to) : undefined
        }

        // react-day-picker 的 range 模式有个特性：
        // 如果你点击同一个日期两次，它可能会把 range 变成 undefined 或者 {from: T, to: T}
        // 为了符合 AntD 直觉：
        // - 如果只有 from，没 to -> 只是开始
        // - 如果 from 和 to 都有 -> 结束
        finalSelected = normalizedRange
      }

      if (!isControlled) {
        setInternalDate(finalSelected)
      }
      onChange?.(finalSelected)

      // 自动关闭逻辑
      if (closeOnSelect) {
        if (mode === 'single' && finalSelected) {
          setOpen(false)
        } else if (mode === 'range') {
          const range = finalSelected as DateRange
          // 只有当完整选择区间后才关闭
          if (range?.from && range?.to) {
            setOpen(false)
          }
        }
      }
    },
    [isControlled, onChange, closeOnSelect, mode]
  )

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    handleSelect(undefined)
  }

  const handlePresetSelect = (presetValue: Date | DateRange) => {
    handleSelect(presetValue)
    setOpen(false)
  }

  const displayValue = formatDateValue(date, formatStr, mode, placeholder, locale)
  const hasValue = mode === 'single' ? date instanceof Date && isValid(date) : !!(date as DateRange)?.from

  // ----------------------------------------------------------------------
  // Render Calendar
  // ----------------------------------------------------------------------

  const renderCalendar = () => {
    const commonProps = {
      locale,
      disabled: disabledDate,
      // 核心修复1：受控的 month
      month: currentMonth,
      onMonthChange: setCurrentMonth
    }

    if (mode === 'range') {
      return (
        <Calendar
          mode="range"
          selected={date as DateRange | undefined}
          onSelect={handleSelect as SelectRangeEventHandler}
          numberOfMonths={2}
          // 默认选中行为设置，防止点击已选范围变成取消选择
          min={2}
          {...commonProps}
        />
      )
    }

    return (
      <Calendar
        mode="single"
        selected={date as Date | undefined}
        onSelect={handleSelect as SelectSingleEventHandler}
        {...commonProps}
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
// Common Presets
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
      value: { from: startOfDay(subDays(new Date(), 6)), to: endOfDay(new Date()) } // 修复预设: 保证是start/end
    },
    {
      label: '最近30天',
      value: { from: startOfDay(subDays(new Date(), 29)), to: endOfDay(new Date()) }
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
