import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDragDropStore } from '../../_store/drag-drop-store'
import type { ImageListItem } from '../../_components/types'
import { useArtworkMediaUpload } from '../use-artwork-media-upload'

const mocks = vi.hoisted(() => ({
  getUploadPath: vi.fn(),
  addImage: vi.fn(),
  uploadSingleFile: vi.fn()
}))

vi.mock('@/lib/trpc', () => ({
  useTRPCClient: () => ({
    artwork: {
      getUploadPath: { query: mocks.getUploadPath },
      addImage: { mutate: mocks.addImage }
    }
  })
}))

vi.mock('../use-chunk-upload', () => ({
  useChunkUpload: () => ({ uploadSingleFile: mocks.uploadSingleFile })
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}))

function image(id: number, sortOrder: number): ImageListItem {
  return {
    id,
    path: `/artist/work/image-${id}.jpg`,
    sortOrder,
    width: 100,
    height: 100,
    size: 10
  }
}

function dragEvent(clientX: number, files: File[] = []) {
  return {
    clientX,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, width: 100 })
    },
    dataTransfer: {
      items: files.map((file) => ({
        kind: 'file',
        getAsFile: () => file,
        webkitGetAsEntry: () => null
      }))
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn()
  } as any
}

describe('useArtworkMediaUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDragDropStore.getState().resetQueue()
  })

  it('routes a left-side drop to add with the first file and next sort order', async () => {
    const firstFile = new File(['first'], 'first.jpg', { type: 'image/jpeg' })
    const ignoredFile = new File(['second'], 'second.jpg', { type: 'image/jpeg' })
    const { result } = renderHook(() =>
      useArtworkMediaUpload({
        artwork: { id: 1, externalId: 'work-1', images: [] },
        imageList: [image(1, 2), image(2, 7)]
      })
    )

    const event = dragEvent(25, [firstFile, ignoredFile])
    await act(async () => {
      result.current.dragHandlers.onDragEnter(event)
      result.current.dragHandlers.onDragOver(event)
      await result.current.dragHandlers.onDrop(event)
    })

    expect(result.current.addDialog.open).toBe(true)
    expect(result.current.addDialog.initialFile).toBe(firstFile)
    expect(result.current.addDialog.defaultOrder).toBe(8)
    expect(result.current.replaceDialog.open).toBe(false)
  })

  it('routes a right-side drop to full replacement with every scanned file', async () => {
    const files = [
      new File(['first'], 'first.jpg', { type: 'image/jpeg' }),
      new File(['second'], 'second.jpg', { type: 'image/jpeg' })
    ]
    const { result } = renderHook(() =>
      useArtworkMediaUpload({ artwork: { id: 2, externalId: 'work-2', images: [] }, imageList: [] })
    )

    const event = dragEvent(75, files)
    await act(async () => {
      result.current.dragHandlers.onDragEnter(event)
      result.current.dragHandlers.onDragOver(event)
      await result.current.dragHandlers.onDrop(event)
    })

    expect(result.current.replaceDialog.open).toBe(true)
    expect(result.current.addDialog.open).toBe(false)
    expect(useDragDropStore.getState().fileQueue).toEqual(files)
  })

  it('keeps drag activation local when more than one target is mounted', () => {
    const { result } = renderHook(() => ({
      first: useArtworkMediaUpload({ artwork: { id: 1, images: [] }, imageList: [] }),
      second: useArtworkMediaUpload({ artwork: { id: 2, images: [] }, imageList: [] })
    }))

    act(() => {
      result.current.first.dragHandlers.onDragEnter(dragEvent(25))
    })

    expect(result.current.first.isDragging).toBe(true)
    expect(result.current.second.isDragging).toBe(false)
  })

  it('keeps the existing add upload naming and refresh flow', async () => {
    const onSuccess = vi.fn()
    const file = new File(['image'], 'source.png', { type: 'image/png' })
    mocks.getUploadPath.mockResolvedValue({ targetDir: '/absolute/work', targetRelDir: 'artist/work' })
    mocks.uploadSingleFile.mockResolvedValue({
      fileName: 'storage-key_p4.png',
      width: 800,
      height: 600,
      size: 1024,
      path: 'artist/work/storage-key_p4.png'
    })
    mocks.addImage.mockResolvedValue({ id: 99 })
    const { result } = renderHook(() =>
      useArtworkMediaUpload({
        artwork: { id: 3, externalId: 'external-id', storageKey: 'storage-key', images: [] },
        imageList: [],
        onSuccess
      })
    )

    act(() => result.current.openAddDialog(file))
    await act(async () => {
      await result.current.addDialog.onSubmit(file, 4)
    })

    expect(mocks.uploadSingleFile).toHaveBeenCalledWith(
      file,
      'storage-key_p4.png',
      '/absolute/work',
      'artist/work',
      expect.any(Function)
    )
    expect(mocks.addImage).toHaveBeenCalledWith({
      artworkId: 3,
      file: {
        fileName: 'storage-key_p4.png',
        order: 4,
        width: 800,
        height: 600,
        size: 1024,
        path: 'artist/work/storage-key_p4.png'
      }
    })
    expect(result.current.addDialog.open).toBe(false)
    expect(onSuccess).toHaveBeenCalledOnce()
  })
})
