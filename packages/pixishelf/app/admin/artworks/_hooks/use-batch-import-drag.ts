import { useState, useCallback, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'

export interface BatchImportItem {
  /** 该条批量导入项的内部 id，用于列表渲染与后续命令索引。 */
  id: string
  /** 在导入列表显示的作品标题；当前实现默认使用文件名去扩展名。 */
  title: string
  /** 当前仅支持单文件作品导入；预留 collection 用于后续支持整目录映射。 */
  type: 'single' | 'collection'
  files: File[]
  /** 该项包含文件数量，当前类型下恒为 1。 */
  fileCount: number
  /** 原始路径信息，现阶段仅保存文件名形式，用于调试或展示。 */
  originalPath: string
}

export interface UseBatchImportDragProps {
  /** 扫描完成后返回可直接消费的作品 import 条目。 */
  onDrop?: (items: BatchImportItem[]) => void
  /** true 时禁用拖拽响应（包含视觉状态与数据扫描）。 */
  disabled?: boolean
}

/**
 * 使用 webkit entry 递归扫描拖拽目录，兼容单文件与文件夹输入。
 * 约束：最终仍按“每个文件一个作品”扁平化输出，不做目录到作品的层级映射。
 */
export function useBatchImportDrag({ onDrop, disabled }: UseBatchImportDragProps = {}) {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  // 递归入口：统一把文件项与目录项都转为 File[]，用于后续统一验证/入队。
  const scanEntry = async (entry: any, path: string = ''): Promise<File[]> => {
    if (entry.isFile) {
      return new Promise<File[]>((resolve) => {
        entry.file(
          (file: File) => resolve([file]),
          () => resolve([])
        )
      })
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      const readEntries = async (): Promise<File[]> => {
        return new Promise((resolve) => {
          reader.readEntries(
            async (entries: any[]) => {
              if (entries.length === 0) {
                resolve([])
                return
              }
              const filesPromises = entries.map((e) => scanEntry(e, path + entry.name + '/'))
              const filesArrays = await Promise.all(filesPromises)
              const files = filesArrays.flat()

              // 继续读取（有些浏览器限制一次只能读部分 entries）
              const nextFiles = await readEntries()
              resolve([...files, ...nextFiles])
            },
            () => resolve([])
          )
        })
      }
      return readEntries()
    }
    return []
  }

  // 将 DataTransferItemList 全量扫描为文件数组，再映射为单文件 ImportItem，便于批量导入流程复用。
  const processEntries = async (items: DataTransferItemList) => {
    const rootEntries = Array.from(items)
      .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
      .filter(Boolean)

    const importItems: BatchImportItem[] = []

    for (const entry of rootEntries) {
      if (!entry) continue

      // 无论是文件还是文件夹，都扫描出所有文件
      const files = await scanEntry(entry)

      // 过滤隐藏文件
      const mediaFiles = files.filter((f) => !f.name.startsWith('.'))

      // 将每个文件都作为一个独立作品
      for (const file of mediaFiles) {
        importItems.push({
          id: uuidv4(),
          title: file.name.replace(/\.[^/.]+$/, ''), // 去除扩展名
          type: 'single',
          files: [file],
          fileCount: 1,
          originalPath: '/' + file.name // 这里简化路径展示，只展示文件名，或者可以用 file.webkitRelativePath (如果 available)
        })
      }
    }

    return importItems
  }

  // 新增：处理普通文件列表（来自 input）
  // 扁平化处理，所有文件均为独立作品
  const processFiles = useCallback((fileList: File[]) => {
    const items: BatchImportItem[] = []

    for (const file of fileList) {
      if (file.name.startsWith('.')) continue

      items.push({
        id: uuidv4(),
        title: file.name.replace(/\.[^/.]+$/, ''),
        type: 'single',
        files: [file],
        fileCount: 1,
        originalPath: '/' + file.name
      })
    }

    return items
  }, [])

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current += 1
      if (dragCounterRef.current === 1) setIsDragging(true)
    },
    [disabled]
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current -= 1
      if (dragCounterRef.current === 0) setIsDragging(false)
    },
    [disabled]
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
    },
    [disabled]
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      dragCounterRef.current = 0

      if (e.dataTransfer.items) {
        // 优先走目录扫描路径：可同时解析拖入目录与文件，且不依赖 items.files 兼容性。
        const items = await processEntries(e.dataTransfer.items)
        if (items.length > 0) {
          onDrop?.(items)
        }
      }
    },
    [disabled, onDrop]
  )

  return {
    isDragging,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop
    },
    processFiles
  }
}
