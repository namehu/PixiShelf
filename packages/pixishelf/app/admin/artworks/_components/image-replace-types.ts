export interface PreviewItem {
  id: string
  file: File
  originalName: string
  newName: string
  order: number
  size: number
  error?: string
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  previewUrl?: string
}

export interface ChapterPreviewItem {
  id: string
  file: File
  originalName: string
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  error?: string
}
