/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react'
import { useDragImages } from './use-drag-images'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock DataTransfer and FileSystemEntry
class MockDataTransferItem {
  kind: string
  type: string
  file: File | null = null
  entry: any = null

  constructor(kind: string, type: string, file?: File, entry?: any) {
    this.kind = kind
    this.type = type
    this.file = file || null
    this.entry = entry || null
  }

  getAsFile() {
    return this.file
  }

  webkitGetAsEntry() {
    return this.entry
  }
}

describe('useDragImages 拖拽逻辑', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('初始化时 isDragging 应为 false', () => {
    const { result } = renderHook(() => useDragImages())
    expect(result.current.isDragging).toBe(false)
  })

  it('拖拽进入/离开时应正确更新 isDragging 状态', () => {
    const { result } = renderHook(() => useDragImages())
    const { dragHandlers } = result.current

    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const mockEvent = { preventDefault, stopPropagation } as any

    // 拖拽进入
    act(() => {
      dragHandlers.onDragEnter(mockEvent)
    })
    expect(result.current.isDragging).toBe(true)
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()

    // 拖拽离开
    act(() => {
      dragHandlers.onDragLeave(mockEvent)
    })
    expect(result.current.isDragging).toBe(false)
  })

  it('应正确处理嵌套元素的拖拽进入/离开（计数器逻辑）', () => {
    const { result } = renderHook(() => useDragImages())
    const { dragHandlers } = result.current
    const mockEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as any

    // 进入父元素
    act(() => {
      dragHandlers.onDragEnter(mockEvent)
    })
    expect(result.current.isDragging).toBe(true)

    // 进入子元素
    act(() => {
      dragHandlers.onDragEnter(mockEvent)
    })
    expect(result.current.isDragging).toBe(true)

    // 离开子元素
    act(() => {
      dragHandlers.onDragLeave(mockEvent)
    })
    expect(result.current.isDragging).toBe(true) // 仍在父元素中，保持 true

    // 离开父元素
    act(() => {
      dragHandlers.onDragLeave(mockEvent)
    })
    expect(result.current.isDragging).toBe(false)
  })

  it('应响应 Drop 事件并解析文件列表', async () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useDragImages({ onDrop }))
    const { dragHandlers } = result.current

    const file1 = new File(['content'], 'test1.png', { type: 'image/png' })
    const mockItems = [new MockDataTransferItem('file', 'image/png', file1)]

    const mockEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        items: mockItems
      }
    } as any

    await act(async () => {
      await dragHandlers.onDrop(mockEvent)
    })

    expect(result.current.isDragging).toBe(false)
    expect(onDrop).toHaveBeenCalledWith([file1])
  })

  it('应支持递归扫描文件夹内容', async () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useDragImages({ onDrop }))
    const { dragHandlers } = result.current

    const fileInDir = new File(['content'], 'nested.png', { type: 'image/png' })

    // Mock FileSystemEntry structure
    const mockEntry = {
      isFile: false,
      isDirectory: true,
      name: 'folder',
      createReader: () => ({
        readEntries: (success: any) => {
          // Return one file entry then empty to finish
          success([
            {
              isFile: true,
              isDirectory: false,
              name: 'nested.png',
              file: (cb: any) => cb(fileInDir)
            }
          ])
          // Second call returns empty array to stop recursion
          // But wait, the loop calls readEntries again.
          // Simplified mock: just call success once with entries,
          // then the recursive logic will call readEntries again.
          // We need a stateful mock or a simpler approach.
        }
      })
    }

    // Improving the mock for recursion
    let readCount = 0
    mockEntry.createReader = () => ({
      readEntries: (success: any) => {
        if (readCount === 0) {
          readCount++
          success([
            {
              isFile: true,
              isDirectory: false,
              name: 'nested.png',
              file: (cb: any) => cb(fileInDir)
            }
          ])
        } else {
          success([])
        }
      }
    })

    const mockItems = [new MockDataTransferItem('file', '', undefined, mockEntry)]

    const mockEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        items: mockItems
      }
    } as any

    await act(async () => {
      await dragHandlers.onDrop(mockEvent)
    })

    expect(onDrop).toHaveBeenCalledWith(expect.arrayContaining([fileInDir]))
  })

  it('禁用状态下不应触发任何回调', () => {
    const { result } = renderHook(() => useDragImages({ disabled: true }))
    const { dragHandlers } = result.current
    const mockEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as any

    act(() => {
      dragHandlers.onDragEnter(mockEvent)
    })

    expect(result.current.isDragging).toBe(false)
    expect(mockEvent.preventDefault).not.toHaveBeenCalled()
  })
})
