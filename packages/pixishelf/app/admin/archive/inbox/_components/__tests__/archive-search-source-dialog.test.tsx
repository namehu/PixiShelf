import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn(), rename: vi.fn(), resolve: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archiveUploader: { resolveIdentity: { mutationOptions: () => ({ kind: 'resolve' }) } },
    archiveSearch: {
      createSource: { mutationOptions: (options: object) => ({ kind: 'create', ...options }) },
      renameSource: { mutationOptions: (options: object) => ({ kind: 'rename', ...options }) }
    }
  })
}))
vi.mock('@tanstack/react-query', () => ({
  useMutation: ({ kind }: { kind: 'create' | 'rename' | 'resolve' }) => ({
    isPending: false,
    mutate: mocks[kind],
    mutateAsync: mocks[kind]
  })
}))
import { ArchiveSearchSourceDialog } from '../archive-search-source-dialog'
const source = {
  id: 'one',
  displayName: 'Name',
  titleQuery: { keyword: 'Abc', matchMode: 'STARTS_WITH' as const, uploaderUid: '123' }
}
const callbacks = { onClose: vi.fn(), onSaved: vi.fn() }
afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe('title source editor', () => {
  it('copies a known UID whose display name is not valid remote name syntax', async () => {
    const named = { ...source, titleQuery: { ...source.titleQuery, uploaderDisplayName: 'Alice "Art"' } }
    render(<ArchiveSearchSourceDialog state={{ mode: 'COPY', source: named }} {...callbacks} />)
    fireEvent.click(screen.getByRole('button', { name: '保存搜索来源' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ displayName: 'Name', ...named.titleQuery }))
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
  it.each([true, false])('preserves the uploader constraint when name resolution succeeds=%s', async (matched) => {
    mocks.resolve.mockResolvedValue(
      matched
        ? {
            outcome: 'MATCHED',
            uploaderUid: '456',
            uploaderName: 'Alice',
            existingSource: null,
            evidenceExternalId: '1'
          }
        : { outcome: 'UNRESOLVED', reason: 'NOT_FOUND', message: '按名称搜索' }
    )
    render(<ArchiveSearchSourceDialog state={{ mode: 'CREATE' }} {...callbacks} />)
    fireEvent.change(screen.getByLabelText('来源名称'), { target: { value: 'Collection' } })
    fireEvent.change(screen.getByLabelText('标题关键词'), { target: { value: 'Match' } })
    fireEvent.change(screen.getByLabelText('限定上传者（可选）'), { target: { value: 'Alice' } })
    fireEvent.click(screen.getByRole('button', { name: '保存搜索来源' }))
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        displayName: 'Collection',
        keyword: 'Match',
        matchMode: 'CONTAINS',
        ...(matched
          ? { uploaderUid: '456', uploaderDisplayName: 'Alice' }
          : { uploaderUid: null, uploaderName: 'Alice' })
      })
    )
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
  })
  it('defaults to contains, canonicalizes the optional UID and saves literal text', async () => {
    render(<ArchiveSearchSourceDialog state={{ mode: 'CREATE' }} {...callbacks} />)
    expect(screen.getByRole('radio', { name: '包含' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.change(screen.getByLabelText('来源名称'), { target: { value: 'Example' } })
    fireEvent.change(screen.getByLabelText('标题关键词'), { target: { value: ' [Abc] ' } })
    fireEvent.click(screen.getByRole('button', { name: '高级选项' }))
    fireEvent.click(screen.getByRole('button', { name: '手动填写 UID' }))
    fireEvent.change(screen.getByLabelText('上传者 UID'), { target: { value: '000123' } })
    fireEvent.click(screen.getByRole('button', { name: '保存搜索来源' }))
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        displayName: 'Example',
        keyword: '[Abc]',
        matchMode: 'CONTAINS',
        uploaderUid: '123'
      })
    )
  })

  it('rejects unsafe syntax before saving', () => {
    render(<ArchiveSearchSourceDialog state={{ mode: 'COPY', source }} {...callbacks} />)
    fireEvent.change(screen.getByLabelText('标题关键词'), { target: { value: 'abc*' } })
    fireEvent.click(screen.getByRole('button', { name: '保存搜索来源' }))
    expect(screen.getByRole('alert').textContent).toContain('星号')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('renames without allowing changes to frozen search conditions', () => {
    render(<ArchiveSearchSourceDialog state={{ mode: 'RENAME', source }} {...callbacks} />)
    expect((screen.getByLabelText('标题关键词') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('上传者 UID') as HTMLInputElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('来源名称'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
    expect(mocks.rename).toHaveBeenCalledWith({ sourceId: 'one', displayName: 'Renamed' })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('copies conditions into a new source instead of mutating the original source', async () => {
    render(<ArchiveSearchSourceDialog state={{ mode: 'COPY', source }} {...callbacks} />)
    fireEvent.click(screen.getByRole('radio', { name: '结尾是' }))
    fireEvent.click(screen.getByRole('button', { name: '保存搜索来源' }))
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        displayName: 'Name',
        keyword: 'Abc',
        matchMode: 'ENDS_WITH',
        uploaderUid: '123'
      })
    )
    expect(mocks.rename).not.toHaveBeenCalled()
  })
})
