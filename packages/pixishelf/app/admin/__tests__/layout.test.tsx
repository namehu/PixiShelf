import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdminLayout from '../layout'
import type { ReactNode } from 'react'

vi.mock('../_components/admin-nav', () => ({ AdminNav: () => <nav>管理菜单</nav> }))
vi.mock('../_components/background-job-event-provider', () => ({
  BackgroundJobEventProvider: ({ children }: { children: ReactNode }) => children
}))

describe('AdminLayout', () => {
  afterEach(cleanup)

  it('lets feature pages use the full available content width', () => {
    const { container } = render(
      <AdminLayout>
        <div>页面内容</div>
      </AdminLayout>
    )
    const contentRow = container.querySelector('aside')?.parentElement

    expect(contentRow?.className).toContain('w-full')
    expect(contentRow?.className).not.toContain('max-w-7xl')
  })
})
