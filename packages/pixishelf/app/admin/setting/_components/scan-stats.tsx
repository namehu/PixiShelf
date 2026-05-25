import { ScanResult } from '@/types'
import { Image, Layers, Trash2, FilePlus } from 'lucide-react'
import { StatCard } from '@/components/shared/stat-card'

export function ScanStats({ result }: { result: ScanResult }) {
  if (!result) return null

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* 1. 发现作品 - 蓝色主题 */}
      <StatCard
        title="发现作品"
        value={result.totalArtworks}
        icon={<Layers className="w-4 h-4 text-blue-500" />}
        className="bg-blue-50/50 border-blue-100 hover:border-blue-200 transition-colors"
      />

      {/* 2. 新增作品 - 绿色主题 (核心指标，高亮) */}
      <StatCard
        title="新增作品"
        value={
          <div className="flex items-center gap-2">
            {result.newArtworks}
            {result.newArtworks > 0 && (
              <span className="text-xs font-normal text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full">+NEW</span>
            )}
          </div>
        }
        icon={<FilePlus className="w-4 h-4 text-green-600" />}
        description={result.newArtworks > 0 ? '数据库已成功入库' : '无新增内容'}
        className="bg-green-50/50 border-green-100 hover:border-green-200 transition-colors shadow-sm"
      />

      {/* 3. 新增图片 - 紫色主题 */}
      <StatCard
        title="新增图片"
        value={result.newImages}
        icon={<Image className="w-4 h-4 text-purple-500" />}
        className="bg-purple-50/50 border-purple-100 hover:border-purple-200 transition-colors"
      />

      {/* 4. 删除作品 - 橙色/红色主题 */}
      <StatCard
        title="清理作品"
        value={result.removedArtworks || 0}
        icon={<Trash2 className="w-4 h-4 text-orange-500" />}
        description={result.removedArtworks ? '已清理无效文件夹' : '无无效数据'}
        className="bg-orange-50/50 border-orange-100 hover:border-orange-200 transition-colors"
      />
    </div>
  )
}
