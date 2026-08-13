import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => false }))
vi.mock('@/components/user-setting', () => ({ usePreferredTags: () => ['夜景', 'city'] }))
vi.mock('../_components/infinite-artwork-grid', () => ({ default: () => <div>推荐作品列表</div> }))
vi.mock('@/components/shared/multiple-selector', () => ({ default: () => null }))
vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
  DrawerContent: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  DrawerDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DrawerFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children: ReactNode }) => <h3>{children}</h3>
}))

import RecommendedArtworkSection from '../_components/recommended-artwork-section'

describe('recommended artwork preference drawer', () => {
  it('groups mobile preference checkboxes with shadcn Field semantics', () => {
    render(<RecommendedArtworkSection initialData={{ items: [], total: 0, page: 1, pageSize: 20 } as never} />)

    fireEvent.click(screen.getByRole('button', { name: '偏好筛选' }))

    const dialog = screen.getByRole('dialog')
    const fieldset = dialog.querySelector('fieldset')
    expect(fieldset).toBeTruthy()
    expect(within(fieldset as HTMLElement).getByText('选择偏好标签')).toBeTruthy()
    expect(within(fieldset as HTMLElement).getByRole('checkbox', { name: '夜景' })).toBeTruthy()
    expect(within(fieldset as HTMLElement).getByRole('checkbox', { name: 'city' })).toBeTruthy()
  })
})
