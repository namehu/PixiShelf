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
  addMonths,
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

/**
 * 范围选择的值类型：[开始时间, 结束时间]
 * 允许 undefined 以兼容部分选择状态
 */
export type RangeValue = [Date | undefined, Date | undefined]

/**
 * 统一的值类型
 */
export type DatePickerValue = Date | RangeValue | undefined

export interface ProDatePickerPreset {
  label: string
  // 预设值也需要兼容数组格式
  value: DatePickerValue | (() => DatePickerValue)
}

export interface ProDatePickerProps {
  /** 组件模式 */
  mode?: ProDatePickerMode
  /** * 受控值
   * single: Date
   * range: [Date, Date] (AntD 风格)
   */
  value?: DatePickerValue
  /** 默认值 (非受控) */
  defaultValue?: DatePickerValue
  /** 改变回调 */
  onChange?: (date: any) => void // 使用 any 为了兼容泛型重载，实际内部会严格处理
  /** 占位符 */
  placeholder?: string
  /** 格式化字符串 (例如 yyyy-MM-dd) */
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

/**
 * 格式化显示文本
 */
const formatDateValue = (
  value: DatePickerValue,
  formatStr: string,
  mode: ProDatePickerMode,
  placeholder: string,
  locale?: Locale
): string => {
  if (!value) return placeholder

  const formatOptions = { locale }

  // Mode: Single
  if (mode === 'single') {
    if (value instanceof Date && isValid(value)) {
      return format(value, formatStr, formatOptions)
    }
    return placeholder
  }

  // Mode: Range
  // 此时 value 应该是 [Date, Date]
  if (Array.isArray(value)) {
    const [from, to] = value

    // 情况1: 还没选
    if (!from && !to) return placeholder

    // 情况2: 只选了开始
    if (from && !to && isValid(from)) {
      return `${format(from, formatStr, formatOptions)} - `
    }

    // 情况3: 选完了 (或者开始和结束是同一天)
    if (from && to && isValid(from) && isValid(to)) {
      return `${format(from, formatStr, formatOptions)} - ${format(to, formatStr, formatOptions)}`
    }
  }

  return placeholder
}

/**
 * 转换工具：将数组 [Date, Date] 转为 react-day-picker 需要的 { from, to }
 */
const transformValueToRange = (value: DatePickerValue): DateRange | undefined => {
  if (Array.isArray(value)) {
    return { from: value[0], to: value[1] }
  }
  return undefined
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

  // 内部状态 (用于非受控模式)
  const [internalDate, setInternalDate] = React.useState<DatePickerValue>(defaultValue)

  // 这里的 date 是当前组件显示的最终值
  const isControlled = valueProp !== undefined
  const date = isControlled ? valueProp : internalDate

  // 日历显示的当前月份
  const [month, setMonth] = React.useState<Date>(new Date())

  // 当弹窗打开时，同步 month 到当前选中的日期
  // 避免上次关掉时在 1月，这次打开选中的是 5月，却还要手动翻页
  React.useEffect(() => {
    if (open) {
      if (mode === 'single' && date instanceof Date) {
        setMonth(date)
      } else if (mode === 'range' && Array.isArray(date) && date[0]) {
        setMonth(date[0])
      } else {
        // 兜底：如果没有选中值，就显示当前时间
        setMonth(new Date())
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]) // 移除 date 依赖，防止选择过程中日期变化导致月份跳动

  // ----------------------------------------------------------------------
  // Handlers
  // ----------------------------------------------------------------------

  /**
   * 处理 Single 模式选择
   */
  const handleSingleSelect: SelectSingleEventHandler = (selectedDate) => {
    const finalDate = selectedDate ? startOfDay(selectedDate) : undefined

    if (!isControlled) {
      setInternalDate(finalDate)
    }
    onChange?.(finalDate)

    if (closeOnSelect && finalDate) {
      setOpen(false)
    }
  }

  /**
   * 处理 Range 模式选择
   * 核心修复：对接 AntD 数组逻辑，修复跨天选择 bug
   */
  const handleRangeSelect: SelectRangeEventHandler = (range: DateRange | undefined) => {
    // 1. 如果是取消选择 (undefined)
    if (!range) {
      if (!isControlled) setInternalDate(undefined)
      onChange?.(undefined)
      return
    }

    const { from, to } = range

    // 2. 只有 from (正在选择中)
    // 注意：react-day-picker 在点击第二次时，如果选了同一天，可能会返回 { from, to: from }
    if (from && !to) {
      const partialState: RangeValue = [startOfDay(from), undefined]
      if (!isControlled) setInternalDate(partialState)
      onChange?.(partialState)
      // 此时不关闭弹窗，等待选择结束
    }

    // 3. 完整的 range (from 和 to 都有)
    if (from && to) {
      // 标准化时间：开始时间 00:00:00，结束时间 23:59:59
      const finalState: RangeValue = [startOfDay(from), endOfDay(to)]

      if (!isControlled) setInternalDate(finalState)
      onChange?.(finalState)

      if (closeOnSelect) {
        setOpen(false)
      }
    }
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    const emptyValue = undefined
    if (!isControlled) setInternalDate(emptyValue)
    onChange?.(emptyValue)
  }

  const handlePresetSelect = (presetValue: DatePickerValue | (() => DatePickerValue)) => {
    const value = typeof presetValue === 'function' ? presetValue() : presetValue

    if (!isControlled) {
      setInternalDate(value)
    }
    onChange?.(value)

    // 选中预设后，更新日历视图位置
    if (mode === 'single' && value instanceof Date) {
      setMonth(value)
    } else if (Array.isArray(value) && value[0]) {
      setMonth(value[0])
    }

    setOpen(false)
  }

  const displayValue = formatDateValue(date, formatStr, mode, placeholder, locale)

  // 判断是否有值用于显示 "Clear" 按钮
  const hasValue = mode === 'single' ? date instanceof Date : Array.isArray(date) && !!date[0]

  // ----------------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------------

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
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-accent rounded-full text-muted-foreground hover:text-foreground transition-colors z-10 cursor-pointer"
            >
              <X className="h-3 w-3" />
              <span className="sr-only">Clear date</span>
            </div>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="start" {...popoverProps}>
        <div className="flex h-full w-full">
          {/* ------------------- Presets Sidebar ------------------- */}
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

          {/* ------------------- Calendar ------------------- */}
          <div className="p-0">
            {mode === 'range' ? (
              <Calendar
                mode="range"
                // 将数组 [Date, Date] 转换为 {from, to} 传给 Calendar
                selected={transformValueToRange(date)}
                onSelect={handleRangeSelect}
                numberOfMonths={2}
                defaultMonth={month}
                // 显式控制 month，防止受控模式下无法翻页
                month={month}
                onMonthChange={setMonth}
                locale={locale}
                disabled={disabledDate}
                /**
                 * 修复核心 Bug: 移除了 min={2}
                 * 1. 允许只选一天 (from=to)
                 * 2. 避免了 react-day-picker 内部对短范围的各种奇怪验证
                 */
              />
            ) : (
              <Calendar
                mode="single"
                selected={date as Date | undefined}
                onSelect={handleSingleSelect}
                month={month}
                onMonthChange={setMonth}
                locale={locale}
                disabled={disabledDate}
              />
            )}
          </div>
        </div>

        {/* Error Message */}
        {typeof error === 'string' && error && (
          <div className="border-t p-2 px-3 bg-destructive/10 text-destructive text-[11px] font-medium">{error}</div>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ----------------------------------------------------------------------
// Common Presets (AntD Array Style)
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
      value: [startOfDay(new Date()), endOfDay(new Date())] as RangeValue
    },
    {
      label: '昨天',
      value: [startOfDay(subDays(new Date(), 1)), endOfDay(subDays(new Date(), 1))] as RangeValue
    },
    {
      label: '最近7天',
      value: [startOfDay(subDays(new Date(), 6)), endOfDay(new Date())] as RangeValue
    },
    {
      label: '最近30天',
      value: [startOfDay(subDays(new Date(), 29)), endOfDay(new Date())] as RangeValue
    },
    {
      label: '本月',
      value: [startOfMonth(new Date()), endOfMonth(new Date())] as RangeValue
    },
    {
      label: '上个月',
      value: [
        startOfMonth(subDays(startOfMonth(new Date()), 1)),
        endOfMonth(subDays(startOfMonth(new Date()), 1))
      ] as RangeValue
    }
  ]
}
