import { useState, useCallback, useRef } from 'react'

export interface UseDragImagesProps {
  /** 文件拖入并扫描完成后的回调 */
  onDrop?: (files: File[]) => void
  /** 拖拽状态变化回调（悬停区域状态） */
  onDragStateChange?: (isDragging: boolean) => void
  /** 禁用拖拽处理开关 */
  disabled?: boolean
}

export interface UseDragImagesReturn {
  /** 当前是否处于可拖拽悬停态 */
  isDragging: boolean
  /** 绑定到 drop area 的事件处理器 */
  dragHandlers: {
    onDragEnter: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => Promise<void>
  }
  /** 手动重置拖拽态 */
  resetDragState: () => void
}

/**
 * 自定义 Hook：递归扫描文件/文件夹并聚合为文件列表
 * @example
 * const { isDragging, dragHandlers } = useDragImages({
 *   onDrop: (files) => console.log(files)
 * })
 *
 * <div {...dragHandlers} className={isDragging ? 'bg-blue-100' : ''}>
 *   将文件拖拽到此处
 * </div>
 */
export function useDragImages({
  onDrop,
  onDragStateChange,
  disabled = false
}: UseDragImagesProps = {}): UseDragImagesReturn {
  const [isDragging, setIsDragging] = useState(false)
  // 拖拽事件在嵌套元素间会成对冒泡，使用计数器可避免子元素 leave 后误判为离开整个 drop area。
  const dragCounterRef = useRef(0)

  const updateDragState = useCallback(
    (dragging: boolean) => {
      setIsDragging(dragging)
      onDragStateChange?.(dragging)
    },
    [onDragStateChange]
  )

  const resetDragState = useCallback(() => {
    dragCounterRef.current = 0
    updateDragState(false)
  }, [updateDragState])

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current += 1
      if (dragCounterRef.current === 1) {
        updateDragState(true)
      }
    },
    [disabled, updateDragState]
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current -= 1
      if (dragCounterRef.current === 0) {
        updateDragState(false)
      }
    },
    [disabled, updateDragState]
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
    },
    [disabled]
  )

  const scanEntry = async (entry: any, fileList: File[]) => {
    if (entry.isFile) {
      return new Promise<void>((resolve) => {
        entry.file(
          (file: File) => {
            fileList.push(file)
            resolve()
          },
          (err: any) => {
            console.warn('Failed to read file:', entry.name, err)
            resolve()
          }
        )
      })
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      const readEntries = async () => {
        return new Promise<void>((resolve) => {
          reader.readEntries(
            async (entries: any[]) => {
              if (entries.length === 0) {
                resolve()
                return
              }
              await Promise.all(entries.map((e) => scanEntry(e, fileList)))
              await readEntries()
              resolve()
            },
            (err: any) => {
              console.warn('Failed to read directory:', entry.name, err)
              resolve()
            }
          )
        })
      }
      await readEntries()
    }
  }

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
      // 清空 hover 状态，防止异步扫描期间视觉标记滞留（特别是快速拖入放下场景）。
      resetDragState()

      const items = e.dataTransfer.items
      if (!items) return

      const fileList: File[] = []
      const promises: Promise<void>[] = []

      for (const item of Array.from(items)) {
        // webkitGetAsEntry 非标准但在拖拽目录场景中是实际可用且最稳妥的入口。
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null
        if (entry) {
          promises.push(scanEntry(entry, fileList))
        } else if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) fileList.push(file)
        }
      }

      try {
        await Promise.all(promises)
        if (fileList.length > 0) {
          onDrop?.(fileList)
        }
      } catch (error) {
        console.error('Error scanning dropped files:', error)
      }
    },
    [disabled, onDrop, resetDragState]
  )

  return {
    isDragging,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop
    },
    resetDragState
  }
}
