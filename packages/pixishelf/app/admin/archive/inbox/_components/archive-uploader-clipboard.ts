'use client'

import { toast } from 'sonner'

export async function copyArchiveUploaderUid(uploaderUid: string) {
  try {
    await navigator.clipboard.writeText(uploaderUid)
    toast.success(`已复制 UID ${uploaderUid}`)
  } catch {
    toast.error('复制 UID 失败', { description: '请检查浏览器剪贴板权限。' })
  }
}
