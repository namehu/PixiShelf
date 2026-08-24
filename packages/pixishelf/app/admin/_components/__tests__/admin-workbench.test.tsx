import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AdminStatusBadge, getAdminStatusTone } from '../admin-status-badge'
import { AdminMetric, AdminSection, AdminSectionHeader, AdminTableFrame, AdminWorkbench } from '../admin-workbench'

afterEach(cleanup)

describe('admin workbench primitives', () => {
  it('keeps one page heading and exposes compact section and table structure', () => {
    render(
      <AdminWorkbench title="作品管理" description="管理图库内容" actions={<button type="button">新增作品</button>}>
        <AdminMetric label="作品" value="128" description="当前收录" />
        <AdminSection>
          <AdminSectionHeader title="作品列表" description="可筛选和复制表格值" />
          <AdminTableFrame>
            <table>
              <tbody>
                <tr>
                  <td>ext-123</td>
                </tr>
              </tbody>
            </table>
          </AdminTableFrame>
        </AdminSection>
      </AdminWorkbench>
    )

    expect(screen.getByRole('heading', { level: 1, name: '作品管理' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: '作品列表' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '新增作品' })).toBeTruthy()
    expect(screen.getByText('ext-123').closest('[data-slot="admin-table-frame"]')?.className).toContain('overflow-x-auto')
    expect(screen.getByText('128').className).not.toContain('select-none')
  })
})

describe('admin status badge', () => {
  it.each([
    ['RUNNING', 'info'],
    ['COMPLETED', 'success'],
    ['PENDING', 'warning'],
    ['PAUSING', 'warning'],
    ['RETRY_WAIT', 'warning'],
    ['CANCELLING', 'warning'],
    ['FAILED', 'destructive'],
    ['CANCELLED', 'muted'],
    ['CUSTOM', 'default']
  ] as const)('maps %s to the %s semantic tone', (status, tone) => {
    expect(getAdminStatusTone(status)).toBe(tone)
  })

  it('allows a localized label without losing the machine-readable status', () => {
    render(<AdminStatusBadge status="RUNNING">运行中</AdminStatusBadge>)

    const badge = screen.getByText('运行中')
    expect(badge.getAttribute('data-status')).toBe('RUNNING')
    expect(badge.getAttribute('data-variant')).toBe('info')
  })
})
