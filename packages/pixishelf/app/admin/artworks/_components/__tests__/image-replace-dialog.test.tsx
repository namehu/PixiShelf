import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageReplaceDialog } from '../image-replace-dialog'

const mocks = vi.hoisted(() => ({
  resetQueue: vi.fn(),
  uploadSingleFile: vi.fn()
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div data-testid="dialog-root">{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('ahooks', () => ({
  useThrottleFn: (fn: (...args: any[]) => unknown) => ({ run: fn })
}))

vi.mock('../../_hooks/use-drag-images', () => ({
  useDragImages: () => ({ dragHandlers: {} })
}))

vi.mock('../../_hooks/use-chunk-upload', () => ({
  useChunkUpload: () => ({ uploadSingleFile: mocks.uploadSingleFile })
}))

vi.mock('../../_store/drag-drop-store', () => ({
  useDragDropStore: (selector: (state: any) => unknown) =>
    selector({
      fileQueue: [],
      resetQueue: mocks.resetQueue
    })
}))

vi.mock('@/components/shared/global-confirm', () => ({
  confirm: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn()
  }
}))

function renderDialog(open = true) {
  return render(
    <ImageReplaceDialog
      open={open}
      onOpenChange={vi.fn()}
      artworkId={42}
      artwork={{ title: '测试作品', externalId: 'work-42', images: [] }}
    />
  )
}

function selectPreviewFile(name: string) {
  const file = new File(['image'], name, { type: 'image/jpeg' })
  fireEvent.change(screen.getByLabelText('选择用于全量替换的媒体与章节文件'), {
    target: { files: [file] }
  })
}

describe('ImageReplaceDialog preview resource lifecycle', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:preview')
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    })
  })

  it('releases preview URLs when the controlled dialog closes', () => {
    const view = renderDialog()
    selectPreviewFile('work-42_p1.jpg')

    expect(URL.createObjectURL).toHaveBeenCalledOnce()

    view.rerender(
      <ImageReplaceDialog
        open={false}
        onOpenChange={vi.fn()}
        artworkId={42}
        artwork={{ title: '测试作品', externalId: 'work-42', images: [] }}
      />
    )

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
    expect(screen.getByText('媒体: 0 个')).toBeTruthy()
  })

  it('releases preview URLs when an expanded row unmounts directly', () => {
    const view = renderDialog()
    selectPreviewFile('work-42_p2.jpg')

    view.unmount()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })
})
