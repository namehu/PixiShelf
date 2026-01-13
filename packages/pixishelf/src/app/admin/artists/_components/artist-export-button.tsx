'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { exportIncompleteArtistsAction } from '@/actions/artist-action'

export function ArtistExportButton() {
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    try {
      setIsExporting(true)
      const { data = [] } = await exportIncompleteArtistsAction({})

      if (!data.length) {
        toast.info('没有找到需要导出的数据')
        return
      }

      // 创建 blob 并下载
      const content = data.join('\n')
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `incomplete_artists_${new Date().toISOString().split('T')[0]}.txt`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast.success(`成功导出 ${data.length} 条未完善用户ID`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : '导出过程中发生未知错误'
      toast.error(msg)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={isExporting}
      className="flex items-center gap-2"
    >
      {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      导出未完善用户ID
    </Button>
  )
}
