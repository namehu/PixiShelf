import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProTable, type ActionType, type ProColumnDef } from '../index'

interface RowData {
  id: number
  externalId: string
}

const columns: ProColumnDef<RowData>[] = [
  {
    accessorKey: 'externalId',
    header: '作品 ID',
    copyable: true,
    copyValue: (row) => `__ext-${row.externalId}`
  }
]

describe('ProTable expandable rows', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    })
  })

  afterEach(cleanup)

  it('renders expanded content only after the expand control is clicked', () => {
    render(
      <ProTable
        columns={columns}
        dataSource={[{ id: 1, externalId: '123' }]}
        renderExpandedRow={(row) => <div>preview-{row.externalId}</div>}
      />
    )

    expect(screen.queryByText('preview-123')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开预览' }))
    expect(screen.getByText('preview-123')).toBeTruthy()
  })

  it('uses the custom copy value without changing the displayed cell value', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<ProTable columns={columns} dataSource={[{ id: 1, externalId: '123' }]} />)

    expect(screen.getByText('123')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '复制 __ext-123' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('__ext-123'))
  })

  it('preserves expanded rows when the parent reloads request data through the action ref', async () => {
    const actionRef: { current: ActionType | undefined } = { current: undefined }
    const request = vi.fn().mockResolvedValue({ data: [{ id: 1, externalId: '123' }], total: 1, success: true })

    render(
      <ProTable
        actionRef={actionRef}
        columns={columns}
        request={request}
        renderExpandedRow={(row) => <div>preview-{row.externalId}</div>}
      />
    )

    expect(await screen.findByText('123')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '展开预览' }))
    expect(screen.getByText('preview-123')).toBeTruthy()

    await act(async () => {
      await actionRef.current?.reload()
    })

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(screen.getByText('preview-123')).toBeTruthy()
    expect(screen.getByRole('button', { name: '收起预览' })).toBeTruthy()
  })

  it('renders an actionable request error and retries without hiding the table contract', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: [{ id: 1, externalId: '456' }], total: 1, success: true })

    render(<ProTable columns={columns} request={request} />)

    expect((await screen.findByRole('alert')).textContent).toContain('表格加载失败')
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('456')).toBeTruthy()
  })
})
