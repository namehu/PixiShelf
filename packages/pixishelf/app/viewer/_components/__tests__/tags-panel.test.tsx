import { render, screen } from '@testing-library/react'
import { cloneElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button'

vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerTrigger: ({ children }: { children: ReactElement }) =>
    cloneElement(children, { 'data-drawer-trigger': 'true' } as object),
  DrawerContent: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  DrawerDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DrawerFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DrawerClose: ({ children }: { children: ReactElement }) =>
    cloneElement(children, { 'data-drawer-close': 'true' } as object)
}))

import TagsPanel from '../tags-panel'

describe('viewer tags panel', () => {
  it('uses a drawer trigger and closeable tag links', () => {
    render(
      <TagsPanel
        tags={[
          { id: 5, name: '夜景', name_zh: null },
          { id: 8, name: 'city', name_zh: '城市' }
        ]}
        trigger={<Button>查看全部标签</Button>}
      />
    )

    expect(screen.getByRole('button', { name: '查看全部标签' }).getAttribute('data-drawer-trigger')).toBe('true')
    expect(screen.getByRole('heading', { name: '所有标签' })).toBeTruthy()
    expect(screen.getByText('查看并打开当前作品的完整标签索引。')).toBeTruthy()

    const firstTag = screen.getByRole('link', { name: '#夜景' })
    const translatedTag = screen.getByRole('link', { name: /#city.*城市/ })
    expect(firstTag.getAttribute('href')).toBe('/tags/5')
    expect(translatedTag.getAttribute('href')).toBe('/tags/8')
    expect(firstTag.getAttribute('data-drawer-close')).toBe('true')
    expect(screen.getByRole('button', { name: '关闭' }).getAttribute('data-drawer-close')).toBe('true')
  })
})
