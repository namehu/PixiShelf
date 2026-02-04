'use client'

import * as React from 'react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { Calendar as CalendarIcon, X } from 'lucide-react'
import { DateRange } from 'react-day-picker'

import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/hooks/use-media-query'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger
} from '@/components/ui/drawer'

// 定义 Antd 风格的 Props
interface DatePickerRangeProps {
  className?: string
  // 核心：接收数组 [开始时间, 结束时间]
  value?: [Date | undefined, Date | undefined]
  // 核心：回调数组
  onChange?: (date: [Date | undefined, Date | undefined]) => void
  placeholder?: string
}

export function DatePickerRange({ className, value, onChange, placeholder = '请选择日期范围' }: DatePickerRangeProps) {
  const [open, setOpen] = React.useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  // --- 状态转换逻辑 ---
  // 将外部的数组 props 转换为 react-day-picker 需要的 range 对象
  const dateRange: DateRange | undefined = React.useMemo(() => {
    if (!value) return undefined
    return { from: value[0], to: value[1] }
  }, [value])

  // 处理日历选择事件，转回数组格式给父组件
  const handleSelect = (range: DateRange | undefined) => {
    if (onChange) {
      onChange([range?.from, range?.to])
    }
  }

  // --- 格式化显示文本 ---
  const displayText = React.useMemo(() => {
    const [start, end] = value || []
    if (!start) return <span className="text-muted-foreground">{placeholder}</span>

    if (start && !end) {
      return (
        <>
          {format(start, 'yyyy-MM-dd', { locale: zhCN })}
          {' - '}
          <span className="text-muted-foreground">选择结束日期</span>
        </>
      )
    }

    return (
      <>
        {format(start, 'yyyy-MM-dd', { locale: zhCN })}
        {' - '}
        {end ? format(end, 'yyyy-MM-dd', { locale: zhCN }) : ''}
      </>
    )
  }, [value, placeholder])

  // --- 移动端临时状态管理 ---
  // 移动端需要在 Drawer 内部暂存状态，点击“确认”才提交，防止滑动时频繁触发 onChange
  const [tempMobileRange, setTempMobileRange] = React.useState<DateRange | undefined>(dateRange)

  // 每次打开抽屉，重置临时状态为当前真实状态
  React.useEffect(() => {
    if (open && !isDesktop) {
      setTempMobileRange(dateRange)
    }
  }, [open, isDesktop, dateRange])

  // 渲染触发器按钮 (PC/Mobile 通用)
  const TriggerButton = (
    <Button
      id="date"
      variant={'outline'}
      className={cn(
        'w-full justify-start text-left font-normal', // w-full 适配移动端宽度
        !value && 'text-muted-foreground',
        className
      )}
    >
      <CalendarIcon className="mr-2 h-4 w-4" />
      {displayText}
    </Button>
  )

  // --- 场景 1: PC 端 (Popover) ---
  if (isDesktop) {
    return (
      <div className={cn('grid gap-2', className)}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{TriggerButton}</PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={handleSelect} // PC端选择即生效
              numberOfMonths={2} // PC端显示两个月，体验更好
              locale={zhCN} // 设置中文
            />
          </PopoverContent>
        </Popover>
      </div>
    )
  }

  // --- 场景 2: 移动端 (Drawer) ---
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{TriggerButton}</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle>选择日期范围</DrawerTitle>
        </DrawerHeader>

        <div className="px-4">
          <Calendar
            mode="range"
            defaultMonth={tempMobileRange?.from}
            selected={tempMobileRange}
            onSelect={setTempMobileRange} // 移动端只更新临时状态
            numberOfMonths={1} // 移动端屏幕窄，只显示一个月
            locale={zhCN}
            className="w-full flex justify-center" // 居中显示
          />
        </div>

        <DrawerFooter className="pt-2">
          <Button
            onClick={() => {
              // 点击确认时，将临时状态同步给父组件
              if (onChange) {
                onChange([tempMobileRange?.from, tempMobileRange?.to])
              }
              setOpen(false)
            }}
          >
            确认
          </Button>
          <DrawerClose asChild>
            <Button variant="outline">取消</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
