import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { privacyStore } from '@/store/privacy-store'
import { privacySession } from '@/lib/privacy-session'
import { PrivacyControl } from '../privacy-control'

beforeEach(() => {
  localStorage.clear()
  privacyStore.setState({ status: 'pending', visit: null, remembered: null, storageError: false })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('privacy controls', () => {
  it('toggles directly in both directions without an additional confirmation', () => {
    privacySession.choose('privacy')
    render(<PrivacyControl />)
    fireEvent.click(screen.getByRole('button', { name: '关闭隐私模式' }))
    expect(privacyStore.getState().status).toBe('direct')
    fireEvent.click(screen.getByRole('button', { name: '开启隐私模式' }))
    expect(privacyStore.getState().status).toBe('privacy')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('provides separate mobile actions for toggling and memory settings', () => {
    privacySession.choose('direct')
    render(<PrivacyControl mobile />)
    fireEvent.click(screen.getByRole('button', { name: '开启隐私模式' }))
    expect(privacyStore.getState().status).toBe('privacy')
    fireEvent.click(screen.getByRole('button', { name: '隐私记忆设置' }))
    expect(screen.getByRole('button', { name: '记住当前选择 30 天' })).toBeTruthy()
  })

  it('remembers and cancels without changing the current mode', () => {
    privacySession.choose('direct')
    render(<PrivacyControl />)
    fireEvent.click(screen.getByRole('button', { name: '隐私记忆设置' }))
    fireEvent.click(screen.getByRole('button', { name: '记住当前选择 30 天' }))
    expect(privacyStore.getState().remembered?.mode).toBe('direct')
    fireEvent.click(screen.getByRole('button', { name: '隐私记忆设置' }))
    expect(screen.getByText(/切换模式不会延长/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消记忆，下次访问重新询问' }))
    expect(privacyStore.getState().remembered).toBeNull()
    expect(privacyStore.getState().status).toBe('direct')
  })

  it('portals the menu inside a fullscreen preview container', () => {
    privacySession.choose('privacy')
    const overlay = document.createElement('div')
    document.body.append(overlay)
    render(<PrivacyControl compact portalContainer={overlay} />)
    fireEvent.click(screen.getByRole('button', { name: '隐私记忆设置' }))
    expect(overlay.querySelector('[data-slot="popover-content"]')).not.toBeNull()
    overlay.remove()
  })

  it('disables mode changes while the initial choice is unresolved', () => {
    render(<PrivacyControl />)
    expect(screen.getByRole('button', { name: '开启隐私模式' })).toHaveProperty('disabled', true)
  })
})
