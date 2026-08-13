import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PageContainer } from '../page-container'
import { PageHeader } from '../page-header'
import { PageState } from '../page-state'
import { SectionHeader } from '../section-header'

afterEach(cleanup)

describe('design foundation layout primitives', () => {
  it.each([
    ['gallery', 'max-w-gallery'],
    ['standard', 'max-w-standard'],
    ['reading', 'max-w-reading'],
    ['workbench', 'max-w-workbench']
  ] as const)('maps the %s container to its shared width token', (size, expectedClass) => {
    render(<PageContainer size={size}>内容</PageContainer>)

    expect(screen.getByText('内容').className).toContain(expectedClass)
  })

  it('renders a page title, metadata, and actions with a single heading', () => {
    render(
      <PageHeader
        eyebrow="Archive 001"
        title="作品档案"
        description="当前收藏中的作品"
        metadata="128 items"
        actions={<button type="button">筛选</button>}
      />
    )

    expect(screen.getByRole('heading', { level: 1, name: '作品档案' })).toBeTruthy()
    expect(screen.getByText('Archive 001')).toBeTruthy()
    expect(screen.getByText('128 items')).toBeTruthy()
    expect(screen.getByRole('button', { name: '筛选' })).toBeTruthy()
  })

  it('supports a lower section heading without changing the action semantics', () => {
    render(<SectionHeader headingLevel="h3" title="最近艺术家" actions={<a href="/artists">查看全部</a>} />)

    expect(screen.getByRole('heading', { level: 3, name: '最近艺术家' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看全部' }).getAttribute('href')).toBe('/artists')
  })
})

describe('PageState', () => {
  it('exposes a named loading status', () => {
    render(<PageState variant="loading" headingLevel="h1" title="加载档案" description="正在读取作品" />)

    expect(screen.getByRole('status', { name: '加载档案' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: '加载档案' })).toBeTruthy()
    expect(screen.getByText('正在读取作品')).toBeTruthy()
  })

  it('uses an alert for an error and keeps the recovery action native', () => {
    render(
      <PageState
        variant="error"
        title="加载失败"
        description="无法连接档案服务"
        action={<button type="button">重试</button>}
      />
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: '加载失败' })).toBeTruthy()
    expect(screen.getByText('无法连接档案服务')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('renders an empty state without blocking text selection', () => {
    render(<PageState variant="empty" title="暂无作品" description="导入作品后会显示在这里" />)

    const description = screen.getByText('导入作品后会显示在这里')
    expect(description.closest('[data-slot="empty"]')?.className).not.toContain('select-none')
  })
})

function hexToLuminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))

  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

function contrastRatio(first: string, second: string) {
  const firstLuminance = hexToLuminance(first)
  const secondLuminance = hexToLuminance(second)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)

  return (lighter + 0.05) / (darker + 0.05)
}

describe('light theme contrast pairs', () => {
  const css = readFileSync(path.resolve(process.cwd(), 'app/globals.css'), 'utf8')

  function token(name: string) {
    const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
    if (!value) throw new Error(`Missing hex token: ${name}`)
    return value
  }

  it.each([
    ['foreground', 'background'],
    ['muted-foreground', 'background'],
    ['muted-foreground', 'muted'],
    ['primary', 'background'],
    ['primary-foreground', 'primary'],
    ['secondary-foreground', 'secondary'],
    ['accent-foreground', 'accent'],
    ['destructive-foreground', 'destructive'],
    ['success-foreground', 'success'],
    ['warning-foreground', 'warning']
  ])('keeps %s readable on %s', (foreground, background) => {
    expect(contrastRatio(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps touch feedback fast without disabling page zoom', () => {
    expect(css).toContain('-webkit-tap-highlight-color:')
    expect(css).toContain('touch-action: manipulation')
    expect(css).not.toContain('user-scalable=no')
  })
})
