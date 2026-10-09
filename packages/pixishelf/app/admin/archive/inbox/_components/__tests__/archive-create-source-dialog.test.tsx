import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveCreateSourceDialog } from '../archive-create-source-dialog'

const mocks = vi.hoisted(() => ({ uploader: vi.fn(), keyword: vi.fn(), resolve: vi.fn(), rename: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archiveUploader: {
      createSource: { mutationOptions: (options: object) => ({ kind: 'uploader', ...options }) },
      resolveIdentity: { mutationOptions: (options: object) => ({ kind: 'resolve', ...options }) }
    },
    archiveSearch: {
      createSource: { mutationOptions: (options: object) => ({ kind: 'keyword', ...options }) },
      renameSource: { mutationOptions: (options: object) => ({ kind: 'rename', ...options }) }
    }
  })
}))
vi.mock('@tanstack/react-query', () => ({
  useMutation: ({
    kind,
    onSuccess,
    onError
  }: {
    kind: keyof typeof mocks
    onSuccess?: (data: unknown) => Promise<void>
    onError?: (error: unknown) => void
  }) => ({
    isPending: false,
    mutateAsync: async (input: unknown) => {
      try {
        const result = await mocks[kind](input)
        await onSuccess?.(result)
        return result
      } catch (error) {
        onError?.(error)
        throw error
      }
    }
  })
}))
vi.mock('@/components/creators/creator-picker', () => ({
  CreatorPicker: ({
    value,
    onChange
  }: {
    value: { id: number; name: string }[]
    onChange: (value: { id: number; name: string }[]) => void
  }) => (
    <div>
      <span>{value.map(({ name }) => name).join(',')}</span>
      <button type="button" onClick={() => onChange([{ id: 7, name: 'Artist' }])}>
        选择艺术家
      </button>
    </div>
  )
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolve.mockResolvedValue({
    outcome: 'MATCHED',
    uploaderUid: '123',
    uploaderName: 'Alice',
    evidenceExternalId: '1',
    existingSource: null
  })
  mocks.uploader.mockResolvedValue({ id: 'uploader', status: 'ACTIVE', uploaderUid: '123', reused: false })
  mocks.keyword.mockResolvedValue({ id: 'keyword', status: 'ACTIVE', titleQuery: {} })
})
afterEach(cleanup)
const callbacks = { onOpenChange: vi.fn(), onCreated: vi.fn(async () => {}) }
const panel = () => within(screen.getByRole('tabpanel'))
const switchTab = (name: string) =>
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false })

describe('unified source creation', () => {
  it('creates an uploader together with selected artists', async () => {
    render(<ArchiveCreateSourceDialog open {...callbacks} />)
    fireEvent.change(panel().getByLabelText('上传者名称'), { target: { value: 'Alice' } })
    fireEvent.click(panel().getByRole('button', { name: '选择艺术家' }))
    fireEvent.click(panel().getByRole('button', { name: '保存来源' }))
    await waitFor(() =>
      expect(mocks.uploader).toHaveBeenCalledWith({
        identityKind: 'NAME',
        identityValue: 'Alice',
        uploaderUid: '123',
        displayName: 'Alice',
        artistIds: [7]
      })
    )
    expect(callbacks.onCreated).toHaveBeenCalledWith('uploader')
  })
  it('keeps drafts and shared artists across tabs and submits keyword bindings', async () => {
    render(<ArchiveCreateSourceDialog open {...callbacks} />)
    fireEvent.change(panel().getByLabelText('上传者名称'), { target: { value: 'Alice' } })
    fireEvent.click(panel().getByRole('button', { name: '选择艺术家' }))
    switchTab('标题关键词')
    expect(panel().getByText('Artist')).toBeTruthy()
    fireEvent.change(panel().getByLabelText('来源名称'), { target: { value: 'Favorites' } })
    fireEvent.change(panel().getByLabelText('标题关键词'), { target: { value: 'Example' } })
    switchTab('上传者')
    expect((panel().getByLabelText('上传者名称') as HTMLInputElement).value).toBe('Alice')
    switchTab('标题关键词')
    expect((panel().getByLabelText('标题关键词') as HTMLInputElement).value).toBe('Example')
    fireEvent.click(panel().getByRole('button', { name: '保存搜索来源' }))
    await waitFor(() =>
      expect(mocks.keyword).toHaveBeenCalledWith({
        displayName: 'Favorites',
        keyword: 'Example',
        matchMode: 'CONTAINS',
        uploaderUid: null,
        artistIds: [7]
      })
    )
    expect(mocks.uploader).not.toHaveBeenCalled()
  })
  it('blocks switching while saving and keeps input after failure', async () => {
    let reject!: (reason: Error) => void
    mocks.uploader.mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail
        })
    )
    render(<ArchiveCreateSourceDialog open {...callbacks} />)
    fireEvent.change(panel().getByLabelText('上传者名称'), { target: { value: 'Alice' } })
    fireEvent.click(panel().getByRole('button', { name: '保存来源' }))
    await waitFor(() => expect(mocks.uploader).toHaveBeenCalled())
    expect(screen.getByRole('tab', { name: '标题关键词' }).hasAttribute('disabled')).toBe(true)
    reject(new Error('Save failed'))
    await waitFor(() => expect(screen.getByRole('tab', { name: '标题关键词' }).hasAttribute('disabled')).toBe(false))
    expect((panel().getByLabelText('上传者名称') as HTMLInputElement).value).toBe('Alice')
    expect(callbacks.onOpenChange).not.toHaveBeenCalled()
  })
  it('clears drafts and artists when reopened', async () => {
    const view = render(<ArchiveCreateSourceDialog open {...callbacks} />)
    fireEvent.change(panel().getByLabelText('上传者名称'), { target: { value: 'Alice' } })
    fireEvent.click(panel().getByRole('button', { name: '选择艺术家' }))
    view.rerender(<ArchiveCreateSourceDialog open={false} {...callbacks} />)
    view.rerender(<ArchiveCreateSourceDialog open {...callbacks} />)
    expect((panel().getByLabelText('上传者名称') as HTMLInputElement).value).toBe('')
    expect(panel().queryByText('Artist')).toBeNull()
  })
})
