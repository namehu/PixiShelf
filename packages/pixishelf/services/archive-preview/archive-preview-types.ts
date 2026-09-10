export type ArchivePreviewSourceInput =
  | { kind: 'artwork'; externalRefId: string }
  | { kind: 'task'; taskId: string }
  | { kind: 'intake'; itemId: string }
  | { kind: 'catalog'; itemId: string }
  | { kind: 'url'; url: string }

export interface ArchivePreviewSourceDto {
  externalRefId: string
  providerKey: string
  label: string
}

export interface ArchivePreviewThumbnailDto {
  ordinal: number
  url: string
  width: number
  height: number
  crop?: { x: number; y: number; width: number; height: number }
}

export interface ArchivePreviewPageDto {
  title: string
  total: number | null
  page: number
  items: ArchivePreviewThumbnailDto[]
  nextPage: number | null
}

export interface OpenArchivePreviewDto extends ArchivePreviewPageDto {
  previewId: string
}
