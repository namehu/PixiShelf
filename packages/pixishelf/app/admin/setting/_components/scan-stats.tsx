import { ScanResult } from '@/types'
import { Image, Layers, RefreshCcw, FilePlus } from 'lucide-react'
import { AdminMetric } from '../../_components/admin-workbench'
import { Badge } from '@/components/ui/badge'

export function ScanStats({ result }: { result: ScanResult }) {
  if (!result) return null

  return (
    <div className="grid grid-cols-2 gap-x-4 md:grid-cols-4">
      <AdminMetric
        label="发现作品"
        value={result.totalArtworks}
        icon={<Layers className="size-4" aria-hidden="true" />}
      />

      {/* 2. 新增作品 - 绿色主题 (核心指标，高亮) */}
      <AdminMetric
        label="新增作品"
        value={
          <div className="flex items-center gap-2">
            {result.newArtworks}
            {result.newArtworks > 0 && (
              <Badge variant="success">新增</Badge>
            )}
          </div>
        }
        icon={<FilePlus className="size-4" aria-hidden="true" />}
        description={result.newArtworks > 0 ? '数据库已成功入库' : '无新增内容'}
      />

      {/* 3. 新增图片 - 紫色主题 */}
      <AdminMetric
        label="新增图片"
        value={result.newImages}
        icon={<Image className="size-4" aria-hidden="true" />}
      />

      {/* 4. 强扫重建作品 */}
      <AdminMetric
        label="重建 Pixiv 作品"
        value={result.removedArtworks || 0}
        icon={<RefreshCcw className="size-4" aria-hidden="true" />}
        description={result.removedArtworks ? '强扫时删除并重新扫描' : '本次未重建已有作品'}
      />
    </div>
  )
}
