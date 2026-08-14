import * as React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { endOfDay, startOfDay } from 'date-fns'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProDatePicker, type DatePickerValue } from '../index'

const rangeStart = new Date(2026, 0, 10)
const previousRangeStart = new Date(2026, 0, 1)
const previousRangeEnd = new Date(2026, 0, 5)
const restartRangeStart = new Date(2026, 0, 20)
const restartRangeEnd = new Date(2026, 0, 25)

vi.mock('@/components/ui/calendar', () => ({
  Calendar: (props: any) => (
    <div data-testid="calendar">
      <button type="button" onClick={() => props.onSelect?.({ from: rangeStart, to: rangeStart }, rangeStart)}>
        select same-day range
      </button>
      <button
        type="button"
        onClick={() => props.onSelect?.({ from: previousRangeStart, to: restartRangeStart }, restartRangeStart)}
      >
        restart range
      </button>
      <button
        type="button"
        onClick={() => props.onSelect?.({ from: restartRangeStart, to: restartRangeEnd }, restartRangeEnd)}
      >
        select restart end
      </button>
    </div>
  )
}))

vi.mock('@/components/ui/popover', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const PopoverContext = React.createContext<{
    open: boolean
    setOpen: (open: boolean) => void
  }>({
    open: false,
    setOpen: () => {}
  })

  return {
    Popover: ({ open, onOpenChange, children }: any) => (
      <PopoverContext.Provider value={{ open, setOpen: onOpenChange }}>
        <div data-testid="popover" data-open={String(open)}>
          {children}
        </div>
      </PopoverContext.Provider>
    ),
    PopoverTrigger: ({ asChild, children }: any) => {
      const { open, setOpen } = React.useContext(PopoverContext)
      const child = React.Children.only(children)

      if (asChild && React.isValidElement<any>(child)) {
        return React.cloneElement(child, {
          onClick: (event: React.MouseEvent) => {
            child.props.onClick?.(event)
            setOpen(!open)
          }
        })
      }

      return (
        <button type="button" onClick={() => setOpen(!open)}>
          {children}
        </button>
      )
    },
    PopoverContent: ({ children }: any) => {
      const { open } = React.useContext(PopoverContext)
      return open ? <div data-testid="popover-content">{children}</div> : null
    }
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ProDatePicker range mode', () => {
  it('keeps the popover open after selecting the start date first', () => {
    const onChange = vi.fn()

    function ControlledRangePicker() {
      const [value, setValue] = React.useState<DatePickerValue>([undefined, undefined])

      return (
        <ProDatePicker
          mode="range"
          value={value}
          onChange={(nextValue) => {
            onChange(nextValue)
            setValue(nextValue ?? [undefined, undefined])
          }}
          placeholder="选择日期范围"
        />
      )
    }

    render(<ControlledRangePicker />)

    fireEvent.click(screen.getByRole('button', { name: /选择日期范围/ }))
    fireEvent.click(screen.getByRole('button', { name: 'select same-day range' }))

    expect(onChange).toHaveBeenLastCalledWith([startOfDay(rangeStart), undefined])
    expect(screen.getByTestId('popover-content')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'select same-day range' }))

    expect(onChange).toHaveBeenLastCalledWith([startOfDay(rangeStart), endOfDay(rangeStart)])
    expect(screen.queryByTestId('popover-content')).toBeNull()
  })

  it('starts a new pending range when selecting again after a complete range', () => {
    const onChange = vi.fn()

    function ControlledRangePicker() {
      const [value, setValue] = React.useState<DatePickerValue>([
        startOfDay(previousRangeStart),
        endOfDay(previousRangeEnd)
      ])

      return (
        <ProDatePicker
          mode="range"
          value={value}
          onChange={(nextValue) => {
            onChange(nextValue)
            setValue(nextValue ?? [undefined, undefined])
          }}
          placeholder="选择日期范围"
        />
      )
    }

    render(<ControlledRangePicker />)

    fireEvent.click(screen.getByRole('button', { name: /2026-01-01 - 2026-01-05/ }))
    fireEvent.click(screen.getByRole('button', { name: 'restart range' }))

    expect(onChange).toHaveBeenLastCalledWith([startOfDay(restartRangeStart), undefined])
    expect(screen.getByTestId('popover-content')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'select restart end' }))

    expect(onChange).toHaveBeenLastCalledWith([startOfDay(restartRangeStart), endOfDay(restartRangeEnd)])
    expect(screen.queryByTestId('popover-content')).toBeNull()
  })

  it('renders the clear action as a named sibling button', () => {
    const onChange = vi.fn()

    render(<ProDatePicker aria-label="发布日期" value={new Date(2026, 0, 10)} onChange={onChange} clearable />)

    const trigger = screen.getByRole('button', { name: '发布日期' })
    const clear = screen.getByRole('button', { name: '清除日期' })

    expect(trigger.contains(clear)).toBe(false)
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledWith(undefined)
  })
})
