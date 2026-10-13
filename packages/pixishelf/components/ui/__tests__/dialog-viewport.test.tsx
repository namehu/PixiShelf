import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../dialog'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('dialog visible viewport fitting', () => {
  it('keeps a form above the mobile keyboard and releases viewport listeners', () => {
    const viewport = Object.assign(new EventTarget(), { height: 700, offsetTop: 0 })
    const removeListener = vi.spyOn(viewport, 'removeEventListener')
    vi.stubGlobal('visualViewport', viewport)
    const view = render(
      <Dialog open>
        <DialogContent fitViewport>
          <DialogTitle>来源表单</DialogTitle>
          <DialogDescription>测试表单</DialogDescription>
        </DialogContent>
      </Dialog>
    )
    const dialog = screen.getByRole('dialog', { name: '来源表单' })
    expect(dialog.style.top).toBe('350px')
    expect(dialog.style.maxHeight).toBe('668px')
    act(() => {
      viewport.height = 360
      viewport.offsetTop = 120
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(dialog.style.top).toBe('300px')
    expect(dialog.style.maxHeight).toBe('328px')
    act(() => {
      viewport.offsetTop = 150
      viewport.dispatchEvent(new Event('scroll'))
    })
    expect(dialog.style.top).toBe('330px')
    view.unmount()
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function))
  })
})
