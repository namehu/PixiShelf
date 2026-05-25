import { useState, useCallback, useRef } from 'react'

export interface UseDragImagesProps {
  /** Callback when files are successfully dropped and scanned */
  onDrop?: (files: File[]) => void
  /** Callback when drag state changes (dragging over the area) */
  onDragStateChange?: (isDragging: boolean) => void
  /** Disable drag and drop functionality */
  disabled?: boolean
}

export interface UseDragImagesReturn {
  /** Whether a drag operation is currently active over the drop zone */
  isDragging: boolean
  /** Event handlers to bind to the drop zone element */
  dragHandlers: {
    onDragEnter: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
  /** Reset the drag state manually */
  resetDragState: () => void
}

/**
 * Custom hook to handle drag and drop of files/folders with recursive scanning
 * @example
 * const { isDragging, dragHandlers } = useDragImages({
 *   onDrop: (files) => console.log(files)
 * })
 *
 * <div {...dragHandlers} className={isDragging ? 'bg-blue-100' : ''}>
 *   Drop files here
 * </div>
 */
export function useDragImages({
  onDrop,
  onDragStateChange,
  disabled = false
}: UseDragImagesProps = {}): UseDragImagesReturn {
  const [isDragging, setIsDragging] = useState(false)
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
      resetDragState()

      const items = e.dataTransfer.items
      if (!items) return

      const fileList: File[] = []
      const promises: Promise<void>[] = []

      for (const item of Array.from(items)) {
        // webkitGetAsEntry is non-standard but supported in most modern browsers for folder drop
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
