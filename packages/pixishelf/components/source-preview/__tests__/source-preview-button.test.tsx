import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourcePreviewButton } from '../source-preview-button'

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), push: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({ archivePreview: { open: { mutationOptions: (options: object) => options } } })
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: { onSuccess: (result: unknown) => void }) => ({
    isPending: false,
    mutate: (variables: unknown) => {
      mocks.mutate(variables)
      options.onSuccess({ previewId: 'opaque/id', title: 'Gallery', total: 0, page: 0, items: [], nextPage: null })
    }
  })
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SourcePreviewButton', () => {
  it('opens from a typed source and navigates with only the opaque preview id', () => {
    render(<SourcePreviewButton source={{ kind: 'task', taskId: 'task-1' }} />)
    fireEvent.click(screen.getByRole('button', { name: '原站预览' }))

    expect(mocks.mutate).toHaveBeenCalledWith({ source: { kind: 'task', taskId: 'task-1' } })
    expect(mocks.push).toHaveBeenCalledWith('/source-preview?preview=opaque%2Fid')
  })
})
