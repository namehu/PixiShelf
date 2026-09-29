import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn(), resolve: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archiveUploader: {
      createSource: { mutationOptions: () => ({ kind: 'create' }) },
      resolveIdentity: { mutationOptions: () => ({ kind: 'resolve' }) }
    }
  })
}))
vi.mock('@tanstack/react-query', () => ({
  useMutation: ({ kind }: { kind: 'create' | 'resolve' }) => ({ isPending: false, mutateAsync: mocks[kind] })
}))
import { ArchiveUploaderCreateSourceDialog } from '../archive-uploader-create-source-dialog'
beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('uploader creation by name', () => {
  it.each([true, false])('saves with one click when name resolution succeeds=%s', async (matched) => {
    mocks.resolve.mockResolvedValue(
      matched
        ? {
            outcome: 'MATCHED',
            uploaderUid: '123',
            uploaderName: 'Alice',
            evidenceExternalId: '1',
            existingSource: null
          }
        : { outcome: 'UNRESOLVED', reason: 'UNAVAILABLE', message: '按名称搜索' }
    )
    render(<ArchiveUploaderCreateSourceDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.queryByLabelText('身份类型')).toBeNull()
    fireEvent.change(screen.getByLabelText('上传者名称'), { target: { value: 'Alice' } })
    fireEvent.click(screen.getByRole('button', { name: '保存来源' }))
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        identityKind: 'NAME',
        identityValue: 'Alice',
        ...(matched ? { uploaderUid: '123', displayName: 'Alice' } : {})
      })
    )
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
  })
})
