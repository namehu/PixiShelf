import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import MultipleSelector from '../multiple-selector'

const options = [
  { value: '3736', label: 'Mooffe' },
  { value: '3909', label: 'Mooffe' },
  { value: '2122', label: '莫芙' }
]
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (scrollIntoViewDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor)
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
})

describe('MultipleSelector', () => {
  it('keeps same-name options independently active and selects the keyboard target by ID', async () => {
    const onChange = vi.fn()
    render(<MultipleSelector defaultOptions={options} onChange={onChange} showOptionValue />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Mooffe(3736)' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByRole('option', { name: 'Mooffe(3909)' }).getAttribute('aria-selected')).toBe('false')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Mooffe(3736)' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('option', { name: 'Mooffe(3909)' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })
    expect(onChange).toHaveBeenLastCalledWith([options[1]])
    expect(screen.queryByRole('option', { name: 'Mooffe(3909)' })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: 'Mooffe(3736)' }))
    expect(onChange).toHaveBeenLastCalledWith([options[1], options[0]])
  })

  it.each([false, true])('still filters by label with creatable=%s', async (creatable) => {
    render(<MultipleSelector defaultOptions={options} creatable={creatable} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Mooffe' } })
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Mooffe' })).toHaveLength(2))
    expect(screen.queryByRole('option', { name: '莫芙' })).toBeNull()
  })

  it('shows IDs in asynchronous results and preserves the original option payload', async () => {
    const onChange = vi.fn()
    render(<MultipleSelector onSearch={async () => options} triggerSearchOnFocus showOptionValue onChange={onChange} />)
    fireEvent.focus(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Mooffe(3909)' }))
    expect(onChange).toHaveBeenLastCalledWith([options[1]])
    expect(screen.getByText('Mooffe(3909)')).toBeTruthy()
  })
})
