import * as React from 'react'
import {
  format,
  subDays,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  isSameDay,
  isValid,
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
// 类型定义
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
  /** 触发按钮 id，用于关联可见标签 */
  id?: string
  /** 触发按钮的可访问名称 */
  'aria-label'?: string
  /** 触发按钮关联的标签 id */
  'aria-labelledby'?: string
  /** 组件模式 */
  mode?: ProDatePickerMode
  /** * 受控值
   * 单选：Date
   * 区间：[Date, Date]（AntD 风格）
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
// 辅助方法
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

  // 单选模式
  if (mode === 'single') {
    if (value instanceof Date && isValid(value)) {
      return format(value, formatStr, formatOptions)
    }
    return placeholder
  }

  // 区间模式
  // 此时 value 期望是 [Date, Date]
  if (Array.isArray(value)) {
    const [from, to] = value

    // 情况1：未选择
    if (!from && !to) return placeholder

    // 情况2：仅选了开始时间
    if (from && !to && isValid(from)) {
      return `${format(from, formatStr, formatOptions)} - `
    }

    // 情况3：选完了（含同一天）
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
// 组件实现
// ----------------------------------------------------------------------

export function ProDatePicker({
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
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

  // 下拉打开时同步 month 到当前选中日期，避免再次打开后还停在旧月份
  React.useEffect(() => {
    if (open) {
      if (mode === 'single' && date instanceof Date) {
        setMonth(date)
      } else if (mode === 'range' && Array.isArray(date) && date[0]) {
        setMonth(date[0])
      } else {
        // 无选中值时回退到当前时间
        setMonth(new Date())
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]) // 移除 date 依赖，防止选择过程中日期变化导致月份跳动

  // ----------------------------------------------------------------------
  // 事件处理
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
   * 核心修复：对齐 AntD 数组语义，修复跨天选择兼容问题
   */
  const handleRangeSelect: SelectRangeEventHandler = (range: DateRange | undefined, triggerDate?: Date) => {
    const [selectedFrom, selectedTo] = Array.isArray(date) ? date : []
    const hadRangeBeforeSelect = !!selectedFrom || !!selectedTo
    const hadCompleteRangeBeforeSelect = !!selectedFrom && !!selectedTo

    // 1. 若回传 undefined 表示取消/清空
    if (!range) {
      if (hadCompleteRangeBeforeSelect && triggerDate) {
        const partialState: RangeValue = [startOfDay(triggerDate), undefined]
        if (!isControlled) setInternalDate(partialState)
        onChange?.(partialState)
        return
      }

      if (!isControlled) setInternalDate(undefined)
      onChange?.(undefined)
      return
    }

    const { from, to } = range
    const isInitialSameDayRange = !!from && !!to && isSameDay(from, to) && !hadRangeBeforeSelect

    if (hadCompleteRangeBeforeSelect && triggerDate) {
      const partialState: RangeValue = [startOfDay(triggerDate), undefined]
      if (!isControlled) setInternalDate(partialState)
      onChange?.(partialState)
      return
    }

    // 2. 仅 from 存在（选择进行中）
    // react-day-picker 默认允许 0 天范围，第一次点击会返回 { from, to: from }。
    // 这里把初始的同日范围视为半选状态，避免开始日期刚点下去 Popover 就关闭。
    if (from && (!to || isInitialSameDayRange)) {
      const partialState: RangeValue = [startOfDay(from), undefined]
      if (!isControlled) setInternalDate(partialState)
      onChange?.(partialState)
      // 保持弹窗，等待用户完成结束日期选择
      return
    }

    // 3. 完整 range（from 和 to 都已就绪）
    if (from && to) {
      // 标准化时间边界：开始 00:00:00，结束 23:59:59
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

  // 有值时显示清空按钮
  const hasValue = mode === 'single' ? date instanceof Date : Array.isArray(date) && !!date[0]

  // ----------------------------------------------------------------------
  // 渲染
  // ----------------------------------------------------------------------

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative w-full">
        <PopoverTrigger asChild>
          <Button
            id={id}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            variant="outline"
            disabled={disabled}
            className={cn(
              'flex w-full justify-start text-left font-normal',
              !hasValue && 'text-muted-foreground',
              error && 'border-destructive text-destructive hover:bg-destructive/5 focus-visible:ring-destructive/20',
              clearable && hasValue ? 'pr-10' : 'pr-3',
              className
            )}
          >
            <CalendarIcon data-icon="inline-start" />
            <span className="truncate">{displayValue}</span>
          </Button>
        </PopoverTrigger>

        {clearable && hasValue && !disabled && (
          <button
            type="button"
            aria-label="清除日期"
            onClick={handleClear}
            className="absolute right-1 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <PopoverContent className="w-auto p-0" align="start" {...popoverProps}>
        <div className="flex h-full w-full">
          {/* ------------------- 预设侧边栏 ------------------- */}
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

          {/* ------------------- 日历区 ------------------- */}
          <div className="p-0">
            {mode === 'range' ? (
              <Calendar
                mode="range"
                // 将 [Date, Date] 转换为 { from, to } 供 Calendar 使用
                selected={transformValueToRange(date)}
                onSelect={handleRangeSelect}
                numberOfMonths={2}
                defaultMonth={month}
                // 显式控制 month，避免受控模式下翻页失效
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

        {/* 错误信息 */}
        {typeof error === 'string' && error && (
          <div className="border-t p-2 px-3 bg-destructive/10 text-destructive text-[11px] font-medium">{error}</div>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ----------------------------------------------------------------------
// 常用预设（AntD 数组风格）
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
